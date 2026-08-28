// ensure that glyphs are presented as colorful
// https://de.wikipedia.org/wiki/Unicodeblock_Variantenselektoren
export const COLOR_EMOJI_PRESENTATION_MODE = "\uFE0F";

const emoji = (base_glyph: string, as_color_emoji: boolean): string =>
  base_glyph + (as_color_emoji ? COLOR_EMOJI_PRESENTATION_MODE : "");

export const ICON_PREV           = emoji("\u{23EE}",  true);  // ⏮
export const ICON_NEXT           = emoji("\u{23ED}",  true);  // ⏭
export const ICON_PLAY           = emoji("\u{25B6}",  true);  // ▶️
export const ICON_PAUSE          = emoji("\u{23F8}",  true);  // ⏸
export const ICON_REPEAT_OFF     = emoji("\u{1F501}", true);  // 🔁
export const ICON_REPEAT_ONE     = emoji("\u{1F502}", true);  // 🔂
export const ICON_REPEAT_ALL     = emoji("\u{1F501}", true);  // 🔁
export const ICON_SHUFFLE_ON     = emoji("\u{1F500}", true);  // 🔀
export const ICON_SHUFFLE_OFF    = emoji("\u{1F500}", true);  // 🔀
export const ICON_SPEAKER        = emoji("\u{1F50A}", true);  // 🔊
export const ICON_FOLDERS        = emoji("\u{1F4C1}", true);  // 📁
export const ICON_SCAN           = emoji("\u{1F3F7}", true);  // 🏷
export const ICON_WARNING        = emoji("\u{26A0}",  true);  // ⚠
export const ICON_SETTINGS       = emoji("\u{2699}",  true);  // ⚙
export const ICON_SEARCH         = emoji("\u{1F50D}", true);  // 🔍
export const ICON_RANDOMIZE      = emoji("\u{1F3B2}", true);  // 🎲
export const ICON_CLEAR_PLAYLIST = emoji("\u{1F9F9}", true);  // 🧹
export const ICON_SAVE_PLAYLIST  = emoji("\u{1F4BE}", true);  // 💾
export const ICON_LOAD_PLAYLIST  = emoji("\u{1F4C2}", true);  // 📂
export const ICON_MUSIC_NOTE     = emoji("\u{266B}",  false); // ♫ - intentionally monochrome

// put color glyphs into html
export function initEmojiButtons(): void {
  const set = (id: string, glyph: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = glyph;
  };
  set("prev-btn", ICON_PREV);
  set("play-btn", ICON_PLAY);
  set("next-btn", ICON_NEXT);
  set("repeat-btn", ICON_REPEAT_ALL);
  set("shuffle-btn", ICON_SHUFFLE_ON);
  set("volume-icon", ICON_SPEAKER);
  set("folders-btn", ICON_FOLDERS);
  set("scan-btn", ICON_SCAN);
  set("problematic-btn", ICON_WARNING);
  set("settings-btn", ICON_SETTINGS);
  set("search-btn", ICON_SEARCH);
  set("playlist-play-btn", ICON_PLAY);
  set("randomize-btn", ICON_RANDOMIZE);
  set("clear-playlist-btn", ICON_CLEAR_PLAYLIST);
  set("save-playlist-btn", ICON_SAVE_PLAYLIST);
  set("load-playlist-btn", ICON_LOAD_PLAYLIST);
  set("cover-placeholder", ICON_MUSIC_NOTE);
}

// Generic placeholder (data URL) for audio servers that announce no icon
export const DLNA_SERVER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
      '<g fill="none" stroke="#888888" stroke-width="1.2">' +
        '<rect x="2" y="2.6" width="12" height="4.8" rx="1"/>' +
        '<rect x="2" y="9.6" width="12" height="4.8" rx="1"/>' +
      "</g>" +
      '<circle cx="4.4" cy="5" r="0.7" fill="#888888"/>' +
      '<circle cx="4.4" cy="12" r="0.7" fill="#888888"/>' +
    "</svg>",
  );
