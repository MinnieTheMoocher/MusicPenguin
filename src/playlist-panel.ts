import { PlaylistEntry } from "./types.js";
import { playTrack, selectedPath, isActuallyPlaying } from "./now-playing.js";
import { formatTime } from "./list-view.js";
import { audio } from "./audio.js";
import { onPlaybackFailure } from "./playback-error.js";
import { t } from "./i18n/index.js";

type RepeatMode = "off" | "one" | "all";

let shuffle = false;
let repeat: RepeatMode = "off";
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
let playlistSortColumn = "";
let playlistSortDirection: "asc" | "desc" = "asc";
let onGotoAlbumPlaylistCb: ((path: string) => void) | null = null;
let onGotoFolderPlaylistCb: ((path: string) => void) | null = null;

function sortPlaylist(): void {
  if (!playlistSortColumn) return;
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
  { key: "ext", label: "Ext" },
  { key: "filename", label: "Path" },
];

const TRACK_MIME = "application/x-musicpenguin-track";

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
    if (typeof data?.shuffle === "boolean") shuffle = data.shuffle;
    if (data?.repeat === "one" || data?.repeat === "all") repeat = data.repeat;
    if (data?.["playlist-sort-column"]) playlistSortColumn = data["playlist-sort-column"];
    if (data?.["playlist-sort-direction"] === "asc" || data?.["playlist-sort-direction"] === "desc") playlistSortDirection = data["playlist-sort-direction"];
    const storedPaths = await window.electronAPI.loadPlaylistStateFile();
    await rebuildFromPaths(storedPaths);
  } catch { /* ignore */ }
}

async function persistState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data && typeof data === "object") delete (data as Record<string, unknown>)["playlist"];
    await window.electronAPI.saveSettings({
      ...(data || {}),
      shuffle,
      repeat,
      "playlist-sort-column": playlistSortColumn || undefined,
      "playlist-sort-direction": playlistSortDirection,
    });
    await window.electronAPI.savePlaylistStateFile(playlist.map((e) => e.path));
  } catch { /* ignore */ }
}

const SHUFFLE_ON = "\u{1F500}";
const SHUFFLE_OFF = "\u{1F500}";

const REPEAT_CYCLE: RepeatMode[] = ["off", "one", "all"];
const REPEAT_ICONS: Record<RepeatMode, string> = {
  off: "\u{1F501}",
  one: "\u{1F502}",
  all: "\u{1F501}",
};

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
    playlistPlayBtn.textContent = "\u23F8\uFE0F";
    playlistPlayBtn.title = t("Pause Playlist");
  } else {
    playlistPlayBtn.textContent = "\u25B6\uFE0F";
    playlistPlayBtn.title = t("Play Playlist");
  }
}

function updateShuffleBtn(btn: HTMLButtonElement): void {
  btn.textContent = shuffle ? SHUFFLE_ON : SHUFFLE_OFF;
  btn.title = t(shuffle ? "Disable Shuffle" : "Enable Shuffle");
  btn.classList.toggle("active", shuffle);
}

function updateRepeatBtn(btn: HTMLButtonElement): void {
  const next = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(repeat) + 1) % REPEAT_CYCLE.length]!;
  btn.textContent = REPEAT_ICONS[repeat];
  btn.title = t(next === "all" ? "Repeat All" : next === "one" ? "Repeat 1" : "Repeat Off");
  btn.classList.toggle("active", repeat !== "off");
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
        indicator.textContent = isActuallyPlaying() && di === currentPlaylistIndex ? "\u{1F50A}" : "";
      }
    }
  } else {
    let placed = false;
    for (let i = 0; i < items.length; i++) {
      const indicator = items[i]!.querySelector<HTMLElement>(".playlist-playing");
      if (indicator) {
        const di = firstIdx + i;
        if (!placed && isActuallyPlaying() && di < playlist.length && playlist[di]!.path === selectedPath) {
          indicator.textContent = "\u{1F50A}";
          placed = true;
        } else {
          indicator.textContent = "";
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
  if (repeat === "one") return currentIdx;

  if (shuffle) {
    return Math.floor(Math.random() * playlist.length);
  }

  const next = currentIdx + 1;
  if (next >= playlist.length) {
    if (repeat === "all") return 0;
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

function playFrom(index: number): void {
  if (index < 0 || index >= playlist.length) return;
  syncPlaylistIndex();
  clearPlayingFlag();
  currentPlaylistIndex = index;
  const entry = playlist[index]!;
  entry._playing = true;
  playTrack(entry.path, entry.title);
  scrollToIndex(index);
  renderPlaylist();
  updatePlayPauseBtn();
}

export function clearPlaylistPlaying(): void {
  clearPlayingFlag();
  currentPlaylistIndex = null;
  updatePlayPauseBtn();
}

export function isPlaylistPlaying(): boolean {
  return currentPlaylistIndex !== null;
}

export function canPlaylistPrev(): boolean {
  syncPlaylistIndex();
  if (currentPlaylistIndex === null || playlist.length === 0) return false;
  if (currentPlaylistIndex > 0) return true;
  return repeat === "all";
}

export function canPlaylistNext(): boolean {
  syncPlaylistIndex();
  if (currentPlaylistIndex === null || playlist.length === 0) return false;
  if (shuffle) return true;
  if (currentPlaylistIndex + 1 < playlist.length) return true;
  return repeat === "all";
}

export function prevPlaylist(): void {
  syncPlaylistIndex();
  if (currentPlaylistIndex === null || playlist.length === 0) return;
  const prev = currentPlaylistIndex - 1;
  if (prev < 0) {
    if (repeat === "all") { playFrom(playlist.length - 1); }
    return;
  }
  playFrom(prev);
}
export function advancePlaylist(): void {
  syncPlaylistIndex();
  if (currentPlaylistIndex === null) return;
  const next = getNextIndex(currentPlaylistIndex);
  if (next === null) {
    clearPlayingFlag();
    currentPlaylistIndex = null;
    renderPlaylist();
    updatePlayPauseBtn();
    return;
  }
  playFrom(next);
}

function formatDuration(sec: string): string {
  const n = parseFloat(sec);
  if (isNaN(n) || n <= 0) return "??:??";
  return formatTime(sec);
}

const coverCache = new Map<string, string | null>();

interface CoverJob {
  path: string;
  li: HTMLLIElement | null;
}

let coverQueue: CoverJob[] = [];
let coverDraining = false;
let coverIntersecting = false;

function coversAllowed(): boolean {
  return document.visibilityState === "visible" && coverIntersecting;
}

function resetCoverImg(img: HTMLImageElement): void {
  img.classList.remove("loaded");
  img.src = "";
  img.onload = null;
  img.onerror = null;
}

function showImgWhenReady(img: HTMLImageElement, src: string): void {
  img.classList.remove("loaded");
  if (!src) { img.src = ""; return; }
  img.onload = () => { img.classList.add("loaded"); };
  img.onerror = () => { img.classList.remove("loaded"); };
  img.src = src;
  if (img.complete) img.classList.add("loaded");
}

async function drainCoverQueue(): Promise<void> {
  if (coverDraining || !coversAllowed()) return;
  coverDraining = true;
  while (coverQueue.length > 0) {
    const job = coverQueue.shift()!;
    const img = job.li ? job.li.querySelector<HTMLImageElement>(".playlist-cover img") : null;
    if (job.li && (!img || img.dataset.path !== job.path)) continue;

    const cached = coverCache.get(job.path);
    if (cached !== undefined) {
      if (img) showImgWhenReady(img, cached || "");
      continue;
    }

    try {
      const dataUrl = await window.electronAPI.getCoverArt(job.path);
      coverCache.set(job.path, dataUrl);
      if (img && img.dataset.path === job.path) {
        showImgWhenReady(img, dataUrl || "");
      }
    } catch {
      coverCache.set(job.path, null);
    }
  }
  coverDraining = false;
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
let edgeScrollRaf = 0;

function measureRowHeight(): number {
  const temp = document.createElement("li");
  temp.className = "playlist-item";
  temp.style.visibility = "hidden";
  temp.style.position = "absolute";
  temp.innerHTML = '<span class="playlist-playing"></span><span class="playlist-cover"><img alt=""><span class="playlist-cover-placeholder">\u266B</span></span><span class="playlist-title"><span class="playlist-title-line">Xg</span><span class="playlist-artist-line">Xg</span></span><span class="playlist-duration">00:00</span>';
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
    const coverImg = document.createElement("img");
    coverImg.alt = "";
    coverSpan.appendChild(coverImg);
    const placeholder = document.createElement("span");
    placeholder.className = "playlist-cover-placeholder";
    placeholder.textContent = "\u266B";
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

const COVER_PRELOAD = 20;

function enqueuePreloadRange(from: number, to: number): void {
  for (let i = from; i <= to; i++) {
    if (i < 0 || i >= playlist.length) continue;
    const path = playlist[i]!.path;
    if (coverCache.has(path)) continue;
    coverQueue.push({ path, li: null });
  }
}

function populate(): void {
  const total = playlist.length;
  coverQueue = [];

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

    const img = li.querySelector<HTMLImageElement>(".playlist-cover img")!;
    resetCoverImg(img);

    const cached = coverCache.get(entry.path);
    if (cached !== undefined) {
      showImgWhenReady(img, cached || "");
    } else {
      coverQueue.push({ path: entry.path, li });
    }
  }

  if (coversAllowed()) {
    enqueuePreloadRange(firstIdx - COVER_PRELOAD, firstIdx - 1);
    enqueuePreloadRange(firstIdx + rowEls.length, firstIdx + rowEls.length + COVER_PRELOAD - 1);
  }

  drainCoverQueue();

  updatePlaylistPlayingIndicator();
  updateScrollbar();
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
    const entry = playlist[di]!;
    e.dataTransfer!.setData(TRACK_MIME, JSON.stringify(entry));
    e.dataTransfer!.setData("application/x-musicpenguin-playlist-index", String(di));
    e.dataTransfer!.effectAllowed = "move";
  });

  /* Drag over / drop on items */
  playListEl.addEventListener("dragover", (e: DragEvent) => {
    if (!e.dataTransfer) return;
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

    const targetLi = (e.target as HTMLElement).closest<HTMLLIElement>(".playlist-item");
    const targetDi = targetLi ? parseInt(targetLi.dataset.index ?? "", 10) : playlist.length;
    const after = targetLi ? (e.clientY - targetLi.getBoundingClientRect().top > targetLi.getBoundingClientRect().height / 2) : true;
    const hadPlaying = currentPlaylistIndex !== null;

    const srcIdxStr = e.dataTransfer!.getData("application/x-musicpenguin-playlist-index");
    if (srcIdxStr !== "") {
      const sourcePi = parseInt(srcIdxStr, 10);
      if (isNaN(sourcePi) || sourcePi === targetDi) return;
      const moved = playlist.splice(sourcePi, 1)[0]!;
      let adjustedTarget = targetDi > sourcePi ? targetDi - 1 : targetDi;
      const insertAt = after ? adjustedTarget + 1 : adjustedTarget;
      playlist.splice(insertAt, 0, moved);
      selectedIndices.clear();
      selectedIndices.add(insertAt);
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
      }
    }

    if (hadPlaying) syncPlaylistIndex();
    playlistSortColumn = "";
    sortPlaylist();
    renderPlaylist();
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
  const SPEED = 6;
  const rect = plViewport.getBoundingClientRect();
  if (e.clientY < rect.top + EDGE) {
    isDraggingEdge = true;
    edgeScrollDir = -SPEED;
  } else if (e.clientY > rect.bottom - EDGE) {
    isDraggingEdge = true;
    edgeScrollDir = SPEED;
  } else {
    stopEdgeScroll();
    return;
  }
  if (!edgeScrollRaf) tickEdgeScroll();
}

function tickEdgeScroll(): void {
  if (!isDraggingEdge) return;
  plViewport.scrollTop += edgeScrollDir;
  firstIdx = Math.max(0, Math.min(getMaxFirstIdx(), Math.round(plViewport.scrollTop / rowHeight)));
  populate();
  edgeScrollRaf = requestAnimationFrame(tickEdgeScroll);
}

function stopEdgeScroll(): void {
  isDraggingEdge = false;
  edgeScrollDir = 0;
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

  const hasItems = playlist.length > 0;
  const canRandomize = playlist.length >= 2;
  for (const id of ["playlist-play-btn", "randomize-btn", "clear-playlist-btn"]) {
    const btn = document.getElementById(id);
    if (btn) {
      const enable = id === "randomize-btn" ? canRandomize : hasItems;
      btn.classList.toggle("enabled", enable);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   initPlaylist
   ══════════════════════════════════════════════════════════════════ */

export function initPlaylist(
  onGotoAlbum?: (path: string) => void,
  onGotoFolder?: (path: string) => void,
): void {
  onGotoAlbumPlaylistCb = onGotoAlbum ?? null;
  onGotoFolderPlaylistCb = onGotoFolder ?? null;
  const shuffleBtn = document.getElementById("shuffle-btn") as HTMLButtonElement;
  const repeatBtn = document.getElementById("repeat-btn") as HTMLButtonElement;
  const randomizeBtn = document.getElementById("randomize-btn") as HTMLButtonElement;
  const clearPlaylistBtn = document.getElementById("clear-playlist-btn") as HTMLButtonElement;
  playlistPlayBtn = document.getElementById("playlist-play-btn") as HTMLButtonElement;
  playListEl = document.getElementById("playlist-list") as HTMLUListElement;

  if (!shuffleBtn || !repeatBtn || !randomizeBtn || !playListEl || !clearPlaylistBtn || !playlistPlayBtn) return;

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

  /* ── Start cover art loading only after the playlist is shown ── */
  const coverObserver = new IntersectionObserver((entries) => {
    const intersecting = entries.some((e) => e.isIntersecting);
    coverIntersecting = intersecting;
    if (coversAllowed()) drainCoverQueue();
  });
  coverObserver.observe(plViewport);
  document.addEventListener("visibilitychange", () => {
    if (coversAllowed()) drainCoverQueue();
  });

  /* ── Drop on viewport itself (empty area, below items) ─────── */
  plViewport.addEventListener("dragover", (e: DragEvent) => {
    if (!e.dataTransfer!.types.includes(TRACK_MIME)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
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
    persistState();
  });

  /* ── Load saved state ─────────────────────────────────────── */
  loadState().then(() => {
    updateShuffleBtn(shuffleBtn);
    updateRepeatBtn(repeatBtn);
    sortPlaylist();
    renderPlaylist();
  });

  /* ── Button listeners ──────────────────────────────────────── */
  shuffleBtn.addEventListener("click", async () => {
    shuffle = !shuffle;
    updateShuffleBtn(shuffleBtn);
    await persistState();
    playlistStateChangeCallbacks.forEach((cb) => cb());
  });

  repeatBtn.addEventListener("click", async () => {
    const idx = REPEAT_CYCLE.indexOf(repeat);
    repeat = REPEAT_CYCLE[(idx + 1) % REPEAT_CYCLE.length]!;
    updateRepeatBtn(repeatBtn);
    await persistState();
    playlistStateChangeCallbacks.forEach((cb) => cb());
  });

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
      if (shuffle && curIdx !== -1) {
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
    updateShuffleBtn(shuffleBtn);
    updateRepeatBtn(repeatBtn);
    const title = t("Currently playing");
    for (const row of rowEls) {
      const span = row.querySelector<HTMLElement>(".playlist-playing");
      if (span) span.title = title;
    }
  });

  clearPlaylistBtn.addEventListener("click", () => {
    if (playlist.length === 0) return;
    clearPlayingFlag();
    playlist = [];
    currentPlaylistIndex = null;
    selectedIndices.clear();
    renderPlaylist();
    persistState();
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
    const paths = res.paths;

    const rows = await window.electronAPI.lookupPaths(paths).catch(() => []);
    const known = new Set(rows.map((r: any) => r.path));
    const missing = paths.filter((p) => !known.has(p));
    if (missing.length > 0) {
      const files = missing.map((p) => ({
        fullPath: p,
        name: p.split("/").pop() ?? p,
        relativePath: p,
      }));
      await window.electronAPI.runIncrementalScan(files);
    }

    await rebuildFromPaths(paths);
    clearPlayingFlag();
    currentPlaylistIndex = null;
    selectedIndices.clear();
    playlistSortColumn = "";
    sortPlaylist();
    renderPlaylist();
    persistState();
    playlistStateChangeCallbacks.forEach((cb) => cb());
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
      const showItem = document.createElement("div");
      showItem.className = "context-menu-item";
      showItem.textContent = t("Show in Folder");
      showItem.addEventListener("click", async () => {
        closeSortContextMenu();
        await window.electronAPI.showInExternalFileExplorer(targetPath, false);
      });
      menu.appendChild(showItem);

      const vlcItem = document.createElement("div");
      vlcItem.className = "context-menu-item";
      vlcItem.textContent = t("Play in VLC");
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
        await window.electronAPI.openInVlc(toPlay);
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

      if (onGotoAlbumPlaylistCb && targetPath) {
        const targetEntry = playlist.find((e) => e.path === targetPath);
        if (targetEntry?.album) {
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

      if (onGotoFolderPlaylistCb && targetPath) {
        const gotoFolderItem = document.createElement("div");
        gotoFolderItem.className = "context-menu-item";
        gotoFolderItem.textContent = t("Goto Folder");
        gotoFolderItem.addEventListener("click", () => {
          closeSortContextMenu();
          onGotoFolderPlaylistCb!(targetPath);
        });
        menu.appendChild(gotoFolderItem);
      }

      const sep2 = document.createElement("hr");
      sep2.className = "playlist-sort-sep";
      menu.appendChild(sep2);
    }

    const heading = document.createElement("div");
    heading.className = "playlist-sort-heading";
    heading.textContent = t("Sort by:");
    menu.appendChild(heading);

    for (const col of SORT_COLUMNS) {
      const item = document.createElement("div");
      item.className = "context-menu-item playlist-sort-item";

      const label = document.createElement("span");
      label.className = "playlist-sort-label";
      label.textContent = t(col.label);
      item.appendChild(label);

      const ascBtn = document.createElement("button");
      ascBtn.className = "playlist-sort-btn" + (playlistSortColumn === col.key && playlistSortDirection === "asc" ? " active" : "");
      ascBtn.textContent = "\u25B2";
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
      descBtn.textContent = "\u25BC";
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
