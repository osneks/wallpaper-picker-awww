# wallpaper picker awww

wallpaper picker is a simple vibe coded wallpaper picker overly made with [awww](https://codeberg.org/LGFae/awww) 

# Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Wiring up Hyprland](# "Wiring up Hyprland")
- [Troubleshooting](#Troubleshooting)
- [Uninstalling](#Uninstalling)
- [Project layout](# "Project layout")

## Features
-True wlr-layer-shell surface (like rofi/wofi) — renders above everything, including fullscreen apps/games, not just normal windows. Achieved via an LD_PRELOAD shim (liblayer-shell-shim.c) that hooks Electron's first
-No taskbar entry, no window-manager chrome from Hyprland at all — it's not a managed window once promoted.
-Escape or clicking away (losing focus) hides it instantly — same dismiss pattern as rofi/wofi.
-Grid of wallpapers grouped by type (JPG/PNG/WEBP/GIF), with type-filter chips at the top.
-Click, or the ⋮ menu per card: apply, show in file manager, copy path, delete.
-Drag-and-drop import of new wallpaper files.
-Runs via Electron's GTK/XWayland backend instead of native Ozone/Wayland, because the layer-shell shim needs a real GtkWindow to hook — the Wayland-native GPU flags (ozone-platform=wayland, zero-copy, etc.) are skipped for this launch path only. Fine for something opened briefly like a launcher; the normal windowed wallpick still gets the fast path.
-Only the first GtkWindow Electron creates gets converted to a layer surface — a safety-scoped hook, not a general-purpose one.

## Installation

## 1. Prerequisites

```bash
sudo pacman -S nodejs npm awww base-devel gtk3 libwebp
yay -S gtk-layer-shell   # AUR - only needed for overlay mode
```

| Package | Needed for |
|---|---|
| `nodejs`, `npm` | Running the app at all |
| `awww` | Actually applying wallpapers (the daemon the app talks to) |
| `base-devel` | Compiling the overlay shim and/or native thumbnailer |
| `gtk3`, `gtk-layer-shell` | Overlay mode only |
| `libwebp` | Native thumbnailer only (WebP decode) |

Make sure `awww-daemon` is running before you try to apply anything —
`awww-daemon &` once, or add `exec-once = awww-daemon` to `hyprland.conf`/
the Lua equivalent so it starts with your session.

## 2. Install

Extract the archive and run the installer:

```bash
git clone https://github.com/osneks/wallpaper-picker-awww.git && cd wallpaper-picker &&./install.sh --all
```

This is an overlay-only app (rofi/wofi-style), so the overlay shim is
always built as part of a normal install — there's no separate flag for
it anymore. The only optional piece is the native thumbnail generator:

```bash
./install.sh --with-native
```

What it does:
- Copies the app to `~/.local/share/wallpaper-picker`
- Installs Electron locally if it's not already on your system
- Installs the `wallpick` command to `~/.local/bin`
- Creates your wallpaper folder (`~/.config/hypr/wallpaper_animated` by
  default) if it doesn't exist yet
- Builds the overlay shim (and the native thumbnailer if `--with-native`
  was passed)

If `~/.local/bin` isn't on your `PATH`, the installer tells you and prints
the line to add to your shell rc.

## 3. Usage

```bash
wallpick                             # open the overlay, current default folder
wallpick ~/Pictures/wallpapers       # this folder, only for this run
wallpick set-dir ~/Pictures/wallpapers   # persist a folder as the default
```

Inside the app: arrow keys to move around the grid, Enter/Space to apply
the focused wallpaper, click a card to apply it directly, or use its ⋮ menu
to show-in-file-manager / copy path / delete. Type filter chips (All / PNG
/ JPG / WEBP / GIF) sit above the grid. Drag and drop image files onto the
window to import them into the current folder.

## 4. Wiring up Hyprland

Add to `hyprland.lua`:

```lua
-- Open the overlay
hl.bind(mainMod .. "+ up", hl.dsp.exec_cmd("wallpick"))

-- Cycle without opening the UI (reads/writes the same state file)
hl.bind(mainMod .. "+ bracketright", hl.dsp.exec_cmd("bash ~/.local/share/wallpaper-picker/scripts/wallpaper-cycle.sh next"))
hl.bind(mainMod .. "+ bracketleft",  hl.dsp.exec_cmd("bash ~/.local/share/wallpaper-picker/scripts/wallpaper-cycle.sh prev"))
```

> **Heads up:** `hl.dsp.exec_cmd` runs in Hyprland's own environment, which
> doesn't always inherit your shell's `PATH`. If the `wallpick` bind does
> nothing, swap in the absolute path: `hl.dsp.exec_cmd("~/.local/bin/wallpick")`.

## 5. Troubleshooting

**Nothing happens when I apply a wallpaper.**
Check `awww-daemon` is actually running: `pgrep -a awww-daemon`. If it's
not, start it (`awww-daemon &`) or add it to your Hyprland autostart.

**Applying feels slow.**
The scripts auto-clear `awww`'s cache if a single apply takes ≥3 seconds
(tune with `AWWW_SLOW_THRESHOLD=<seconds>`), so an occasional slow load
should self-correct on the next one. If every apply is consistently slow,
build the native thumbnailer (`./install.sh --with-native`) — full-size
image decoding on every render is the usual cause.

**Set-dir on an old build (no such command)?**
Older versions had separate `wallpick -o` overlay mode and a plain windowed
mode. The app is now overlay-only, and `set-dir` ships by default — just
re-run `./install.sh` from this archive.

**Overlay keybind does nothing.**
1. Confirm the shim built: `ls overlay/liblayer-shell-shim.so` inside the
   install directory. If missing, run `overlay/build-shim.sh`.
2. Confirm `gtk-layer-shell` is actually installed (`pkg-config --exists
   gtk-layer-shell-0`).
3. Check the `PATH` issue in section 4 above.

**Overlay shim fails to build.**
```bash
cd ~/.local/share/wallpaper-picker/overlay
./build-shim.sh
```
Needs `gtk-layer-shell` from the AUR — the base Arch repos don't carry it.

**Native thumbnailer fails to build.**
Needs `libwebp` (`sudo pacman -S libwebp`) and a C++17 compiler
(`base-devel`). Run `./native/build.sh` from inside the install directory
directly to see the exact compiler error if it's not obvious.

**High RAM/CPU usage, or the app wouldn't quit and the system slowed down.**
This was a real bug in earlier versions where every overlay keypress
spawned a brand new Electron process that never exited. It's fixed via a
single-instance lock in `main.js` — if you're on an old build, re-extract
this archive and reinstall. If you have leftover zombie processes from
before the fix: `pkill -f wallpaper-picker`, then relaunch.

**Wallpapers not showing up / wrong folder.**
Check what folder is actually configured:
```bash
cat ~/.config/wallpaper-picker/config.json
```
Set it explicitly with `wallpick set-dir <folder>`, or override for a
single run with `wallpick <folder>` / `wallpick -o <folder>`.

## 6. Uninstalling

```bash
rm -rf ~/.local/share/wallpaper-picker
rm -f ~/.local/bin/wallpick
rm -rf ~/.config/wallpaper-picker
```
(Your actual wallpaper image files are untouched — this only removes the
app itself.)

## 7. Project layout (for reference)

```
wallpaper-picker/
├── install.sh              one-command installer
├── main.js                 Electron main process
├── preload.js               IPC bridge
├── package.json
├── renderer/                the UI (HTML/CSS/JS)
├── scripts/
│   ├── apply-wallpaper.sh   called by the app when you apply a wallpaper
│   └── wallpaper-cycle.sh   standalone next/prev, for keybinds
├── overlay/                 rofi-style layer-shell overlay
│   ├── layer-shell-shim.c
│   ├── build-shim.sh
│   └── run-overlay.sh
└── native/                  optional native thumbnail generator
    ├── thumbgen.cpp
    └── build.sh
```
