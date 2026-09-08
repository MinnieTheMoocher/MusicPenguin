import type { ITranslate } from "./ITranslate.js";

/**
 * English (US) — the fallback language. English strings ARE the lookup
 * keys, so no explicit translations are required here. Entries only ever
 * need to be added when the rendered text should differ from the key.
 * Unicode character "…" shall NOT be used.
 */
export const enUS: ITranslate = {
  key: "en-us",
  label: "English",
  messages: {
    // the following entries are intentional overrides where the key is GOOD but we want a DIFFERENT English text in the UI
    "Search on $1": "Search $1",
  },
};
