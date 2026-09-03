import * as fs from "fs";
import { detectKdeDesktopScheme } from "./desktop-kde";
import { detectGnomeDesktopScheme } from "./desktop-gnome";

const DESKTOP_SCHEME_DETECTORS: ReadonlyArray<() => "dark" | "light" | null> = [
  detectKdeDesktopScheme,
  detectGnomeDesktopScheme,
];

/** Map a desktop color scheme to the default design id. */
const designForScheme = (scheme: "dark" | "light"): string =>
  scheme === "light" ? "white" : "dark_gray";

/**
 * Initial design precedence:
 * 1. a saved design setting — the user decided explicitly (validated against
 *    the design ids known at runtime, i.e. built-in and custom designs);
 * 2. the desktop color scheme (dark desktop → Dark Gray design, light desktop →
 *    White design), detected by each registered desktop provider;
 * 3. default: dark_gray.
 */
export function detectInitialDesign(settingsPath: string, knownDesignIds: ReadonlySet<string>): string {
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const s = JSON.parse(raw);
    if (typeof s.design === "string" && knownDesignIds.has(s.design)) {
      return s.design; // the user decided explicitly
    }
  } catch { /* no settings yet */ }

  for (const detect of DESKTOP_SCHEME_DETECTORS) {
    const scheme = detect();
    if (scheme) return designForScheme(scheme);
  }

  return "dark_gray";
}