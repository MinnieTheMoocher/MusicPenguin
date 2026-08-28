export const SHUFFLE_ON  = "🔀";
export const SHUFFLE_OFF = "🔀";

export const REPEAT_OFF  = "🔁";
export const REPEAT_ONE  = "🔂";
export const REPEAT_ALL  = "🔁";

export const SPEAKER     = "🔊";

/* Generic placeholder (data URL) for audio servers that announce no icon */
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
