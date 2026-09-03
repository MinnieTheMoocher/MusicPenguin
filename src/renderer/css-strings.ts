import { t } from "../common/i18n/index.js";

/**
 * Every string that the design stylesheets (each file under src/renderer/designs/)
 * render via `content:` is defined here and injected as a CSS custom property on
 * <html>, so no user-visible text lives in the stylesheets. Re-run on language
 * change (see initCssStrings).
 */
export function applyCssStrings(): void {
  const s = document.documentElement.style;
  s.setProperty("--pseudo-empty", '""');
  s.setProperty("--check-mark", '"✓"');
  s.setProperty("--playlist-empty-text", JSON.stringify(t("Playlist: Drop tracks here")));
}

export function initCssStrings(): void {
  applyCssStrings();
  document.addEventListener("language-changed", applyCssStrings);
}
