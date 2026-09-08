/**
 * i18n key consistency tests.
 *
 * Verifies two invariants against the actual source:
 *
 * 1. NO keys are UNUSED — every key defined in a language dictionary must be
 *    referenced somewhere in the source via `t("...")`, `t('...')` or a
 *    `data-i18n` / `data-i18n-title` / `data-i18n-placeholder` / `data-i18n-alt`
 *    attribute. Dead / obsolete entries are flagged.
 *
 * 2. EVERY TRANSLATION carries ALL keys — each non-English dictionary
 *    (de-de, fr-fr, es-es) must contain every key that is used in the source.
 *    A missing key would silently fall back to the English original.
 *    (en-us is the source of truth and intentionally only carries overrides.)
 *
 * The English strings ARE the lookup keys, so a key is just the string passed
 * to `t()` / stored as an attribute value.
 */
const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

const SRC_ROOT = path.join(__dirname, "..", "src");
const I18N_DIR = path.join(SRC_ROOT, "common", "i18n");
const TRANSLATION_LANGS = ["de-de", "fr-fr", "es-es"];

/** Unescape a source/dictionary string literal so that the raw text compares
 *  equal across quoting styles (e.g. `t('Cannot play "$1"')` vs the dictionary
 *  key `"Cannot play \"$1\""`). */
function unescape(src: string): string {
  return src
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== I18N_DIR) out.push(...walk(full));
    } else if (/\.(ts|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Collect every key referenced in the source via `t("...")` / `t('...')` and
 *  the `data-i18n*` attributes. Keys are stored unescaped. */
function collectUsedKeys(): Set<string> {
  const used = new Set<string>();
  const tDouble = /\bt\(\s*"((?:[^\\]|\\.)*?)"/g;
  const tSingle = /\bt\(\s*'((?:[^\\]|\\.)*?)'/g;
  const dataI18n = /\bdata-i18n(?:-title|-placeholder|-alt)?="([^"]*)"/g;

  for (const file of walk(SRC_ROOT)) {
    const text = fs.readFileSync(file, "utf-8");
    let m: RegExpExecArray | null;
    tDouble.lastIndex = 0;
    while ((m = tDouble.exec(text)) !== null) used.add(unescape(m[1]!));
    tSingle.lastIndex = 0;
    while ((m = tSingle.exec(text)) !== null) used.add(unescape(m[1]!));
    dataI18n.lastIndex = 0;
    while ((m = dataI18n.exec(text)) !== null) used.add(m[1]!);
  }
  return used;
}

/** Parse the `messages` object of a dictionary `.ts` file and return its keys
 *  (unescaped). */
function readDictionaryKeys(lang: string): Set<string> {
  const file = path.join(I18N_DIR, `${lang}.ts`);
  const text = fs.readFileSync(file, "utf-8");
  const start = text.indexOf("messages: {");
  if (start < 0) throw new Error(`${lang}.ts: no "messages: {" object found`);
  const body = text.slice(start + "messages: {".length, text.lastIndexOf("}"));
  const keys = new Set<string>();
  const entry = /^\s*"((?:[^\\]|\\.)*?)"\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(body)) !== null) keys.add(unescape(m[1]!));
  return keys;
}

function main(): void {
  const used = collectUsedKeys();
  const langKeys: Record<string, Set<string>> = {};
  for (const lang of ["de-de", "fr-fr", "es-es", "en-us"]) {
    langKeys[lang] = readDictionaryKeys(lang);
  }

  let failed = false;
  const fail = (msg: string): void => {
    failed = true;
    console.error(`  ✗ ${msg}`);
  };
  const pass = (msg: string): void => {
    console.log(`  ✓ ${msg}`);
  };

  console.log("i18n key checks");
  console.log(`used keys referenced in source: ${used.size}`);

  console.log("\n[1] no UNUSED keys:");
  for (const lang of ["de-de", "fr-fr", "es-es", "en-us"]) {
    const unused = [...langKeys[lang]!].filter((k) => !used.has(k)).sort();
    if (unused.length === 0) {
      pass(`${lang}: all ${langKeys[lang]!.size} keys are used`);
    } else {
      fail(`${lang}: ${unused.length} unused key(s): ${unused.join(" | ")}`);
    }
  }

  console.log("\n[2] every TRANSLATION carries ALL keys:");
  for (const lang of TRANSLATION_LANGS) {
    const missing = [...used].filter((k) => !langKeys[lang]!.has(k)).sort();
    if (missing.length === 0) {
      pass(`${lang}: ${used.size}/${used.size} keys present`);
    } else {
      fail(`${lang}: missing ${missing.length} key(s): ${missing.join(" | ")}`);
    }
  }

  console.log("");
  if (failed) {
    console.error("FAILED");
    process.exit(1);
  }
  console.log("OK");
}

main();
