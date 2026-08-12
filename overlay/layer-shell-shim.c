// layer-shell-shim.c
//
// LD_PRELOAD shim that turns an Electron app's main window into a real
// wlr-layer-shell surface (like rofi/wofi), so it renders above everything
// including fullscreen windows, with no Hyprland window-manager chrome.
//
// WHY THIS EXISTS: Electron has no native layer-shell support. Its
// Ozone/Wayland backend talks to the compositor directly and only ever
// creates plain xdg_toplevel surfaces. Its *older* GTK/XWayland backend,
// however, really does create GtkWindow objects under the hood - and
// gtk-layer-shell works by intercepting exactly that. So this only works
// when Electron is launched WITHOUT --ozone-platform=wayland.
//
// LIMITATION: Electron can create more than one GtkWindow (dialogs,
// devtools, etc). This shim only converts the FIRST toplevel window it
// sees, on the assumption that's your main picker window. If you open
// devtools or a native dialog before the main window appears, adjust the
// counter logic below.
//
// BUILD:
//   gcc -shared -fPIC -o liblayer-shell-shim.so layer-shell-shim.c \
//       $(pkg-config --cflags --libs gtk+-3.0 gtk-layer-shell-0)
//
// RUN:
//   GDK_BACKEND=x11 LD_PRELOAD=$(pwd)/liblayer-shell-shim.so electron .

#define _GNU_SOURCE
#include <dlfcn.h>
#include <gtk/gtk.h>
#include <gtk-layer-shell/gtk-layer-shell.h>
#include <stdlib.h>
#include <string.h>

typedef GtkWidget *(*gtk_window_new_t)(GtkWindowType);

GtkWidget *gtk_window_new(GtkWindowType type) {
    static gtk_window_new_t real_gtk_window_new = NULL;
    static int toplevel_count = 0;

    if (!real_gtk_window_new) {
        real_gtk_window_new = (gtk_window_new_t)dlsym(RTLD_NEXT, "gtk_window_new");
    }

    GtkWidget *window = real_gtk_window_new(type);

    if (getenv("LAYER_SHELL_SHIM_DISABLE")) {
        return window;
    }

    if (type == GTK_WINDOW_TOPLEVEL) {
        toplevel_count++;

        // Only convert the first toplevel (the main picker window).
        // Devtools / dialogs opened later are left as normal windows.
        if (toplevel_count == 1) {
            GtkWindow *gwin = GTK_WINDOW(window);

            gtk_layer_init_for_window(gwin);

            const char *ns = getenv("LAYER_SHELL_NAMESPACE");
            gtk_layer_set_namespace(gwin, ns ? ns : "wallpaper-picker");

            // "overlay" = above fullscreen apps. Use "top" if you want it
            // below fullscreen windows but above normal ones instead.
            const char *layer = getenv("LAYER_SHELL_LAYER");
            GtkLayerShellLayer l = GTK_LAYER_SHELL_LAYER_OVERLAY;
            if (layer && strcmp(layer, "top") == 0) {
                l = GTK_LAYER_SHELL_LAYER_TOP;
            }
            gtk_layer_set_layer(gwin, l);

            // No anchors set = centered on screen, like rofi's default.
            // Set LAYER_SHELL_ANCHOR_TOP=1 etc. if you want it pinned instead.
            if (getenv("LAYER_SHELL_ANCHOR_TOP")) {
                gtk_layer_set_anchor(gwin, GTK_LAYER_SHELL_EDGE_TOP, TRUE);
            }
            if (getenv("LAYER_SHELL_ANCHOR_BOTTOM")) {
                gtk_layer_set_anchor(gwin, GTK_LAYER_SHELL_EDGE_BOTTOM, TRUE);
            }
            if (getenv("LAYER_SHELL_ANCHOR_LEFT")) {
                gtk_layer_set_anchor(gwin, GTK_LAYER_SHELL_EDGE_LEFT, TRUE);
            }
            if (getenv("LAYER_SHELL_ANCHOR_RIGHT")) {
                gtk_layer_set_anchor(gwin, GTK_LAYER_SHELL_EDGE_RIGHT, TRUE);
            }

            // ON_DEMAND: grabs keyboard focus while shown/focused, releases
            // it when hidden - same behavior rofi/wofi use.
            gtk_layer_set_keyboard_mode(gwin, GTK_LAYER_SHELL_KEYBOARD_MODE_ON_DEMAND);

            // Don't reserve screen space for it (it overlaps content).
            gtk_layer_set_exclusive_zone(gwin, -1);
        }
    }

    return window;
}
