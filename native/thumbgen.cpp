// thumbgen.cpp
//
// Batch-generates small cached thumbnails for a directory of wallpapers,
// using all available CPU cores. This exists because the biggest CPU/GPU
// cost in the Electron app was Chromium decoding full-resolution (often
// multi-MB, sometimes animated) wallpaper files just to paint a ~190x128px
// grid thumbnail - on every launch, every scroll, every filter change.
// This tool does that decode+downscale work ONCE per file, in parallel,
// natively, and caches the result as a small static JPEG. Chromium then
// only ever has to load the small cached file.
//
// USAGE:
//   thumbgen <source_dir> <cache_dir> [max_dimension]
//
// OUTPUT: a JSON object on stdout mapping absolute source path -> absolute
// cache thumbnail path, e.g.:
//   {"/home/user/wallpapers/a.png":"/home/user/.cache/wallpaper-picker/thumbs/ab12....jpg"}
//
// Animated formats (GIF/animated WebP) are thumbnailed from their FIRST
// FRAME ONLY - the grid no longer needs to decode/animate every visible
// wallpaper just to show a preview. The original file is untouched and
// still applied with full animation via awww when actually selected.

#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "vendor/stb_image.h"
#include "vendor/stb_image_resize2.h"
#include "vendor/stb_image_write.h"

#include <webp/decode.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace {

// FNV-1a - fast, dependency-free, good enough for a cache key (not
// cryptographic, doesn't need to be for this purpose).
uint64_t fnv1a(const std::string &s) {
  uint64_t h = 1469598103934665603ULL;
  for (unsigned char c : s) {
    h ^= c;
    h *= 1099511628211ULL;
  }
  return h;
}

std::string toHex(uint64_t v) {
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
  return std::string(buf);
}

struct DecodedImage {
  std::vector<unsigned char> rgb; // 3 bytes/pixel, no alpha - thumbnails are opaque
  int width = 0;
  int height = 0;
  bool ok = false;
};

// 8K-ish ceiling (~66 megapixels). Well above any real wallpaper, but low
// enough that even several of these decoded at once across threads stays
// bounded (66MP * 3 bytes ~= 200MB per image, worst case).
constexpr int64_t kMaxSourcePixels = 8000LL * 8000LL;

DecodedImage decodeWebp(const std::string &path) {
  DecodedImage img;
  std::ifstream f(path, std::ios::binary);
  if (!f) return img;
  std::vector<unsigned char> data((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());

  int peekW = 0, peekH = 0;
  if (!WebPGetInfo(data.data(), data.size(), &peekW, &peekH)) return img;
  // Guard against decoding something absurd (corrupt file, malicious
  // dimensions, an accidentally-huge source) into a giant RGB buffer. A
  // handful of these decoded in parallel across threads is exactly what
  // can spike memory hard enough to cause system-wide slowdowns.
  if (static_cast<int64_t>(peekW) * peekH > kMaxSourcePixels) return img;

  int w = 0, h = 0;
  // WebPDecodeRGB pulls the first/only frame for both static and animated
  // WebP - exactly the "static preview" behavior we want for the grid.
  unsigned char *decoded = WebPDecodeRGB(data.data(), data.size(), &w, &h);
  if (!decoded) return img;

  img.rgb.assign(decoded, decoded + (static_cast<size_t>(w) * h * 3));
  img.width = w;
  img.height = h;
  img.ok = true;
  WebPFree(decoded);
  return img;
}

DecodedImage decodeWithStb(const std::string &path) {
  DecodedImage img;
  int w, h, channels;
  if (!stbi_info(path.c_str(), &w, &h, &channels)) return img;
  if (static_cast<int64_t>(w) * h > kMaxSourcePixels) return img;

  // stbi_load on an animated GIF decodes only the first frame - fine here.
  unsigned char *decoded = stbi_load(path.c_str(), &w, &h, &channels, 3);
  if (!decoded) return img;

  img.rgb.assign(decoded, decoded + (static_cast<size_t>(w) * h * 3));
  img.width = w;
  img.height = h;
  img.ok = true;
  stbi_image_free(decoded);
  return img;
}

bool generateThumbnail(const std::string &srcPath, const std::string &destPath, int maxDim) {
  std::string ext;
  {
    auto dot = srcPath.find_last_of('.');
    if (dot != std::string::npos) ext = srcPath.substr(dot + 1);
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
  }

  DecodedImage img = (ext == "webp") ? decodeWebp(srcPath) : decodeWithStb(srcPath);
  if (!img.ok || img.width <= 0 || img.height <= 0) return false;

  double scale = std::min(1.0, static_cast<double>(maxDim) / std::max(img.width, img.height));
  int outW = std::max(1, static_cast<int>(img.width * scale));
  int outH = std::max(1, static_cast<int>(img.height * scale));

  std::vector<unsigned char> resized(static_cast<size_t>(outW) * outH * 3);
  unsigned char *result = stbir_resize_uint8_linear(
      img.rgb.data(), img.width, img.height, 0,
      resized.data(), outW, outH, 0,
      STBIR_RGB);
  if (!result) return false;

  // Quality 82 JPEG - visually clean at thumbnail size, small on disk so
  // reading it back off disk is cheap too.
  int ok = stbi_write_jpg(destPath.c_str(), outW, outH, 3, resized.data(), 82);
  return ok != 0;
}

// Cache key incorporates path + mtime + size, so edited/replaced files
// regenerate automatically instead of serving a stale thumbnail.
std::string cacheKeyFor(const std::string &path) {
  struct stat st{};
  long long mtime = 0, size = 0;
  if (stat(path.c_str(), &st) == 0) {
    mtime = static_cast<long long>(st.st_mtime);
    size = static_cast<long long>(st.st_size);
  }
  std::ostringstream oss;
  oss << path << "|" << mtime << "|" << size;
  return toHex(fnv1a(oss.str()));
}

std::string jsonEscape(const std::string &s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  return out;
}

} // namespace

int main(int argc, char **argv) {
  if (argc < 3) {
    std::cerr << "usage: thumbgen <source_dir> <cache_dir> [max_dimension]\n";
    return 1;
  }

  std::string srcDir = argv[1];
  std::string cacheDir = argv[2];
  int maxDim = argc >= 4 ? std::atoi(argv[3]) : 400;

  std::error_code ec;
  fs::create_directories(cacheDir, ec);

  static const std::vector<std::string> exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"};

  std::vector<std::string> files;
  for (const auto &entry : fs::directory_iterator(srcDir, ec)) {
    if (!entry.is_regular_file()) continue;
    std::string ext = entry.path().extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    if (std::find(exts.begin(), exts.end(), ext) != exts.end()) {
      files.push_back(entry.path().string());
    }
  }

  std::vector<std::pair<std::string, std::string>> results(files.size());
  std::atomic<size_t> nextIndex{0};

  unsigned int threadCount = std::max(1u, std::min(4u, std::thread::hardware_concurrency()));
  std::vector<std::thread> workers;

  for (unsigned int t = 0; t < threadCount; ++t) {
    workers.emplace_back([&]() {
      size_t i;
      while ((i = nextIndex.fetch_add(1)) < files.size()) {
        const std::string &src = files[i];
        std::string key = cacheKeyFor(src);
        std::string dest = (fs::path(cacheDir) / (key + ".jpg")).string();

        bool needsGeneration = !fs::exists(dest);
        if (needsGeneration) {
          if (!generateThumbnail(src, dest, maxDim)) {
            // Decode failed (corrupt file, unsupported variant, etc) - fall
            // back to the original path so the app still shows *something*.
            dest = src;
          }
        }
        results[i] = {src, dest};
      }
    });
  }
  for (auto &w : workers) w.join();

  std::ostringstream out;
  out << "{";
  for (size_t i = 0; i < results.size(); ++i) {
    if (i > 0) out << ",";
    out << "\"" << jsonEscape(results[i].first) << "\":\"" << jsonEscape(results[i].second) << "\"";
  }
  out << "}";
  std::cout << out.str() << std::endl;

  return 0;
}
