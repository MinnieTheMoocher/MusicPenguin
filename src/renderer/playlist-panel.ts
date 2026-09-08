import { PlaylistEntry } from "./types.js";
import { playTrack, loadTrack, selectedPath, isActuallyPlaying, getShuffle, getRepeat, onPlayModeChange, pickRandomExcluding, isPlayableFile, noteExternalPlays } from "./now-playing.js";
import { getExternalPlayer, getExternalPlayerDisplayName } from "./external-player.js";
import { formatTime } from "./list-view.js";
import { audio } from "./audio.js";
import { getThumbnail, fetchThumbnail } from "./thumbnail-cache.js";
import { onPlaybackFailure } from "./playback-error.js";
import { t } from "../common/i18n/index.js";
import { ICON_SPEAKER, ICON_MUSIC_NOTE, ICON_CARET_UP, ICON_CARET_DOWN } from "./icons.js";
import { passesMinAutoplayRating } from "./min-autoplay-rating.js";
import { ARTIST_ALBUM_TRACKNO, SORTING_MODES, sortingModeLabel, sortPlaylistByArtistAlbumTrackNo } from "./sorting.js";

let playlist: PlaylistEntry[] = [];
let selectedIndices: Set<number> = new Set();
let lastClickedIndex: number | null = null;
let currentPlaylistIndex: number | null = null;
let playlistStateChangeCallbacks: Array<() => void> = [];
export function onPlaylistStateChange(cb: () => void): void {
  playlistStateChangeCallbacks.push(cb);
}
let onSelectCallbacks: Array<(path: string) => void> = [];
export function onPlaylistSelect(cb: (path: string) => void): void {
  onSelectCallbacks.push(cb);
}
let mainListSelectionQuery: () => boolean = () => false;
export function registerMainListSelectionQuery(cb: () => boolean): void {
  mainListSelectionQuery = cb;
}
let playlistSortColumn = "";
let playlistSortDirection: "asc" | "desc" = "asc";
let onGotoAlbumPlaylistCb: ((path: string) => void) | null = null;
let onGotoFolderPlaylistCb: ((path: string) => void) | null = null;
let onGotoArtistPlaylistCb: ((path: string) => void) | null = null;
let onGotoComposerPlaylistCb: ((path: string) => void) | null = null;

function sortPlaylist(): void {
  if (!playlistSortColumn) return;
  if (playlistSortColumn === ARTIST_ALBUM_TRACKNO) {
    sortPlaylistByArtistAlbumTrackNo(playlist);
    return;
  }
  playlist.sort((a, b) => {
    if (playlistSortColumn === "rating" || playlistSortColumn === "playcount") {
      const aVal = a[playlistSortColumn] ?? 0;
      const bVal = b[playlistSortColumn] ?? 0;
      return playlistSortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
    if (playlistSortColumn === "trackNo" || playlistSortColumn === "duration") {
      const aVal = parseFloat(String(a[playlistSortColumn] ?? "0")) || 0;
      const bVal = parseFloat(String(b[playlistSortColumn] ?? "0")) || 0;
      return playlistSortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
    const aVal = String(a[playlistSortColumn as keyof PlaylistEntry] ?? "");
    const bVal = String(b[playlistSortColumn as keyof PlaylistEntry] ?? "");
    const cmp = aVal.localeCompare(bVal);
    return playlistSortDirection === "asc" ? cmp : -cmp;
  });
}

const SORT_COLUMNS = [
  { key: "trackNo", label: "#" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumArtist", label: "Album Artist" },
  { key: "composer", label: "Composer" },
  { key: "conductor", label: "Conductor" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
  { key: "rating", label: "Rating" },
  { key: "duration", label: "Duration" },
  { key: "playcount", label: "Play Count" },
  { key: "ext", label: "File Extension" },
  { key: "filename", label: "Path" },
];

const TRACK_MIME = "application/x-musicpenguin-track";
const PLAYLIST_INDEX_MIME = "application/x-musicpenguin-playlist-index";

/* Drag payloads carry a JSON array of source indices (ascending). */
function parseDragIndices(raw: string): number[] {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    const n = parseInt(raw, 10);
    return isNaN(n) ? [] : [n];
  }
  const list = Array.isArray(arr) ? arr : [arr];
  return [...new Set(list.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
}

function makeEntry(path: string, row?: Track): PlaylistEntry {
  return {
    path,
    title: row?.title || (row?.filename ? row.filename.replace(/\.[^.]+$/, "") : ""),
    artist: row?.artist ?? "",
    duration: String(row?.duration ?? "0"),
    album: row?.album ?? "",
    trackNo: row?.track_no ?? "",
    albumArtist: row?.album_artist ?? "",
    genre: row?.genre ?? "",
    year: row?.year ?? "",
    composer: row?.composer ?? "",
    conductor: row?.conductor ?? "",
    comment: row?.comment ?? "",
    rating: row?.rating ?? 0,
    bpm: row?.bpm ?? 0,
    playcount: row?.playcount ?? 0,
    filename: row?.filename ?? "",
    ext: row?.filename && row.filename.includes(".") ? row.filename.split(".").pop()!.toLowerCase() : "",
    trackPath: path,
    id: path,
    dlna: row?.dlna === 1,
  };
}

async function rebuildFromPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    playlist = [];
    return;
  }
  try {
    const rows = await window.electronAPI.lookupPaths(paths);
    const byPath = new Map(rows.map((r: any) => [r.path, r]));
    playlist = paths.map((p) => makeEntry(p, byPath.get(p)));
  } catch {
    playlist = [];
  }
}

async function loadState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data?.["playlist-sort-column"]) playlistSortColumn = data["playlist-sort-column"];
    if (data?.["playlist-sort-direction"] === "asc" || data?.["playlist-sort-direction"] === "desc") playlistSortDirection = data["playlist-sort-direction"];
    const storedPaths = await window.electronAPI.loadPlaylistStateFile();
    await rebuildFromPaths(storedPaths);
  } catch { /* ignore */ }
}

async function persistState(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      "playlist-sort-column": playlistSortColumn || undefined,
      "playlist-sort-direction": playlistSortDirection,
    });
    await window.electronAPI.savePlaylistStateFile(playlist.map((e) => e.path));
  } catch { /* ignore */ }
}

let plViewport: HTMLElement;
let playListEl: HTMLUListElement;
let playlistPlayBtn: HTMLButtonElement | null = null;

function updatePlayPauseBtn(): void {
  if (!playlistPlayBtn) return;
  const empty = playlist.length === 0;
  playlistPlayBtn.disabled = empty;
  if (empty) return;
  const isPaused = audio.paused;
  const isPlaying = currentPlaylistIndex !== null;
  if (isPlaying && !isPaused) {
    playlistPlayBtn.classList.add("playing");
    playlistPlayBtn.title = t("Pause Playlist");
  } else {
    playlistPlayBtn.classList.remove("playing");
    playlistPlayBtn.title = t("Play Playlist");
  }
}

function clearSelection(): void {
  selectedIndices.clear();
  lastClickedIndex = null;
  for (const li of rowEls) li.classList.remove("selected");
}

function clearPlayingFlag(): void {
  for (const e of playlist) delete e._playing;
}

export function updatePlaylistPlayingIndicator(): void {
  const items = playListEl.querySelectorAll<HTMLElement>(".playlist-item");
  if (currentPlaylistIndex !== null) {
    for (let i = 0; i < items.length; i++) {
      const indicator = items[i]!.querySelector<HTMLElement>(".playlist-playing");
      if (indicator) {
        const di = firstIdx + i;
        indicator.innerHTML = isActuallyPlaying() && di === currentPlaylistIndex ? ICON_SPEAKER : "";
      }
    }
  } else {
    let placed = false;
    for (let i = 0; i < items.length; i++) {
      const indicator = items[i]!.querySelector<HTMLElement>(".playlist-playing");
      if (indicator) {
        const di = firstIdx + i;
        if (!placed && isActuallyPlaying() && di < playlist.length && playlist[di]!.path === selectedPath) {
          indicator.innerHTML = ICON_SPEAKER;
          placed = true;
        } else {
          indicator.innerHTML = "";
        }
      }
    }
  }
}

function syncPlaylistIndex(): void {
  if (currentPlaylistIndex === null) return;
  const flaggedIdx = playlist.findIndex((e) => e._playing);
  if (flaggedIdx !== -1) { currentPlaylistIndex = flaggedIdx; return; }
  const entry = playlist[currentPlaylistIndex];
  if (!entry) { currentPlaylistIndex = null; return; }
  entry._playing = true;
}

function getNextIndex(currentIdx: number): number | null {
  const r = getRepeat();
  const s = getShuffle();

  if (r === "one") return currentIdx;

  if (s) {
    const paths = playlist.map((e) => e.path);
    const currentPath = playlist[currentIdx]?.path ?? null;
    const picked = pickRandomExcluding(paths, currentPath);
    if (picked === null) return null;
    return playlist.findIndex((e) => e.path === picked);
  }

  const next = currentIdx + 1;
  if (next >= playlist.length) {
    if (r === "all") return 0;
    return null;
  }
  return next;
}

function randomIndexExcluding(exclude: number): number {
  if (playlist.length <= 1) return exclude;
  const candidates: number[] = [];
  for (let i = 0; i < playlist.length; i++) {
    if (i !== exclude) candidates.push(i);
  }
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

function playFrom(index: number, autoPlay = true): void {
  if (index < 0 || index >= playlist.length) return;
  syncPlaylistIndex();
  clearPlayingFlag();
  currentPlaylistIndex = index;
  const entry = playlist[index]!;
  entry._playing = true;
  if (autoPlay) {
    playTrack(entry.path, entry.title);
  } else {
    const fn = !audio.paused ? playTrack : loadTrack;
    fn(entry.path, entry.title);
  }
  scrollToIndex(index);
  renderPlaylist();
  updatePlayPauseBtn();
}

export function clearPlaylistPlaying(): void {
  clearPlayingFlag();
  currentPlaylistIndex = null;
  updatePlayPauseBtn();
}

/* Empties the playlist entirely: used by the clear button and when the
   library database is erased (nothing left to display anyway). */
export function clearPlaylist(): void {
  if (playlist.length === 0) return;
  clearPlayingFlag();
  playlist = [];
  currentPlaylistIndex = null;
  selectedIndices.clear();
  renderPlaylist();
  updatePlayPauseBtn();
  persistState();
  playlistStateChangeCallbacks.forEach((cb) => cb());
}

/* When new tracks land in the playlist while a MAIN-LIST track is
   currently playing and that track is part of the playlist, the
   playlist adopts it as its current entry: play/pause button reflects
   playlist-playing mode, the speaker indicator anchors to that row and
   prev/next operate on the playlist from here on. */
function adoptPlayingTrackIntoPlaylist(): void {
  if (currentPlaylistIndex !== null) return;
  if (!isActuallyPlaying() || !selectedPath) return;
  const idx = playlist.findIndex((e) => e.path === selectedPath);
  if (idx === -1) return;
  clearPlayingFlag();
  currentPlaylistIndex = idx;
  playlist[idx]!._playing = true;
  updatePlayPauseBtn();
  updatePlaylistPlayingIndicator();
  playlistStateChangeCallbacks.forEach((cb) => cb());
}

export function isPlaylistPlaying(): boolean {
  return currentPlaylistIndex !== null;
}

/* Best row to start prev/next from: the playing row while a playlist is
   active, otherwise the last row the user selected in the playlist. */
function navBaseIndex(): number | null {
  if (currentPlaylistIndex !== null) return currentPlaylistIndex;
  if (lastClickedIndex !== null && lastClickedIndex >= 0 && lastClickedIndex < playlist.length) {
    return lastClickedIndex;
  }
  return null;
}

export function hasPlaylistNavBase(): boolean {
  return navBaseIndex() !== null && playlist.length > 0;
}

export function canPlaylistPrev(): boolean {
  syncPlaylistIndex();
  if (playlist.length === 0) return false;
  const base = navBaseIndex();
  if (base === null) return false;
  if (getShuffle()) return true;
  if (base > 0) return true;
  return getRepeat() === "all";
}

export function canPlaylistNext(): boolean {
  syncPlaylistIndex();
  if (playlist.length === 0) return false;
  const base = navBaseIndex();
  if (base === null) return false;
  if (getShuffle()) return true;
  if (base + 1 < playlist.length) return true;
  return getRepeat() === "all";
}

export function prevPlaylist(autoPlay = true): void {
  syncPlaylistIndex();
  if (playlist.length === 0) return;
  const base = navBaseIndex();
  if (base === null) return;

  if (getShuffle()) {
    const paths = playlist.map((e) => e.path);
    const currentPath = playlist[base]?.path ?? null;
    const tried = new Set<string>();
    let picked: string | null = pickRandomExcluding(paths, currentPath);
    while (picked !== null && !isPlayableFile(picked)) {
      if (tried.has(picked)) { picked = null; break; }
      tried.add(picked);
      picked = pickRandomExcluding(paths, picked);
    }
    if (picked !== null) {
      const idx = playlist.findIndex((e) => e.path === picked);
      if (idx !== -1) playFrom(idx, autoPlay);
    }
    return;
  }

  const n = playlist.length;
  for (let j = base - 1; j >= 0; j--) {
    if (isPlayableFile(playlist[j]!.path)) { playFrom(j, autoPlay); return; }
  }
  if (getRepeat() === "all") {
    for (let j = n - 1; j > base; j--) {
      if (isPlayableFile(playlist[j]!.path)) { playFrom(j, autoPlay); return; }
    }
  }
}
export function advancePlaylist(autoPlay = true): void {
  syncPlaylistIndex();
  if (playlist.length === 0) return;
  const base = navBaseIndex();
  if (base === null) return;
  const ratingFilter = autoPlay && getRepeat() !== "one";
  /* A MANUAL next (autoPlay=false) must always advance to the NEXT
     track — repeat-one only governs auto-advance, never the user
     pressing next. */
  const manualRepeatOne = !autoPlay && getRepeat() === "one";
  const tried = new Set<number>();
  let next = manualRepeatOne
    ? base + 1
    : getNextIndex(base);
  if (manualRepeatOne && (next as number) >= playlist.length) {
    next = getRepeat() === "all" ? 0 : null;
  }
  while (next !== null && (!isPlayableFile(playlist[next]!.path) || (ratingFilter && !passesMinAutoplayRating(playlist[next]!.rating)))) {
    if (tried.has(next)) { next = null; break; }
    tried.add(next);
    next = manualRepeatOne ? next + 1 : getNextIndex(next);
  }
  if (next === null) {
    clearPlayingFlag();
    currentPlaylistIndex = null;
    renderPlaylist();
    updatePlayPauseBtn();
    return;
  }
  playFrom(next, autoPlay);
}

function formatDuration(sec: string): string {
  const n = parseFloat(sec);
  if (isNaN(n) || n <= 0) return "??:??";
  return formatTime(sec);
}

/* ══════════════════════════════════════════════════════════════════
   Virtual Scroll
   ══════════════════════════════════════════════════════════════════ */

let rowEls: HTMLLIElement[] = [];
let firstIdx = 0;
let rowHeight = 0;
let visibleCount = 0;
const OVERSCAN = 5;

let scrollTrackEl: HTMLDivElement | null = null;
let scrollThumbEl: HTMLDivElement | null = null;
let isDraggingThumb = false;
let dragStartY = 0;
let dragStartTop = 0;

let isDraggingEdge = false;
let edgeScrollDir = 0;
let edgeScrollTicks = 0;
let edgeScrollRaf = 0;

/* ── Cover art (Variant C: scroll-stop queue + cache) ──────────
   Variant A (per-row async on every populate()) was tried first
   but caused IPC storms: fetches for recycled virtual-scroll rows
   piled up and delivered results to stale DOM elements, so images
   never appeared.  Variant C avoids this by loading cover art only
   once scrolling settles — the queue is stable, and cached results
   persist on the entry object for instant reuse on re-scroll. */
let coverArtTimer: ReturnType<typeof setTimeout> | null = null;
let coverArtGeneration = 0;
const COVER_ART_DEBOUNCE_MS = 200;

function measureRowHeight(): number {
  const temp = document.createElement("li");
  temp.className = "playlist-item";
  temp.style.visibility = "hidden";
  temp.style.position = "absolute";
  temp.innerHTML = `<span class="playlist-playing"></span><span class="playlist-cover"><span class="playlist-cover-placeholder">${ICON_MUSIC_NOTE}</span></span><span class="playlist-title"><span class="playlist-title-line">Xg</span><span class="playlist-artist-line">Xg</span></span><span class="playlist-duration">00:00</span>`;
  playListEl.appendChild(temp);
  const h = temp.offsetHeight;
  temp.remove();
  return h || 48;
}

function computeVisibleCount(): number {
  const panelH = plViewport.clientHeight || 400;
  return Math.max(1, Math.ceil(panelH / rowHeight)) + OVERSCAN;
}

function buildRows(): void {
  playListEl.innerHTML = "";
  rowEls = [];
  for (let i = 0; i < visibleCount; i++) {
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.draggable = true;

    const playingSpan = document.createElement("span");
    playingSpan.className = "playlist-playing";
    playingSpan.title = t("Currently playing");

    const coverSpan = document.createElement("span");
    coverSpan.className = "playlist-cover";
    const placeholder = document.createElement("span");
    placeholder.className = "playlist-cover-placeholder";
    placeholder.innerHTML = ICON_MUSIC_NOTE;
    coverSpan.appendChild(placeholder);

    const titleSpan = document.createElement("span");
    titleSpan.className = "playlist-title";
    const titleLine = document.createElement("span");
    titleLine.className = "playlist-title-line";
    const artistLine = document.createElement("span");
    artistLine.className = "playlist-artist-line";
    titleSpan.appendChild(titleLine);
    titleSpan.appendChild(artistLine);

    const durSpan = document.createElement("span");
    durSpan.className = "playlist-duration";

    li.appendChild(playingSpan);
    li.appendChild(coverSpan);
    li.appendChild(titleSpan);
    li.appendChild(durSpan);

    rowEls.push(li);
    playListEl.appendChild(li);
  }
}

function populate(): void {
  const total = playlist.length;

  for (let i = 0; i < rowEls.length; i++) {
    const di = firstIdx + i;
    const li = rowEls[i]!;
    if (di >= total) {
      li.style.display = "none";
      continue;
    }
    li.style.display = "";
    const entry = playlist[di]!;
    li.dataset.index = String(di);
    li.dataset.path = entry.path;
    li.classList.toggle("selected", selectedIndices.has(di));
    li.classList.toggle("playing", currentPlaylistIndex === di);

    li.querySelector(".playlist-title-line")!.textContent = entry.title;
    li.querySelector(".playlist-artist-line")!.textContent = entry.artist;
    li.querySelector(".playlist-duration")!.textContent = formatDuration(entry.duration);

    const coverSpan = li.querySelector(".playlist-cover")!;
    const existingImg = coverSpan.querySelector("img") as HTMLImageElement | null;
    const placeholder = coverSpan.querySelector(".playlist-cover-placeholder") as HTMLElement | null;
    const thumb = getThumbnail(entry.path);
    if (thumb) {
      if (placeholder) placeholder.style.display = "none";
      if (existingImg) {
        existingImg.src = thumb;
      } else {
        const img = document.createElement("img");
        img.alt = "";
        img.src = thumb;
        coverSpan.appendChild(img);
      }
    } else {
      if (placeholder) placeholder.style.display = "";
      if (existingImg) existingImg.remove();
    }
  }

  updatePlaylistPlayingIndicator();
  updateScrollbar();
  scheduleCoverLoad();
}

function scheduleCoverLoad(): void {
  if (coverArtTimer) clearTimeout(coverArtTimer);
  coverArtTimer = setTimeout(() => {
    coverArtTimer = null;
    loadVisibleCoverArt();
  }, COVER_ART_DEBOUNCE_MS);
}

function loadVisibleCoverArt(): void {
  const generation = ++coverArtGeneration;
  const end = Math.min(firstIdx + visibleCount, playlist.length);
  const batch: { entry: PlaylistEntry; rowIdx: number }[] = [];
  for (let i = firstIdx; i < end; i++) {
    const entry = playlist[i];
    if (!entry || getThumbnail(entry.path)) continue;
    batch.push({ entry, rowIdx: i - firstIdx });
  }
  if (batch.length === 0) return;

  const CONCURRENCY = 6;
  let next = 0;
  function fetchNext(): void {
    if (next >= batch.length) return;
    if (generation !== coverArtGeneration) return;
    const item = batch[next++]!;
    fetchThumbnail(item.entry.path).then((thumb) => {
      if (generation !== coverArtGeneration) return;
      if (thumb) {
        applyCoverArt(item.rowIdx, thumb);
      }
    }).catch(() => {}).finally(fetchNext);
  }
  for (let c = 0; c < CONCURRENCY && c < batch.length; c++) fetchNext();
}

function applyCoverArt(rowIdx: number, dataUrl: string): void {
  const li = rowEls[rowIdx];
  if (!li) return;
  const coverSpan = li.querySelector(".playlist-cover");
  if (!coverSpan) return;
  const placeholder = coverSpan.querySelector(".playlist-cover-placeholder") as HTMLElement | null;
  if (placeholder) placeholder.style.display = "none";
  let img = coverSpan.querySelector("img") as HTMLImageElement | null;
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    coverSpan.appendChild(img);
  }
  img.src = dataUrl;
}

function getTotalHeight(): number {
  return playlist.length * rowHeight;
}

function getMaxFirstIdx(): number {
  if (!plViewport || rowHeight <= 0) return 0;
  const visibleRows = Math.max(1, Math.floor(plViewport.clientHeight / rowHeight));
  return Math.max(0, playlist.length - visibleRows);
}

function updateScrollbar(): void {
  if (!scrollThumbEl || !scrollTrackEl) return;
  if (playlist.length <= visibleCount - OVERSCAN) {
    scrollTrackEl.parentElement!.style.display = "none";
    return;
  }
  scrollTrackEl.parentElement!.style.display = "";
  const trackH = scrollTrackEl.clientHeight;
  const thumbH = Math.max(30, trackH * ((visibleCount - OVERSCAN) / playlist.length));
  const maxIdx = getMaxFirstIdx();
  const thumbPos = maxIdx > 0 ? (firstIdx / maxIdx) * (trackH - thumbH) : 0;
  scrollThumbEl.style.height = thumbH + "px";
  scrollThumbEl.style.top = thumbPos + "px";
}

function scrollToIndex(idx: number, force = false): void {
  if (!force) {
    const visibleRows = visibleCount - OVERSCAN;
    if (idx >= firstIdx && idx < firstIdx + visibleRows) return;
  }
  const maxIdx = getMaxFirstIdx();
  firstIdx = Math.max(0, Math.min(maxIdx, idx));
  populate();
}

/* ── Event delegation ──────────────────────────────────────── */

function setupDelegation(): void {
  /* Click / dblclick */
  playListEl.addEventListener("click", (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    if (!li) return;
    const di = parseInt(li.dataset.index ?? "", 10);
    if (isNaN(di) || di >= playlist.length) return;
    const entry = playlist[di]!;

    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, di);
      const end = Math.max(lastClickedIndex, di);
      clearSelection();
      for (let j = start; j <= end; j++) selectedIndices.add(j);
      for (let i = 0; i < rowEls.length; i++) {
        const realIdx = firstIdx + i;
        rowEls[i]!.classList.toggle("selected", realIdx >= start && realIdx <= end);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (selectedIndices.has(di)) {
        selectedIndices.delete(di);
        li.classList.remove("selected");
      } else {
        selectedIndices.add(di);
        li.classList.add("selected");
      }
      lastClickedIndex = di;
    } else {
      clearSelection();
      selectedIndices.add(di);
      li.classList.add("selected");
      lastClickedIndex = di;
      onSelectCallbacks.forEach((cb) => cb(entry.path));
    }
  });

  playListEl.addEventListener("dblclick", (e: MouseEvent) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    if (!li) return;
    const di = parseInt(li.dataset.index ?? "", 10);
    if (isNaN(di) || di >= playlist.length) return;
    playFrom(di);
  });

  /* Drag start */
  playListEl.addEventListener("dragstart", (e: DragEvent) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    if (!li) return;
    const di = parseInt(li.dataset.index ?? "", 10);
    if (isNaN(di) || di >= playlist.length) return;
    /* Grabbed entry always wins; the selection only rides along when it
       actually contains the grabbed row (multi-entry move) */
    const indices = selectedIndices.has(di)
      ? [...selectedIndices].filter((i) => i >= 0 && i < playlist.length).sort((a, b) => a - b)
      : [di];
    e.dataTransfer!.setData(TRACK_MIME, JSON.stringify(indices.map((i) => playlist[i])));
    e.dataTransfer!.setData(PLAYLIST_INDEX_MIME, JSON.stringify(indices));
    e.dataTransfer!.effectAllowed = "move";
  });

  /* Drag over / drop on items */
  playListEl.addEventListener("dragover", (e: DragEvent) => {
    if (!e.dataTransfer) return;
    if (!e.dataTransfer.types.includes(TRACK_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    for (const el of playListEl.querySelectorAll(".drag-over")) el.classList.remove("drag-over");
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    if (li) li.classList.add("drag-over");
    startEdgeScroll(e);
  });

  playListEl.addEventListener("dragleave", (e: DragEvent) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    if (li) li.classList.remove("drag-over");
    const related = e.relatedTarget as Node | null;
    if (!related || !playListEl.contains(related)) stopEdgeScroll();
  });

  playListEl.addEventListener("drop", async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopEdgeScroll();
    for (const el of playListEl.querySelectorAll(".drag-over")) el.classList.remove("drag-over");

    /* Only accept internal drag-and-drop (track data or playlist index).
       External file drops are not supported. */
    const srcIdxStr = e.dataTransfer?.getData(PLAYLIST_INDEX_MIME) ?? "";
    const trackData = e.dataTransfer?.getData(TRACK_MIME) ?? "";
    if (srcIdxStr === "" && trackData === "") return;

    const targetLi = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    const targetDi = targetLi ? parseInt(targetLi.dataset.index ?? "", 10) : playlist.length;
    /* Half-test against the VISIBLE portion of the row: a partially
       scrolled-out row must not report a wrong half (e.g. the first row
       clipped above the viewport made "insert before first" impossible). */
    let after = true;
    if (targetLi) {
      const liRect = targetLi.getBoundingClientRect();
      const vpRect = plViewport.getBoundingClientRect();
      const visTop = Math.max(liRect.top, vpRect.top);
      const visBottom = Math.min(liRect.bottom, vpRect.bottom);
      const midY = visBottom > visTop ? (visTop + visBottom) / 2 : (liRect.top + liRect.bottom) / 2;
      after = e.clientY > midY;
    }
    const hadPlaying = currentPlaylistIndex !== null;
    let addedNewTracks = false;

    if (srcIdxStr !== "") {
      const sources = parseDragIndices(srcIdxStr).filter((i) => i < playlist.length);
      if (!sources.length) return;

      /* Insertion point in original coordinates (before targetDi, or after it) */
      const anchor = after ? targetDi + 1 : targetDi;
      const moved = sources.map((i) => playlist[i]!);
      /* Remove sources descending so indices stay valid */
      for (let j = sources.length - 1; j >= 0; j--) playlist.splice(sources[j]!, 1);
      const insertAt = Math.max(0, Math.min(playlist.length, anchor - sources.filter((i) => i < anchor).length));
      playlist.splice(insertAt, 0, ...moved);
      selectedIndices.clear();
      for (let j = 0; j < moved.length; j++) selectedIndices.add(insertAt + j);
    } else {
      const raw = e.dataTransfer!.getData(TRACK_MIME);
      if (raw) {
        const tracks = JSON.parse(raw) as Array<{ path: string; title?: string; artist?: string }>;
        const arr = Array.isArray(tracks) ? tracks : [tracks];
        const paths = arr.map((t) => t.path);
        const rows = await window.electronAPI.lookupPaths(paths).catch(() => []);
        const byPath = new Map(rows.map((r: any) => [r.path, r]));
        let insertAt = targetDi;
        for (const t of arr) {
          const row = byPath.get(t.path);
          playlist.splice(insertAt, 0, makeEntry(t.path, row));
          insertAt++;
        }
        selectedIndices.clear();
        selectedIndices.add(insertAt - 1);
        addedNewTracks = true;
      }
    }

    if (hadPlaying) syncPlaylistIndex();
    playlistSortColumn = "";
    sortPlaylist();
    renderPlaylist();
    if (addedNewTracks) adoptPlayingTrackIntoPlaylist();
    persistState();
  });

  /* Keyboard navigation */
  playListEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedIndices.size === 0) return;
      const sorted = [...selectedIndices].sort((a, b) => b - a);
      for (const idx of sorted) playlist.splice(idx, 1);
      syncPlaylistIndex();
      selectedIndices.clear();
      renderPlaylist();
      persistState();
      return;
    }

    if (playlist.length === 0) return;

    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndices.size === 1) {
        const idx = [...selectedIndices][0]!;
        playFrom(idx);
      } else if (selectedIndices.size === 0) {
        playFrom(0);
      }
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const step = e.key === "ArrowUp" ? -1 : 1;

      if (selectedIndices.size === 0) {
        selectedIndices.add(0);
        lastClickedIndex = 0;
        renderPlaylist();
        scrollToIndex(0);
        onSelectCallbacks.forEach((cb) => cb(playlist[0]!.path));
        return;
      }

      if (e.shiftKey) {
        const cur = Math.max(...selectedIndices);
        const next = Math.max(0, Math.min(playlist.length - 1, cur + step));
        if (!selectedIndices.has(next)) {
          const lo = Math.min(lastClickedIndex ?? cur, next);
          const hi = Math.max(lastClickedIndex ?? cur, next);
          selectedIndices.clear();
          for (let i = lo; i <= hi; i++) selectedIndices.add(i);
          renderPlaylist();
          scrollToIndex(next);
        }
        return;
      }

      const cur = Math.max(...selectedIndices);
      const next = Math.max(0, Math.min(playlist.length - 1, cur + step));
      clearSelection();
      selectedIndices.add(next);
      lastClickedIndex = next;
      renderPlaylist();
      scrollToIndex(next);
      onSelectCallbacks.forEach((cb) => cb(playlist[next]!.path));
    }
  });

  playListEl.tabIndex = 0;
}

/* ── Edge auto-scroll during drag ──────────────────────────── */

function startEdgeScroll(e: DragEvent): void {
  const EDGE = 40;
  const rect = plViewport.getBoundingClientRect();
  if (e.clientY < rect.top + EDGE) {
    isDraggingEdge = true;
    edgeScrollDir = -1;
  } else if (e.clientY > rect.bottom - EDGE) {
    isDraggingEdge = true;
    edgeScrollDir = 1;
  } else {
    stopEdgeScroll();
    return;
  }
  if (!edgeScrollRaf) tickEdgeScroll();
}

function tickEdgeScroll(): void {
  if (!isDraggingEdge) return;
  /* Virtual scroller: native scrollTop has no range — stepping must go
     through scrollToIndex/firstIdx. Rows-per-tick ramps up while the
     pointer stays in the edge zone so long lists can be crossed quickly. */
  const rowsPerTick = 1 + Math.floor(edgeScrollTicks / 20); // ~0.33s per extra row/frame, cap below
  const target = Math.max(0, Math.min(getMaxFirstIdx(), firstIdx + edgeScrollDir * Math.min(rowsPerTick, 8)));
  if (target !== firstIdx) {
    edgeScrollTicks++;
    scrollToIndex(target, true);
  } else {
    edgeScrollTicks = 0;
  }
  edgeScrollRaf = requestAnimationFrame(tickEdgeScroll);
}

function stopEdgeScroll(): void {
  isDraggingEdge = false;
  edgeScrollDir = 0;
  edgeScrollTicks = 0;
  if (edgeScrollRaf) {
    cancelAnimationFrame(edgeScrollRaf);
    edgeScrollRaf = 0;
  }
}

/* ── Scrollbar ─────────────────────────────────────────────── */

function setupScrollbarEvents(): void {
  if (!scrollTrackEl || !scrollThumbEl) return;

  scrollThumbEl.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingThumb = true;
    dragStartY = e.clientY;
    dragStartTop = parseFloat(scrollThumbEl!.style.top) || 0;
    document.body.classList.add("dragging");
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDraggingThumb || !scrollTrackEl || !scrollThumbEl) return;
    const trackH = scrollTrackEl.clientHeight;
    const thumbH = scrollThumbEl.clientHeight;
    const dy = e.clientY - dragStartY;
    const maxIdx = getMaxFirstIdx();
    const maxTop = trackH - thumbH;
    const pct = maxTop > 0 ? Math.max(0, Math.min(1, (dragStartTop + dy) / maxTop)) : 0;
    scrollToIndex(Math.round(pct * maxIdx), true);
  });

  document.addEventListener("mouseup", () => {
    if (isDraggingThumb) {
      isDraggingThumb = false;
      document.body.classList.remove("dragging");
    }
  });

  scrollTrackEl.addEventListener("click", (e: MouseEvent) => {
    if (!scrollThumbEl || !scrollTrackEl) return;
    if (e.target === scrollThumbEl) return;
    const rect = scrollTrackEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const thumbRect = scrollThumbEl.getBoundingClientRect();
    const thumbTop = thumbRect.top - rect.top;
    if (y < thumbTop) {
      scrollToIndex(firstIdx - (visibleCount - OVERSCAN));
    } else {
      scrollToIndex(firstIdx + (visibleCount - OVERSCAN));
    }
  });

  plViewport.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const speed = e.deltaMode === 1 ? 3 : 1;
    const step = Math.max(1, Math.round(Math.abs(e.deltaY) / rowHeight) * speed);
    scrollToIndex(firstIdx + dir * step, true);
  }, { passive: false });
}

/* ── Recalc on resize ──────────────────────────────────────── */

function recalc(): void {
  const newCount = computeVisibleCount();
  if (newCount !== visibleCount) {
    visibleCount = newCount;
    buildRows();
  }
  firstIdx = Math.min(firstIdx, getMaxFirstIdx());
  populate();
}

/* ══════════════════════════════════════════════════════════════════
   renderPlaylist — triggers virtual scroll populate
   ══════════════════════════════════════════════════════════════════ */

function renderPlaylist(): void {
  syncPlaylistIndex();
  updatePlayPauseBtn();
  recalc();

  plViewport.classList.toggle("playlist-empty", playlist.length === 0);

  const atLeast1 = playlist.length >= 1;
  const atLeast2 = playlist.length >= 2;
  for (const id of ["playlist-play-btn", "randomize-btn", "clear-playlist-btn", "save-playlist-btn"]) {
    const btn = document.getElementById(id);
    if (btn) {
      const enable = id === "randomize-btn" ? atLeast2 : atLeast1;
      btn.classList.toggle("enabled", enable);
    }
  }

  let totalSec = 0;
  for (const e of playlist) {
    const n = parseFloat(e.duration);
    if (!isNaN(n) && n > 0) totalSec += Math.floor(n);
  }
  const summary = document.getElementById("playlist-total-time");
  if (summary) summary.textContent = t("Total time: $1", formatTime(String(totalSec)) || "00:00");

  scheduleCoverLoad();
}

/* ══════════════════════════════════════════════════════════════════
   initPlaylist
   ══════════════════════════════════════════════════════════════════ */

async function appendToPlaylist(paths: string[]): Promise<void> {
  if (!playListEl || paths.length === 0) return;
  const hadPlaying = currentPlaylistIndex !== null;
  const firstNewIdx = playlist.length;
  /* If anything was selected before (main list or playlist), leave the
     selection untouched */
  const hadAnySelection = selectedIndices.size > 0 || mainListSelectionQuery();
  const rows = await window.electronAPI.lookupPaths(paths).catch(() => [] as Track[]);
  const byPath = new Map(rows.map((r: any) => [r.path, r]));
  for (const p of paths) {
    playlist.push(makeEntry(p, byPath.get(p)));
  }
  if (!hadAnySelection) {
    /* Select the first newly added item so its details are shown */
    clearSelection();
    selectedIndices.add(firstNewIdx);
    lastClickedIndex = firstNewIdx;
  }
  if (hadPlaying) syncPlaylistIndex();
  playlistSortColumn = "";
  sortPlaylist();
  renderPlaylist();
  adoptPlayingTrackIntoPlaylist();
  if (!hadAnySelection && playlist[firstNewIdx]) {
    onSelectCallbacks.forEach((cb) => cb(playlist[firstNewIdx]!.path));
  }
  persistState();
}

export async function importPlaylistPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const rows = await window.electronAPI.lookupPaths(paths).catch(() => [] as Track[]);
  const known = new Set(rows.map((r: any) => r.path));
  const missing = paths.filter((p) => !known.has(p));
  if (missing.length > 0) {
    const files = missing.map((p) => ({
      fullPath: p,
      name: p.split("/").pop() ?? p,
      relativePath: p,
    }));
    await window.electronAPI.scanSpecificFiles(files);
  }

  /* Keep the play state untouched: if a playlist track is currently playing,
     re-anchor it in the new list instead of detaching playback */
  const hadPlaying = currentPlaylistIndex !== null;
  const playingPath = hadPlaying ? playlist[currentPlaylistIndex!]?.path ?? null : null;

  await rebuildFromPaths(paths);
  if (hadPlaying && playingPath !== null) {
    const idx = playlist.findIndex((e) => e.path === playingPath);
    if (idx !== -1) {
      playlist[idx]!._playing = true;
      currentPlaylistIndex = idx;
    } else {
      currentPlaylistIndex = null;
    }
  } else {
    currentPlaylistIndex = null;
  }
  selectedIndices.clear();
  playlistSortColumn = "";
  sortPlaylist();
  renderPlaylist();
  persistState();
  playlistStateChangeCallbacks.forEach((cb) => cb());
}

export function initPlaylist(
  onGotoAlbum?: (path: string) => void,
  onGotoFolder?: (path: string) => void,
  onGotoArtist?: (path: string) => void,
  onGotoComposer?: (path: string) => void,
): void {
  onGotoAlbumPlaylistCb = onGotoAlbum ?? null;
  onGotoFolderPlaylistCb = onGotoFolder ?? null;
  onGotoArtistPlaylistCb = onGotoArtist ?? null;
  onGotoComposerPlaylistCb = onGotoComposer ?? null;
  const randomizeBtn = document.getElementById("randomize-btn") as HTMLButtonElement;
  const clearPlaylistBtn = document.getElementById("clear-playlist-btn") as HTMLButtonElement;
  playlistPlayBtn = document.getElementById("playlist-play-btn") as HTMLButtonElement;
  playListEl = document.getElementById("playlist-list") as HTMLUListElement;

  if (!randomizeBtn || !playListEl || !clearPlaylistBtn || !playlistPlayBtn) return;

  /* ── Build virtual scroll DOM ──────────────────────────────── */
  plViewport = document.createElement("div");
  plViewport.id = "playlist-viewport";
  playListEl.parentNode!.insertBefore(plViewport, playListEl);
  plViewport.appendChild(playListEl);

  const scrollbar = document.createElement("div");
  scrollbar.id = "playlist-scrollbar";
  scrollTrackEl = document.createElement("div");
  scrollTrackEl.id = "playlist-scroll-track";
  scrollThumbEl = document.createElement("div");
  scrollThumbEl.id = "playlist-scroll-thumb";
  scrollTrackEl.appendChild(scrollThumbEl);
  scrollbar.appendChild(scrollTrackEl);
  plViewport.appendChild(scrollbar);

  rowHeight = measureRowHeight();
  visibleCount = computeVisibleCount();
  buildRows();
  setupDelegation();
  setupScrollbarEvents();

  const resizeObserver = new ResizeObserver(() => recalc());
  resizeObserver.observe(plViewport);
  window.addEventListener("resize", () => recalc());

  /* ── Drop on viewport itself (empty area, below items) ─────── */
  plViewport.addEventListener("dragover", (e: DragEvent) => {
    const dt = e.dataTransfer!;
    const isInternalMove = dt.types.includes(PLAYLIST_INDEX_MIME);
    if (!dt.types.includes(TRACK_MIME)) return;
    e.preventDefault();
    dt.dropEffect = isInternalMove ? "move" : "copy";
    startEdgeScroll(e);
  });

  plViewport.addEventListener("drop", async (e: DragEvent) => {
    const raw = e.dataTransfer!.getData(TRACK_MIME);
    if (!raw) return;
    /* If the drop target is a .playlist-item, the item-level handler already ran */
    if ((e.target as HTMLElement).closest(".playlist-item")) return;
    e.preventDefault();
    e.stopPropagation();
    for (const el of plViewport.querySelectorAll(".drag-over")) el.classList.remove("drag-over");
    stopEdgeScroll();

    /* Internal reorder onto empty area = move to end of playlist */
    const srcIdxStr = e.dataTransfer!.getData(PLAYLIST_INDEX_MIME);
    if (srcIdxStr !== "") {
      const sources = parseDragIndices(srcIdxStr).filter((i) => i < playlist.length);
      if (sources.length > 0) {
        const hadPlaying = currentPlaylistIndex !== null;
        const moved = sources.map((i) => playlist[i]!);
        for (let j = sources.length - 1; j >= 0; j--) playlist.splice(sources[j]!, 1);
        playlist.push(...moved);
        selectedIndices.clear();
        for (let j = playlist.length - moved.length; j < playlist.length; j++) selectedIndices.add(j);
        if (hadPlaying) syncPlaylistIndex();
        renderPlaylist();
        persistState();
      }
      return;
    }

    const hadPlaying = currentPlaylistIndex !== null;
    const tracks = JSON.parse(raw) as Array<{ path: string; title?: string; artist?: string }>;
    const arr = Array.isArray(tracks) ? tracks : [tracks];
    const paths = arr.map((t) => t.path);
    const rows = await window.electronAPI.lookupPaths(paths).catch(() => []);
    const byPath = new Map(rows.map((r: any) => [r.path, r]));
    for (const t of arr) {
      const row = byPath.get(t.path);
      playlist.push(makeEntry(t.path, row));
    }
    selectedIndices.clear();
    selectedIndices.add(playlist.length - 1);
    if (hadPlaying) syncPlaylistIndex();
    playlistSortColumn = "";
    sortPlaylist();
    renderPlaylist();
    adoptPlayingTrackIntoPlaylist();
    persistState();
  });

  /* ── Load saved state ─────────────────────────────────────── */
  loadState().then(() => {
    sortPlaylist();
    renderPlaylist();
  });

  /* ── Button listeners ──────────────────────────────────────── */
  randomizeBtn.addEventListener("click", () => {
    if (playlist.length < 2) return;
    const hadPlaying = currentPlaylistIndex !== null;
    for (let i = playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playlist[i]!, playlist[j]!] = [playlist[j]!, playlist[i]!];
    }
    if (hadPlaying) syncPlaylistIndex();
    selectedIndices.clear();
    renderPlaylist();
    persistState();
    playlistStateChangeCallbacks.forEach((cb) => cb());
  });

  playlistPlayBtn.addEventListener("click", () => {
    if (playlist.length === 0) return;

    if (currentPlaylistIndex !== null) {
      if (audio.paused) {
        audio.play().catch((err) => onPlaybackFailure(selectedPath, err));
      } else {
        audio.pause();
      }
      return;
    }

    const selected = [...selectedIndices].sort((a, b) => a - b);
    if (selected.length > 0) {
      playFrom(selected[0]!);
    } else {
      const curIdx = playlist.findIndex((e) => e.path === selectedPath);
      if (getShuffle() && curIdx !== -1) {
        playFrom(randomIndexExcluding(curIdx));
      } else {
        playFrom(0);
      }
    }
  });

  audio.addEventListener("play", updatePlayPauseBtn);
  audio.addEventListener("pause", updatePlayPauseBtn);

  document.addEventListener("language-changed", () => {
    updatePlayPauseBtn();
    const title = t("Currently playing");
    for (const row of rowEls) {
      const span = row.querySelector<HTMLElement>(".playlist-playing");
      if (span) span.title = title;
    }
    renderPlaylist();
  });

  onPlayModeChange(() => {
    renderPlaylist();
    playlistStateChangeCallbacks.forEach((cb) => cb());
  });

  clearPlaylistBtn.addEventListener("click", () => {
    if (playlist.length > 0) clearPlaylist();
  });

  const savePlaylistBtn = document.getElementById("save-playlist-btn") as HTMLButtonElement | null;
  savePlaylistBtn?.addEventListener("click", async () => {
    if (playlist.length === 0) return;
    const res = await window.electronAPI.savePlaylist(playlist.map((e) => e.path));
    if (!res.canceled && res.path) {
      playlistStateChangeCallbacks.forEach((cb) => cb());
    }
  });

  const loadPlaylistBtn = document.getElementById("load-playlist-btn") as HTMLButtonElement | null;
  loadPlaylistBtn?.addEventListener("click", async () => {
    const res = await window.electronAPI.loadPlaylist();
    if (res.canceled || !res.paths || res.paths.length === 0) return;
    await importPlaylistPaths(res.paths);
  });

  /* ── Context menu on container ─────────────────────────────── */
  let sortContextMenuEl: HTMLElement | null = null;
  let sortMenuCloseHandler: ((ce: Event) => void) | null = null;

  function closeSortContextMenu(): void {
    if (sortContextMenuEl) {
      sortContextMenuEl.remove();
      sortContextMenuEl = null;
    }
    if (sortMenuCloseHandler) {
      document.removeEventListener("click", sortMenuCloseHandler);
      document.removeEventListener("contextmenu", sortMenuCloseHandler);
      document.removeEventListener("keydown", sortMenuCloseHandler);
      sortMenuCloseHandler = null;
    }
  }

  const playlistContainer = document.getElementById("playlist-panel")!;
  playlistContainer.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    closeSortContextMenu();

    const selPaths = [...selectedIndices]
      .sort((a, b) => a - b)
      .map((i) => playlist[i]?.path)
      .filter(Boolean) as string[];
    const targetPath = selPaths.length > 0 ? selPaths[0]! : playlist[0]?.path || "";

    const menu = document.createElement("div");
    menu.className = "context-menu playlist-sort-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";
    menu.addEventListener("contextmenu", (ce) => ce.preventDefault());

    if (targetPath) {
      /* DLNA rows are stream URLs without a physical file to reveal;
         in a mixed selection fall back to the first local file. */
      const pathsToCheck = selPaths.length ? selPaths : [targetPath];
      const firstLocalPath = pathsToCheck.find((p) => !/^https?:\/\//i.test(p));
      const localPaths = pathsToCheck.filter((p) => !/^https?:\/\//i.test(p));
      if (firstLocalPath) {
        const showItem = document.createElement("div");
        showItem.className = "context-menu-item";
        showItem.textContent = t("Show in Folder");
        showItem.addEventListener("click", async () => {
          closeSortContextMenu();
          await window.electronAPI.showInExternalFileExplorer(firstLocalPath, false);
        });
        menu.appendChild(showItem);

        const defaultAppItem = document.createElement("div");
        defaultAppItem.className = "context-menu-item";
        defaultAppItem.textContent = t("Open with Default Application");
        defaultAppItem.addEventListener("click", async () => {
          closeSortContextMenu();
          audio.pause();
          const opened = await window.electronAPI.openWithDefaultApplication(localPaths);
          if (opened.length > 0) noteExternalPlays(opened);
        });
        menu.appendChild(defaultAppItem);
      }

      const vlcItem = document.createElement("div");
      vlcItem.className = "context-menu-item";
      vlcItem.textContent = t("Play in $1", getExternalPlayerDisplayName());
      vlcItem.addEventListener("click", async () => {
        closeSortContextMenu();
        clearSelection();
        const toPlay = selPaths.length > 0 ? selPaths : [targetPath];
        const items = playListEl.querySelectorAll(".playlist-item");
        for (const sp of toPlay) {
          const pi = playlist.findIndex((e) => e.path === sp);
          if (pi !== -1) {
            selectedIndices.add(pi);
            const vrow = pi - firstIdx;
            if (vrow >= 0 && vrow < items.length) items[vrow]!.classList.add("selected");
          }
        }
        audio.pause();
        const result = await window.electronAPI.openInExternalPlayer(toPlay, getExternalPlayer());
        if (result.ok) {
          noteExternalPlays(toPlay);
        } else {
          alert(t("Could not open external player:\n$1", result.error ?? ""));
        }
      });
      menu.appendChild(vlcItem);

      const copyItem = document.createElement("div");
      copyItem.className = "context-menu-item";
      copyItem.textContent = t("Copy Path");
      copyItem.addEventListener("click", async () => {
        closeSortContextMenu();
        const paths = selPaths.length > 0 ? selPaths : [targetPath];
        try {
          await navigator.clipboard.writeText(paths.join("\n"));
        } catch { /* clipboard not available */ }
      });
      menu.appendChild(copyItem);

      const rescanItem = document.createElement("div");
      rescanItem.className = "context-menu-item";
      rescanItem.textContent = t("Rescan Tags");
      rescanItem.addEventListener("click", async () => {
        closeSortContextMenu();
        await window.electronAPI.rescanFiles(selPaths.length > 0 ? selPaths : [targetPath]);
      });
      menu.appendChild(rescanItem);

      const sep1 = document.createElement("hr");
      sep1.className = "playlist-sort-sep";
      menu.appendChild(sep1);

      let hasGotoItems = false;

      if (onGotoAlbumPlaylistCb && targetPath) {
        const targetEntry = playlist.find((e) => e.path === targetPath);
        if (targetEntry?.album) {
          hasGotoItems = true;
          const gotoAlbumItem = document.createElement("div");
          gotoAlbumItem.className = "context-menu-item";
          gotoAlbumItem.textContent = t("Goto Album");
          gotoAlbumItem.addEventListener("click", () => {
            closeSortContextMenu();
            onGotoAlbumPlaylistCb!(targetPath);
          });
          menu.appendChild(gotoAlbumItem);
        }
      }

      if (onGotoFolderPlaylistCb && firstLocalPath) {
        hasGotoItems = true;
        const gotoFolderItem = document.createElement("div");
        gotoFolderItem.className = "context-menu-item";
        gotoFolderItem.textContent = t("Goto Folder");
        gotoFolderItem.addEventListener("click", () => {
          closeSortContextMenu();
          onGotoFolderPlaylistCb!(firstLocalPath);
        });
        menu.appendChild(gotoFolderItem);
      }

      if (onGotoArtistPlaylistCb && targetPath) {
        const targetEntry = playlist.find((e) => e.path === targetPath);
        if (targetEntry?.artist) {
          hasGotoItems = true;
          const gotoArtistItem = document.createElement("div");
          gotoArtistItem.className = "context-menu-item";
          gotoArtistItem.textContent = t("Goto Artist");
          gotoArtistItem.addEventListener("click", () => {
            closeSortContextMenu();
            onGotoArtistPlaylistCb!(targetPath);
          });
          menu.appendChild(gotoArtistItem);
        }
      }

      if (onGotoComposerPlaylistCb && targetPath) {
        const targetEntry = playlist.find((e) => e.path === targetPath);
        if (targetEntry?.composer) {
          hasGotoItems = true;
          const gotoComposerItem = document.createElement("div");
          gotoComposerItem.className = "context-menu-item";
          gotoComposerItem.textContent = t("Goto Composer");
          gotoComposerItem.addEventListener("click", () => {
            closeSortContextMenu();
            onGotoComposerPlaylistCb!(targetPath);
          });
          menu.appendChild(gotoComposerItem);
        }
      }

      if (hasGotoItems) {
        const sep2 = document.createElement("hr");
        sep2.className = "playlist-sort-sep";
        menu.appendChild(sep2);
      }
    }

    const heading = document.createElement("div");
    heading.className = "playlist-sort-heading";
    heading.textContent = t("Sort by:");
    menu.appendChild(heading);

    for (const mode of SORTING_MODES) {
      if (mode.id !== ARTIST_ALBUM_TRACKNO) continue;
      const item = document.createElement("div");
      item.className = "context-menu-item playlist-sort-item"
        + (playlistSortColumn === mode.id ? " active" : "");

      const label = document.createElement("span");
      label.className = "playlist-sort-label";
      label.textContent = sortingModeLabel(mode);
      item.appendChild(label);

      item.addEventListener("click", () => {
        playlistSortColumn = mode.id;
        playlistSortDirection = "asc";
        sortPlaylist();
        renderPlaylist();
        persistState();
        closeSortContextMenu();
      });
      menu.appendChild(item);
    }

    for (const col of SORT_COLUMNS) {
      const item = document.createElement("div");
      item.className = "context-menu-item playlist-sort-item";

      const label = document.createElement("span");
      label.className = "playlist-sort-label";
      label.textContent = t(col.label);
      item.appendChild(label);

      const ascBtn = document.createElement("button");
      ascBtn.className = "playlist-sort-btn" + (playlistSortColumn === col.key && playlistSortDirection === "asc" ? " active" : "");
      ascBtn.innerHTML = ICON_CARET_UP;
      ascBtn.title = t("Sort ascending");
      ascBtn.addEventListener("click", () => {
        playlistSortColumn = col.key;
        playlistSortDirection = "asc";
        sortPlaylist();
        renderPlaylist();
        persistState();
        closeSortContextMenu();
      });
      item.appendChild(ascBtn);

      const descBtn = document.createElement("button");
      descBtn.className = "playlist-sort-btn" + (playlistSortColumn === col.key && playlistSortDirection === "desc" ? " active" : "");
      descBtn.innerHTML = ICON_CARET_DOWN;
      descBtn.title = t("Sort descending");
      descBtn.addEventListener("click", () => {
        playlistSortColumn = col.key;
        playlistSortDirection = "desc";
        sortPlaylist();
        renderPlaylist();
        persistState();
        closeSortContextMenu();
      });
      item.appendChild(descBtn);

      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    sortContextMenuEl = menu;

    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - r.width - 8) + "px";
      }
      if (r.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - r.height - 8) + "px";
      }
      if (parseInt(menu.style.left) < 0) menu.style.left = "8px";
      if (parseInt(menu.style.top) < 0) menu.style.top = "8px";
    });

    const close = (ce: Event) => {
      if (ce instanceof KeyboardEvent && ce.key === "Escape") {
        closeSortContextMenu();
        return;
      }
      if (sortContextMenuEl && !sortContextMenuEl.contains(ce.target as Node)) {
        closeSortContextMenu();
      }
    };
    sortMenuCloseHandler = close;
    setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", close);
      document.addEventListener("keydown", close);
    }, 0);
  });
}

export function updatePlaylistPaths(oldPath: string, newPath: string): void {
  let changed = false;
  for (const entry of playlist) {
    if (entry.path === oldPath) {
      entry.path = newPath;
      entry.trackPath = newPath;
      entry.id = newPath;
      changed = true;
    }
  }
  if (changed) {
    persistState();
  }
}

export function updatePlaylistEntry(update: TagUpdate): void {
  const entry = playlist.find((e) => e.path === update.path);
  if (!entry) return;
  entry.title = update.title || entry.filename.replace(/\.[^.]+$/, "");
  entry.artist = update.artist;
  entry.album = update.album;
  entry.trackNo = update.track_no;
  entry.albumArtist = update.album_artist;
  entry.genre = update.genre;
  entry.year = update.year;
  entry.composer = update.composer;
  entry.conductor = update.conductor;
  entry.comment = update.comment;
  entry.rating = update.rating;
  entry.bpm = update.bpm ?? 0;
  entry.duration = String(update.duration ?? "");
  entry.ext = entry.filename.includes(".") ? entry.filename.split(".").pop()!.toLowerCase() : "";
  sortPlaylist();
  renderPlaylist();
}

/* Ratings are edited in the list/details/now-playing UIs and persisted
   by the main process; keep the playlist's own entries in sync so a
   playlist sorted by rating stays consistent. */
document.addEventListener("rating-updated", ((e: CustomEvent) => {
  const { path, rating } = e.detail;
  let changed = false;
  for (const entry of playlist) {
    if (entry.path === path && entry.rating !== rating) {
      entry.rating = rating;
      changed = true;
    }
  }
  if (changed && playlistSortColumn === "rating") {
    sortPlaylist();
    renderPlaylist();
  }
}) as EventListener);
