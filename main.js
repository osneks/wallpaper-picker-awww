const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { existsSync, readFileSync } = require('fs');
const { execFile } = require('child_process');

// This app is overlay-only: it always runs as a wlr-layer-shell surface
// via the shim in overlay/, which requires Electron's GTK/XWayland window
// path rather than native Ozone/Wayland - so no Ozone GPU switches here.

const DEFAULT_WALLPAPER_DIR =
  process.env.WALLPAPER_DIR || path.join(process.env.HOME, '.config/hypr/wallpaper_animated');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const STATE_FILE = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'wallpaper-index');
const APPLY_SCRIPT = path.join(__dirname, 'scripts', 'apply-wallpaper.sh');
const THUMBGEN_BIN = path.join(__dirname, 'native', 'thumbgen');
const THUMB_CACHE_DIR = path.join(app.getPath('userData'), 'thumb-cache');
const THUMB_MAX_DIM = 400;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveConfig(cfg) {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function getWallpaperDir() {
  const cfg = loadConfig();
  return cfg.wallpaperDir || DEFAULT_WALLPAPER_DIR;
}

async function listWallpapers() {
  const dir = getWallpaperDir();
  if (!existsSync(dir)) return [];

  try {
    const files = await fs.readdir(dir);
    const wallpapers = files
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
      .map((f) => {
        const filePath = path.join(dir, f);
        const type = path.extname(f).slice(1).toUpperCase();
        return { path: filePath, thumb: filePath, type };
      });

    wallpapers.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.path.localeCompare(b.path);
    });

    await attachThumbnails(wallpapers, dir);

    return wallpapers;
  } catch {
    return [];
  }
}

// Runs the native thumbgen binary (see native/thumbgen.cpp) to get small,
// pre-decoded cached thumbnails instead of handing Chromium full-resolution
// (sometimes multi-MB, sometimes animated) source images to decode just to
// paint a small grid thumbnail. This is the biggest CPU/GPU cost in the
// whole app, so this is where native code actually earns its keep.
//
// Fully optional: if the binary hasn't been built (native/build.sh), every
// wallpaper's `thumb` just stays equal to its `path` and the app behaves
// exactly as before - nothing breaks if you skip this.
function attachThumbnails(wallpapers, dir) {
  if (!existsSync(THUMBGEN_BIN)) return Promise.resolve();

  return new Promise((resolve) => {
    const child = execFile(
      THUMBGEN_BIN,
      [dir, THUMB_CACHE_DIR, String(THUMB_MAX_DIM)],
      { timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          console.error('thumbgen failed, falling back to full-res images:', error.message);
          return resolve();
        }
        try {
          const map = JSON.parse(stdout);
          for (const wp of wallpapers) {
            if (map[wp.path]) wp.thumb = map[wp.path];
          }
        } catch (e) {
          console.error('thumbgen produced invalid JSON:', e.message);
        }
        resolve();
      }
    );
    child.on('error', () => resolve());
  });
}

async function readCurrentIndex(maxCount) {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const n = parseInt(raw.trim(), 10);
    if (Number.isNaN(n) || n < 0 || (maxCount !== undefined && n >= maxCount)) {
      return -1;
    }
    return n;
  } catch {
    return -1;
  }
}

let mainWindow;

// --- Single-instance lock ---------------------------------------------------
// Without this, every press of the overlay keybind spawned a brand new,
// complete Electron process (main + renderer + GPU process - Chromium is
// multi-process even for one window). mainWindow.on('blur', hide) only
// hides a window, it does NOT quit the app, so every one of those extra
// launches stayed resident forever. Repeated keybind presses silently
// accumulated full browser engines in memory until the system ran out of
// RAM/swap - this was almost certainly the actual cause of the slowdown/
// hang, not a leak inside a single running instance.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is already running - hand off to it (via
  // 'second-instance' below) and exit immediately instead of starting a
  // second full Chromium stack.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    // Toggle behavior, matching rofi/wofi: press again while it's open
    // to close it, press while hidden to reopen it - either way, reuses
    // the one existing window instead of creating another process.
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    // Both are somewhat moot once the overlay/ shim promotes this to a
    // real layer-shell surface (Hyprland/wlroots own its stacking and it's
    // never in a taskbar to begin with), but harmless to set regardless.
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      // Caches compiled V8 bytecode for renderer.js/preload.js on disk after
      // the first run, so subsequent launches skip re-parsing/compiling JS
      // from scratch. Small win, but a real one on every launch.
      v8CacheOptions: 'code',
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // On Wayland/Hyprland, show() alone doesn't reliably grant keyboard
    // focus the way it does on X11 - this was the actual cause of arrow
    // keys (and Enter/Space) doing nothing: clicks work because they don't
    // need focus, keyboard input does.
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  // Rofi/wofi-style dismiss behavior: close on blur or Escape instead of
  // leaving a stray window sitting on top of everything.
  mainWindow.on('blur', () => mainWindow.hide());
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow.hide();
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('wallpapers:list', async () => {
  const wallpapers = await listWallpapers();
  const currentIndex = await readCurrentIndex(wallpapers.length);
  return { wallpapers, currentIndex, folder: getWallpaperDir() };
});

ipcMain.handle('folder:get', () => getWallpaperDir());

ipcMain.handle('folder:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose wallpaper folder',
    properties: ['openDirectory'],
    defaultPath: getWallpaperDir(),
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { changed: false, folder: getWallpaperDir() };
  }

  const chosen = result.filePaths[0];
  const cfg = loadConfig();
  cfg.wallpaperDir = chosen;
  await saveConfig(cfg);

  return { changed: true, folder: chosen };
});

ipcMain.handle('wallpapers:select', (_event, { index, targetPath }) => {
  if (!Number.isInteger(index) || index < 0 || !targetPath) {
    return Promise.reject(new Error('Invalid parameters'));
  }

  return new Promise((resolve, reject) => {
    execFile('bash', [APPLY_SCRIPT, String(index), targetPath], (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
      } else {
        resolve({ ok: true, index, path: targetPath });
      }
    });
  });
});

// IPC: Delete file
ipcMain.handle('wallpapers:delete', async (_event, filePath) => {
  try {
    await fs.unlink(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC: Show file in Linux File Manager
ipcMain.handle('wallpapers:show-in-folder', (_event, filePath) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

// IPC: Copy dropped files into current directory
ipcMain.handle('wallpapers:add', async (_event, filePaths) => {
  const destDir = getWallpaperDir();
  let addedCount = 0;

  for (const src of filePaths) {
    const ext = path.extname(src).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      const fileName = path.basename(src);
      const dest = path.join(destDir, fileName);
      try {
        await fs.copyFile(src, dest);
        addedCount++;
      } catch (e) {
        console.error(`Failed to copy ${src}:`, e);
      }
    }
  }

  return { ok: true, addedCount };
});