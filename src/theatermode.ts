/* ── Theater Mode ────────────────────────────────────────── */

import { audio, formatTime } from "./audio.js";
import { setupRatingHover } from "./list-view.js";
import { onPlaybackFailure } from "./playback-error.js";
import { t } from "./i18n/index.js";

const overlay = document.createElement("div");
overlay.id = "theater-mode";
overlay.innerHTML = `
  <div id="tm-bg"></div>
  <div id="tm-close-area"><button id="tm-close" data-i18n-title="Close" title="Close">&times;</button></div>
  <div id="tm-body">
    <div id="tm-cover-area">
      <img id="tm-cover" alt="" />
      <div id="tm-cover-placeholder">♫</div>
    </div>
    <div id="tm-info">
      <div id="tm-artist"></div>
      <div id="tm-title"></div>
      <div id="tm-album-line"></div>
      <div id="tm-year"></div>
      <div id="tm-bottom-group">
        <div id="tm-controls">
          <button id="tm-prev-btn" data-i18n-title="Previous Track" title="Previous Track">⏮</button>
          <button id="tm-play-btn" data-i18n-title="Play" title="Play">▶️</button>
          <button id="tm-next-btn" data-i18n-title="Next Track" title="Next Track">⏭</button>
          <span id="tm-current-time" data-i18n-title="Elapsed time of current track" title="Elapsed time of current track">0:00</span>
          <div id="tm-progress-wrap">
            <div id="tm-progress-track" data-i18n-title="Progress" title="Progress">
              <div id="tm-progress-fill"></div>
              <div id="tm-progress-hover-time">0:00</div>
            </div>
            <div id="tm-rating"><span id="tm-rating-inner" data-i18n-title="Rating" title="Rating"></span></div>
          </div>
          <span id="tm-duration" data-i18n-title="Track length" title="Track length">0:00</span>
        </div>
      </div>
    </div>
  </div>
  <div id="tm-volume-hover-area">
    <div id="tm-volume-section">
      <button id="tm-volume-icon" data-i18n-title="Mute" title="Mute">🔊</button>
      <input type="range" id="tm-volume-slider" min="0" max="1" step="0.01" value="1" data-i18n-title="Volume" title="Volume" />
    </div>
  </div>
`;
document.body.appendChild(overlay);

overlay.querySelector("#tm-close")!.addEventListener("click", hide);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay.style.display === "flex") hide();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && overlay.style.display === "flex") hide();
});

/* ── Cursor idle hide ──────────────────────────────────── */
let cursorTimer: ReturnType<typeof setTimeout> | null = null;

function showCursor(): void {
  overlay.classList.remove("tm-idle");
}

function hideCursor(): void {
  overlay.classList.add("tm-idle");
}

function resetCursorTimer(): void {
  showCursor();
  if (cursorTimer !== null) clearTimeout(cursorTimer);
  cursorTimer = setTimeout(hideCursor, 3000);
}

overlay.addEventListener("mousemove", resetCursorTimer);

function stopCursorTimer(): void {
  if (cursorTimer !== null) {
    clearTimeout(cursorTimer);
    cursorTimer = null;
  }
  showCursor();
}

/* ── Playback controls ──────────────────────────────────── */

const tmPlayBtn = overlay.querySelector("#tm-play-btn") as HTMLButtonElement;
const tmCurrentTimeEl = overlay.querySelector("#tm-current-time") as HTMLSpanElement;
const tmDurationEl = overlay.querySelector("#tm-duration") as HTMLSpanElement;
const tmProgressFill = overlay.querySelector("#tm-progress-fill") as HTMLDivElement;
const tmProgressTrack = overlay.querySelector("#tm-progress-track") as HTMLDivElement;
const tmHoverTimeEl = overlay.querySelector("#tm-progress-hover-time") as HTMLDivElement;
const tmPrevBtn = overlay.querySelector("#tm-prev-btn") as HTMLButtonElement;
const tmNextBtn = overlay.querySelector("#tm-next-btn") as HTMLButtonElement;

let onPrevTrack: (() => void) | null = null;
let onNextTrack: (() => void) | null = null;
let onCanPrevTrack: (() => boolean) | null = null;
let onCanNextTrack: (() => boolean) | null = null;
let transitioning = false;
let isManualTransition = false;

export function setTrackNavCallbacks(
  prev: () => void,
  next: () => void,
  canPrev: () => boolean,
  canNext: () => boolean,
): void {
  onPrevTrack = prev;
  onNextTrack = next;
  onCanPrevTrack = canPrev;
  onCanNextTrack = canNext;
}

function updateNavButtons(): void {
  tmPrevBtn.disabled = onCanPrevTrack ? !onCanPrevTrack() : true;
  tmNextBtn.disabled = onCanNextTrack ? !onCanNextTrack() : true;
}

tmPrevBtn.addEventListener("click", () => {
  if (!onPrevTrack || tmPrevBtn.disabled) return;
  transitioning = true;
  isManualTransition = true;
  overlay.classList.add("tm-transitioning");
  onPrevTrack();
  updateNavButtons();
});
tmNextBtn.addEventListener("click", () => {
  if (!onNextTrack || tmNextBtn.disabled) return;
  transitioning = true;
  isManualTransition = true;
  overlay.classList.add("tm-transitioning");
  onNextTrack();
  updateNavButtons();
});

const tmVolumeSlider = overlay.querySelector("#tm-volume-slider") as HTMLInputElement;
const tmVolumeIcon = overlay.querySelector("#tm-volume-icon") as HTMLButtonElement;

function tmUpdateVolumeIcon(): void {
  if (audio.muted || audio.volume === 0) {
    tmVolumeIcon.innerHTML = "&#128263;";
    tmVolumeIcon.title = t("Unmute");
  } else if (audio.volume < 0.5) {
    tmVolumeIcon.innerHTML = "&#128265;";
    tmVolumeIcon.title = t("Mute");
  } else {
    tmVolumeIcon.innerHTML = "&#128266;";
    tmVolumeIcon.title = t("Mute");
  }
}

document.addEventListener("language-changed", () => {
  tmPlayBtn.title = t(audio.paused ? "Play" : "Pause");
  tmUpdateVolumeIcon();
});

audio.addEventListener("volumechange", () => {
  const vol = audio.muted ? 0 : audio.volume;
  tmVolumeSlider.value = String(vol);
  tmUpdateVolumeIcon();
});

tmVolumeSlider.addEventListener("input", () => {
  audio.volume = parseFloat(tmVolumeSlider.value);
  audio.muted = false;
});

tmVolumeIcon.addEventListener("click", () => {
  audio.muted = !audio.muted;
});

/* ── Volume hover ─────────────────────────────────────── */
const tmVolumeHoverArea = overlay.querySelector("#tm-volume-hover-area") as HTMLElement;
const tmVolumeSection = overlay.querySelector("#tm-volume-section") as HTMLElement;
const tmBottomGroup = overlay.querySelector("#tm-bottom-group") as HTMLElement;
let tmVolTimer: ReturnType<typeof setTimeout> | null = null;

tmVolumeHoverArea.addEventListener("mouseenter", () => {
  if (tmVolTimer) { clearTimeout(tmVolTimer); tmVolTimer = null; }
  tmVolumeSection.classList.add("tm-volume-visible");
});
tmVolumeHoverArea.addEventListener("mouseleave", () => {
  tmVolTimer = setTimeout(() => {
    tmVolumeSection.classList.remove("tm-volume-visible");
    tmVolTimer = null;
  }, 600);
});

tmPlayBtn.addEventListener("click", () => {
  if (audio.paused) {
    audio.play().catch((err) => {
      const path = decodeURIComponent(audio.src.replace(/^file:\/\//, "")) || currentPath;
      onPlaybackFailure(path, err);
    });
  } else {
    audio.pause();
  }
});

function getTransitionMs(): number {
  const val = getComputedStyle(overlay).getPropertyValue("--tm-transition-duration").trim();
  const match = val.match(/^([\d.]+)s$/);
  return match ? parseFloat(match[1]!) * 1000 : 0;
}

audio.addEventListener("play", async () => {
  tmPlayBtn.innerHTML = "&#x23F8;&#xFE0F;";
  tmPlayBtn.title = t("Pause");
  if (overlay.style.display !== "flex") return;
  const path = decodeURIComponent(audio.src.replace(/^file:\/\//, ""));
  if (!path || path === currentPath) return;
  if (isManualTransition) {
    isManualTransition = false;
    await new Promise((r) => setTimeout(r, getTransitionMs()));
  }
  try {
    await updateContent(path);
  } catch { /* ignore */ }
  transitioning = false;
  overlay.classList.remove("tm-transitioning");
  updateNavButtons();
});
audio.addEventListener("pause", () => {
  tmPlayBtn.innerHTML = "&#x25B6;&#xFE0F;";
  tmPlayBtn.title = t("Play");
});
audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    tmCurrentTimeEl.textContent = formatTime(audio.currentTime);
    const pct = (audio.currentTime / audio.duration) * 100;
    if (!tmDragging) {
      tmProgressFill.style.width = pct + "%";
    }
    if (overlay.style.display === "flex" && currentPath && !transitioning) {
      const remaining = audio.duration - audio.currentTime;
      if (remaining > 0 && remaining * 1000 <= getTransitionMs()) {
        transitioning = true;
        overlay.classList.add("tm-transitioning");
      }
    }
  }
});
audio.addEventListener("loadedmetadata", () => {
  tmDurationEl.textContent = formatTime(audio.duration);
  syncProgress();
});
audio.addEventListener("seeked", () => {
  syncProgress();
  if (transitioning && overlay.style.display === "flex") {
    const remaining = audio.duration - audio.currentTime;
    if (remaining * 1000 > getTransitionMs()) {
      transitioning = false;
      overlay.classList.remove("tm-transitioning");
    }
  }
});
audio.addEventListener("ended", () => {
  tmPlayBtn.innerHTML = "&#x25B6;&#xFE0F;";
  tmPlayBtn.title = t("Play");
  tmProgressFill.style.width = "0%";
  tmCurrentTimeEl.textContent = "0:00";
  if (overlay.style.display === "flex" && !transitioning) {
    transitioning = true;
    overlay.classList.add("tm-transitioning");
  }
});

function syncProgress(): void {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  tmProgressFill.style.width = pct + "%";
  tmCurrentTimeEl.textContent = formatTime(audio.currentTime);
}

function tmPctFromClientX(clientX: number): number {
  if (!audio.duration) return 0;
  const rect = tmProgressTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

let tmDragging = false;
let tmDragPct = 0;

tmProgressTrack.addEventListener("mousemove", (e) => {
  if (!audio.duration) return;
  const rect = tmProgressTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  tmHoverTimeEl.textContent = formatTime(pct * audio.duration);
  tmHoverTimeEl.style.left = `${pct * 100}%`;
});

tmProgressTrack.addEventListener("mousedown", (e) => {
  tmDragging = true;
  tmDragPct = tmPctFromClientX(e.clientX);
  tmProgressFill.style.width = tmDragPct * 100 + "%";
  tmCurrentTimeEl.textContent = formatTime(tmDragPct * audio.duration);
});

document.addEventListener("mousemove", (e) => {
  if (!tmDragging) return;
  tmDragPct = tmPctFromClientX(e.clientX);
  tmProgressFill.style.width = tmDragPct * 100 + "%";
  tmCurrentTimeEl.textContent = formatTime(tmDragPct * audio.duration);
  tmHoverTimeEl.textContent = formatTime(tmDragPct * audio.duration);
  tmHoverTimeEl.style.left = `${tmDragPct * 100}%`;
});

document.addEventListener("mouseup", () => {
  if (!tmDragging) return;
  tmDragging = false;
  audio.currentTime = tmDragPct * audio.duration;
});

let currentPath: string | null = null;

function hide(): void {
  stopCursorTimer();
  overlay.style.display = "none";
  currentPath = null;
  transitioning = false;
  isManualTransition = false;
  if (document.fullscreenElement) document.exitFullscreen();
}

function getBackground(img: HTMLImageElement): string {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const winRatio = winW / winH;

  let sx: number, sy: number, sw: number, sh: number;
  if (w / h > winRatio) {
    sh = h;
    sw = h * winRatio;
    sx = (w - sw) / 2;
    sy = 0;
  } else {
    sw = w;
    sh = w / winRatio;
    sx = 0;
    sy = (h - sh) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = winW;
  canvas.height = winH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, winW, winH);
  return canvas.toDataURL();
}

const coverImg = overlay.querySelector("#tm-cover") as HTMLImageElement;
const coverPlaceholder = overlay.querySelector("#tm-cover-placeholder") as HTMLElement;
const titleEl = overlay.querySelector("#tm-title") as HTMLDivElement;
const artistEl = overlay.querySelector("#tm-artist") as HTMLDivElement;
const albumLineEl = overlay.querySelector("#tm-album-line") as HTMLDivElement;
const yearEl = overlay.querySelector("#tm-year") as HTMLDivElement;

coverImg.addEventListener("click", () => hide());
coverPlaceholder.addEventListener("click", () => hide());

async function updateContent(filePath: string): Promise<void> {
  currentPath = filePath;

  let rows;
  try {
    rows = await window.electronAPI.lookupPaths([filePath]);
  } catch { return; }
  const row = rows?.[0];
  if (!row || currentPath !== filePath) return;

  const title = row.title || row.filename.replace(/\.[^.]+$/, "");
  const artist = row.artist || "";
  const year = row.year || "";
  const album = (row.album && row.album !== title) ? row.album : "";

  artistEl.textContent = artist;
  artistEl.style.display = artist ? "" : "none";
  titleEl.innerHTML = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ \(/g, "<br>(");
  albumLineEl.textContent = album;
  albumLineEl.style.display = album ? "" : "none";
  yearEl.textContent = year;
  yearEl.style.display = year ? "" : "none";

  const ratingEl = overlay.querySelector("#tm-rating-inner") as HTMLSpanElement;
  setupRatingHover(ratingEl, row.rating ?? 0, filePath);

  overlay.style.background = "#000000";

  let dataUrl: string | null = null;
  try {
    dataUrl = await window.electronAPI.getCoverArt(filePath);
  } catch { /* ignore */ }

  if (currentPath !== filePath) return;

  if (dataUrl) {
    coverImg.src = dataUrl;
    coverImg.style.display = "block";
    coverPlaceholder.style.display = "none";

    await new Promise<void>((resolve) => {
      const onReady = () => {
        if (currentPath === filePath) {
          try {
            const bgData = getBackground(coverImg);
            const bgEl = overlay.querySelector("#tm-bg") as HTMLElement;
            if (bgEl) {
              bgEl.style.backgroundImage = `url(${bgData})`;
              bgEl.style.backgroundSize = "cover";
              bgEl.style.backgroundPosition = "center";
              bgEl.style.backgroundRepeat = "no-repeat";
            }
          } catch { /* ignore */ }
          syncProgress();
        }
        resolve();
      };
      if (coverImg.complete && coverImg.naturalWidth > 0) {
        onReady();
      } else {
        coverImg.onload = onReady;
        coverImg.onerror = () => { syncProgress(); resolve(); };
      }
    });
  } else {
    coverImg.style.display = "none";
    coverPlaceholder.style.display = "flex";
    const bgEl = overlay.querySelector("#tm-bg") as HTMLElement;
    if (bgEl) bgEl.style.backgroundImage = "";
    syncProgress();
  }
}

export async function showTheaterMode(filePath: string): Promise<void> {
  await updateContent(filePath);
  if (currentPath === filePath) {
    syncProgress();
    resetCursorTimer();
    const playingPath = decodeURIComponent(audio.src.replace(/^file:\/\//, ""));
    const isPlaying = currentPath === playingPath;
    tmBottomGroup.style.display = isPlaying ? "" : "none";
    tmVolumeHoverArea.style.display = isPlaying ? "" : "none";
    overlay.style.display = "flex";
    updateNavButtons();
    try { await document.documentElement.requestFullscreen(); } catch { /* ignored */ }
    if (audio.duration && !transitioning) {
      const remaining = audio.duration - audio.currentTime;
      if (remaining > 0 && remaining * 1000 <= getTransitionMs()) {
        transitioning = true;
        overlay.classList.add("tm-transitioning");
      }
    }
  }
}
