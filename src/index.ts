import { TreeNode, ListItem } from "./types.js";
import { renderGroups } from "./groups-view.js";
import { initVirtualList, VirtualListController, loadColumnWidths, loadColumnVisibility, formatTime, setOnDeletedFiles } from "./list-view.js";
import { showDetails } from "./detail-panel.js";
import { setSelectedTrack, playTrack, initNowPlaying, initPlayableExtensions, refreshListIndicator, onTrackEnd, setNavCallbacks, updateNavButtons, onNavStateChange, selectedPath } from "./now-playing.js";
import "./split-pane.js";
import { loadSplitterState } from "./split-pane.js";
import { initPlaylist, clearPlaylistPlaying, advancePlaylist, prevPlaylist, isPlaylistPlaying, canPlaylistPrev, canPlaylistNext, updatePlaylistPaths, updatePlaylistEntry, onPlaylistStateChange, onPlaylistSelect } from "./playlist-panel.js";
import { initSearchPanel } from "./search-panel.js";
import { initSettings } from "./settings.js";
import { initFoldersDialog, startupInit } from "./folders-dialog.js";
import { scanFolders, FolderNode, fileCountLabel } from "./scanner.js";
import { setTrackNavCallbacks } from "./theatermode.js";
import { t, initI18n } from "./i18n/index.js";

const HEADER_COLUMNS = ["", "playcount", "track_no", "title", "artist", "album", "album_artist", "composer", "conductor", "year", "genre", "bpm", "rating", "duration", "ext", "path"];

const groupsData: TreeNode[] = [
  { id: "grp-allfiles", label: "All Files" },
  { id: "grp-search", label: "Search Result" },
  { id: "grp-most-played", label: "Most Played" },
];
let albumGroupItems: TreeNode[] = [];
let folderGroupItems: TreeNode[] = [];

const groupsEl = document.getElementById("groups-list")!;
const listEl = document.getElementById("list")!;

let tracks: Track[] = [];
let searchResults: Track[] | null = null;
let selectedGroupId: string | null = "grp-allfiles";
let selectedTrackPath: string | null = null;
let playingTrackPath: string | null = null;
let sortColumn = "path";
let sortDirection: "asc" | "desc" = "asc";
let listScrollTop = 0;
let listCtrl: VirtualListController | null = null;

/* ── Sort ──────────────────────────────────────────────────── */

async function loadSortState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data?.["sort-column"]) sortColumn = data["sort-column"];
    if (data?.["sort-direction"] === "asc" || data?.["sort-direction"] === "desc") sortDirection = data["sort-direction"];
  } catch { /* ignore */ }
}

async function saveSortState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    await window.electronAPI.saveSettings({
      ...(data || {}),
      "sort-column": sortColumn,
      "sort-direction": sortDirection,
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
    const data = await window.electronAPI.loadSettings();
    await window.electronAPI.saveSettings({
      ...(data || {}),
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

function sortArray(arr: Track[]): void {
  arr.sort((a, b) => {
    if (sortColumn === "track_no") {
      const aDisc = parseInt(a.disc_no, 10) || 0;
      const bDisc = parseInt(b.disc_no, 10) || 0;
      const aTrack = parseInt(a.track_no, 10) || 0;
      const bTrack = parseInt(b.track_no, 10) || 0;
      const cmp = aDisc !== bDisc ? aDisc - bDisc : aTrack - bTrack;
      return sortDirection === "asc" ? cmp : -cmp;
    }
    if (sortColumn === "playcount") {
      return sortDirection === "asc" ? a.playcount - b.playcount : b.playcount - a.playcount;
    }
    if (sortColumn === "rating") {
      return sortDirection === "asc" ? a.rating - b.rating : b.rating - a.rating;
    }
    if (sortColumn === "bpm") {
      return sortDirection === "asc" ? a.bpm - b.bpm : b.bpm - a.bpm;
    }
    if (sortColumn === "ext") {
      const aExt = a.filename.includes(".") ? a.filename.split(".").pop()!.toLowerCase() : "";
      const bExt = b.filename.includes(".") ? b.filename.split(".").pop()!.toLowerCase() : "";
      const cmp = aExt.localeCompare(bExt);
      return sortDirection === "asc" ? cmp : -cmp;
    }
    const aVal = (a[sortColumn as keyof Track] || "") as string;
    const bVal = (b[sortColumn as keyof Track] || "") as string;
    const cmp = aVal.toLowerCase().localeCompare(bVal.toLowerCase());
    return sortDirection === "asc" ? cmp : -cmp;
  });
}

function sortTracks(): void {
  sortArray(tracks);
}

function onHeaderClick(col: string): void {
  if (sortColumn === col) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortColumn = col;
    sortDirection = "asc";
  }
  saveSortState();
  sortArray(tracks);
  if (searchResults) sortArray(searchResults);
  renderTrackList();
  updateSortIndicators();
  listCtrl?.setSortState(sortColumn, sortDirection);
}

function applySort(column: string, direction: "asc" | "desc"): void {
  sortColumn = column;
  sortDirection = direction;
  saveSortState();
  sortArray(tracks);
  if (searchResults) sortArray(searchResults);
  renderTrackList();
  updateSortIndicators();
  listCtrl?.setSortState(column, direction);
}

function headerLabel(col: string): string {
  switch (col) {
    case "album_artist": return t("Album Artist");
    case "track_no": return t("#");
    case "playcount": return t("Play Count");
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
    (th as HTMLElement).style.cursor = "pointer";
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
    const arrow = col === sortColumn ? (sortDirection === "asc" ? "▲" : "▼") : "";
    span.textContent = label;
    if (arrow) {
      const badge = document.createElement("span");
      badge.className = "sort-badge";
      badge.textContent = arrow;
      span.appendChild(badge);
    } else {
      const existing = span.querySelector(".sort-badge");
      if (existing) existing.remove();
    }
  });
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
  if (selectedGroupId?.startsWith("grp-folder:")) {
    const folderPath = decodeURIComponent(selectedGroupId.slice("grp-folder:".length));
    return tracks.filter((t) => t.path.startsWith(folderPath + "/"));
  }
  return tracks;
}

function mainListNext(): void {
  if (!playingTrackPath) return;
  const source = getCurrentSource();
  const idx = source.findIndex((t) => t.path === playingTrackPath);
  if (idx >= 0 && idx < source.length - 1) {
    const next = source[idx + 1]!;
    playingTrackPath = next.path;
    selectedTrackPath = next.path;
    setSelectedTrack(next.path, next.title || undefined);
    playTrack(next.path, next.title || undefined);
    showDetails(trackToListItem(next, idx + 1));
    for (let i = 0; i < listEl.children.length; i++) {
      const tr = listEl.children[i] as HTMLElement;
      tr.classList.toggle("selected", tr.dataset.path === next.path);
    }
    refreshListIndicator();
    refreshNavButtons();
  }
}

function mainListPrev(): void {
  if (!playingTrackPath) return;
  const source = getCurrentSource();
  const idx = source.findIndex((t) => t.path === playingTrackPath);
  if (idx > 0) {
    const prev = source[idx - 1]!;
    playingTrackPath = prev.path;
    selectedTrackPath = prev.path;
    setSelectedTrack(prev.path, prev.title || undefined);
    playTrack(prev.path, prev.title || undefined);
    showDetails(trackToListItem(prev, idx));
    for (let i = 0; i < listEl.children.length; i++) {
      const tr = listEl.children[i] as HTMLElement;
      tr.classList.toggle("selected", tr.dataset.path === prev.path);
    }
    refreshListIndicator();
    refreshNavButtons();
  }
}

function canMainListNext(): boolean {
  if (!playingTrackPath) return false;
  const source = getCurrentSource();
  const idx = source.findIndex((t) => t.path === playingTrackPath);
  return idx >= 0 && idx < source.length - 1;
}

function canMainListPrev(): boolean {
  if (!playingTrackPath) return false;
  const source = getCurrentSource();
  const idx = source.findIndex((t) => t.path === playingTrackPath);
  return idx > 0;
}

function renderTrackList(): void {
  const saved = new Set<string>();
  for (let i = 0; i < listEl.children.length; i++) {
    const tr = listEl.children[i] as HTMLElement;
    if (tr.classList.contains("selected") && tr.dataset.path) {
      saved.add(tr.dataset.path);
    }
  }

  const source = getCurrentSource();
  sortArray(source);
  const items = source.map((t, i) => trackToListItem(t, i));
  listCtrl!.updateData(items, saved);

  refreshListIndicator();
  refreshNavButtons();
  sendPriorityPaths();
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
    if (selectedGroupId === "grp-allfiles" || selectedGroupId === "grp-search") {
      if (selectedGroupId === "grp-allfiles") sortTracks();
      renderTrackList();
    }
    if (update.path === selectedTrackPath) {
      const source = getCurrentSource();
      const idx = source.findIndex((t) => t.path === update.path);
      if (idx !== -1) showDetails(trackToListItem(source[idx]!, idx));
    }
  }
  updatePlaylistEntry(update);
}

function refreshNavButtons(): void {
  const cp = isPlaylistPlaying() ? canPlaylistPrev() : canMainListPrev();
  const cn = isPlaylistPlaying() ? canPlaylistNext() : canMainListNext();
  updateNavButtons(cp, cn);
}

/* ── Init ──────────────────────────────────────────────────── */

async function init() {
  await initI18n();
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
    statusText.textContent = t("Loaded $1 $2 from library. Tag scanning stopped.", tracks.length, fileCountLabel(tracks.length));
  });
  const settingsOverlay = document.getElementById("settings-overlay")!;
  const foldersOverlay = document.getElementById("folders-overlay")!;
  window.electronAPI.onTagScanning((data) => {
    if (!settingsOverlay.classList.contains("hidden") || !foldersOverlay.classList.contains("hidden")) return;
    if (!data.path) {
      statusText.textContent = t("Loaded $1 $2 from library. Tag scanning complete.", tracks.length, fileCountLabel(tracks.length));
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
    selectedTrackPath = item.trackPath;
    showDetails(item);
    setSelectedTrack(item.trackPath, item.title || undefined);
    sendPriorityPaths();
  }, (item) => {
    clearPlaylistPlaying();
    playingTrackPath = item.trackPath;
    playTrack(item.trackPath, item.title || undefined);
  }, applySort, (item) => {
    gotoAlbum(item.album, item.trackPath);
  }, (item) => {
    const dir = item.trackPath.substring(0, item.trackPath.lastIndexOf("/"));
    gotoFolder(dir, item.trackPath);
  });
  listCtrl.setSortState(sortColumn, sortDirection);
  listCtrl.setAfterRender(refreshListIndicator);
  window.addEventListener("beforeunload", saveUIStateSync);
  setOnDeletedFiles((paths) => {
    const removed = new Set(paths);
    tracks = tracks.filter((t) => !removed.has(t.path));
    renderTrackList();
  });

  async function runSearch(query: string, regex: boolean): Promise<void> {
    if (!query) {
      alert(t("Enter a search term first."));
      selectedGroupId = "grp-allfiles";
      refreshGroupsUI();
      renderTrackList();
      listCtrl!.setScrollOffset(0);
      saveUIState();
      return;
    }
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
      (folderPath) => window.electronAPI.showInExternalFileExplorer(folderPath, true));
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
      renderTrackList();
      listCtrl!.setScrollOffset(0);
      const first = source[0];
      if (first) {
        clearPlaylistPlaying();
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
      renderTrackList();
      listCtrl!.setScrollOffset(0);
      const first = source[0];
      if (first) {
        clearPlaylistPlaying();
        playingTrackPath = first.path;
        playTrack(first.path, first.title || undefined);
        showDetails(trackToListItem(first, 0));
        selectedTrackPath = first.path;
        listCtrl!.selectAndScrollTo(first.path);
      }
    }
  }

  function fetchGroupCoverArt(node: TreeNode, samplePath: string): void {
    if (node.coverArt || !samplePath) return;
    window.electronAPI.getCoverArt(samplePath).then((dataUrl) => {
      if (dataUrl) {
        node.coverArt = dataUrl;
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
    }
    selectedGroupId = id;
    refreshGroupsUI();
    const source = getCurrentSource();
    sortArray(source);
    renderTrackList();
    listCtrl!.setScrollOffset(0);
    saveUIState();
    if (!node.coverArt) {
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
    }
    selectedGroupId = id;
    refreshGroupsUI();
    const source = getCurrentSource();
    sortArray(source);
    renderTrackList();
    listCtrl!.setScrollOffset(0);
    saveUIState();
    if (!node.coverArt) {
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

  function onGroupSelect(node: TreeNode): void {
    if (node.id === "grp-search" && searchResults === null) {
      const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
      const regexBtn = document.getElementById("regex-btn") as HTMLElement | null;
      const query = searchInput?.value.trim() ?? "";
      const regex = regexBtn?.classList.contains("active") ?? false;
      runSearch(query, regex);
      return;
    }
    if (node.id === "grp-album-heading" || node.id === "grp-folder-heading") return;
    selectedGroupId = node.id;
    saveUIState();
    if (node.id === "grp-most-played") {
      sortColumn = "playcount";
      sortDirection = "desc";
      saveSortState();
      updateSortIndicators();
    }
    if (node.id === "grp-allfiles" || node.id === "grp-search" || node.id === "grp-most-played" ||
        node.id.startsWith("grp-album:") || node.id.startsWith("grp-folder:")) {
      renderTrackList();
      listCtrl!.setScrollOffset(0);
    } else {
      listCtrl!.updateData([]);
    }
    showDetails(null);
    setSelectedTrack(null);
    selectedTrackPath = null;
  }

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
  );

  onPlaylistSelect((path: string) => {
    const track = tracks.find((t) => t.path === path);
    if (track) {
      const idx = tracks.indexOf(track);
      showDetails(trackToListItem(track, idx));
    }
  });

  setNavCallbacks(
    () => { isPlaylistPlaying() ? prevPlaylist() : mainListPrev(); refreshNavButtons(); },
    () => { isPlaylistPlaying() ? advancePlaylist() : mainListNext(); refreshNavButtons(); },
  );
  onNavStateChange(refreshNavButtons);
  onPlaylistStateChange(refreshNavButtons);
  refreshNavButtons();

  setTrackNavCallbacks(
    () => isPlaylistPlaying() ? prevPlaylist() : mainListPrev(),
    () => isPlaylistPlaying() ? advancePlaylist() : mainListNext(),
    () => isPlaylistPlaying() ? canPlaylistPrev() : canMainListPrev(),
    () => isPlaylistPlaying() ? canPlaylistNext() : canMainListNext(),
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

    if (selectedGroupId === "grp-allfiles") sortTracks();
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

  /* ── Init settings dialog ─────────────────────────────────── */
  await initSettings();

  /* ── Init about dialog ─────────────────────────────────── */
  {
    const aboutOverlay = document.getElementById("about-overlay")!;
    const aboutClose = document.getElementById("about-dialog-close")!;
    const aboutLogo = document.getElementById("about-logo")!;
    const aboutAppName = document.getElementById("about-app-name")!;
    const aboutVersion = document.getElementById("about-version")!;
    const aboutBy = document.getElementById("about-by")!;
    const aboutHomepage = document.getElementById("about-homepage") as HTMLAnchorElement;
    const aboutOk = document.getElementById("about-ok")!;
    const logo = document.getElementById("large-application-logo")!;

    function showAbout(): void {
      window.electronAPI.getVersion().then((v) => {
        //aboutVersion.textContent = t("Version $1", v); // FIXME: shows WRONG number, not 0.0.1, therefore as hotfix hardcoded
      });
      aboutOverlay.classList.remove("hidden");
    }

    function hideAbout(): void {
      aboutOverlay.classList.add("hidden");
    }

    logo.addEventListener("click", showAbout);
    aboutClose.addEventListener("click", hideAbout);
    aboutOk.addEventListener("click", hideAbout);

    function openHomepage(): void {
      window.electronAPI.openExternal(aboutHomepage.href);
    }
    aboutLogo.addEventListener("click", openHomepage);
    aboutAppName.addEventListener("click", openHomepage);
    aboutVersion.addEventListener("click", openHomepage);
    aboutBy.addEventListener("click", openHomepage);
    aboutHomepage.addEventListener("click", (e) => {
      e.preventDefault();
      openHomepage();
    });

    aboutOverlay.addEventListener("click", (e) => {
      if (e.target === aboutOverlay) hideAbout();
    });
  }

  /* ── Init folders dialog ─────────────────────────────────── */
  await initFoldersDialog(async () => {
    tracks = await window.electronAPI.loadFiles();
    statusText.textContent = t("Loaded $1 $2 from library.", tracks.length, fileCountLabel(tracks.length));
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
    const saved = await window.electronAPI.loadSettings();
    const folders: FolderNode[] = saved?.folders ?? [];
    const flat = folders.flatMap(f =>
      f.children && f.children.length > 0
        ? f.children.filter(c => c.enabled).map(c => ({ path: c.path }))
        : f.enabled ? [{ path: f.path }] : []
    );
    if (flat.length === 0) {
      statusText.textContent = t("No folders configured. Open settings to add folders.");
      return;
    }
    statusText.textContent = t("Scanning folders...");
    const { files } = await scanFolders(folders, (msg) => {
      statusText.textContent = msg;
    });
    statusText.textContent = files.length > 0
      ? t("Found $1 $2. Reading tags...", files.length, fileCountLabel(files.length))
      : t("No new files. Scanning tags for untagged entries...");
    const result = await window.electronAPI.runIncrementalScan(files);
    tracks = await window.electronAPI.loadFiles();
    const parts = [
      t("Total files: $1. Added: $2.", result.total, result.added),
      result.errors > 0 ? " " + t("Errors: $1.", result.errors) : "",
      result.removed > 0 ? " " + t("Removed $1 missing $2.", result.removed, fileCountLabel(result.removed)) : "",
    ];
    statusText.textContent = parts.filter(Boolean).join(" ");
    sortTracks();
    renderTrackList();
    listCtrl!.setScrollOffset(0);
  });

  /* ── Problematic files button ──────────────────────────── */
  document.getElementById("problematic-btn")!.addEventListener("click", async () => {
    const result = await window.electronAPI.getProblematicFiles();
    if (result.count > 0) {
      if (result.opened) {
        statusText.textContent = t("$1 problematic $2 written to $3 and opened in editor.", result.count, fileCountLabel(result.count), result.path);
      } else {
        alert(t("Written $1 problematic $2 to:\n$3\n\nNo editor could be automatically launched. Please open the file manually.", result.count, fileCountLabel(result.count), result.path));
        statusText.textContent = t("$1 problematic $2 written to $3.", result.count, fileCountLabel(result.count), result.path);
      }
    } else {
      alert(t("No problematic files found."));
      statusText.textContent = t("No problematic files found.");
    }
  });

  /* ── Startup: load existing files from DB, start tag reader ── */
  await startupInit(async () => {
    tracks = await window.electronAPI.loadFiles();
    statusText.textContent = t("Loaded $1 $2 from library.", tracks.length, fileCountLabel(tracks.length));
    if (selectedGroupId === "grp-allfiles") {
      sortTracks();
      renderTrackList();
      listCtrl!.setScrollOffset(0);
    }
  });

  /* ── Let the browser paint the empty shell before loading data ─── */
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  /* ── LAST: load tracks and render list ────────────────────── */
  tracks = await window.electronAPI.loadFiles();
  statusText.textContent = t("Loaded $1 $2 from library.", tracks.length, fileCountLabel(tracks.length));

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
}

init();
