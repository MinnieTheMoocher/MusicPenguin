export const DEFAULT_SEARCH_URLS = [
  "https://www.discogs.com/search?type=all&title=${title}&artist=${artist}",
  "https://www.amazon.de/s?k=${artist}+${title}",
  "https://www.google.com/search?udm=2&q=${artist}+${title}",
  "https://musicbrainz.org/taglookup/index?tag-lookup.artist=${artist}&tag-lookup.track=${title}",
  "https://portal.dnb.de/opac/simpleSearch?query=${artist}+${title}"
];

/* Special persisted design choice: follow the operating system color scheme.
   It is intentionally not a discovered stylesheet id. */
export const SYSTEM_DESIGN_ID = "system";

/* Filenames considered for cover art stored next to the tracks (case-
   insensitive, any of the extensions below). Front = preferred as the
   primary cover; rear/back and any other images in the folder are offered
   by theater mode when clicking through the covers. */
export const FRONT_COVER_FILENAMES = ["folder", "cover", "front"];
export const REAR_COVER_FILENAMES = ["rear", "back"];
export const COVER_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

// minimal required size for images to be considered extra images worth showing in theater mode
export const MIN_EXTRA_IMAGE_SIZE = 100;

/* Combined duration of the theater mode fade-over-black between two
   tracks, in milliseconds. Half of it is used for the fade-out at the
   end of the current track, the other half for the fade-in over the
   beginning of the next one. If either half does not fit into its
   track (track too short), that transition is sudden instead. */
export const THEATER_FADE_TOTAL_MS = 2000;

export const TAG_BATCH_SIZE = 20;
// NUM_TAG_READER_THREADS = 4 was determined by nas-bench.js (see tag-reader.ts).
export const NUM_TAG_READER_THREADS = 4;

// Default widths (px) for visible columns; columns absent from this map are
// hidden until the user enables them (only applied when no persisted column
// configuration exists).
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  _playing: 19,
  trackNo: 50,
  title: 395,
  artist: 360,
  album: 288,
  rating: 124,
  duration: 100,
};

// Checkpoint-save the library DB after this many tag writes while scanning.
// saveDb()/VACUUM serialize the whole database and block the main process,
// so they must be rare.
export const TAG_SAVE_INTERVAL = 1000;

// Upper size limit for reading a whole file into memory when probing for
// structural defects (e.g. after <audio> playback fails).
export const MAX_PROBE_FILE_SIZE = 20 * 1024 * 1024;

export const MEDIA_FILE_EXTENSIONS = new Set([
  ".mp3", ".mp2", ".m2a", ".mpg", ".mpeg",
  ".aac", ".m4a", // unwanted: ".m4b", ".m4pa", ".m4r",
  ".mp4", ".m4v", ".mov", // unwanted: ".movie", ".qt", ".3gp",
  ".mkv", ".webm", // unwanted: ".mka", ".mk3d", ".mks",
  ".ogg", ".ogv", ".oga", ".ogm", ".ogx", ".opus", ".spx",
  ".wav", // unwanted: ".wave", ".bwf",
  ".flac",
  ".aif", ".aiff", ".aifc", ".au",
  ".asf", ".wma", ".wmv",
// unwanted:
//".ape",
//".wv", ".wvp",
//".mpc",
//".dsf", ".dff",
]);

export const PLAYABLE_FILE_EXTENSIONS = new Set([
  ".mp3", ".mp2",
  ".aac", ".m4a", // unwanted: ".m4b", ".m4pa", ".m4r",
  ".mp4", ".m4v",
  ".ogg", ".opus", ".oga",
  ".webm",
  ".wav", // unwanted: ".wave", ".bwf",
  ".flac",
]);
