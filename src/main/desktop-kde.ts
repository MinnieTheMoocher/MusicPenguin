import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { luminanceRgb } from "./color";

function getKdeColorScheme(): "dark" | "light" | null {
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
      return luminanceRgb(fgRgb[0]!, fgRgb[1]!, fgRgb[2]!) >
        luminanceRgb(bgRgb[0]!, bgRgb[1]!, bgRgb[2]!)
        ? "dark" : "light";
    }
  } catch { /* not KDE or file unreadable */ }
  return null;
}

/**
 * Detect the user's desktop color scheme on KDE (Plasma) by parsing the KDE
 * settings files. Returns `null` when the current session is not KDE or the
 * scheme cannot be determined.
 */
export function detectKdeDesktopScheme(): "dark" | "light" | null {
  if (!/KDE/i.test(process.env.XDG_CURRENT_DESKTOP || "")) return null;
  return getKdeColorScheme();
}
