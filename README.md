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

An Electron wallpaper picker for Hyprland, with an optional rofi-style
layer-shell overlay mode and a native C++ thumbnail generator for low CPU
usage. Built for Arch + Hyprland + `awww`.

## Prerequisites

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

##Install

Extract the archive and run the installer:

```bash
tar -xzf wallpaper-picker.tar.gz
cd wallpaper-picker
./install.sh --all
```

`--all` builds everything: the overlay shim and the native thumbnailer.
If you only want the base app, run `./install.sh` with no flags — you can
always come back and run `./install.sh --all` again later, it's safe to
re-run.

Individual flags, if you want to be selective:

```bash
./install.sh                 # app only
./install.sh --with-overlay  # + rofi-style layer-shell overlay
./install.sh --with-native   # + native C++ thumbnail generator
./install.sh --all           # everything
```

What it does:
- Copies the app to `~/.local/share/wallpaper-picker`
- Installs Electron locally if it's not already on your system
- Installs the `wallpick` command to `~/.local/bin`
- Creates your wallpaper folder (`~/.config/hypr/wallpaper_animated` by
  default) if it doesn't exist yet
- Builds the overlay shim / native thumbnailer if requested

If `~/.local/bin` isn't on your `PATH`, the installer tells you and prints
the line to add to your shell rc.

## Usage

```bash
wallpick                             # normal window, current default folder
wallpick ~/Pictures/wallpapers       # normal window, this folder only this run
wallpick -o                          # rofi-style overlay
wallpick -o ~/Pictures/wallpapers    # overlay, this folder only this run
wallpick set-dir ~/Pictures/wallpapers   # persist a folder as the default
```

Inside the app: Enter/Space to apply the focused wallpaper, click a card to apply it directly, or use its ⋮ menu
to show-in-file-manager / copy path / delete. Type filter chips (All / PNG
/ JPG / WEBP / GIF) sit above the grid. Drag and drop image files onto the
window to import them into the current folder.

## Wiring up Hyprland

Add to `hyprland.lua`:

```lua
-- Open the overlay
hl.bind(mainMod .. "+ up", hl.dsp.exec_cmd("wallpick -o"))

-- Cycle without opening the UI (reads/writes the same state file)
hl.bind(mainMod .. "+ bracketright", hl.dsp.exec_cmd("bash ~/.local/share/wallpaper-picker/scripts/wallpaper-cycle.sh next"))
hl.bind(mainMod .. "+ bracketleft",  hl.dsp.exec_cmd("bash ~/.local/share/wallpaper-picker/scripts/wallpaper-cycle.sh prev"))
```

> **Heads up:** `hl.dsp.exec_cmd` runs in Hyprland's own environment, which
> doesn't always inherit your shell's `PATH`. If the `wallpick -o` bind does
> nothing, swap in the absolute path: `hl.dsp.exec_cmd("~/.local/bin/wallpick -o")`.

## Troubleshooting

**Nothing happens when I apply a wallpaper.**
Check `awww-daemon` is actually running: `pgrep -a awww-daemon`. If it's
not, start it (`awww-daemon &`) or add it to your Hyprland autostart.

**Applying feels slow.**
The scripts auto-clear `awww`'s cache if a single apply takes ≥3 seconds
(tune with `AWWW_SLOW_THRESHOLD=<seconds>`), so an occasional slow load
should self-correct on the next one. If every apply is consistently slow,
build the native thumbnailer (`./install.sh --with-native`) — full-size
image decoding on every render is the usual cause.

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

## Uninstalling

```bash
rm -rf ~/.local/share/wallpaper-picker
rm -f ~/.local/bin/wallpick
rm -rf ~/.config/wallpaper-picker
```
(Your actual wallpaper image files are untouched — this only removes the
app itself.)

## Project layout (for reference)

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




