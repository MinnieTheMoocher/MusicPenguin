import type { ITranslate } from "./ITranslate.js";
import { enUS } from "./en-us.js";
import { deDE } from "./de-de.js";
import { frFR } from "./fr-fr.js";
import { esES } from "./es-es.js";

export type LanguageCode = "en-us" | "de-de" | "fr-fr" | "es-es";

export const LANGUAGES: Record<string, ITranslate> = {
  [enUS.key]: enUS,
  [deDE.key]: deDE,
  [frFR.key]: frFR,
  [esES.key]: esES,
};

let currentLanguage: ITranslate = enUS;

export function getLanguage(): string {
  return currentLanguage.key;
}

/**
 * Localization lookup. Pass an English source string (which is also the
 * key) and get back the localized version of it. Placeholders `$1`, `$2`,
 * ... in the template are replaced by the given arguments, so numbers can
 * be inserted at the proper location of each language.
 *
 *   t("$1 $2 in MusicPenguin library.", 5, "files")  →  "Loaded 5 files from library."
 *
 * Missing keys fall back to the English original, so en-us is the source
 * of truth and never needs an explicit dictionary.
 *
 * Always pass a literal as the key. The i18n consistency test extracts keys
 * by grepping the source for `t("...")` / `t('...')`, so a key hidden inside
 * a larger expression is not detected. In particular, prefer the ternary as
 * `cond ? t("A") : t("B")`, never `t(cond ? "A" : "B")`.
 */
export function t(enKey: string, ...args: Array<string | number>): string {
  const template = currentLanguage.messages[enKey] ?? enKey;
  if (args.length === 0) return template;
  return template.replace(/\$(\d+)/g, (match, idx: string) => {
    const arg = args[Number(idx) - 1];
    return arg === undefined ? match : String(arg);
  });
}

/**
 * Fills every static element carrying a `data-i18n`, `data-i18n-title`,
 * `data-i18n-placeholder` or `data-i18n-alt` attribute with the localized
 * text. Re-run this on language change to update the whole UI instantly.
 */
export function applyTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(key));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-alt]").forEach((el) => {
    const key = el.getAttribute("data-i18n-alt");
    if (key) el.setAttribute("alt", t(key));
  });
  document.documentElement.lang = currentLanguage.key;
}

/**
 * Switch the active language and re-apply translations immediately.
 * Dispatches a "language-changed" event so dynamic components can refresh.
 */
export function setLanguage(lang: string): void {
  currentLanguage = LANGUAGES[lang] ?? enUS;
  if (typeof document !== "undefined") {
    applyTranslations(document);
    document.dispatchEvent(new CustomEvent("language-changed"));
  }
}

/** Best guess at the parent OS language (Electron/Chromium locale). */
export function detectLanguage(): LanguageCode {
  const nav = typeof navigator !== "undefined" ? (navigator.language ?? "") : "";
  const lang = nav.toLowerCase();
  if (lang.startsWith("de")) return "de-de";
  if (lang.startsWith("fr")) return "fr-fr";
  if (lang.startsWith("es")) return "es-es";
  return "en-us";
}

/**
 * Renderer bootstrapping. The main process already resolves the language
 * (saved setting → OS locale) and passes it as `?lang=`, so we apply it
 * synchronously. We then double-check the saved setting.
 */
export async function initI18n(): Promise<void> {
  const fromQuery = location.search.match(/[?&]lang=([\w-]+)/)?.[1];
  if (fromQuery && LANGUAGES[fromQuery]) setLanguage(fromQuery);
  try {
    const data = await window.electronAPI.loadSettings();
    const saved = data?.language;
    if (typeof saved === "string" && LANGUAGES[saved]) setLanguage(saved);
  } catch { /* keep query/detected language */ }
}

export type { ITranslate } from "./ITranslate.js";
