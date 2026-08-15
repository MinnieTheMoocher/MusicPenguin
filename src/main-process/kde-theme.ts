import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

function getKdeColorScheme(): string | null {
  try {
    const kdeglobals = path.join(os.homedir(), ".config", "kdeglobals");
    const kdeDefaults = path.join(os.homedir(), ".config", "kdedefaults", "kdeglobals");
    let content = "";
    try { content += fs.readFileSync(kdeglobals, "utf-8") + "\n"; } catch { /* ignore */ }
    try { content += fs.readFileSync(kdeDefaults, "utf-8") + "\n"; } catch { /* ignore */ }
    if (!content) return null;
    const lines = content.split("\n");
    let section = "";
    let colorScheme: string | null = null;
    let bgRgb: number[] | null = null;
    let fgRgb: number[] | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      const sm = trimmed.match(/^\[(.+)\]$/);
      if (sm) { section = sm[1]!; continue; }
      const km = trimmed.match(/^(\w+)=(.*)$/);
      if (!km) continue;
      const key = km[1]!, val = km[2]!;

      if (section === "General" && key === "ColorScheme") colorScheme = val;

      if (section === "Colors:Window" || section === "Colors:View") {
        if (key === "BackgroundNormal") {
          const p = val.split(",").map(Number);
          if (p.length === 3 && p.every(n => !isNaN(n))) bgRgb = p;
        }
        if (key === "ForegroundNormal") {
          const p = val.split(",").map(Number);
          if (p.length === 3 && p.every(n => !isNaN(n))) fgRgb = p;
        }
      }
    }

    if (colorScheme) {
      const lower = colorScheme.toLowerCase();
      if (lower.includes("dark")) return "dark";
      if (lower.includes("light")) return "light";
    }

    if (bgRgb && fgRgb) {
      return relativeLuminance(fgRgb[0]!, fgRgb[1]!, fgRgb[2]!) >
        relativeLuminance(bgRgb[0]!, bgRgb[1]!, bgRgb[2]!)
        ? "dark" : "light";
    }
  } catch { /* not KDE or file unreadable */ }
  return null;
}

export function detectInitialTheme(settingsPath: string): string {
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const s = JSON.parse(raw);
    if (s.theme === "light" || s.theme === "dark") return s.theme;
  } catch { /* no settings yet */ }

  if (/KDE/i.test(process.env.XDG_CURRENT_DESKTOP || "")) {
    const kde = getKdeColorScheme();
    if (kde) return kde;
  }

  return "dark";
}
