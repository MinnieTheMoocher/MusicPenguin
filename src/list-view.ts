import { ListItem } from "./types.js";
import { audio } from "./audio.js";
import { t } from "./i18n/index.js";
import { noteExternalPlays } from "./now-playing.js";
import { getExternalPlayer, getExternalPlayerDisplayName } from "./external-player.js";
import { DEFAULT_COLUMN_WIDTHS } from "./config.js";
import { ARTIST_ALBUM_TRACKNO, SORTING_MODES } from "./sorting.js";

let listSortColumn = "";
let listSortDirection: "asc" | "desc" = "asc";
let activeSortingMode: string | null = null;
let onSortCb: ((column: string, direction: "asc" | "desc") => void) | null = null;
let onSortingModeCb: ((id: string) => void) | null = null;
let onGotoAlbumCb: ((item: ListItem) => void) | null = null;
let onGotoFolderCb: ((item: ListItem) => void) | null = null;
let onGotoArtistCb: ((item: ListItem) => void) | null = null;
let onGotoComposerCb: ((item: ListItem) => void) | null = null;

function menuKeyToSortKey(key: string): string {
  switch (key) {
    case "trackNo": return "track_no";
    case "albumArtist": return "album_artist";
    case "filename": return "path";
    default: return key;
  }
}

export function ratingToStarCount(rating: number): number {
  if (rating === 0) return 0;
  if (rating > 0 && rating <= 1) return -1;
  if (rating < 26) return 0.5;
  if (rating < 52) return 1;
  if (rating < 77) return 1.5;
  if (rating < 103) return 2;
  if (rating < 128) return 2.5;
  if (rating < 154) return 3;
  if (rating < 180) return 3.5;
  if (rating < 205) return 4;
  if (rating < 231) return 4.5;
  return 5;
}

export function formatTime(sec: string): string {
  const n = parseFloat(sec);
  if (isNaN(n) || n <= 0) return "";
  const totalSec = Math.floor(n);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function renderRating(rating: number): string {
  const count = ratingToStarCount(rating);
  if (count === -1) {
    return `<span class="star star-hated">🤮</span>`
      + `<span class="star star-hollow">☆</span>`.repeat(4);
  }
  const full = Math.floor(count);
  const half = count % 1 >= 0.5;
  const hollow = 5 - full - (half ? 1 : 0);
  let html = "";
  for (let i = 0; i < full; i++) {
    html += `<span class="star star-filled">★</span>`;
  }
  if (half) {
    html += `<span class="star-half"><span class="star-half-bg">☆</span><span class="star-half-fg">★</span></span>`;
  }
  for (let i = 0; i < hollow; i++) {
    html += `<span class="star star-hollow">☆</span>`;
  }
  return html;
}

function starCountToDbValue(stars: number): number {
  if (stars <= 0) return 0;
  if (stars <= 0.5) return 13;
  if (stars <= 1) return 38;
  if (stars <= 1.5) return 64;
  if (stars <= 2) return 90;
  if (stars <= 2.5) return 115;
  if (stars <= 3) return 141;
  if (stars <= 3.5) return 166;
  if (stars <= 4) return 192;
  if (stars <= 4.5) return 217;
  return 243;
}

/* Hover-preview sentinel for the "hated" state — distinct from -1,
   which marks "cursor outside any slot". */
const HATE_PREVIEW = -2;

function highlightStars(el: HTMLElement, count: number): void {
  const starNodes = el.querySelectorAll<HTMLElement>(".star, .star-half");
  const full = Math.floor(count);
  const half = count % 1 >= 0.5;
  let i = 0;
  for (; i < full && i < starNodes.length; i++) {
    const span = starNodes[i]!;
    span.className = "star star-filled";
    span.textContent = "★";
  }
  if (half && i < starNodes.length) {
    const span = starNodes[i]!;
    span.className = "star-half";
    span.innerHTML = '<span class="star-half-bg">☆</span><span class="star-half-fg">★</span>';
    i++;
  }
  for (; i < starNodes.length; i++) {
    const span = starNodes[i]!;
    span.className = "star star-hover-hollow";
    span.textContent = "☆";
  }
}

function setRatingValue(el: HTMLElement, path: string, dbVal: number): void {
  window.electronAPI.setRating(path, dbVal);
  /* Keep the virtual list's own model in sync — otherwise scrolling away
     and back (or any repopulation) restores the previous rating. */
  for (const item of allItems) {
    if (item.trackPath === path) item.rating = dbVal;
  }
  for (const target of document.querySelectorAll<HTMLElement>(`[data-track-path="${path}"]`)) {
    target.dataset.rating = String(dbVal);
    target.innerHTML = renderRating(dbVal);
  }
  /* Let other modules sync their models (main list data, playlist, ...)
     so the new rating survives navigation, re-sorting and re-renders. */
  document.dispatchEvent(new CustomEvent("rating-updated", { detail: { path, rating: dbVal } }));
}

export function setupRatingHover(el: HTMLElement, rating: number, trackPath?: string): void {
  if (!el.dataset.ratingInitialized) {
    el.dataset.ratingInitialized = "1";
    let hoveredStarCount = -1;
    el.addEventListener("mousemove", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".star, .star-half");
      if (!target || !el.contains(target)) return;
      const stars = Array.from(el.querySelectorAll<HTMLElement>(".star, .star-half"));
      const idx = stars.indexOf(target);
      if (idx === -1) return;
      const rect = target.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      /* Far-left quarter of the first slot previews the "hated" state;
         a hated emoji under the cursor counts as that zone too, which
         keeps the preview stable while it is shown. */
      const hateZone = target.classList.contains("star-hated") || (idx === 0 && relX < 0.25);
      let starCount: number;
      if (hateZone) {
        starCount = HATE_PREVIEW;
      } else {
        const midX = rect.left + rect.width / 2;
        starCount = idx + (e.clientX >= midX ? 1 : 0.5);
      }
      if (starCount !== hoveredStarCount) {
        hoveredStarCount = starCount;
        if (starCount === HATE_PREVIEW) {
          el.innerHTML = renderRating(1);
        } else {
          highlightStars(el, starCount);
        }
      }
    });
    el.addEventListener("mouseleave", () => {
      hoveredStarCount = -1;
      const r = parseInt(el.dataset.rating || "0", 10);
      el.innerHTML = renderRating(r);
    });
    el.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".star, .star-half");
      if (!target) return;
      const stars = Array.from(el.querySelectorAll<HTMLElement>(".star, .star-half"));
      const idx = stars.indexOf(target);
      if (idx === -1) return;
      e.stopPropagation();
      const path = el.dataset.trackPath;
      if (!path) return;
      const rect = target.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      /* Far-left quarter of the first slot (or the hated emoji itself)
         assigns the "hated" rating. Clearing a track back to
         "(unrated)" is only offered via the context menu. */
      if (target.classList.contains("star-hated") || (idx === 0 && relX < 0.25)) {
        setRatingValue(el, path, 1);
        return;
      }
      const midX = rect.left + rect.width / 2;
      const clickedStars = idx + (e.clientX >= midX ? 1 : 0.5);
      setRatingValue(el, path, starCountToDbValue(clickedStars));
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const path = el.dataset.trackPath;
      if (!path) return;
      const existingMenu = document.querySelector(".rating-context-menu");
      if (existingMenu) existingMenu.remove();

      const menu = document.createElement("div");
      menu.className = "context-menu rating-context-menu";
      menu.style.left = e.clientX + "px";
      menu.style.top = e.clientY + "px";
    menu.addEventListener("contextmenu", (ce: Event) => ce.preventDefault());

      const items: { label: string; dbVal: number }[] = [
        { label: t("(unrated)"), dbVal: 0 },
        { label: "🤮", dbVal: 1 },
        { label: "★", dbVal: starCountToDbValue(1) },
        { label: "★★", dbVal: starCountToDbValue(2) },
        { label: "★★★", dbVal: starCountToDbValue(3) },
        { label: "★★★★", dbVal: starCountToDbValue(4) },
        { label: "★★★★★", dbVal: starCountToDbValue(5) },
      ];
      for (const item of items) {
        const menuItem = document.createElement("div");
        menuItem.className = "context-menu-item";
        menuItem.textContent = item.label;
        menuItem.addEventListener("click", () => {
          menu.remove();
          setRatingValue(el, path, item.dbVal);
        });
        menu.appendChild(menuItem);
      }

      document.body.appendChild(menu);

      const close = (ce: MouseEvent) => {
        if (!menu.contains(ce.target as Node)) {
          menu.remove();
          document.removeEventListener("click", close);
          document.removeEventListener("contextmenu", close);
        }
      };
      const onKey = (ke: KeyboardEvent) => {
        if (ke.key === "Escape") {
          menu.remove();
          document.removeEventListener("keydown", onKey);
          document.removeEventListener("click", close);
          document.removeEventListener("contextmenu", close);
        }
      };
      setTimeout(() => {
        document.addEventListener("click", close);
        document.addEventListener("contextmenu", close);
        document.addEventListener("keydown", onKey);
      }, 0);
    });
  }
  el.dataset.rating = String(rating);
  if (trackPath) el.dataset.trackPath = trackPath;
  el.innerHTML = renderRating(rating);
}

const COLUMNS = [
  { key: "_playing" as const, label: "" },
  { key: "playcount" as const, label: "Play Count" },
  { key: "trackNo" as const, label: "#" },
  { key: "title" as const, label: "Title" },
  { key: "artist" as const, label: "Artist" },
  { key: "album" as const, label: "Album" },
  { key: "albumArtist" as const, label: "Album Artist" },
  { key: "composer" as const, label: "Composer" },
  { key: "conductor" as const, label: "Conductor" },
  { key: "year" as const, label: "Year" },
  { key: "genre" as const, label: "Genre" },
  { key: "bpm" as const, label: "BPM" },
  { key: "rating" as const, label: "Rating" },
  { key: "duration" as const, label: "Duration" },
  { key: "ext" as const, label: "Ext" },
  { key: "filename" as const, label: "Path" },
];

const CSS_VARS = COLUMNS.map((c) => `--col-${c.key}`);

let resizeInitDone = false;
let columnMenuInitDone = false;
const hiddenColumns = new Set<string>();

const MENU_COLUMNS = COLUMNS.filter((c) => c.key !== "_playing");

function toggleColumn(key: string, hidden: boolean): void {
  const selector = `.col-${key}`;
  for (const el of document.querySelectorAll(selector)) {
    el.classList.toggle("col-hidden", hidden);
  }
}

export function setColumnVisibility(list: string[]): void {
  hiddenColumns.clear();
  for (const key of list) hiddenColumns.add(key);
  const table = document.getElementById("list-table")!;
  for (const col of MENU_COLUMNS) {
    toggleColumn(col.key, hiddenColumns.has(col.key));
    if (hiddenColumns.has(col.key)) {
      table.style.setProperty(`--col-${col.key}`, "0px");
    }
  }
}

async function saveColumnVisibility(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      "hidden-columns": [...hiddenColumns],
    });
  } catch { /* ignore */ }
}

export async function loadColumnVisibility(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    const hidden = data?.["hidden-columns"] as string[] | undefined;
    if (Array.isArray(hidden) && hidden.length) {
      setColumnVisibility(hidden);
    } else {
      setColumnVisibility(MENU_COLUMNS.map((c) => c.key).filter((key) => !(key in DEFAULT_COLUMN_WIDTHS)));
    }
  } catch { /* ignore */ }
}

function initColumnHeaderMenu(): void {
  if (columnMenuInitDone) return;
  columnMenuInitDone = true;

  const thead = document.querySelector("#list-table thead");
  if (!thead) return;

  (thead as HTMLElement).addEventListener("contextmenu", (e: MouseEvent) => {
    const th = (e.target as HTMLElement).closest("th");
    if (!th) return;
    e.preventDefault();
    e.stopPropagation();

    const existing = document.querySelector(".column-header-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "context-menu column-header-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";
    menu.addEventListener("contextmenu", (ce) => ce.preventDefault());

    for (const col of MENU_COLUMNS) {
      const item = document.createElement("label");
      item.className = "context-menu-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenColumns.has(col.key);
      item.appendChild(cb);
      item.appendChild(document.createTextNode(t(col.label)));
      cb.addEventListener("change", () => {
        const newHidden = !cb.checked;
        if (newHidden) hiddenColumns.add(col.key);
        else hiddenColumns.delete(col.key);
        toggleColumn(col.key, newHidden);
        const table = document.getElementById("list-table")!;
        if (newHidden) {
          table.style.setProperty(`--col-${col.key}`, "0px");
        } else {
          table.style.removeProperty(`--col-${col.key}`);
        }
        saveColumnVisibility();
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);

    const close = (ce: Event) => {
      if (ce instanceof KeyboardEvent && ce.key === "Escape") {
        menu.remove();
        document.removeEventListener("click", close);
        document.removeEventListener("contextmenu", close);
        document.removeEventListener("keydown", close);
        return;
      }
      if (!menu.contains(ce.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close);
        document.removeEventListener("contextmenu", close);
        document.removeEventListener("keydown", close);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", close);
      document.addEventListener("keydown", close);
    }, 0);
  });
}

function getColumnWidths(): number[] {
  const table = document.getElementById("list-table")!;
  const tr = table.querySelector("thead tr");
  if (!tr) return COLUMNS.map((c) => DEFAULT_COLUMN_WIDTHS[c.key] ?? 80);

  const widths: number[] = [];
  const cols = tr.children;
  for (let i = 0; i < cols.length; i++) {
    widths.push((cols[i] as HTMLElement).offsetWidth);
  }
  return widths;
}

function setColumnWidths(widths: number[]): void {
  const table = document.getElementById("list-table")!;
  const ths = table.querySelectorAll("thead th");
  for (let i = 0; i < CSS_VARS.length && i < widths.length; i++) {
    if (ths[i]?.classList.contains("col-hidden")) continue;
    table.style.setProperty(CSS_VARS[i]!, widths[i]!.toFixed(0) + "px");
  }
}

async function saveColumnWidths(): Promise<void> {
  const widths = getColumnWidths();
  const table = document.getElementById("list-table")!;
  const ths = table.querySelectorAll("thead th");
  const vals: string[] = [];
  for (let i = 0; i < CSS_VARS.length && i < widths.length; i++) {
    if (ths[i]?.classList.contains("col-hidden")) {
      vals.push("");
    } else {
      vals.push(widths[i]!.toFixed(0));
    }
  }
  try {
    await window.electronAPI.saveSettings({ "column-widths": vals });
  } catch { /* ignore */ }
}

export async function loadColumnWidths(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    const saved = data?.["column-widths"] as string[] | undefined;
    if (!saved || !Array.isArray(saved) || saved.length !== CSS_VARS.length) return;
    const table = document.getElementById("list-table")!;
    for (let i = 0; i < CSS_VARS.length; i++) {
      const val = saved[i]!;
      if (!val || val.endsWith("%")) continue;
      const num = val.endsWith("px") ? val.slice(0, -2) : val;
      table.style.setProperty(CSS_VARS[i]!, num + "px");
    }
  } catch { /* ignore */ }
}

function addResizeHandles(): void {
  if (resizeInitDone) return;
  resizeInitDone = true;

  const table = document.getElementById("list-table")!;
  const ths = table.querySelectorAll("thead th");

  ths.forEach((th, colIndex) => {
    const handle = document.createElement("div");
    handle.className = "col-resize-handle";

    handle.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidths = getColumnWidths();

      function onMove(me: MouseEvent): void {
        const dx = me.clientX - startX;
        const widths = [...startWidths];
        widths[colIndex] = Math.max(40, widths[colIndex]! + dx);
        setColumnWidths(widths);
      }

      function onUp(): void {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        handle.classList.remove("active");
        requestAnimationFrame(() => {
          document.body.classList.remove("dragging");
        });
        saveColumnWidths();
      }

      handle.classList.add("active");
      document.body.classList.add("dragging");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    th.appendChild(handle);
  });
}

/* ── Virtual Scrolling Engine ─────────────────────────────── */

let allItems: ListItem[] = [];
let rowEls: HTMLTableRowElement[] = [];
let cellEls: HTMLTableCellElement[][] = [];
let firstIdx = 0;
let selPaths = new Set<string>();
let anchorRow = 0;

let onSelectCb: ((item: ListItem, idx: number) => void) | null = null;
let onDblClickCb: ((item: ListItem, idx: number) => void) | null = null;

let tbody: HTMLElement | null = null;
let viewport: HTMLElement | null = null;
let scrollbarEl: HTMLDivElement | null = null;
let scrollTrack: HTMLDivElement | null = null;
let scrollThumbEl: HTMLDivElement | null = null;

let rowHeight = 0;
let visibleCount = 0;
const OVERSCAN = 5;
let isDraggingThumb = false;
let dragStartY = 0;
let dragStartTop = 0;

/* ── Row Factory ────────────────────────────────────────── */

function createRowCells(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  for (const col of COLUMNS) {
    const td = document.createElement("td");
    td.className = `col-${col.key}`;
    if (col.key === "_playing") {
      td.className += " col-playing";
      td.title = t("Currently playing");
    }
    if (col.key === "rating") {
      td.className += " col-rating";
      setupRatingHover(td, 0);
    }
    tr.appendChild(td);
  }
  return Array.from(tr.children) as HTMLTableCellElement[];
}

document.addEventListener("language-changed", () => {
  const title = t("Currently playing");
  for (const cells of cellEls) {
    const td = cells[0];
    if (td) td.title = title;
  }
});

function buildRows(): void {
  if (!tbody) return;
  rowEls = [];
  cellEls = [];
  tbody.innerHTML = "";

  for (let i = 0; i < visibleCount; i++) {
    const tr = document.createElement("tr");
    tr.draggable = true;
    tr.dataset.vrow = String(i);
    const cells = createRowCells(tr);
    rowEls.push(tr);
    cellEls.push(cells);
    tbody.appendChild(tr);
  }
}

let afterRenderCb: (() => void) | null = null;

/* ── Populate visible window ──────────────────────────────── */

function populate(): void {
  const total = allItems.length;
  for (let i = 0; i < rowEls.length; i++) {
    const di = firstIdx + i;
    const tr = rowEls[i]!;
    const cells = cellEls[i]!;

    if (di >= total) {
      tr.style.display = "none";
      continue;
    }
    tr.style.display = "";
    const item = allItems[di]!;
    tr.dataset.id = `tr-${di}`;
    tr.dataset.path = item.trackPath;
    tr.classList.toggle("selected", selPaths.has(item.trackPath));
    tr.classList.toggle("row-even", di % 2 === 0);
    tr.classList.toggle("row-odd", di % 2 !== 0);

    for (let j = 0; j < COLUMNS.length; j++) {
      const col = COLUMNS[j]!;
      const td = cells[j]!;
      const key = col.key;

      if (key === "_playing") {
        td.textContent = "";
      } else if (hiddenColumns.has(key)) {
        td.textContent = "";
      } else if (key === "rating") {
        td.dataset.rating = String(item.rating);
        td.dataset.trackPath = item.trackPath;
        td.innerHTML = renderRating(item.rating);
      } else if (key === "duration") {
        td.textContent = formatTime(item.duration);
      } else if (key === "playcount") {
        td.textContent = item.playcount ? String(item.playcount) : "";
      } else if (key === "bpm") {
        td.textContent = item.bpm ? String(item.bpm) : "";
      } else if (key === "title") {
        td.textContent = item.title || (item.filename || item.path).split("/").pop()!.replace(/\.[^.]+$/, "");
      } else {
        td.textContent = item[key] as string;
      }
    }
  }
  if (total > 0 && total - firstIdx < rowEls.length) {
    const last = total > 0 ? total - 1 : 0;
    for (let i = last - firstIdx + 1; i < rowEls.length; i++) {
      if (rowEls[i]) rowEls[i]!.style.display = "none";
    }
  }
  afterRenderCb?.();
}

/* ── Scrollbar ────────────────────────────────────────────── */

function getTotalHeight(): number {
  return allItems.length * rowHeight;
}

function getViewportHeight(): number {
  return viewport ? viewport.clientHeight : rowEls.length * rowHeight;
}

function getMaxFirstIdx(): number {
  if (!viewport || rowHeight <= 0) return 0;
  const table = document.getElementById("list-table");
  if (!table) return Math.max(0, allItems.length - rowEls.length);
  const sbH = table.offsetHeight - table.clientHeight;
  const headerH = table.querySelector("thead")?.offsetHeight ?? 0;
  const effectiveHeight = viewport.clientHeight - Math.max(0, sbH) - headerH;
  const visibleRows = Math.max(1, Math.floor(effectiveHeight / rowHeight));
  return Math.max(0, allItems.length - visibleRows);
}

function updateScrollbar(): void {
  if (!scrollThumbEl || !scrollTrack || !scrollbarEl) return;
  const total = allItems.length;
  if (total <= rowEls.length) {
    scrollbarEl.style.display = "none";
    return;
  }
  scrollbarEl.style.display = "";
  const trackH = scrollTrack.clientHeight;
  const thumbH = Math.max(30, trackH * (rowEls.length / total));
  const maxIdx = getMaxFirstIdx();
  const thumbPos = maxIdx > 0 ? (firstIdx / maxIdx) * (trackH - thumbH) : 0;
  scrollThumbEl.style.height = thumbH + "px";
  scrollThumbEl.style.top = thumbPos + "px";
}

function scrollToIndex(idx: number): void {
  const maxIdx = getMaxFirstIdx();
  firstIdx = Math.max(0, Math.min(maxIdx, idx));
  populate();
  updateScrollbar();
}

/* ── Event delegation on tbody ─────────────────────────────── */

function setupDelegation(): void {
  if (!tbody) return;

  tbody.addEventListener("click", (e: MouseEvent) => {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr");
    if (!tr) return;
    const vrow = parseInt(tr.dataset.vrow ?? "", 10);
    const di = firstIdx + vrow;
    if (isNaN(di) || di >= allItems.length) return;
    const item = allItems[di]!;

    if (e.ctrlKey || e.metaKey) {
      const isNow = tr.classList.toggle("selected");
      if (isNow) selPaths.add(item.trackPath);
      else selPaths.delete(item.trackPath);
      anchorRow = di;
      onSelectCb?.(item, di);
    } else if (e.shiftKey) {
      const lo = Math.min(anchorRow, di);
      const hi = Math.max(anchorRow, di);
      selPaths.clear();
      for (let i = lo; i <= hi && i < allItems.length; i++) {
        selPaths.add(allItems[i]!.trackPath);
      }
      for (let i = 0; i < rowEls.length; i++) {
        const r = rowEls[i]!;
        const realIdx = firstIdx + i;
        r.classList.toggle("selected", realIdx >= lo && realIdx <= hi && realIdx < allItems.length);
      }
      onSelectCb?.(item, di);
    } else {
      selPaths.clear();
      selPaths.add(item.trackPath);
      for (const r of rowEls) r.classList.remove("selected");
      tr.classList.add("selected");
      anchorRow = di;
      onSelectCb?.(item, di);
    }
    tbody!.focus();
  });

  tbody.addEventListener("dblclick", (e: MouseEvent) => {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr");
    if (!tr) return;
    const vrow = parseInt(tr.dataset.vrow ?? "", 10);
    const di = firstIdx + vrow;
    if (isNaN(di) || di >= allItems.length) return;
    onDblClickCb?.(allItems[di]!, di);
  });

  tbody.addEventListener("dragstart", (e: DragEvent) => {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr");
    if (!tr) return;
    const vrow = parseInt(tr.dataset.vrow ?? "", 10);
    const di = firstIdx + vrow;
    if (isNaN(di) || di >= allItems.length) return;
    const draggedItem = allItems[di]!;

    let allTracks: Array<{ path: string; title: string; artist: string; duration: string }> = [];
    /* Drag exactly what the mouse grabbed. The current selection only rides
       along when it actually contains the grabbed row (multi-row drag);
       a stale selection from before must NEVER hijack the drag. */
    if (selPaths.has(draggedItem.trackPath)) {
      for (const item of allItems) {
        if (!selPaths.has(item.trackPath)) continue;
        allTracks.push({ path: item.trackPath, title: item.title, artist: item.artist, duration: item.duration });
      }
    } else {
      allTracks.push({ path: draggedItem.trackPath, title: draggedItem.title, artist: draggedItem.artist, duration: draggedItem.duration });
    }
    e.dataTransfer!.setData("application/x-musicpenguin-track", JSON.stringify(allTracks));
  });

  /* ── Context menu on rows ────────────────────────────── */
  let contextMenuEl: HTMLElement | null = null;
  function closeContextMenu(): void {
    if (contextMenuEl) {
      contextMenuEl.remove();
      contextMenuEl = null;
    }
  }

  const listTable = tbody.closest<HTMLElement>("#list-table") || document.querySelector<HTMLElement>("#list-table");
  const contextTarget = listTable || tbody;
  contextTarget.addEventListener("contextmenu", (e) => {
    const targetRow = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr");
    e.preventDefault();
    closeContextMenu();

    const clickedPath = targetRow?.dataset.path || null;

    const selected = tbody!.querySelectorAll("tr.selected");
    const targetIsSelected = targetRow?.classList.contains("selected") ?? false;
    const paths: string[] = clickedPath && targetIsSelected && selected.length > 1
      ? Array.from(selected).map((tr) => (tr as HTMLElement).dataset.path).filter(Boolean) as string[]
      : clickedPath ? [clickedPath] : [];

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top = e.clientY + "px";

    if (clickedPath) {
      /* DLNA rows are stream URLs without a physical file to reveal;
         in a mixed selection fall back to the first local file. */
      const firstLocalPath = paths.find((p) => !/^https?:\/\//i.test(p));
      if (firstLocalPath) {
        const showItem = document.createElement("div");
        showItem.className = "context-menu-item";
        showItem.textContent = t("Show in Folder");
        showItem.addEventListener("click", async () => {
          closeContextMenu();
          await window.electronAPI.showInExternalFileExplorer(firstLocalPath, false);
        });
        menu.appendChild(showItem);
      }

      const vlcItem = document.createElement("div");
      vlcItem.className = "context-menu-item";
      vlcItem.textContent = t("Play in $1", getExternalPlayerDisplayName());
      vlcItem.addEventListener("click", async () => {
        closeContextMenu();
        selPaths.clear();
        for (const p of paths) selPaths.add(p);
        populate();
        audio.pause();
        const opened = await window.electronAPI.openInExternalPlayer(paths, getExternalPlayer());
        if (opened) noteExternalPlays(paths);
      });
      menu.appendChild(vlcItem);

      const copyItem = document.createElement("div");
      copyItem.className = "context-menu-item";
      copyItem.textContent = t("Copy Path");
      copyItem.addEventListener("click", async () => {
        closeContextMenu();
        try {
          await navigator.clipboard.writeText(paths.join("\n"));
        } catch { /* clipboard not available */ }
      });
      menu.appendChild(copyItem);

      const rescanItem = document.createElement("div");
      rescanItem.className = "context-menu-item";
      rescanItem.textContent = t("Rescan Tags");
      rescanItem.addEventListener("click", async () => {
        closeContextMenu();
        await window.electronAPI.rescanFiles(paths);
      });
      menu.appendChild(rescanItem);

      const sep1 = document.createElement("hr");
      sep1.className = "playlist-sort-sep";
      menu.appendChild(sep1);

      let hasGotoItems = false;

      if (onGotoAlbumCb && clickedPath) {
        const clickedItem = allItems.find((it) => it.trackPath === clickedPath);
        if (clickedItem?.album) {
          hasGotoItems = true;
          const gotoAlbumItem = document.createElement("div");
          gotoAlbumItem.className = "context-menu-item";
          gotoAlbumItem.textContent = t("Goto Album");
          gotoAlbumItem.addEventListener("click", () => {
            closeContextMenu();
            if (clickedItem) onGotoAlbumCb!(clickedItem);
          });
          menu.appendChild(gotoAlbumItem);
        }
      }

      if (onGotoFolderCb && firstLocalPath) {
        hasGotoItems = true;
        const gotoFolderItem = document.createElement("div");
        gotoFolderItem.className = "context-menu-item";
        gotoFolderItem.textContent = t("Goto Folder");
        gotoFolderItem.addEventListener("click", () => {
          closeContextMenu();
          const item = allItems.find((it) => it.trackPath === firstLocalPath);
          if (item) onGotoFolderCb!(item);
        });
        menu.appendChild(gotoFolderItem);
      }

      if (onGotoArtistCb && clickedPath) {
        const clickedItem = allItems.find((it) => it.trackPath === clickedPath);
        if (clickedItem?.artist) {
          hasGotoItems = true;
          const gotoArtistItem = document.createElement("div");
          gotoArtistItem.className = "context-menu-item";
          gotoArtistItem.textContent = t("Goto Artist");
          gotoArtistItem.addEventListener("click", () => {
            closeContextMenu();
            if (clickedItem) onGotoArtistCb!(clickedItem);
          });
          menu.appendChild(gotoArtistItem);
        }
      }

      if (onGotoComposerCb && clickedPath) {
        const clickedItem = allItems.find((it) => it.trackPath === clickedPath);
        if (clickedItem?.composer) {
          hasGotoItems = true;
          const gotoComposerItem = document.createElement("div");
          gotoComposerItem.className = "context-menu-item";
          gotoComposerItem.textContent = t("Goto Composer");
          gotoComposerItem.addEventListener("click", () => {
            closeContextMenu();
            if (clickedItem) onGotoComposerCb!(clickedItem);
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

    if (onSortCb) {
      const heading = document.createElement("div");
      heading.className = "playlist-sort-heading";
      heading.textContent = t("Sort by:");
      menu.appendChild(heading);

      for (const mode of SORTING_MODES) {
        if (mode.id !== ARTIST_ALBUM_TRACKNO) continue;
        const item = document.createElement("div");
        item.className = "context-menu-item playlist-sort-item"
          + (activeSortingMode === mode.id ? " active" : "");

        const label = document.createElement("span");
        label.className = "playlist-sort-label";
        label.textContent = t(mode.name);
        item.appendChild(label);

        item.addEventListener("click", () => {
          closeContextMenu();
          activeSortingMode = mode.id;
          listSortColumn = "";
          listSortDirection = "asc";
          onSortingModeCb!(mode.id);
        });
        menu.appendChild(item);
      }

      for (const col of MENU_COLUMNS) {
        const sortKey = menuKeyToSortKey(col.key);
        const item = document.createElement("div");
        item.className = "context-menu-item playlist-sort-item";

        const label = document.createElement("span");
        label.className = "playlist-sort-label";
        label.textContent = t(col.label);
        item.appendChild(label);

        const ascBtn = document.createElement("button");
        ascBtn.className = "playlist-sort-btn" + (listSortColumn === sortKey && listSortDirection === "asc" ? " active" : "");
        ascBtn.textContent = "▲";
        ascBtn.title = t("Sort ascending");
        ascBtn.addEventListener("click", () => {
          closeContextMenu();
          activeSortingMode = null;
          listSortColumn = sortKey;
          listSortDirection = "asc";
          onSortCb!(sortKey, "asc");
        });
        item.appendChild(ascBtn);

        const descBtn = document.createElement("button");
        descBtn.className = "playlist-sort-btn" + (listSortColumn === sortKey && listSortDirection === "desc" ? " active" : "");
        descBtn.textContent = "▼";
        descBtn.title = t("Sort descending");
        descBtn.addEventListener("click", () => {
          closeContextMenu();
          activeSortingMode = null;
          listSortColumn = sortKey;
          listSortDirection = "desc";
          onSortCb!(sortKey, "desc");
        });
        item.appendChild(descBtn);

        menu.appendChild(item);
      }
    }

    menu.addEventListener("contextmenu", (ce) => ce.preventDefault());
    document.body.appendChild(menu);
    contextMenuEl = menu;
    e.stopPropagation();
  });

  document.addEventListener("click", closeContextMenu);
  document.addEventListener("contextmenu", (e) => {
    if (contextMenuEl && !contextMenuEl.contains(e.target as Node)) {
      closeContextMenu();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeContextMenu();
  });

  /* ── Keyboard nav ────────────────────────────────────── */
  tbody.tabIndex = 0;
  tbody.addEventListener("keydown", (e) => {
    if (rowEls.length === 0 || allItems.length === 0) return;

    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      selPaths.clear();
      for (let i = 0; i < allItems.length; i++) selPaths.add(allItems[i]!.trackPath);
      for (let r = 0; r < rowEls.length; r++) {
        const realIdx = firstIdx + r;
        rowEls[r]!.classList.toggle("selected", realIdx < allItems.length);
      }
      anchorRow = allItems.length - 1;
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const sel = tbody!.querySelector("tr.selected") as HTMLElement | null;
      if (!sel) {
        rowEls[0]!.classList.add("selected");
        anchorRow = 0;
        const di = firstIdx + 0;
        onSelectCb?.(allItems[di]!, di);
        onDblClickCb?.(allItems[di]!, di);
      } else {
        const vrow = parseInt(sel.dataset.vrow ?? "", 10);
        const di = firstIdx + vrow;
        if (!isNaN(di) && di < allItems.length) {
          onDblClickCb?.(allItems[di]!, di);
        }
      }
      return;
    }

    if (e.key === "Delete") {
      if (selPaths.size === 0) return;
      const paths = Array.from(selPaths);
      showDeleteDialog(paths);
      return;
    }

    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();

    const sel = tbody!.querySelectorAll("tr.selected");
    if (sel.length === 0) {
      const di = firstIdx + 0;
      if (di >= allItems.length) return;
      rowEls[0]!.classList.add("selected");
      selPaths.clear();
      selPaths.add(allItems[di]!.trackPath);
      anchorRow = di;
      onSelectCb?.(allItems[di]!, di);
      return;
    }

    if (e.shiftKey) {
      const step = e.key === "ArrowUp" ? -1 : 1;
      const curSel = tbody!.querySelector("tr.selected") as HTMLElement | null;
      if (!curSel) return;
      const curV = parseInt(curSel.dataset.vrow ?? "", 10);
      if (isNaN(curV)) return;
      let nextV = Math.max(0, Math.min(rowEls.length - 1, curV + step));
      const cursorGlobal = firstIdx + nextV;
      if (cursorGlobal >= allItems.length) return;
      const lo = Math.min(anchorRow, cursorGlobal);
      const hi = Math.max(anchorRow, cursorGlobal);
      selPaths.clear();
      for (let i = lo; i <= hi; i++) selPaths.add(allItems[i]!.trackPath);
      for (let r = 0; r < rowEls.length; r++) {
        const realIdx = firstIdx + r;
        rowEls[r]!.classList.toggle("selected", realIdx >= lo && realIdx <= hi && realIdx < allItems.length);
      }
      onSelectCb?.(allItems[cursorGlobal]!, cursorGlobal);
      return;
    }

    // collapse multi-selection
    if (sel.length > 1) {
      sel.forEach((r) => r.classList.remove("selected"));
      sel[0]!.classList.add("selected");
      anchorRow = firstIdx + parseInt((sel[0] as HTMLElement).dataset.vrow ?? "0", 10);
      selPaths.clear();
      selPaths.add(allItems[anchorRow]!.trackPath);
    }
    const current = tbody!.querySelector("tr.selected") as HTMLElement | null;
    if (!current) return;
    const curV = parseInt(current.dataset.vrow ?? "", 10);

    const canSelect = (vrow: number) => firstIdx + vrow < allItems.length;

    if (e.key === "ArrowUp") {
      if (curV > 0 && canSelect(curV - 1)) {
        current.classList.remove("selected");
        rowEls[curV - 1]!.classList.add("selected");
        anchorRow = firstIdx + curV - 1;
        selPaths.clear();
        selPaths.add(allItems[anchorRow]!.trackPath);
        onSelectCb?.(allItems[anchorRow]!, anchorRow);
      } else if (firstIdx > 0) {
        scrollToIndex(firstIdx - 1);
        rowEls[0]!.classList.add("selected");
        anchorRow = firstIdx;
        selPaths.clear();
        selPaths.add(allItems[anchorRow]!.trackPath);
        onSelectCb?.(allItems[anchorRow]!, anchorRow);
      }
    } else if (e.key === "ArrowDown") {
      if (curV < rowEls.length - 1 && canSelect(curV + 1)) {
        current.classList.remove("selected");
        rowEls[curV + 1]!.classList.add("selected");
        anchorRow = firstIdx + curV + 1;
        selPaths.clear();
        selPaths.add(allItems[anchorRow]!.trackPath);
        onSelectCb?.(allItems[anchorRow]!, anchorRow);
      } else if (firstIdx + rowEls.length < allItems.length) {
        scrollToIndex(firstIdx + 1);
        const lastV = rowEls.length - 1;
        rowEls[lastV]!.classList.add("selected");
        anchorRow = firstIdx + lastV;
        selPaths.clear();
        selPaths.add(allItems[anchorRow]!.trackPath);
        onSelectCb?.(allItems[anchorRow]!, anchorRow);
      }
    }
  });
}

/* ── Scrollbar events ──────────────────────────────────────── */

function setupScrollbarEvents(): void {
  if (!scrollTrack || !scrollThumbEl || !scrollbarEl) return;

  /* Thumb drag */
  scrollThumbEl.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingThumb = true;
    dragStartY = e.clientY;
    dragStartTop = parseFloat(scrollThumbEl!.style.top) || 0;
    document.body.classList.add("dragging");
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDraggingThumb || !scrollTrack || !scrollThumbEl) return;
    const trackH = scrollTrack.clientHeight;
    const thumbH = scrollThumbEl.clientHeight;
    const dy = e.clientY - dragStartY;
    const total = allItems.length;
    const maxIdx = getMaxFirstIdx();
    const maxTop = trackH - thumbH;
    const pct = maxTop > 0 ? Math.max(0, Math.min(1, (dragStartTop + dy) / maxTop)) : 0;
    const newIdx = Math.round(pct * maxIdx);
    scrollToIndex(newIdx);
  });

  document.addEventListener("mouseup", () => {
    if (isDraggingThumb) {
      isDraggingThumb = false;
      document.body.classList.remove("dragging");
    }
  });

  /* Track click (page up/down) */
  scrollTrack.addEventListener("click", (e: MouseEvent) => {
    if (!scrollThumbEl || !scrollTrack) return;
    if (e.target === scrollThumbEl) return;
    const rect = scrollTrack.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const thumbRect = scrollThumbEl.getBoundingClientRect();
    const thumbTop = thumbRect.top - rect.top;
    const page = visibleCount;
    if (y < thumbTop) {
      scrollToIndex(firstIdx - page);
    } else {
      scrollToIndex(firstIdx + page);
    }
  });

  /* Mouse wheel on viewport */
  if (viewport) {
    viewport.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const speed = e.deltaMode === 1 ? 3 : 1;
      const step = Math.max(1, Math.round(Math.abs(e.deltaY) / rowHeight) * speed);
      scrollToIndex(firstIdx + dir * step);
    }, { passive: false });
  }
}

/* ── Measure row height ─────────────────────────────────────── */

function measureRowHeight(): number {
  const tempTr = document.createElement("tr");
  tempTr.style.visibility = "hidden";
  tempTr.style.position = "absolute";
  const td = document.createElement("td");
  td.textContent = "Hg";
  tempTr.appendChild(td);
  tbody?.appendChild(tempTr);
  const h = tempTr.offsetHeight;
  tempTr.remove();
  return h || 32;
}

/* ── Sync scrollbar spacer with thead height ────────────────── */

function syncScrollSpacer(): void {
  const spacer = document.getElementById("list-scroll-spacer");
  const thead = document.querySelector<HTMLElement>("#list-table thead");
  if (spacer && thead) {
    spacer.style.height = thead.offsetHeight + "px";
  }
}

/* ── Recalc on resize / splitter ────────────────────────────── */

function recalc(): void {
  if (!viewport || !tbody) return;
  const panelH = viewport.clientHeight || 400;
  const newCount = Math.max(1, Math.ceil(panelH / rowHeight)) + OVERSCAN;
  if (newCount !== visibleCount) {
    visibleCount = newCount;
    buildRows();
  }
  firstIdx = Math.min(firstIdx, getMaxFirstIdx());
  anchorRow = Math.min(anchorRow, Math.max(0, allItems.length - 1));
  populate();
  updateScrollbar();
  syncScrollSpacer();
}

/* ── Delete dialog ────────────────────────────────────────── */

let onDeleteCb: ((paths: string[]) => void) | null = null;

export function setOnDeletedFiles(cb: (paths: string[]) => void): void {
  onDeleteCb = cb;
}

function showDeleteDialog(paths: string[]): void {
  const existing = document.querySelector(".delete-dialog-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "delete-dialog-overlay";

  const box = document.createElement("div");
  box.className = "delete-dialog-box";

  const warning = document.createElement("div");
  warning.className = "delete-dialog-warning";
  warning.textContent = "⚠️";

  const question = document.createElement("div");
  question.className = "delete-dialog-question";
  question.textContent = paths.length === 1
    ? t("Where do you want to delete this file?")
    : t("Where do you want to delete these $1 files?", paths.length);

  const btnRow = document.createElement("div");
  btnRow.className = "delete-dialog-buttons";

  const dbBtn = document.createElement("button");
  dbBtn.className = "delete-dialog-btn";
  dbBtn.textContent = t("From Library");
  dbBtn.addEventListener("click", async () => {
    close();
    await window.electronAPI.deleteFiles(paths);
    onDeleteCb?.(paths);
  });

  const diskBtn = document.createElement("button");
  diskBtn.className = "delete-dialog-btn delete-dialog-btn-danger";
  diskBtn.textContent = t("In File System");
  diskBtn.addEventListener("click", async () => {
    close();
    await window.electronAPI.deleteFilesFromDisk(paths);
    onDeleteCb?.(paths);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "delete-dialog-btn";
  cancelBtn.textContent = t("Cancel");
  cancelBtn.addEventListener("click", () => close());

  btnRow.appendChild(dbBtn);
  btnRow.appendChild(diskBtn);
  btnRow.appendChild(cancelBtn);
  box.appendChild(warning);
  box.appendChild(question);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape" && overlay.parentElement) close();
  };
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onEsc);
  }
  document.addEventListener("keydown", onEsc);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

/* ── Public API ─────────────────────────────────────────────── */

export interface VirtualListController {
  updateData(items: ListItem[], selected?: Set<string>): void;
  getScrollOffset(): number;
  setScrollOffset(offset: number): void;
  refreshRow(path: string): void;
  setAfterRender(cb: () => void): void;
  setSortState(column: string, direction: "asc" | "desc"): void;
  setSortingMode(id: string | null): void;
  selectAndScrollTo(path: string): ListItem | null;
  hasSelection(): boolean;
  captureSelectionAnchor(): { path: string; offset: number } | null;
  restoreSelectionAnchor(anchor: { path: string; offset: number }): void;
}

export function initVirtualList(
  container: HTMLElement,
  onSelect: (item: ListItem, idx: number) => void,
  onDblClick?: (item: ListItem, idx: number) => void,
  onSort?: (column: string, direction: "asc" | "desc") => void,
  onSortingMode?: (id: string) => void,
  onGotoAlbum?: (item: ListItem) => void,
  onGotoFolder?: (item: ListItem) => void,
  onGotoArtist?: (item: ListItem) => void,
  onGotoComposer?: (item: ListItem) => void,
): VirtualListController {
  tbody = container;
  onSelectCb = onSelect;
  onDblClickCb = onDblClick ?? null;
  onSortCb = onSort ?? null;
  onSortingModeCb = onSortingMode ?? null;
  onGotoAlbumCb = onGotoAlbum ?? null;
  onGotoFolderCb = onGotoFolder ?? null;
  onGotoArtistCb = onGotoArtist ?? null;
  onGotoComposerCb = onGotoComposer ?? null;

  const table = container.closest("table") || container.parentElement;
  const panel = container.closest("#list-panel") || table?.closest("#list-panel");

  if (!panel) throw new Error("list-view: #list-panel not found");

  viewport = panel.querySelector<HTMLElement>("#list-viewport");
  if (!viewport) {
    viewport = document.createElement("div");
    viewport.id = "list-viewport";
    const tableEl = panel.querySelector("#list-table")!;
    panel.insertBefore(viewport, tableEl);
    viewport.appendChild(tableEl);
  }

  scrollbarEl = panel.querySelector<HTMLDivElement>("#list-scrollbar");
  if (!scrollbarEl) {
    scrollbarEl = document.createElement("div");
    scrollbarEl.id = "list-scrollbar";
    const scrollSpacer = document.createElement("div");
    scrollSpacer.id = "list-scroll-spacer";
    scrollbarEl.appendChild(scrollSpacer);
    scrollTrack = document.createElement("div");
    scrollTrack.id = "list-scroll-track";
    scrollThumbEl = document.createElement("div");
    scrollThumbEl.id = "list-scroll-thumb";
    scrollTrack.appendChild(scrollThumbEl);
    scrollbarEl.appendChild(scrollTrack);
    viewport.appendChild(scrollbarEl);
  } else {
    scrollTrack = scrollbarEl.querySelector("#list-scroll-track");
    scrollThumbEl = scrollbarEl.querySelector("#list-scroll-thumb");
  }

  addResizeHandles();
  initColumnHeaderMenu();

  rowHeight = measureRowHeight();
  visibleCount = Math.max(1, Math.ceil((viewport.clientHeight || 400) / rowHeight)) + OVERSCAN;
  buildRows();
  setupDelegation();
  setupScrollbarEvents();
  syncScrollSpacer();

  const resizeObserver = new ResizeObserver(() => recalc());
  resizeObserver.observe(viewport);
  window.addEventListener("resize", () => recalc());

  return {
    updateData(items: ListItem[], selected?: Set<string>) {
      allItems = items;
      selPaths = selected ?? new Set();
      recalc();
    },

    getScrollOffset(): number {
      return firstIdx;
    },

    setScrollOffset(offset: number): void {
      scrollToIndex(offset);
    },

    refreshRow(path: string): void {
      const idx = allItems.findIndex((it) => it.trackPath === path);
      if (idx === -1) return;
      const vrow = idx - firstIdx;
      if (vrow < 0 || vrow >= rowEls.length) return;
      const tr = rowEls[vrow]!;
      const cells = cellEls[vrow]!;
      const item = allItems[idx]!;
      tr.dataset.path = item.trackPath;
      tr.classList.toggle("selected", selPaths.has(item.trackPath));
      tr.classList.toggle("row-even", idx % 2 === 0);
      tr.classList.toggle("row-odd", idx % 2 !== 0);
      for (let j = 0; j < COLUMNS.length; j++) {
        const col = COLUMNS[j]!;
        const td = cells[j]!;
        const key = col.key;
        if (key === "_playing") {
          td.textContent = "";
        } else if (hiddenColumns.has(key)) {
          td.textContent = "";
        } else if (key === "bpm") {
          td.textContent = item.bpm ? String(item.bpm) : "";
        } else if (key === "rating") {
          td.dataset.rating = String(item.rating);
          td.dataset.trackPath = item.trackPath;
          td.innerHTML = renderRating(item.rating);
        } else if (key === "duration") {
          td.textContent = formatTime(item.duration);
        } else if (key === "playcount") {
          td.textContent = item.playcount ? String(item.playcount) : "";
        } else {
          td.textContent = item[key] as string;
        }
      }
      afterRenderCb?.();
    },

    setAfterRender(cb: () => void): void {
      afterRenderCb = cb;
    },

    setSortState(column: string, direction: "asc" | "desc"): void {
      listSortColumn = column;
      listSortDirection = direction;
      activeSortingMode = null;
    },

    setSortingMode(id: string | null): void {
      activeSortingMode = id;
      if (id) {
        listSortColumn = "";
        listSortDirection = "asc";
      }
    },

    selectAndScrollTo(path: string): ListItem | null {
      const idx = allItems.findIndex((it) => it.trackPath === path);
      if (idx === -1) return null;
      selPaths.clear();
      selPaths.add(path);
      const vrow = idx - firstIdx;
      if (vrow < 0 || vrow >= rowEls.length) {
        scrollToIndex(idx);
      } else {
        populate();
        updateScrollbar();
      }
      return allItems[idx]!;
    },

    hasSelection(): boolean {
      return selPaths.size > 0;
    },

    /* Viewport anchor of the topmost selected row: its path plus the
       row offset from the window start. Captured BEFORE a re-sort so
       the row can be placed back at the same vertical position after
       the new order is in effect. */
    captureSelectionAnchor(): { path: string; offset: number } | null {
      if (selPaths.size === 0) return null;
      for (let i = 0; i < allItems.length; i++) {
        const it = allItems[i]!;
        if (selPaths.has(it.trackPath)) {
          return { path: it.trackPath, offset: i - firstIdx };
        }
      }
      return null;
    },

    /* Scrolls (never repopulates order) so the anchored path sits at
       the viewport offset it had before the sort, clamped to the valid
       scroll range. A no-op if the path left the list. */
    restoreSelectionAnchor(anchor: { path: string; offset: number }): void {
      const idx = allItems.findIndex((it) => it.trackPath === anchor.path);
      if (idx === -1) return;
      scrollToIndex(idx - anchor.offset);
    },
  };
}

/* ── Legacy export (deprecated but kept for compat of loading) ── */
export function renderList(
  _container: HTMLElement,
  _items: ListItem[],
  _onSelect: (item: ListItem, index: number) => void,
  _onDblClick?: (item: ListItem, index: number) => void,
  _selectedPaths?: Set<string>,
): void {
  console.warn("renderList is deprecated, use initVirtualList + updateData");
}
