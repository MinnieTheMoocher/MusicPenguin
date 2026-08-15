/**
 * Contract every supported language must fulfill.
 *
 * Design: the English strings themselves are the lookup keys (gettext
 * style). `t("All Files")` returns the localized text; when a key is
 * missing the English original is returned, so `en-us` is the fallback
 * source of truth and its dictionary can stay empty.
 *
 * Dynamic text uses positional placeholders `$1`, `$2`, ... inside the
 * template; the caller passes matching arguments to `t()`.
 */
export interface ITranslate {
  /** Stable all-lowercase ISO language identifier, e.g. "en-us". */
  readonly key: string;
  /** Human readable label shown in the settings language picker. */
  readonly label: string;
  /** English string → localized string. */
  readonly messages: Record<string, string>;
}
