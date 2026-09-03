import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { luminanceHex } from "./color";

/** Read a `org.gnome.desktop.interface` GSettings value, or null if unavailable. */
function gsettingGet(key: string): string | null {
  try {
    const out = execFileSync("gsettings", ["get", "org.gnome.desktop.interface", key], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().replace(/^'(.*)'$/, "$1").toLowerCase();
  } catch { /* gsettings missing, not on a GNOME session with our D-Bus, or key absent */ }
  return null;
}

/** Fallback when gsettings is unavailable: parse `gtk-theme-name` from the GTK settings files. */
function readGtkThemeFromSettingsIni(): string | null {
  for (const version of ["3.0", "4.0"]) {
    const file = path.join(os.homedir(), ".config", `gtk-${version}`, "settings.ini");
    try {
      const content = fs.readFileSync(file, "utf-8");
      const m = content.match(/^\s*gtk-theme-name\s*=\s*(.+)\s*$/m);
      if (m) return m[1]!.trim().toLowerCase();
    } catch { /* file unreadable */ }
  }
  return null;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** First hex color literal of a `name:<hex>` entry (used for `fg_color`/`bg_color` in `gtk-color-scheme`). */
function hexAfter(key: string, value: string): string | null {
  const m = value.match(new RegExp(`${key}\\s*:\\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\\b`));
  const cand = m?.[1] ?? null;
  return cand && HEX_RE.test(cand) ? cand : null;
}

/** First hex color literal of a CSS `@define-color name` variable. */
function hexDefine(name: string, css: string): string | null {
  const m = css.match(new RegExp(`@define-color\\s+${name}\\s+(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\\b`));
  const cand = m?.[1] ?? null;
  return cand && HEX_RE.test(cand) ? cand : null;
}

/** Extract a text/background hex pair from a settings.ini or gtk.css file, if one is declared. */
function colorPairFromFile(file: string): { fg: string; bg: string } | null {
  let content: string;
  try { content = fs.readFileSync(file, "utf8"); } catch { return null; }

  // settings.ini: gtk-color-scheme = "…fg_color:#… bg_color:#…"
  const scheme = content.match(/gtk-color-scheme\s*=\s*"?([^"\r\n]*)"?/i);
  if (scheme) {
    const fg = hexAfter("fg_color", scheme[1]!);
    const bg = hexAfter("bg_color", scheme[1]!);
    if (fg && bg) return { fg, bg };
  }

  // gtk.css: @define-color theme_fg_color / theme_bg_color
  const fg = hexDefine("theme_fg_color", content) ?? hexDefine("fg_color", content);
  const bg = hexDefine("theme_bg_color", content) ?? hexDefine("bg_color", content);
  if (fg && bg) return { fg, bg };

  return null;
}

/** Directories that hold themes for a given theme name. */
function themeRoots(name: string): string[] {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return [
    path.join(os.homedir(), ".themes", name),
    path.join(dataHome, "themes", name),
    path.join("/usr/share/themes", name),
    path.join("/usr/local/share/themes", name),
  ];
}

/**
 * Last resort: probe the configured default text (foreground) and background
 * colors and compare their brightness — brighter text on a darker background
 * is a dark mode. Sources: `gtk-color-scheme` from the user's or the theme's
 * settings.ini, then `@define-color theme_fg_color`/`theme_bg_color` from the
 * theme's gtk.css. Returns null when no colors can be found.
 */
function detectGnomeThemeColors(): "dark" | "light" | null {
  const themeName = gsettingGet("gtk-theme") ?? readGtkThemeFromSettingsIni();
  const files = [
    path.join(os.homedir(), ".config", "gtk-3.0", "settings.ini"),
    path.join(os.homedir(), ".config", "gtk-4.0", "settings.ini"),
  ];
  if (themeName) {
    for (const root of themeRoots(themeName)) {
      files.push(
        path.join(root, "gtk-3.0", "settings.ini"),
        path.join(root, "gtk-3.0", "gtk.css"),
        path.join(root, "gtk-4.0", "gtk.css"),
      );
    }
  }

  for (const file of files) {
    const pair = colorPairFromFile(file);
    if (!pair) continue;
    const fgLum = luminanceHex(pair.fg);
    const bgLum = luminanceHex(pair.bg);
    if (fgLum === null || bgLum === null) continue;
    return fgLum > bgLum ? "dark" : "light"; // brighter text → dark mode
  }
  return null;
}

/**
 * Detect the user's desktop color scheme on GNOME (incl. Ubuntu's GNOME shell)
 * by evaluating the environment and user settings (GSettings dconf, falling
 * back to the GTK settings.ini files). Returns `null` when the current session
 * is not GNOME or the scheme cannot be determined — the caller then falls back
 * to the Dark Gray default design.
 */
export function detectGnomeDesktopScheme(): "dark" | "light" | null {
  if (!/GNOME|Unity/i.test(process.env.XDG_CURRENT_DESKTOP || "")) return null;

  // GNOME 42+: explicit light/dark preference (org.gnome.desktop.interface color-scheme).
  const colorScheme = gsettingGet("color-scheme");
  if (colorScheme === "prefer-dark") return "dark";
  if (colorScheme === "prefer-light") return "light";

  // Otherwise the scheme follows the GTK theme ("Adwaita-dark", "Yaru-dark", ...).
  // Only a name that explicitly says dark or light counts as a determination.
  const gtkTheme = gsettingGet("gtk-theme") ?? readGtkThemeFromSettingsIni();
  if (gtkTheme) {
    if (/dark|black/i.test(gtkTheme)) return "dark";
    if (/light|white/i.test(gtkTheme)) return "light";
  }

  return detectGnomeThemeColors();
}