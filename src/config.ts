export const DEFAULT_SEARCH_URLS = [
  "https://www.discogs.com/search?type=all&title=${title}&artist=${artist}",
  "https://www.amazon.de/s?k=${artist}+${title}",
  "https://www.google.com/search?udm=2&q=${artist}+${title}",
  "https://musicbrainz.org/taglookup/index?tag-lookup.artist=${artist}&tag-lookup.track=${title}",
  "https://portal.dnb.de/opac/simpleSearch?query=${artist}+${title}"
];

export const TAG_BATCH_SIZE = 100;
// NUM_TAG_READER_THREADS = 4 was determined by nas-bench.js (see tag-reader.ts).
export const NUM_TAG_READER_THREADS = 4;

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
  ".mp3",
  ".aac", ".m4a", // unwanted: ".m4b", ".m4pa", ".m4r",
  ".mp4", ".m4v",
  ".ogg", ".opus", ".oga",
  ".webm",
  ".wav", // unwanted: ".wave", ".bwf",
  ".flac",
]);
