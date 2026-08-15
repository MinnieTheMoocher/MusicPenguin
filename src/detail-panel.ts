import { ListItem } from "./types.js";
import { setupRatingHover, renderRating } from "./list-view.js";
import { showTheaterMode } from "./theatermode.js";
import { t } from "./i18n/index.js";

const pathInput = document.getElementById("field-path") as HTMLInputElement;
const titleInput = document.getElementById("field-title") as HTMLInputElement;
const artistInput = document.getElementById("field-artist") as HTMLInputElement;
const albumInput = document.getElementById("field-album") as HTMLInputElement;
const trackNoInput = document.getElementById("field-track-no") as HTMLInputElement;
const discNoInput = document.getElementById("field-disc-no") as HTMLInputElement;
const albumArtistInput = document.getElementById("field-album-artist") as HTMLInputElement;
const genreInput = document.getElementById("field-genre") as HTMLInputElement;
const yearInput = document.getElementById("field-year") as HTMLInputElement;
const composerInput = document.getElementById("field-composer") as HTMLInputElement;
const conductorInput = document.getElementById("field-conductor") as HTMLInputElement;
const bpmInput = document.getElementById("field-bpm") as HTMLInputElement;
const ratingEl = document.getElementById("field-rating") as HTMLSpanElement;
const commentInput = document.getElementById("field-comment") as HTMLTextAreaElement;
const coverImg = document.getElementById("cover-image") as HTMLImageElement;
const coverPlaceholder = document.getElementById("cover-placeholder") as HTMLElement;
const coverArea = document.getElementById("cover-area") as HTMLElement;
const searchBtnContainer = document.getElementById("search-btn-container")!;

let currentCoverPath: string | null = null;
let currentTrackPath: string | null = null;
let currentArtist = "";
let currentTitle = "";
let currentComposer = "";
let currentConductor = "";

function searchLabelFromUrl(url: string): string {
  try {
    const hostname = new URL(url.replace(/\$\{.*?\}/g, "x")).hostname;
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      const domain = parts[parts.length - 2]!;
      const label = domain.length <= 3 ? domain.toUpperCase() : domain.charAt(0).toUpperCase() + domain.slice(1);
      return t("Search on $1", label);
    }
  } catch { /* fall through */ }
  return t("Search");
}

import { DEFAULT_SEARCH_URLS } from "./config.js";

const SEARCH_REPLACEMENTS: [RegExp, string][] = [
  [/ - /g, " "],
];

function cleanSearchTerm(s: string): string {
  for (const [pattern, replacement] of SEARCH_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

function interpolateUrl(template: string): string {
  const searchArtist = currentArtist || currentComposer || currentConductor;
  return template
    .replace(/\$\{artist\}/g, encodeURIComponent(cleanSearchTerm(searchArtist)))
    .replace(/\$\{title\}/g, encodeURIComponent(cleanSearchTerm(currentTitle)));
}

function buildSearchButtons(urls: string[]): void {
  searchBtnContainer.innerHTML = "";
  for (const url of urls.slice(0, 5)) {
    const btn = document.createElement("button");
    btn.className = "search-btn";
    btn.textContent = searchLabelFromUrl(url);
    btn.title = url;
    btn.addEventListener("click", () => {
      window.electronAPI.openExternal(interpolateUrl(url));
    });
    searchBtnContainer.appendChild(btn);
  }
}

(async () => {
  const data = await window.electronAPI.loadSettings();
  const urls = data?.["search-urls"] ?? DEFAULT_SEARCH_URLS;
  buildSearchButtons(urls);
})();

pathInput.addEventListener("change", async () => {
  const oldPath = currentTrackPath;
  if (!oldPath) return;
  const newPath = pathInput.value.trim();
  if (!newPath || newPath === oldPath) return;

  const result = await window.electronAPI.moveFile(oldPath, newPath);
  if (!result.ok) {
    pathInput.value = oldPath;
    alert(t("Failed to move file:\n$1", result.error ?? ""));
    return;
  }

  document.dispatchEvent(new CustomEvent("file-path-changed", {
    detail: { oldPath, newPath: result.newPath, newFilename: result.newFilename },
  }));
});

function updateSearchButtons(): void {
  searchBtnContainer.style.display = currentArtist || currentTitle || currentComposer || currentConductor ? "flex" : "none";
}

async function loadCover(path: string): Promise<void> {
  currentCoverPath = path;
  const dataUrl = await window.electronAPI.getCoverArt(path);
  if (currentCoverPath !== path) return; // stale response
  if (dataUrl) {
    coverImg.src = dataUrl;
    coverImg.dataset.coverUrl = dataUrl;
    coverPlaceholder.style.display = "none";
  } else {
    coverImg.removeAttribute("src");
    delete coverImg.dataset.coverUrl;
    coverPlaceholder.style.display = "";
  }
  updateSearchButtons();
}

function updateCoverTitle(): void {
  coverArea.title = t("Cover") + " " + t("(click for theater mode)");
}
updateCoverTitle();
document.addEventListener("language-changed", updateCoverTitle);

coverArea.addEventListener("click", () => {
  if (!currentCoverPath) return;
  showTheaterMode(currentCoverPath);
});

export function showDetails(item: ListItem | null): void {
  if (item) {
    currentTrackPath = item.trackPath;
    currentArtist = item.artist ?? "";
    currentTitle = item.title ?? "";
    currentComposer = item.composer ?? "";
    currentConductor = item.conductor ?? "";
    pathInput.value = item.path ?? "";
    titleInput.value = currentTitle;
    artistInput.value = currentArtist;
    albumInput.value = item.album ?? "";
    trackNoInput.value = item.rawTrackNo ?? "";
    discNoInput.value = item.discNo ?? "";
    albumArtistInput.value = item.albumArtist ?? "";
    genreInput.value = item.genre ?? "";
    yearInput.value = item.year ?? "";
    composerInput.value = item.composer ?? "";
    conductorInput.value = item.conductor ?? "";
    bpmInput.value = item.bpm ? String(item.bpm) : "";
    setupRatingHover(ratingEl, item.rating ?? 0, item.trackPath);
    ratingEl.dataset.rating = String(item.rating ?? 0);
    ratingEl.dataset.trackPath = item.trackPath;
    ratingEl.innerHTML = renderRating(item.rating ?? 0);
    commentInput.value = item.comment ?? "";
    loadCover(item.trackPath);
  } else {
    currentTrackPath = null;
    currentArtist = "";
    currentTitle = "";
    currentComposer = "";
    currentConductor = "";
    searchBtnContainer.style.display = "none";
    pathInput.value = "";
    titleInput.value = "";
    artistInput.value = "";
    albumInput.value = "";
    trackNoInput.value = "";
    discNoInput.value = "";
    albumArtistInput.value = "";
    genreInput.value = "";
    yearInput.value = "";
    composerInput.value = "";
    conductorInput.value = "";
    bpmInput.value = "";
    ratingEl.innerHTML = "";
    delete ratingEl.dataset.trackPath;
    commentInput.value = "";
    coverImg.removeAttribute("src");
    coverPlaceholder.style.display = "";
    currentCoverPath = null;
  }
}

const form = document.getElementById("detail-form")!;

/* ── ESC to restore & blur ───────────────────────────────── */
const detailInputs = [
  pathInput, titleInput, artistInput, albumInput,
  trackNoInput, discNoInput, albumArtistInput,
  genreInput, yearInput, composerInput, conductorInput,
  bpmInput, commentInput,
];

for (const el of detailInputs) {
  el.addEventListener("focus", () => {
    el.dataset.originalValue = el.value;
  });
  el.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") {
      el.value = el.dataset.originalValue ?? el.value;
      el.blur();
    }
  });
}

/* ── Context menu for detail inputs ──────────────────────── */
let contextMenuEl: HTMLElement | null = null;

function closeContextMenu(): void {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

form.addEventListener("contextmenu", (e) => {
  const target = (e.target as HTMLElement).closest("input, textarea");
  if (!target) return;
  e.preventDefault();
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  function addItem(label: string, action: () => void): void {
    const item = document.createElement("div");
    item.className = "context-menu-item";
    item.textContent = label;
    item.addEventListener("click", () => { closeContextMenu(); action(); });
    menu.appendChild(item);
  }

  addItem(t("Copy"), () => {
    const el = target as HTMLInputElement | HTMLTextAreaElement;
    const text = el.value.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    navigator.clipboard.writeText(text || el.value).catch(() => {});
  });

  addItem(t("Cut"), () => {
    const el = target as HTMLInputElement | HTMLTextAreaElement;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const text = el.value.substring(start, end) || el.value;
    navigator.clipboard.writeText(text).catch(() => {});
    if (start !== end && !el.readOnly) {
      el.value = el.value.substring(0, start) + el.value.substring(end);
    }
  });

  addItem(t("Paste"), () => {
    const el = target as HTMLInputElement | HTMLTextAreaElement;
    if (el.readOnly) return;
    navigator.clipboard.readText().then((text) => {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = el.value.substring(0, start) + text + el.value.substring(end);
      el.selectionStart = el.selectionEnd = start + text.length;
    }).catch(() => {});
  });

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