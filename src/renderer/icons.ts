// ICON_*` constants are the single source of truth for every UI icon: the
// markup lives in icons/*.svg, is bundled as text (esbuild
// --loader:.svg=text), and is injected into the DOM at runtime. index.html
// therefore contains no duplicated <svg> markup.

import svgPlay from "./icons/player-play-filled.svg";
import svgPause from "./icons/player-pause-filled.svg";

import svgSkipBack from "./icons/player-skip-back-filled.svg";
import svgSkipForward from "./icons/player-skip-forward-filled.svg";

import svgRepeatOff from "./icons/repeat-off.svg";
import svgRepeatOnce from "./icons/repeat-once.svg";
import svgRepeat from "./icons/repeat.svg";

import svgShuffle from "./icons/arrows-shuffle.svg";

import svgSpeaker from "./icons/volume-2.svg";
import svgMute from "./icons/volume-3.svg";

import svgRegex from "./icons/asterisk.svg";
import svgSearch from "./icons/search.svg";

import svgFile from "./icons/file.svg";
import svgFileDownload from "./icons/file-download.svg";
import svgFileUpload from "./icons/file-upload.svg";

import svgFolder from "./icons/folder.svg";
import svgFolderOpen from "./icons/folder-open.svg";
import svgFolders from "./icons/folders.svg";

import svgAlertTriangle from "./icons/alert-triangle.svg";

import svgServer from "./icons/server.svg";
import svgTag from "./icons/tag.svg";
import svgSettings from "./icons/settings.svg";
import svgRandomize from "./icons/spiral.svg";

import svgCaretUp from "./icons/caret-up.svg";
import svgCaretDown from "./icons/caret-down.svg";

export const ICON_PLAY          = svgPlay.trim();
export const ICON_PAUSE         = svgPause.trim();

export const ICON_PREV          = svgSkipBack.trim();
export const ICON_NEXT          = svgSkipForward.trim();

export const ICON_REPEAT_OFF    = svgRepeatOff.trim();
export const ICON_REPEAT_ONE    = svgRepeatOnce.trim();
export const ICON_REPEAT_ALL    = svgRepeat.trim();

export const ICON_SHUFFLE_OFF   = svgShuffle.trim();
export const ICON_SHUFFLE_ON    = svgShuffle.trim();

export const ICON_SPEAKER       = svgSpeaker.trim();
export const ICON_MUTE          = svgMute.trim();

export const ICON_REGEX         = svgRegex.trim();
export const ICON_SEARCH        = svgSearch.trim();

export const ICON_FOLDER_OPEN   = svgFolderOpen.trim();
export const ICON_FOLDER_CLOSED = svgFolder.trim();
export const ICON_FOLDERS       = svgFolders.trim();

export const ICON_WARNING       = svgAlertTriangle.trim();
export const ICON_MUSIC_NOTE     = "\u266B"; // ♫ - intentionally monochrome

export const ICON_SCAN          = svgTag.trim();
export const ICON_SETTINGS      = svgSettings.trim();
export const DLNA_SERVER        = svgServer.trim();

export const ICON_RANDOMIZE     = svgRandomize.trim();
export const ICON_CLEAR         = svgFile.trim();
export const ICON_SAVE          = svgFileDownload.trim();
export const ICON_LOAD          = svgFileUpload.trim();

export const ICON_CARET_UP      = svgCaretUp.trim();
export const ICON_CARET_DOWN    = svgCaretDown.trim();

/* Play/pause buttons carry BOTH icons (as .icon-play / .icon-pause spans);
   the base CSS shows the right one based on the button's `playing` class, so
   a skin can choose which icon represents each state (or force one icon). */
export const ICON_PLAY_PAUSE = `<span class="icon-play">${svgPlay.trim()}</span><span class="icon-pause">${svgPause.trim()}</span>`;

/* SVG must be injected directly into html, otherwise we cannot style the SVG by injecting currentColor or change its stroke-width etc. */
export function injectStaticIcons(): void {
  const icons: Array<[string, string]> = [
    ["prev-btn", ICON_PREV],
    ["play-btn", ICON_PLAY_PAUSE],
    ["next-btn", ICON_NEXT],

    ["repeat-btn", ICON_REPEAT_ALL],
    ["shuffle-btn", ICON_SHUFFLE_ON],

    ["volume-icon", ICON_SPEAKER],

    ["folders-btn", ICON_FOLDERS],
    ["scan-btn", ICON_SCAN],
    ["problematic-btn", ICON_WARNING],
    ["settings-btn", ICON_SETTINGS],

    ["cover-placeholder", ICON_MUSIC_NOTE],

    ["regex-btn", ICON_REGEX],
    ["search-btn", ICON_SEARCH],

    ["playlist-play-btn", ICON_PLAY_PAUSE],
    ["randomize-btn", ICON_RANDOMIZE],
    ["clear-playlist-btn", ICON_CLEAR],
    ["save-playlist-btn", ICON_SAVE],
    ["load-playlist-btn", ICON_LOAD],
  ];

  for (const [id, icon] of icons) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon;
  }
}
