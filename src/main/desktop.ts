import * as fs from "fs";
import { nativeTheme } from "electron";
import { SYSTEM_DESIGN_ID } from "../common/config";

/** Map a desktop color scheme to the default design id. */
const designForScheme = (scheme: "dark" | "light"): string =>
  scheme === "light" ? "white" : "dark_gray";

/**
 * Initial design precedence:
 * 1. a saved design setting — the user decided explicitly (validated against
 *    the design ids known at runtime, i.e. built-in and custom designs);
 * 2. the desktop color scheme (dark desktop → Dark Gray design, light desktop →
 *    White design), detected by Electron's cross-platform nativeTheme API;
 * 3. default: dark_gray.
 */
export function detectInitialDesign(settingsPath: string, knownDesignIds: ReadonlySet<string>): string {
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const s = JSON.parse(raw);
    if (typeof s.design === "string" && s.design !== SYSTEM_DESIGN_ID && knownDesignIds.has(s.design)) {
      return s.design; // the user decided explicitly
    }
  } catch { /* no settings yet */ }

  /* This function is called from start(), after app.ready, so Chromium has
     already resolved the host desktop's current color scheme. */
  return designForScheme(nativeTheme.shouldUseDarkColors ? "dark" : "light");
}
