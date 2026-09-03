import { TreeNode, ListItem } from "./types.js";
import { audio } from "./audio.js";
import { injectStaticIcons, ICON_CARET_UP, ICON_CARET_DOWN } from "./icons.js";
import { renderGroups } from "./groups-view.js";
import { initVirtualList, VirtualListController, loadColumnWidths, loadColumnVisibility, formatTime, setOnDeletedFiles } from "./list-view.js";
import { applySortingMode, ARTIST_ALBUM_TRACKNO, TRACKNO, FILENAME } from "./sorting.js";
import { showDetails } from "./detail-panel.js";
import { setSelectedTrack, playTrack, loadTrack, initNowPlaying, initPlayableExtensions, refreshListIndicator, onTrackEnd, setNavCallbacks, updateNavButtons, onNavStateChange, selectedPath, setMprisNavState, onSelectedPathChange, getShuffle, getRepeat, pickRandomExcluding, resetShuffleHistory, onPlayModeChange, isPlayableFile, isActuallyPlaying, refreshNowPlayingMetadata } from "./now-playing.js";
import "./split-pane.js";
import { loadSplitterState } from "./split-pane.js";
import { initPlaylist, clearPlaylistPlaying, clearPlaylist, advancePlaylist, prevPlaylist, isPlaylistPlaying, canPlaylistPrev, canPlaylistNext, updatePlaylistPaths, updatePlaylistEntry, onPlaylistStateChange, onPlaylistSelect, registerMainListSelectionQuery, hasPlaylistNavBase } from "./playlist-panel.js";
import { initSearchPanel } from "./search-panel.js";
import { initSettings, setOnDatabaseCleared } from "./settings.js";
import { initExternalPlayer } from "./external-player.js";
import { initFoldersDialog } from "./folders-dialog.js";
import { runFullScan, fileCountLabel, subscribeDlnaProgress } from "./scanner.js";
import { setTrackNavCallbacks, setShownTrackHandlers, refreshTheaterModeMetadata } from "./theatermode.js";
import { fetchThumbnail } from "./thumbnail-cache.js";
import { t, initI18n } from "../common/i18n/index.js";
import { initCssStrings } from "./css-strings.js";
import { debugLog } from "./debug-log.js";
import { passesMinAutoplayRating } from "./min-autoplay-rating.js";
import iconLicense from "./icons/LICENSE.md";

const HEADER_COLUMNS = ["", "playcount", "track_no", "title", "artist", "album", "album_artist", "composer", "conductor", "year", "genre", "bpm", "rating", "duration", "ext", "path"];

const groupsData: TreeNode[] = [
  { id: "grp-allfiles", label: "All Tracks" },
  { id: "grp-search", label: "Search Result" },
  { id: "grp-most-played", label: "Most Played" },
];
let albumGroupItems: TreeNode[] = [];
let folderGroupItems: TreeNode[] = [];
let artistGroupItems: TreeNode[] = [];
let composerGroupItems: TreeNode[] = [];

/* ── Left-panel group persistence ───────────────────────────── */

/* The Goto Album/Artist/Composer/Folder groups are persisted as the
   KIND plus the string that populated them (album/artist/composer
   name, folder path) — never the computed result tracks. Order is
   preserved exactly as the groups render on the left panel (album
   section, then artist, then composer, then folder). */

type GroupKind = "album" | "artist" | "composer" | "folder";

interface GroupEntry {
  kind: GroupKind;
  value: string;
}

function groupValueFromId(id: string, kind: GroupKind): string {
  return decodeURIComponent(id.slice(("grp-" + kind + ":").length));
}

function collectGroupItems(): GroupEntry[] {
  const collect = (arr: TreeNode[], kind: GroupKind): GroupEntry[] => {
    return arr.map((n) => ({ kind, value: groupValueFromId(n.id, kind) }));
  };
  return [
    ...collect(albumGroupItems, "album"),
    ...collect(artistGroupItems, "artist"),
    ...collect(composerGroupItems, "composer"),
    ...collect(folderGroupItems, "folder"),
  ];
}

async function saveGroupItems(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      "group-items": collectGroupItems(),
    });
  } catch { /* ignore */ }
}

async function loadGroupItems(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    const entries = data?.["group-items"];
    if (!Array.isArray(entries)) return;
    const sections: Record<GroupKind, TreeNode[]> = { album: [], artist: [], composer: [], folder: [] };
    for (const entry of entries) {
      const kind = entry?.kind;
      const value = entry?.value;
      if (typeof kind !== "string" || typeof value !== "string" || value === "") continue;
      if (kind !== "album" && kind !== "artist" && kind !== "composer" && kind !== "folder") continue;
      const id = "grp-" + kind + ":" + encodeURIComponent(value);
      sections[kind]!.push({
        id,
        label: kind === "folder" ? (value.replace(/\/$/, "").split("/").pop() || value) : value,
      });
    }
    albumGroupItems = sections.album;
    artistGroupItems = sections.artist;
    composerGroupItems = sections.composer;
    folderGroupItems = sections.folder;
  } catch { /* ignore */ }
}

const groupsEl = document.getElementById("groups-list")!;
const listEl = document.getElementById("list")!;

let tracks: Track[] = [];
let searchResults: Track[] | null = null;
let selectedGroupId: string | null = "grp-allfiles";
let selectedTrackPath: string | null = null;
let playingTrackPath: string | null = null;
/* Where the user last established a selection: drives which list Prev/Next
   act on when nothing is playing ("last one wins"). */
let navFromList: "main" | "playlist" | null = null;
let sortColumn = "path";
let sortDirection: "asc" | "desc" = "asc";
let manualSortApplied = false;
let listScrollTop = 0;
let listCtrl: VirtualListController | null = null;

/* ── Sort ──────────────────────────────────────────────────── */

async function loadSortState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data?.["sort-column"]) sortColumn = data["sort-column"];
    if (data?.["sort-direction"] === "asc" || data?.["sort-direction"] === "desc") sortDirection = data["sort-direction"];
    if (typeof data?.["sort-manual"] === "boolean") manualSortApplied = data["sort-manual"];
  } catch { /* ignore */ }
}

async function saveSortState(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      "sort-column": sortColumn,
      "sort-direction": sortDirection,
      "sort-manual": manualSortApplied,
    });
  } catch { /* ignore */ }
}

async function loadUIState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data?.["selected-group-id"]) {
      selectedGroupId = data["selected-group-id"];
    }
    if (typeof data?.["list-scroll-top"] === "number") listScrollTop = data["list-scroll-top"];
  } catch { /* ignore */ }
}

async function saveUIState(): Promise<void> {
  try {
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    await window.electronAPI.saveSettings({
      "selected-group-id": selectedGroupId,
      "list-scroll-top": listCtrl ? listCtrl.getScrollOffset() : 0,
      "search-query": searchInput?.value ?? "",
    });
  } catch { /* ignore */ }
}

function saveUIStateSync(): void {
  try {
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    window.electronAPI.saveSettingsSync({
      "selected-group-id": selectedGroupId,
      "list-scroll-top": listCtrl ? listCtrl.getScrollOffset() : 0,
      "search-query": searchInput?.value ?? "",
    });
  } catch { /* ignore */ }
}

/* Ascending comparator only — direction is applied separately so the
   same key order can be reused for inserting single rows. */
function compareTracks(a: Track, b: Track): number {
  if (sortColumn === "track_no") {
    const aDisc = parseInt(a.disc_no, 10) || 0;
    const bDisc = parseInt(b.disc_no, 10) || 0;
    const aTrack = parseInt(a.track_no, 10) || 0;
    const bTrack = parseInt(b.track_no, 10) || 0;
    return aDisc !== bDisc ? aDisc - bDisc : aTrack - bTrack;
  }
  if (sortColumn === "playcount") {
    return a.playcount - b.playcount;
  }
  if (sortColumn === "rating") {
    return a.rating - b.rating;
  }
  if (sortColumn === "bpm") {
    return a.bpm - b.bpm;
  }
  if (sortColumn === "duration") {
    /* Duration arrives as a string but must compare numerically —
       lexicographic order would rank "1004" between "100" and "101". */
    const aDur = parseFloat(a.duration) || 0;
    const bDur = parseFloat(b.duration) || 0;
    return aDur - bDur;
  }
  if (sortColumn === "ext") {
    const aExt = a.filename.includes(".") ? a.filename.split(".").pop()!.toLowerCase() : "";
    const bExt = b.filename.includes(".") ? b.filename.split(".").pop()!.toLowerCase() : "";
    return aExt.localeCompare(bExt);
  }
  const aVal = (a[sortColumn as keyof Track] || "") as string;
  const bVal = (b[sortColumn as keyof Track] || "") as string;
  return aVal.toLowerCase().localeCompare(bVal.toLowerCase());
}

function sortArray(arr: Track[]): void {
  const dir = sortDirection === "asc" ? 1 : -1;
  arr.sort((a, b) => compareTracks(a, b) * dir);
}

/* Slots a single row into the position the current sort column demands,
   WITHOUT touching any other row's position (Array#sort is stable, but
   a full re-sort would still drag already-visible rows around). */
function insertSorted(arr: Track[], row: Track): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareTracks(arr[mid]!, row) <= 0) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, row);
}

function sortTracks(): void {
  sortArray(tracks);
}

function sortByTrackNo(arr: Track[]): void {
  arr.sort((a, b) => {
    const aDisc = parseInt(a.disc_no, 10) || 0;
    const bDisc = parseInt(b.disc_no, 10) || 0;
    if (aDisc !== bDisc) return aDisc - bDisc;
    const aTrack = parseInt(a.track_no, 10) || 0;
    const bTrack = parseInt(b.track_no, 10) || 0;
    return aTrack - bTrack;
  });
}

function sortByAlbumThenTrackNo(arr: Track[]): void {
  arr.sort((a, b) => {
    const albumCmp = (a.album || "").toLowerCase().localeCompare((b.album || "").toLowerCase());
    if (albumCmp !== 0) return albumCmp;
    const aDisc = parseInt(a.disc_no, 10) || 0;
    const bDisc = parseInt(b.disc_no, 10) || 0;
    if (aDisc !== bDisc) return aDisc - bDisc;
    const aTrack = parseInt(a.track_no, 10) || 0;
    const bTrack = parseInt(b.track_no, 10) || 0;
    return aTrack - bTrack;
  });
}

/* Manual sorting must feel calm: if rows are selected, remember where
   the topmost selected row sat in the viewport and, after the new
   order is rendered, scroll that same row back to the same vertical
   position (as close as the valid range allows). Without this, a
   re-sort makes the selection "jump away" whenever its sorted
   position is off-screen. */
function sortKeepingSelectionInView(sort: () => void): void {
  const anchor = listCtrl?.captureSelectionAnchor() ?? null;
  sort();
  if (anchor) listCtrl?.restoreSelectionAnchor(anchor);
}

function onHeaderClick(col: string): void {
  if (sortColumn === col) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortColumn = col;
    sortDirection = "asc";
  }
  manualSortApplied = true;
  saveSortState();
  sortKeepingSelectionInView(() => {
    sortArray(tracks);
    if (searchResults) sortArray(searchResults);
    renderTrackList();
  });
  updateSortIndicators();
  listCtrl?.setSortState(sortColumn, sortDirection);
}

function applySort(column: string, direction: "asc" | "desc"): void {
  sortColumn = column;
  sortDirection = direction;
  manualSortApplied = true;
  saveSortState();
  sortKeepingSelectionInView(() => {
    sortArray(tracks);
    if (searchResults) sortArray(searchResults);
    renderTrackList();
  });
  updateSortIndicators();
  listCtrl?.setSortState(column, direction);
}

function headerLabel(col: string): string {
  switch (col) {
    case "album_artist": return t("Album Artist");
    case "track_no": return t("#");
    case "playcount": return t("Play Count");
    case "title": return t("Title");
    case "artist": return t("Artist");
    case "album": return t("Album");
    case "composer": return t("Composer");
    case "conductor": return t("Conductor");
    case "year": return t("Year");
    case "genre": return t("Genre");
    case "rating": return t("Rating");
    case "duration": return t("Duration");
    case "bpm": return t("BPM");
    case "path": return t("Path");
    case "ext": return t("Ext");
    default: return col.charAt(0).toUpperCase() + col.slice(1);
  }
}

function headerTooltip(col: string): string {
  switch (col) {
    case "track_no": return t("Disc Number - Track Number");
    case "bpm": return t("Beats Per Minute");
    case "ext": return t("File Extension");
    default: return headerLabel(col);
  }
}

function updateHeaderTooltips(): void {
  const ths = document.querySelectorAll("#list-table thead th");
  ths.forEach((th, i) => {
    const col = HEADER_COLUMNS[i];
    if (!col) return;
    (th as HTMLElement).title = headerTooltip(col);
  });
}

function initSortHeaders(): void {
  const ths = document.querySelectorAll("#list-table thead th");
  ths.forEach((th, i) => {
    const col = HEADER_COLUMNS[i];
    if (!col) return;
    (th as HTMLElement).title = headerTooltip(col);
    (th as HTMLElement).dataset.col = col;
    (th as HTMLElement).addEventListener("click", () => {
      if (document.body.classList.contains("dragging")) return;
      onHeaderClick(col);
    });
  });
}

function updateSortIndicators(): void {
  const ths = document.querySelectorAll<HTMLElement>("#list-table thead th");
  ths.forEach((th) => th.classList.toggle("sorted", th.dataset.col === sortColumn));
  const labels = document.querySelectorAll<HTMLElement>("#list-table thead th .col-label");
  labels.forEach((span) => {
    const th = span.closest("th") as HTMLElement;
    const col = th.dataset.col;
    if (!col) return;
    const label = headerLabel(col);
const isSorted = col === sortColumn;
    span.textContent = label;
    if (isSorted) {
      const badge = document.createElement("span");
      badge.className = "sort-badge";
      badge.innerHTML = sortDirection === "asc" ? ICON_CARET_UP : ICON_CARET_DOWN;
      span.appendChild(badge);
    } else {
      const existing = span.querySelector(".sort-badge");
      if (existing) existing.remove();
    }
  });
}

/* Applying a library "standard sorting mode" (Goto Album/Artist/Composer/Folder
   and the equivalent group clicks) imposes its own order, so any manual
   column-sort state and its column-header arrows no longer apply and must
   be cleared. They reappear the next time the user sorts manually. */
function clearManualSortIndicator(): void {
  sortColumn = "";
  sortDirection = "asc";
  manualSortApplied = false;
  updateSortIndicators();
  listCtrl?.setSortState(sortColumn, sortDirection);
}

/* ── Formatting ────────────────────────────────────────────── */

function formatTrackNo(track: string | null | undefined, disc: string | null | undefined): string {
  const tn = track ? parseInt(track, 10) : NaN;
  const tnStr = isNaN(tn) ? "" : tn.toString().padStart(2, "0");
  if (!disc) return tnStr;
  const dn = parseInt(disc, 10);
  if (isNaN(dn)) return tnStr;
  return `${dn}-${tnStr}`;
}

function trackToListItem(t: Track, idx: number): ListItem {
  const cleanDisc = t.disc_no === "null" ? "" : (t.disc_no || "");
  const cleanTrack = t.track_no === "null" ? "" : (t.track_no || "");
  return {
    id: `tr-${idx}`,
    path: t.path,
    filename: t.path,
    title: t.title || "",
    artist: t.artist || "",
    album: t.album || "",
    trackNo: formatTrackNo(cleanTrack, cleanDisc),
    albumArtist: t.album_artist || "",
    genre: t.genre || "",
    year: t.year === "null" ? "" : (t.year || ""),
    ext: t.filename.includes(".") ? t.filename.split(".").pop()!.toLowerCase() : "",
    discNo: cleanDisc,
    rawTrackNo: cleanTrack,
    trackPath: t.path,
    composer: t.composer || "",
    conductor: t.conductor || "",
    comment: t.comment || "",
    rating: t.rating || 0,
    bpm: t.bpm || 0,
    duration: t.duration,
    playcount: t.playcount ?? 0,
    dlna: t.dlna === 1,
  };
}

/* ── Priority paths ────────────────────────────────────────── */

function sendPriorityPaths(): void {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const tr of listEl.querySelectorAll("tr.selected")) {
    const path = (tr as HTMLElement).dataset.path;
    if (path && !seen.has(path)) {
      paths.push(path);
      seen.add(path);
    }
  }
  for (const tr of listEl.querySelectorAll("tr")) {
    const path = (tr as HTMLElement).dataset.path;
    if (path && !seen.has(path)) {
      paths.push(path);
      seen.add(path);
    }
  }
  if (paths.length > 0) {
    window.electronAPI.prioritizeFiles(paths);
  }
}

/* ── Render ────────────────────────────────────────────────── */

function getCurrentSource(): Track[] {
  if (selectedGroupId === "grp-search") return searchResults ?? [];
  if (selectedGroupId === "grp-most-played") {
    return [...tracks]
      .filter((t) => (t.playcount ?? 0) > 0)
      .sort((a, b) => b.playcount - a.playcount)
      .slice(0, 100);
  }
  if (selectedGroupId?.startsWith("grp-album:")) {
    const albumName = decodeURIComponent(selectedGroupId.slice("grp-album:".length));
    return tracks.filter((t) => t.album === albumName);
  }
  if (selectedGroupId?.startsWith("grp-artist:")) {
    const artistName = decodeURIComponent(selectedGroupId.slice("grp-artist:".length)).toLowerCase();
    if (!artistName) return tracks;
    return tracks.filter((t) => t.artist.toLowerCase().includes(artistName));
  }
  if (selectedGroupId?.startsWith("grp-composer:")) {
    const composerName = decodeURIComponent(selectedGroupId.slice("grp-composer:".length));
    return tracks.filter((t) => t.composer === composerName);
  }
  if (selectedGroupId?.startsWith("grp-folder:")) {
    const folderPath = decodeURIComponent(selectedGroupId.slice("grp-folder:".length));
    return tracks.filter((t) => t.path.startsWith(folderPath + "/"));
  }
  return tracks;
}

function mainListNext(autoPlay = true): void {
  const base = mainListNavBase(autoPlay);
  if (!base) return;
  const source = getCurrentSource();
  const repeat = getRepeat();
  const shuffle = getShuffle();

  /* Auto-advance skips tracks below the configured minimum rating
     (unrated/hated never pass). Manual navigation is not filtered. */
  const ratingFilter = autoPlay && repeat !== "one";
  const belowMinRating = new Set(
    ratingFilter ? source.filter((tr) => !passesMinAutoplayRating(tr.rating)).map((tr) => tr.path) : []
  );
  const usable = (p: string): boolean => isPlayableFile(p) && !belowMinRating.has(p);

  const startTrack = (cand: Track): void => {
    playingTrackPath = cand.path;
    selectedTrackPath = cand.path;
    setSelectedTrack(cand.path, cand.title || undefined);
    const fn = autoPlay || !audio.paused ? playTrack : loadTrack;
    fn(cand.path, cand.title || undefined);
    showDetails(trackToListItem(cand, source.indexOf(cand)));
    for (let i = 0; i < listEl.children.length; i++) {
      const tr = listEl.children[i] as HTMLElement;
      tr.classList.toggle("selected", tr.dataset.path === cand.path);
    }
    refreshListIndicator();
    refreshNavButtons();
  };

  const idx = source.findIndex((t) => t.path === base);
  if (autoPlay && repeat === "one") {
    if (idx >= 0) startTrack(source[idx]!);
    return;
  }

  if (shuffle) {
    const paths = source.map((t) => t.path);
    const tried = new Set<string>();
    let picked: string | null = pickRandomExcluding(paths, base);
    while (picked !== null && !usable(picked)) {
      if (tried.has(picked)) { picked = null; break; }
      tried.add(picked);
      picked = pickRandomExcluding(paths, picked);
    }
    if (!picked) return;
    const next = source.find((t) => t.path === picked);
    if (!next) return;
    startTrack(next);
    return;
  }
  if (idx < 0) return;

  for (let j = idx + 1; j < source.length; j++) {
    const cand = source[j]!;
    if (usable(cand.path)) { startTrack(cand); return; }
  }
  if (repeat === "all") {
    for (let j = 0; j <= idx; j++) {
      const cand = source[j]!;
      if (usable(cand.path)) { startTrack(cand); return; }
    }
  }
}

function mainListPrev(autoPlay = true): void {
  const base = mainListNavBase(autoPlay);
  if (!base) return;
  const source = getCurrentSource();
  const repeat = getRepeat();
  const shuffle = getShuffle();

  const startTrack = (cand: Track): void => {
    playingTrackPath = cand.path;
    selectedTrackPath = cand.path;
    setSelectedTrack(cand.path, cand.title || undefined);
    const fn = autoPlay || !audio.paused ? playTrack : loadTrack;
    fn(cand.path, cand.title || undefined);
    showDetails(trackToListItem(cand, source.indexOf(cand)));
    for (let i = 0; i < listEl.children.length; i++) {
      const tr = listEl.children[i] as HTMLElement;
      tr.classList.toggle("selected", tr.dataset.path === cand.path);
    }
    refreshListIndicator();
    refreshNavButtons();
  };

  if (shuffle) {
    const paths = source.map((t) => t.path);
    const tried = new Set<string>();
    let picked: string | null = pickRandomExcluding(paths, base);
    while (picked !== null && !isPlayableFile(picked)) {
      if (tried.has(picked)) { picked = null; break; }
      tried.add(picked);
      picked = pickRandomExcluding(paths, picked);
    }
    if (!picked) return;
    const prev = source.find((t) => t.path === picked);
    if (!prev) return;
    startTrack(prev);
    return;
  }

  const idx = source.findIndex((t) => t.path === base);
  if (idx < 0) return;

  for (let j = idx - 1; j >= 0; j--) {
    const cand = source[j]!;
    if (isPlayableFile(cand.path)) { startTrack(cand); return; }
  }
  if (repeat === "all") {
    for (let j = source.length - 1; j > idx; j--) {
      const cand = source[j]!;
      if (isPlayableFile(cand.path)) { startTrack(cand); return; }
    }
  }
}

function canMainListNext(): boolean {
  if (!mainListNavBase(false)) return false;
  const source = getCurrentSource();
  if (source.length === 0) return false;
  if (getShuffle()) return true;
  if (getRepeat() === "all") return true;
  const idx = source.findIndex((t) => t.path === mainListNavBase(false));
  return idx >= 0 && idx < source.length - 1;
}

function canMainListPrev(): boolean {
  if (!mainListNavBase(false)) return false;
  const source = getCurrentSource();
  if (source.length === 0) return false;
  if (getShuffle()) return true;
  if (getRepeat() === "all") return true;
  const idx = source.findIndex((t) => t.path === mainListNavBase(false));
  return idx > 0;
}

/* Row Prev/Next start from: the currently PLAYING track while audio is
   active (auto-advance always continues from the track that just ended);
   only for a MANUAL step with nothing playing do we fall back to the LAST
   row the user selected in the main list. */
function mainListNavBase(autoPlay = true): string | null {
  if (autoPlay || isActuallyPlaying()) return playingTrackPath;
  return selectedTrackPath ?? playingTrackPath;
}

function renderTrackList(sourceOverride?: Track[]): void {
  const saved = new Set<string>();
  for (let i = 0; i < listEl.children.length; i++) {
    const tr = listEl.children[i] as HTMLElement;
    if (tr.classList.contains("selected") && tr.dataset.path) {
      saved.add(tr.dataset.path);
    }
  }

  const source = sourceOverride ?? getCurrentSource();
  if (manualSortApplied) sortArray(source);
  const items = source.map((t, i) => trackToListItem(t, i));
  listCtrl!.updateData(items, saved);

  refreshListIndicator();
  refreshNavButtons();
  sendPriorityPaths();
}

/* Refresh every UI surface that displays metadata of the given paths.
   Callers must have updated the underlying models first; nothing here
   touches playback state.

   Deliberately NO re-sort: when a detail of a visible track changes
   (rating, tags, path, duration...) the row must stay exactly where it
   is so the user doesn't lose track of it, even if it is now out of
   sorted order. The list only re-sorts when the user actively sorts
   again (header click / context menu / group switch). */
function refreshTrackUiEverywhere(paths: string[]): void {
  if (paths.length === 0) return;
  const affected = new Set(paths);
  if (listCtrl) renderTrackList();
  if (selectedTrackPath && affected.has(selectedTrackPath)) {
    const source = getCurrentSource();
    const idx = source.findIndex((t) => t.path === selectedTrackPath);
    if (idx !== -1) showDetails(trackToListItem(source[idx]!, idx));
  }
  for (const p of paths) {
    void refreshNowPlayingMetadata(p);
    void refreshTheaterModeMetadata(p);
  }
}

/* Row snapshot → TagUpdate shape, for surfaces that consume tag updates. */
function trackToTagUpdate(t: Track): TagUpdate {
  return {
    path: t.path,
    title: t.title,
    artist: t.artist,
    album: t.album,
    track_no: t.track_no,
    album_artist: t.album_artist,
    genre: t.genre,
    disc_no: t.disc_no,
    year: t.year,
    composer: t.composer,
    conductor: t.conductor,
    comment: t.comment,
    rating: t.rating ?? 0,
    bpm: t.bpm ?? 0,
    duration: parseFloat(t.duration) || 0,
    tags_error: 0,
  };
}

function applyTagUpdate(update: TagUpdate): void {
  const existing = tracks.find((t) => t.path === update.path);
  if (existing) {
    existing.title = update.title;
    existing.artist = update.artist;
    existing.album = update.album;
    existing.track_no = update.track_no;
    existing.album_artist = update.album_artist;
    existing.genre = update.genre;
    existing.year = update.year;
    existing.composer = update.composer;
    existing.conductor = update.conductor;
    existing.comment = update.comment;
    existing.rating = update.rating ?? 0;
    existing.bpm = update.bpm ?? 0;
    existing.duration = String(update.duration ?? "");
    const srcInSearch = searchResults?.find((t) => t.path === update.path);
    if (srcInSearch) {
      Object.assign(srcInSearch, existing);
    }
  }
  updatePlaylistEntry(update);
  refreshTrackUiEverywhere(existing ? [update.path] : []);
}

/* ── Known-duration backfill ───────────────────────────────── */

/* Durations learned after storage (ffprobe fixup pass in the main
   process, or the <audio> element at play time) are merged into every
   model here. Only actual gaps (unknown/zero) are filled — never an
   existing value, matching the DB-level rule. */
function mergeKnownDurations(rows: Array<{ path: string; duration: string }>): void {
  if (!rows || rows.length === 0) return;
  const byPath = new Map(tracks.map((t) => [t.path, t]));
  const touched: string[] = [];
  for (const row of rows) {
    if (!row?.path || !(parseFloat(row.duration) > 0)) continue;
    const existing = byPath.get(row.path);
    if (!existing || parseFloat(existing.duration) > 0) continue;
    existing.duration = row.duration;
    const srcInSearch = searchResults?.find((t) => t.path === row.path);
    if (srcInSearch && !(parseFloat(srcInSearch.duration) > 0)) {
      srcInSearch.duration = row.duration;
    }
    updatePlaylistEntry(trackToTagUpdate(existing));
    touched.push(row.path);
  }
  refreshTrackUiEverywhere(touched);
}

function refreshNavButtons(): void {
  const cp = isPlaylistPlaying() ? canPlaylistPrev() : canMainListPrev();
  const cn = isPlaylistPlaying() ? canPlaylistNext() : canMainListNext();
  updateNavButtons(cp, cn);
  setMprisNavState(cp, cn);
}

/* ── Live DLNA import ──────────────────────────────────────── */

/* Tracks discovered during a running DLNA enumeration arrive in
   batches; they are merged into the library immediately but the list
   re-render is throttled so browsing huge servers doesn't thrash the
   UI. Only the plain track list grows live — search results and
   album/folder groups refresh on the next full library reload. */
const DLNA_MERGE_INTERVAL_MS = 400;
let dlnaPendingRows: Track[] = [];
let dlnaMergeTimer: ReturnType<typeof setTimeout> | null = null;

function queueDlnaRows(rows: Track[]): void {
  dlnaPendingRows.push(...rows);
  if (dlnaMergeTimer) return;
  dlnaMergeTimer = setTimeout(() => {
    dlnaMergeTimer = null;
    flushDlnaRows();
  }, DLNA_MERGE_INTERVAL_MS);
}

function flushDlnaRows(): void {
  const rows = dlnaPendingRows;
  dlnaPendingRows = [];
  if (rows.length === 0 || !listCtrl) return;

  const byPath = new Map(tracks.map((t) => [t.path, t]));
  const touchedRows: Track[] = [];
  for (const row of rows) {
    const existing = byPath.get(row.path);
    if (existing) {
      Object.assign(existing, row);
      const srcInSearch = searchResults?.find((t) => t.path === row.path);
      if (srcInSearch) Object.assign(srcInSearch, row);
    } else {
      /* Brand-new rows slot into sorted position via binary insert;
         existing rows never move (no full re-sort). */
      insertSorted(tracks, row);
      byPath.set(row.path, row);
    }
    /* NEW rows must be included too — a fresh/full import consists of
       nothing else, and without them no re-render would happen at all
       (the main list would stay empty for the whole enumeration). */
    touchedRows.push(row);
  }

  /* A re-discovered track may carry changed tags: refresh every UI
     surface that shows them, exactly like a local tag re-scan does. */
  for (const row of touchedRows) {
    updatePlaylistEntry(trackToTagUpdate(row));
  }
  refreshTrackUiEverywhere(touchedRows.map((r) => r.path));
}

/* ── Block external file drag-and-drop globally ────────────── */
{
  const TRACK_MIME = "application/x-musicpenguin-track";
  document.addEventListener("dragover", (e: DragEvent) => {
    if (e.dataTransfer && !e.dataTransfer.types.includes(TRACK_MIME)) {
      e.preventDefault();
    }
  });
  document.addEventListener("drop", (e: DragEvent) => {
    if (e.dataTransfer && !e.dataTransfer.types.includes(TRACK_MIME)) {
      e.preventDefault();
    }
  });
}

/* ── Init ──────────────────────────────────────────────────── */

async function init() {
  /* Report the measured now-playing bar height to the main process so it
     can pin the window's minimum height to it (the bar must always stay
     fully visible). The height is fixed by CSS and only changes when a
     design switch resizes the bar — the observer re-reports on that. */
  {
    const nowPlayingEl = document.getElementById("now-playing");
    if (nowPlayingEl) {
      const reportNowPlayingHeight = () => {
        const h = Math.ceil(nowPlayingEl.getBoundingClientRect().height);
        if (h > 0) window.electronAPI.setNowPlayingHeight(h);
      };
      reportNowPlayingHeight();
      const observer = new ResizeObserver(reportNowPlayingHeight);
      observer.observe(nowPlayingEl);
      window.addEventListener("beforeunload", () => observer.disconnect());
    }
  }

  injectStaticIcons();
  await initI18n();
  initCssStrings();
  window.electronAPI.onTagUpdate(applyTagUpdate);
  const statusText = document.getElementById("status-text")!;
  const cancelBtn = document.getElementById("status-cancel-btn")! as HTMLButtonElement;
  cancelBtn.addEventListener("click", async () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = t("Stopping...");
    await window.electronAPI.stopTagRead();
    cancelBtn.classList.add("hidden");
    cancelBtn.disabled = false;
    cancelBtn.textContent = t("Cancel");
    statusText.textContent = t("$1 $2 in MusicPenguin library.", tracks.length, fileCountLabel(tracks.length)+" "+t("Tag scanning stopped."));
  });
  const settingsOverlay = document.getElementById("settings-overlay")!;
  const foldersOverlay = document.getElementById("folders-overlay")!;
  subscribeDlnaProgress((found, name, addedTracks) => {
    /* Only tracks DISCOVERED SO FAR — the total is unknowable while
       enumerating, so it is never implied. */
    statusText.textContent = t("Scanning audio server $1: $2 $3", name ?? "", found, fileCountLabel(found));
    if (addedTracks.length > 0) queueDlnaRows(addedTracks);
  });
  window.electronAPI.onTagScanning((data) => {
    if (!settingsOverlay.classList.contains("hidden") || !foldersOverlay.classList.contains("hidden")) return;
    if (!data.path) {
      statusText.textContent = t("Tag scanning complete.")+" "+t("$1 $2 in MusicPenguin library.", tracks.length, fileCountLabel(tracks.length));
      cancelBtn.classList.add("hidden");
      return;
    }
    const name = data.path.split("/").pop() || data.path.split("\\").pop() || data.path;
    const progress = data.total ? `(${data.scanned}/${data.total}) ` : "";
    statusText.textContent = t("Reading tags $1 $2", progress, name);
    cancelBtn.classList.remove("hidden");
  });

  await loadSortState();
  await loadUIState();
  await loadSplitterState();
  await loadColumnWidths();
  await loadColumnVisibility();
  initSortHeaders();
  updateSortIndicators();

  listCtrl = initVirtualList(listEl, (item) => {
    navFromList = "main";
    selectedTrackPath = item.trackPath;
    showDetails(item);
    setSelectedTrack(item.trackPath, item.title || undefined);
    sendPriorityPaths();
  }, (item) => {
    clearPlaylistPlaying();
    resetShuffleHistory(selectedGroupId ?? "");
    playingTrackPath = item.trackPath;
    playTrack(item.trackPath, item.title || undefined);
  }, applySort, (id: string) => {
    const source = getCurrentSource();
    applySortingMode(id, source);
    clearManualSortIndicator();
    renderTrackList(source);
    listCtrl!.setSortingMode(id);
  }, (item) => {
    gotoAlbum(item.album, item.trackPath);
  }, (item) => {
    const dir = item.trackPath.substring(0, item.trackPath.lastIndexOf("/"));
    gotoFolder(dir, item.trackPath);
  }, (item) => {
    gotoArtist(item.artist, item.trackPath);
  }, (item) => {
    gotoComposer(item.composer, item.trackPath);
  });
  listCtrl.setSortState(sortColumn, sortDirection);
  listCtrl!.setSortingMode(null);
  listCtrl.setAfterRender(refreshListIndicator);
  window.addEventListener("beforeunload", saveUIStateSync);
  setOnDeletedFiles((paths) => {
    const removed = new Set(paths);
    tracks = tracks.filter((t) => !removed.has(t.path));
    renderTrackList();
  });

  async function runSearch(query: string, regex: boolean): Promise<void> {
    const cols: string[] = [];
    const tagMap: Record<string, string> = {
      "search-tag-title": "title",
      "search-tag-artist": "artist",
      "search-tag-album": "album",
      "search-tag-album-artist": "album_artist",
      "search-tag-composer": "composer",
      "search-tag-conductor": "conductor",
      "search-tag-year": "year",
      "search-tag-genre": "genre",
      "search-tag-comment": "comment",
      "search-tag-path": "path",
    };
    for (const [id, col] of Object.entries(tagMap)) {
      const cb = document.getElementById(id) as HTMLInputElement;
      if (cb?.checked) cols.push(col);
    }
    searchResults = await window.electronAPI.searchFiles({ query, columns: cols, regex });
    sortArray(searchResults);
    selectedGroupId = "grp-search";
    refreshGroupsUI();
    renderTrackList();
    listCtrl!.setScrollOffset(0);
    saveUIState();
  }

  function buildGroups(): TreeNode[] {
    return [
      ...groupsData,
      ...(albumGroupItems.length ? [{ id: "grp-album-heading", label: "── " + t("Album") + " ──" }] as TreeNode[] : []),
      ...albumGroupItems,
      ...(artistGroupItems.length ? [{ id: "grp-artist-heading", label: "── " + t("Artist") + " ──" }] as TreeNode[] : []),
      ...artistGroupItems,
      ...(composerGroupItems.length ? [{ id: "grp-composer-heading", label: "── " + t("Composer") + " ──" }] as TreeNode[] : []),
      ...composerGroupItems,
      ...(folderGroupItems.length ? [{ id: "grp-folder-heading", label: "── " + t("Folder") + " ──" }] as TreeNode[] : []),
      ...folderGroupItems,
    ];
  }

  function getTracksForGroup(groupId: string): Array<{ path: string; title: string; artist: string; duration: string }> {
    let source: Track[];
    if (groupId.startsWith("grp-album:")) {
      const album = decodeURIComponent(groupId.slice("grp-album:".length));
      source = tracks.filter((t) => t.album === album)
        .sort((a, b) => {
          const aDisc = parseInt(a.disc_no, 10) || 0;
          const bDisc = parseInt(b.disc_no, 10) || 0;
          const aTrack = parseInt(a.track_no, 10) || 0;
          const bTrack = parseInt(b.track_no, 10) || 0;
          return aDisc !== bDisc ? aDisc - bDisc : aTrack - bTrack;
        });
    } else if (groupId.startsWith("grp-folder:")) {
      const folder = decodeURIComponent(groupId.slice("grp-folder:".length));
      source = tracks.filter((t) => t.path.startsWith(folder + "/"))
        .sort((a, b) => a.path.localeCompare(b.path));
    } else if (groupId.startsWith("grp-artist:")) {
      const artist = decodeURIComponent(groupId.slice("grp-artist:".length)).toLowerCase();
      source = artist
        ? tracks.filter((t) => t.artist.toLowerCase().includes(artist))
            .sort((a, b) => a.path.localeCompare(b.path))
        : [];
    } else if (groupId.startsWith("grp-composer:")) {
      const composer = decodeURIComponent(groupId.slice("grp-composer:".length));
      source = tracks.filter((t) => t.composer === composer)
        .sort((a, b) => a.path.localeCompare(b.path));
    } else {
      return [];
    }
    return source.map((t) => ({
      path: t.path,
      title: t.title || "",
      artist: t.artist || "",
      duration: t.duration || "",
    }));
  }

  function refreshGroupsUI(): void {
    renderGroups(groupsEl, buildGroups(), onGroupSelect, onGroupDblClick, selectedGroupId, getTracksForGroup,
      (folderPath) => window.electronAPI.showInExternalFileExplorer(folderPath, true),
      onRemoveGroup);
  }

  function onRemoveGroup(node: TreeNode): void {
    let arr: TreeNode[];
    if (node.id.startsWith("grp-album:")) arr = albumGroupItems;
    else if (node.id.startsWith("grp-artist:")) arr = artistGroupItems;
    else if (node.id.startsWith("grp-composer:")) arr = composerGroupItems;
    else if (node.id.startsWith("grp-folder:")) arr = folderGroupItems;
    else return;
    const idx = arr.findIndex((n) => n.id === node.id);
    if (idx === -1) return;
    arr.splice(idx, 1);
    void saveGroupItems();
    if (selectedGroupId === node.id) {
      if (arr.length > 0) {
        selectedGroupId = arr[Math.min(idx, arr.length - 1)]!.id;
      } else {
        selectedGroupId = "grp-allfiles";
      }
    }
    refreshGroupsUI();
    groupsEl.focus();
    onGroupSelect({ id: selectedGroupId!, label: "" });
  }

  document.addEventListener("language-changed", () => {
    updateSortIndicators();
    updateHeaderTooltips();
    refreshGroupsUI();
  });

  function onGroupDblClick(node: TreeNode): void {
    if (node.id.startsWith("grp-album:")) {
      sortColumn = "track_no";
      sortDirection = "asc";
      saveSortState();
      updateSortIndicators();
      const source = getCurrentSource();
      sortArray(source);
      renderTrackList(source);
      listCtrl!.setScrollOffset(0);
      const first = source[0];
      if (first) {
        clearPlaylistPlaying();
        resetShuffleHistory(node.id);
        playingTrackPath = first.path;
        playTrack(first.path, first.title || undefined);
        showDetails(trackToListItem(first, 0));
        selectedTrackPath = first.path;
        listCtrl!.selectAndScrollTo(first.path);
      }
    } else if (node.id.startsWith("grp-folder:")) {
      sortColumn = "path";
      sortDirection = "asc";
      saveSortState();
      updateSortIndicators();
      const source = getCurrentSource();
      sortArray(source);
      renderTrackList(source);
      listCtrl!.setScrollOffset(0);
      const first = source[0];
      if (first) {
        clearPlaylistPlaying();
        resetShuffleHistory(node.id);
        playingTrackPath = first.path;
        playTrack(first.path, first.title || undefined);
        showDetails(trackToListItem(first, 0));
        selectedTrackPath = first.path;
        listCtrl!.selectAndScrollTo(first.path);
      }
    }
  }

  function fetchGroupCoverArt(node: TreeNode, samplePath: string): void {
    if (node.thumbnail || !samplePath) return;
    fetchThumbnail(samplePath).then((thumb) => {
      if (thumb) {
        node.thumbnail = thumb;
        refreshGroupsUI();
      }
    }).catch(() => {});
  }

  function gotoAlbum(album: string, sourcePath?: string): void {
    if (!album) return;
    const id = "grp-album:" + encodeURIComponent(album);
    let node = albumGroupItems.find((n) => n.id === id);
    if (!node) {
      node = { id, label: album };
      albumGroupItems.push(node);
      void saveGroupItems();
    }
    selectedGroupId = id;
    refreshGroupsUI();
    const anchor = listCtrl?.captureSelectionAnchor() ?? null;
    const source = getCurrentSource();
    applySortingMode(TRACKNO, source);
    clearManualSortIndicator();
    renderTrackList(source);
    listCtrl!.setSortingMode(TRACKNO);
    if (anchor) {
      listCtrl?.restoreSelectionAnchor(anchor);
    } else {
      listCtrl!.setScrollOffset(0);
    }
    saveUIState();
    if (!node.thumbnail) {
      const sample = tracks.find((t) => t.album === album)?.path;
      if (sample) fetchGroupCoverArt(node, sample);
    }
    if (sourcePath) {
      const found = source.find((t) => t.path === sourcePath);
      if (found) {
        const idx = source.indexOf(found);
        showDetails(trackToListItem(found, idx));
        selectedTrackPath = found.path;
        listCtrl!.selectAndScrollTo(found.path);
      }
    }
  }

  function gotoFolder(folder: string, sourcePath?: string): void {
    if (!folder) return;
    const id = "grp-folder:" + encodeURIComponent(folder);
    let node = folderGroupItems.find((n) => n.id === id);
    if (!node) {
      const label = folder.replace(/\/$/, "").split("/").pop() || folder;
      node = { id, label };
      folderGroupItems.push(node);
      void saveGroupItems();
    }
    selectedGroupId = id;
    refreshGroupsUI();
    const anchor = listCtrl?.captureSelectionAnchor() ?? null;
    const source = getCurrentSource();
    const isDlna = source.some((t) => t.dlna);
    if (isDlna) {
      applySortingMode(ARTIST_ALBUM_TRACKNO, source);
    } else {
      applySortingMode(FILENAME, source);
    }
    clearManualSortIndicator();
    renderTrackList(source);
    listCtrl!.setSortingMode(isDlna ? ARTIST_ALBUM_TRACKNO : FILENAME);
    if (anchor) {
      listCtrl?.restoreSelectionAnchor(anchor);
    } else {
      listCtrl!.setScrollOffset(0);
    }
    saveUIState();
    if (!node.thumbnail) {
      const sample = tracks
        .filter((t) => t.path.startsWith(folder + "/"))
        .sort((a, b) => a.path.localeCompare(b.path))
        [0]?.path;
      if (sample) fetchGroupCoverArt(node, sample);
    }
    if (sourcePath) {
      const found = source.find((t) => t.path === sourcePath);
      if (found) {
        const idx = source.indexOf(found);
        showDetails(trackToListItem(found, idx));
        selectedTrackPath = found.path;
        listCtrl!.selectAndScrollTo(found.path);
      }
    }
  }

  function stripArtistSuffix(artist: string): string {
    return artist.replace(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|\+)\s+.+$/i, "").trim();
  }

  function gotoArtist(artist: string, sourcePath?: string): void {
    if (!artist) return;
    const baseArtist = stripArtistSuffix(artist) || artist;
    const id = "grp-artist:" + encodeURIComponent(baseArtist);
    let node = artistGroupItems.find((n) => n.id === id);
    if (!node) {
      node = { id, label: baseArtist };
      artistGroupItems.push(node);
      void saveGroupItems();
    }
    selectedGroupId = id;
    refreshGroupsUI();
    const anchor = listCtrl?.captureSelectionAnchor() ?? null;
    const source = getCurrentSource();
    applySortingMode(ARTIST_ALBUM_TRACKNO, source);
    clearManualSortIndicator();
    renderTrackList(source);
    listCtrl!.setSortingMode(ARTIST_ALBUM_TRACKNO);
    if (anchor) {
      listCtrl?.restoreSelectionAnchor(anchor);
    } else {
      listCtrl!.setScrollOffset(0);
    }
    saveUIState();
    if (sourcePath) {
      const found = source.find((t) => t.path === sourcePath);
      if (found) {
        const idx = source.indexOf(found);
        showDetails(trackToListItem(found, idx));
        selectedTrackPath = found.path;
        listCtrl!.selectAndScrollTo(found.path);
      }
    }
  }

  function gotoComposer(composer: string, sourcePath?: string): void {
    if (!composer) return;
    const id = "grp-composer:" + encodeURIComponent(composer);
    let node = composerGroupItems.find((n) => n.id === id);
    if (!node) {
      node = { id, label: composer };
      composerGroupItems.push(node);
      void saveGroupItems();
    }
    selectedGroupId = id;
    refreshGroupsUI();
    const anchor = listCtrl?.captureSelectionAnchor() ?? null;
    const source = getCurrentSource();
    applySortingMode(ARTIST_ALBUM_TRACKNO, source);
    clearManualSortIndicator();
    renderTrackList(source);
    listCtrl!.setSortingMode(ARTIST_ALBUM_TRACKNO);
    if (anchor) {
      listCtrl?.restoreSelectionAnchor(anchor);
    } else {
      listCtrl!.setScrollOffset(0);
    }
    saveUIState();
    if (sourcePath) {
      const found = source.find((t) => t.path === sourcePath);
      if (found) {
        const idx = source.indexOf(found);
        showDetails(trackToListItem(found, idx));
        selectedTrackPath = found.path;
        listCtrl!.selectAndScrollTo(found.path);
      }
    }
  }

  function onGroupSelect(node: TreeNode): void {
    if (node.id === "grp-search" && searchResults === null) {
      const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
      const regexBtn = document.getElementById("regex-btn") as HTMLElement | null;
      const query = searchInput?.value.trim() ?? "";
      const regex = regexBtn?.classList.contains("active") ?? false;
      runSearch(query, regex);
      return;
    }
    if (node.id === "grp-album-heading" || node.id === "grp-folder-heading" ||
        node.id === "grp-artist-heading" || node.id === "grp-composer-heading") return;
    selectedGroupId = node.id;
    saveUIState();
    if (node.id === "grp-most-played") {
      sortColumn = "playcount";
      sortDirection = "desc";
      saveSortState();
      updateSortIndicators();
    }
    const anchor = listCtrl?.captureSelectionAnchor() ?? null;

    /* Actively clicking a group applies that group's sorting scheme to
       the main list, overriding (and clearing) any differing manual
       sort — mirroring the Goto actions. */
    if (node.id === "grp-allfiles" || node.id === "grp-search" || node.id === "grp-most-played") {
      listCtrl!.setSortingMode(null);
      renderTrackList();
    } else if (node.id.startsWith("grp-album:")) {
      const source = getCurrentSource();
      applySortingMode(TRACKNO, source);
      clearManualSortIndicator();
      renderTrackList(source);
      listCtrl!.setSortingMode(TRACKNO);
    } else if (node.id.startsWith("grp-artist:") || node.id.startsWith("grp-composer:")) {
      const source = getCurrentSource();
      applySortingMode(ARTIST_ALBUM_TRACKNO, source);
      clearManualSortIndicator();
      renderTrackList(source);
      listCtrl!.setSortingMode(ARTIST_ALBUM_TRACKNO);
    } else if (node.id.startsWith("grp-folder:")) {
      const source = getCurrentSource();
      const isDlna = source.some((t) => t.dlna);
      if (isDlna) applySortingMode(ARTIST_ALBUM_TRACKNO, source);
      else applySortingMode(FILENAME, source);
      clearManualSortIndicator();
      renderTrackList(source);
      listCtrl!.setSortingMode(isDlna ? ARTIST_ALBUM_TRACKNO : FILENAME);
    } else {
      listCtrl!.updateData([]);
    }
    const prevTrack = selectedTrackPath;
    if (prevTrack && anchor) {
      const source = getCurrentSource();
      const found = source.find((t) => t.path === prevTrack);
      if (found) {
        const idx = source.indexOf(found);
        showDetails(trackToListItem(found, idx));
        listCtrl!.restoreSelectionAnchor(anchor);
        return;
      }
    }
    listCtrl!.setScrollOffset(0);
    showDetails(null);
    selectedTrackPath = null;
  }

  /* Restore persisted Goto Album/Artist/Composer/Folder groups before
     the left panel is first rendered. */
  await loadGroupItems();
  refreshGroupsUI();

  initPlaylist(
    (path: string) => {
      const track = tracks.find((t) => t.path === path);
      if (track && track.album) gotoAlbum(track.album, path);
    },
    (path: string) => {
      const dir = path.substring(0, path.lastIndexOf("/"));
      gotoFolder(dir, path);
    },
    (path: string) => {
      const track = tracks.find((t) => t.path === path);
      if (track && track.artist) gotoArtist(track.artist, path);
    },
    (path: string) => {
      const track = tracks.find((t) => t.path === path);
      if (track && track.composer) gotoComposer(track.composer, path);
    },
  );

  onPlaylistSelect((path: string) => {
    navFromList = "playlist";
    const track = tracks.find((t) => t.path === path);
    if (track) {
      const idx = tracks.indexOf(track);
      showDetails(trackToListItem(track, idx));
    }
    refreshNavButtons();
  });

  registerMainListSelectionQuery(() => listCtrl?.hasSelection() ?? false);

  /* Reload the track list when a second instance modified the library. */
  window.electronAPI.onLibraryChanged(async () => {
    tracks = await window.electronAPI.loadFiles();
    sortTracks();
    renderTrackList();
    refreshGroupsUI();
  });

  /* Durations learned by the main process's ffprobe fixup pass. */
  window.electronAPI.onDurationsFixed((data) => mergeKnownDurations(data?.rows ?? []));

  /* Durations learned at play time from the <audio> element. */
  document.addEventListener("track-duration-known", ((e: CustomEvent) => {
    const { path, duration } = e.detail ?? {};
    if (path && Number.isFinite(duration)) {
      mergeKnownDurations([{ path, duration: String(duration) }]);
    }
  }) as EventListener);

  /* Route prev/next to playlist or main list.  Playlist wins when it is
     actively playing, or — only while IDLE — when the user last selected
     there. A main-list track actively playing always uses the main list. */
  const usePlaylistNav = (): boolean =>
    isPlaylistPlaying() || (!isActuallyPlaying() && navFromList === "playlist" && hasPlaylistNavBase());

  setNavCallbacks(
    () => { usePlaylistNav() ? prevPlaylist(false) : mainListPrev(false); refreshNavButtons(); },
    () => { usePlaylistNav() ? advancePlaylist(false) : mainListNext(false); refreshNavButtons(); },
  );
  onSelectedPathChange((path) => { playingTrackPath = path; });
  onNavStateChange(refreshNavButtons);
  onPlaylistStateChange(refreshNavButtons);
  onPlayModeChange(refreshNavButtons);
  refreshNavButtons();

  setTrackNavCallbacks(
    () => usePlaylistNav() ? prevPlaylist(false) : mainListPrev(false),
    () => usePlaylistNav() ? advancePlaylist(false) : mainListNext(false),
    () => usePlaylistNav() ? canPlaylistPrev() : canMainListPrev(),
    () => usePlaylistNav() ? canPlaylistNext() : canMainListNext(),
  );

/* Theater mode opened with nothing playing: it preloads the shown
      track paused (loadTrack — same as single-select semantics) so its
      prev/next are correct immediately; play resumes. Unplayable tracks
      are NOT preloaded (no external-player side effects on a mere
      theater mode open) — only an explicit play may send them there via
      playTrack. */
  setShownTrackHandlers(
    (path) => { if (isPlayableFile(path)) void loadTrack(path); },
    (path) => { void playTrack(path); },
  );

  onTrackEnd(() => {
    if (isPlaylistPlaying()) {
      advancePlaylist();
    } else {
      mainListNext();
    }
    refreshNavButtons();
  });

  await initSearchPanel((query, regex) => {
    runSearch(query, regex);
  });

  // Restore group state for saved search results
  if (selectedGroupId === "grp-search") {
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    const regexBtn = document.getElementById("regex-btn") as HTMLElement | null;
    const query = searchInput?.value.trim() ?? "";
    const regex = regexBtn?.classList.contains("active") ?? false;
    if (query) {
      await runSearch(query, regex);
    }
  }

  await initPlayableExtensions();
  await initExternalPlayer();
  await initNowPlaying();

  /* ── File path change handler ─────────────────────────────── */
  document.addEventListener("file-path-changed", ((e: CustomEvent) => {
    const { oldPath, newPath, newFilename } = e.detail;

    const updateInArray = (arr: Track[]) => {
      const t = arr.find((x) => x.path === oldPath);
      if (t) {
        t.path = newPath;
        t.filename = newFilename;
      }
    };
    updateInArray(tracks);
    if (searchResults) updateInArray(searchResults);

    if (selectedTrackPath === oldPath) selectedTrackPath = newPath;
    if (playingTrackPath === oldPath) playingTrackPath = newPath;

    updatePlaylistPaths(oldPath, newPath);

    /* NO re-sort: the renamed/moved row keeps its position even if the
       list is sorted by path; the visible cells are refreshed in place
       by renderTrackList below. Order updates only on manual sort. */
    renderTrackList();

    if (selectedTrackPath === newPath) {
      const source = getCurrentSource();
      const idx = source.findIndex((t) => t.path === newPath);
      if (idx >= 0) {
        showDetails(trackToListItem(source[idx]!, idx));
        for (let i = 0; i < listEl.children.length; i++) {
          const tr = listEl.children[i] as HTMLElement;
          tr.classList.toggle("selected", tr.dataset.path === newPath);
        }
      }
    }
  }) as EventListener);

  /* ── Playcount update handler ────────────────────────── */
  document.addEventListener("playcount-updated", ((e: CustomEvent) => {
    const { path, playcount } = e.detail;
    const t = tracks.find((x) => x.path === path);
    if (t) t.playcount = playcount;
    if (searchResults) {
      const sr = searchResults.find((x) => x.path === path);
      if (sr) sr.playcount = playcount;
    }
    const row = listEl.querySelector(`tr[data-path="${path}"]`);
    if (row) {
      const cell = row.querySelector(".col-playcount") as HTMLElement | null;
      if (cell) cell.textContent = playcount ? String(playcount) : "";
    }
    if (selectedGroupId === "grp-most-played") {
      renderTrackList();
    }
  }) as EventListener);

  /* ── Rating update handler ───────────────────────────── */
  document.addEventListener("rating-updated", ((e: CustomEvent) => {
    const { path, rating } = e.detail;
    const t = tracks.find((x) => x.path === path);
    if (t) t.rating = rating;
    if (searchResults) {
      const sr = searchResults.find((x) => x.path === path);
      if (sr) sr.rating = rating;
    }
    /* The visible row was already repainted in place by setRatingValue
       (cells + virtual list model). Deliberately NO re-sort here: a
       re-rated track must stay at its position even when the list is
       sorted by rating — it may sit out of order until the user sorts
       again manually, which is exactly what we want. */
  }) as EventListener);

  /* ── Init settings dialog ─────────────────────────────────── */
  await initSettings();

  /* When the user empties the MusicPenguin library, drop every
     user-built "album"/"artist"/"composer"/"folder" group so the left
     panel no longer references tracks that no longer exist. */
  setOnDatabaseCleared(() => {
    clearPlaylist();
    albumGroupItems = [];
    artistGroupItems = [];
    composerGroupItems = [];
    folderGroupItems = [];
    void saveGroupItems();
    const wasUserGroup =
      !!selectedGroupId &&
      (selectedGroupId.startsWith("grp-album:") ||
        selectedGroupId.startsWith("grp-artist:") ||
        selectedGroupId.startsWith("grp-composer:") ||
        selectedGroupId.startsWith("grp-folder:"));
    if (wasUserGroup) selectedGroupId = "grp-allfiles";
    refreshGroupsUI();
    if (wasUserGroup) onGroupSelect({ id: "grp-allfiles", label: "" });
  });

  /* ── Init about dialog ─────────────────────────────────── */
  {
    const aboutOverlay = document.getElementById("about-overlay")!;
    const aboutClose = document.getElementById("about-dialog-close")!;
    const aboutVersion = document.getElementById("about-version")!;
    const aboutBluesky = document.getElementById("about-bluesky2") as HTMLAnchorElement;
    const aboutGitHub = document.getElementById("about-github2") as HTMLAnchorElement;
    const aboutIconset = document.getElementById("about-iconset2") as HTMLAnchorElement;
    const aboutOk = document.getElementById("about-ok")!;
    const logo = document.getElementById("app-logo")!;

    function showAbout(): void {
      window.electronAPI.getVersion().then((v) => {
        aboutVersion.textContent = t("Version $1", v);
      });
      aboutOverlay.classList.remove("hidden");
    }

    function hideAbout(): void {
      aboutOverlay.classList.add("hidden");
    }

    logo.addEventListener("click", showAbout);
    aboutClose.addEventListener("click", hideAbout);
    aboutOk.addEventListener("click", hideAbout);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !aboutOverlay.classList.contains("hidden")) hideAbout();
    });

    aboutGitHub.addEventListener("click", (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(aboutGitHub.href);
    });

    document.getElementById("about-logo")!.addEventListener("click", () => {
      window.electronAPI.openExternal(aboutBluesky.href);
    });

    aboutBluesky.addEventListener("click", (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(aboutBluesky.href);
    });

    aboutIconset.addEventListener("click", (e) => {
      e.preventDefault();
      window.electronAPI.openExternal(aboutIconset.href);
    });

    /* ── License modal: shows the bundled icon license 1:1 ── */
    const licenseOverlay = document.getElementById("license-overlay")!;
    const licenseClose = document.getElementById("license-dialog-close")!;
    const licenseTitle = document.getElementById("license-dialog-title")!;
    const licenseText = document.getElementById("license-text")!;
    let licenseLoaded = false;

    function showLicense(): void {
      licenseTitle.textContent = t("Icons License: $1", "tabler-icons");
      if (!licenseLoaded) {
        licenseText.textContent = iconLicense;
        licenseLoaded = true;
      }
      licenseOverlay.classList.remove("hidden");
    }

    function hideLicense(): void {
      licenseOverlay.classList.add("hidden");
    }

    document.getElementById("about-license-btn")!.addEventListener("click", showLicense);
    licenseClose.addEventListener("click", hideLicense);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !licenseOverlay.classList.contains("hidden")) hideLicense();
    });
    licenseOverlay.addEventListener("click", (e) => {
      if (e.target === licenseOverlay) hideLicense();
    });

    aboutOverlay.addEventListener("click", (e) => {
      if (e.target === aboutOverlay) hideAbout();
    });
  }

  /* ── Init folders dialog ─────────────────────────────────── */
  await initFoldersDialog(async () => {
    tracks = await window.electronAPI.loadFiles();
    statusText.textContent = t("$1 $2 in MusicPenguin library.", tracks.length, fileCountLabel(tracks.length));
    if (selectedGroupId === "grp-search") {
      const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
      const regexBtn = document.getElementById("regex-btn") as HTMLElement | null;
      const query = searchInput?.value.trim() ?? "";
      const regex = regexBtn?.classList.contains("active") ?? false;
      if (query) {
        await runSearch(query, regex);
      } else {
        renderTrackList();
      }
    } else {
      sortTracks();
      renderTrackList();
      listCtrl!.setScrollOffset(0);
    }
  });

  /* ── Scan button ────────────────────────────────────────── */
  document.getElementById("scan-btn")!.addEventListener("click", async () => {
    cancelBtn.classList.add("hidden");
    statusText.textContent = t("Loading folders...");

    const result = await runFullScan({
      onProgress: (msg) => { statusText.textContent = msg; },
    });

    /* A reload failure must not swallow the summary — the status bar
       has to end on a final state either way. */
    try {
      tracks = await window.electronAPI.loadFiles();
    } catch (err) {
      debugLog("[scan] loadFiles failed:", err instanceof Error ? err.message : String(err));
    }

    const parts: string[] = [];
    parts.push(t("$1 tracks in library.", result.total));
    if (result.removed > 0) parts.push(t("$1 removed.", result.removed));
    if (result.errors > 0) parts.push(t("$1 errors.", result.errors));
    statusText.textContent = parts.join(" ");
    sortTracks();
    renderTrackList();
    listCtrl!.setScrollOffset(0);
    refreshProblematicBtn();
  });

  /* ── Problematic files button ──────────────────────────── */
  const problematicBtn = document.getElementById("problematic-btn")!;

  async function refreshProblematicBtn() {
    try {
      const count = await window.electronAPI.getProblematicFileCount();
      problematicBtn.hidden = count < 1;
    } catch {
      problematicBtn.hidden = true;
    }
  }

  problematicBtn.addEventListener("click", async () => {
    const result = await window.electronAPI.getProblematicFiles();
    if (result.count == 1) {
      statusText.textContent = t("1 problematic file, see $1", result.path);
    } else if (result.count > 1) {
      statusText.textContent = t("$1 problematic files, see $2", result.count, result.path);
    } else {
      alert(t("No problematic files found."));
      statusText.textContent = t("No problematic files found.");
    }
  });

  /* ── Startup: load existing files from DB, populate list, start tag reader ── */

  /* ── Let the browser paint the empty shell first ─── */
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  /* ── Load tracks from DB ────────────────────────────── */
  tracks = await window.electronAPI.loadFiles();
  statusText.textContent = t("$1 $2 in MusicPenguin library.", tracks.length, fileCountLabel(tracks.length));
  refreshProblematicBtn();

  /* ── Sort and render main list ───────────────────────── */
  sortTracks();
  if (selectedGroupId === "grp-search") {
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    const regexBtn = document.getElementById("regex-btn") as HTMLElement | null;
    const query = searchInput?.value.trim() ?? "";
    const regex = regexBtn?.classList.contains("active") ?? false;
    if (query) {
      await runSearch(query, regex);
    } else {
      renderTrackList();
    }
  } else if (selectedGroupId === "grp-allfiles") {
    renderTrackList();
  } else if (selectedGroupId === "grp-most-played") {
    sortColumn = "playcount";
    sortDirection = "desc";
    saveSortState();
    listCtrl?.setSortState(sortColumn, sortDirection);
    updateSortIndicators();
    renderTrackList();
  } else {
    renderTrackList();
  }

  /* ── Select restored track / restore scroll position ───── */
  if (selectedPath) {
    const source = getCurrentSource();
    if (source.find((t) => t.path === selectedPath)) {
      const item = listCtrl!.selectAndScrollTo(selectedPath);
      if (item) showDetails(item);
    } else if (listScrollTop > 0) {
      requestAnimationFrame(() => listCtrl!.setScrollOffset(listScrollTop));
    }
  } else if (listScrollTop > 0) {
    requestAnimationFrame(() => listCtrl!.setScrollOffset(listScrollTop));
  }

  /* ── Startup complete: drop the black overlay ──────────── */
  document.getElementById("startup-overlay")?.remove();
}

init();
