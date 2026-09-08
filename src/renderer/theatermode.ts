/* ── Theater Mode ────────────────────────────────────────── */

import { audio, formatTime } from "./audio.js";
import { setupRatingHover } from "./list-view.js";
import { onPlaybackFailure, setSilentSkipHandler } from "./playback-error.js";
import { MEDIA_FILE_EXTENSIONS, MIN_EXTRA_IMAGE_SIZE, THEATER_FADE_TOTAL_MS } from "../common/config.js";
import { ICON_PREV, ICON_NEXT, ICON_PLAY_PAUSE, ICON_SPEAKER, ICON_MUTE, ICON_MUSIC_NOTE } from "./icons.js";
import { t } from "../common/i18n/index.js";

const overlay = document.createElement("div");
overlay.id = "theater-mode";
overlay.innerHTML = `
  <div id="theater-bg"></div>
  <div id="theater-close-area"><button id="theater-close" data-i18n-title="Close" title="Close">&times;</button></div>
  <div id="theater-body">
    <div id="theater-cover-area">
      <img id="theater-cover" alt="" />
      <div id="theater-cover-placeholder">${ICON_MUSIC_NOTE}</div>
    </div>
    <div id="theater-info">
      <div id="theater-artist"></div>
      <div id="theater-title"></div>
      <div id="theater-album-line"></div>
      <div id="theater-year"></div>
      <div id="theater-bottom-group">
        <div id="theater-controls">
          <button id="theater-prev-btn" data-i18n-title="Previous Track" title="Previous Track">${ICON_PREV}</button>
          <button id="theater-play-btn" data-i18n-title="Play" title="Play">${ICON_PLAY_PAUSE}</button>
          <button id="theater-next-btn" data-i18n-title="Next Track" title="Next Track">${ICON_NEXT}</button>
          <span id="theater-current-time" data-i18n-title="Elapsed time of current track" title="Elapsed time of current track">00:00</span>
          <div id="theater-progress-wrap">
            <div id="theater-progress-track" data-i18n-title="Progress" title="Progress">
              <div id="theater-progress-fill"></div>
            </div>
            <div id="theater-rating"><span id="theater-rating-inner" data-i18n-title="Rating" title="Rating"></span></div>
          </div>
          <span id="theater-duration" data-i18n-title="Track length" title="Track length">00:00</span>
        </div>
      </div>
    </div>
  </div>
  <div id="theater-volume-hover-area">
    <div id="theater-volume-section">
      <button id="theater-volume-icon" data-i18n-title="Mute" title="Mute">${ICON_SPEAKER}</button>
      <input type="range" id="theater-volume-slider" min="0" max="1" step="0.01" value="1" data-i18n-title="Volume" title="Volume" />
    </div>
  </div>
`;
document.body.appendChild(overlay);

overlay.querySelector("#theater-close")!.addEventListener("click", hide);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlay.style.display === "flex") hide();
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && overlay.style.display === "flex") hide();
});

/* ── Click anywhere to close ───────────────────────────── */
/* Any click that is not on an interactive control closes theater
   mode: buttons (prev/play/next/mute/close), the progress slider,
   the rating stars, the volume slider and the cover (which cycles
   images) are excluded. The mousedown bookkeeping prevents closing
   when a control drag (seek/volume) ends outside that control. */
const THEATER_KEEP_OPEN_SELECTOR = "button, input, #theater-progress-track, #theater-rating, #theater-cover-area";
/* Clicks arriving within this window after the overlay opened are
   ignored. Without it the second click of a double-click on the detail
   panel's cover would instantly close the just-opened overlay (tracks
   without cover art open fast enough for that race to be visible). */
const THEATER_OPEN_CLICK_GRACE_MS = 500;
let theaterOpenedAt = 0;
let theaterPressInControl = false;

overlay.addEventListener("mousedown", (e) => {
  theaterPressInControl = !!(e.target as HTMLElement).closest(THEATER_KEEP_OPEN_SELECTOR);
});

overlay.addEventListener("click", (e) => {
  const wasInControl = theaterPressInControl;
  theaterPressInControl = false;
  if (wasInControl) return;
  if ((e.target as HTMLElement).closest(THEATER_KEEP_OPEN_SELECTOR)) return;
  if (Date.now() - theaterOpenedAt < THEATER_OPEN_CLICK_GRACE_MS) return;
  hide();
});

/* ── Cursor idle hide ──────────────────────────────────── */
let cursorTimer: ReturnType<typeof setTimeout> | null = null;

function showCursor(): void {
  overlay.classList.remove("theater-idle");
}

function hideCursor(): void {
  overlay.classList.add("theater-idle");
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

const theaterPlayBtn = overlay.querySelector("#theater-play-btn") as HTMLButtonElement;
const theaterCurrentTimeEl = overlay.querySelector("#theater-current-time") as HTMLSpanElement;
const theaterDurationEl = overlay.querySelector("#theater-duration") as HTMLSpanElement;
const theaterProgressFill = overlay.querySelector("#theater-progress-fill") as HTMLDivElement;
const theaterProgressTrack = overlay.querySelector("#theater-progress-track") as HTMLDivElement;
const theaterPrevBtn = overlay.querySelector("#theater-prev-btn") as HTMLButtonElement;
const theaterNextBtn = overlay.querySelector("#theater-next-btn") as HTMLButtonElement;

let onPrevTrack: (() => void) | null = null;
let onNextTrack: (() => void) | null = null;
let onCanPrevTrack: (() => boolean) | null = null;
let onCanNextTrack: (() => boolean) | null = null;
/* Load (paused) and play handlers for the track theater mode is
   showing (wired to now-playing's loadTrack/playTrack via index.ts; a
   direct import would be circular). Load fires when theater mode
   opens with NOTHING in the <audio> element yet — the track is
   preloaded paused so prev/next availability reflects its real position;
   actual playback waits for the play button. */
let onLoadShownTrack: ((path: string) => void) | null = null;
let onPlayShownTrack: ((path: string) => void) | null = null;
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

export function setShownTrackHandlers(
  load: (path: string) => void,
  play: (path: string) => void,
): void {
  onLoadShownTrack = load;
  onPlayShownTrack = play;
}

function updateNavButtons(): void {
  theaterPrevBtn.disabled = onCanPrevTrack ? !onCanPrevTrack() : true;
  theaterNextBtn.disabled = onCanNextTrack ? !onCanNextTrack() : true;
}

theaterPrevBtn.addEventListener("click", () => {
  if (!onPrevTrack || theaterPrevBtn.disabled) return;
  transitioning = true;
  isManualTransition = true;
  overlay.classList.add("theater-transitioning");
  onPrevTrack();
  updateNavButtons();
});

function theaterAdvanceNext(): void {
  if (!onNextTrack || theaterNextBtn.disabled) return;
  transitioning = true;
  isManualTransition = true;
  overlay.classList.add("theater-transitioning");
  onNextTrack();
  updateNavButtons();
}
theaterNextBtn.addEventListener("click", theaterAdvanceNext);

/* ── Silent skip over unplayable tracks ─────────────────── */
/* While theater mode is open, a failed playback must not raise the
   unplayable-file dialog: the track is skipped forward instead (like
   pressing next). Consecutive skips are capped so a fully broken list
   cannot make the app skip forever; the cap resets whenever a track
   actually starts playing. */
const THEATER_MAX_AUTO_SKIPS = 25;
let theaterAutoSkips = 0;

setSilentSkipHandler(() => {
  if (overlay.style.display !== "flex") return false;
  if (theaterAutoSkips >= THEATER_MAX_AUTO_SKIPS) {
    revealInstantly(); /* un-stick an armed fade-over-black */
    return true;
  }
  theaterAutoSkips++;
  theaterAdvanceNext();
  return true;
});

audio.addEventListener("playing", () => { theaterAutoSkips = 0; });

const theaterVolumeSlider = overlay.querySelector("#theater-volume-slider") as HTMLInputElement;
const theaterVolumeIcon = overlay.querySelector("#theater-volume-icon") as HTMLButtonElement;

function theaterUpdateVolumeIcon(): void {
  const muted = audio.muted || audio.volume === 0;
  theaterVolumeIcon.innerHTML = muted ? ICON_MUTE : ICON_SPEAKER;
  theaterVolumeIcon.title = muted ? t("Unmute") : t("Mute");
}

document.addEventListener("language-changed", () => {
  theaterPlayBtn.title = audio.paused ? t("Play") : t("Pause");
  theaterUpdateVolumeIcon();
});

function theaterUpdateSliderFill(): void {
  const pct = (audio.muted ? 0 : audio.volume) * 100;
  theaterVolumeSlider.style.setProperty("--slider-fill", pct + "%");
}

audio.addEventListener("volumechange", () => {
  const vol = audio.muted ? 0 : audio.volume;
  theaterVolumeSlider.value = String(vol);
  theaterUpdateSliderFill();
  theaterUpdateVolumeIcon();
});

theaterVolumeSlider.addEventListener("input", () => {
  audio.volume = parseFloat(theaterVolumeSlider.value);
  audio.muted = false;
});

theaterVolumeIcon.addEventListener("click", () => {
  audio.muted = !audio.muted;
});

/* ── Volume hover ─────────────────────────────────────── */
const theaterVolumeHoverArea = overlay.querySelector("#theater-volume-hover-area") as HTMLElement;
const theaterVolumeSection = overlay.querySelector("#theater-volume-section") as HTMLElement;
const theaterBottomGroup = overlay.querySelector("#theater-bottom-group") as HTMLElement;
let theaterVolTimer: ReturnType<typeof setTimeout> | null = null;

theaterVolumeHoverArea.addEventListener("mouseenter", () => {
  if (theaterVolTimer) { clearTimeout(theaterVolTimer); theaterVolTimer = null; }
  theaterVolumeSection.classList.add("theater-volume-visible");
});
theaterVolumeHoverArea.addEventListener("mouseleave", () => {
  theaterVolTimer = setTimeout(() => {
    theaterVolumeSection.classList.remove("theater-volume-visible");
    theaterVolTimer = null;
  }, 600);
});

theaterPlayBtn.addEventListener("click", () => {
  /* Nothing loaded (load was refused, e.g. an unplayable file): let
     playTrack handle it — that includes the external-player flow. */
  if (!audio.src) {
    if (currentPath && onPlayShownTrack) {
      onPlayShownTrack(currentPath);
      updateNavButtons();
    }
    return;
  }
  if (audio.paused) {
    audio.play().catch((err) => {
      const path = decodeURIComponent(audio.src.replace(/^file:\/\//, "")) || currentPath;
      onPlaybackFailure(path, err);
    });
  } else {
    audio.pause();
  }
});

/* Fade duration for EACH direction (out and in): half of the combined
   total configured in config.ts. Applied to the CSS variable that
   drives all fade transitions, so visuals and timing logic always
   match. */
function getTransitionMs(): number {
  return THEATER_FADE_TOTAL_MS / 2;
}
overlay.style.setProperty("--theater-transition-duration", getTransitionMs() + "ms");

/* ── Fade eligibility ───────────────────────────────────── */
/* The fade-over-black between two tracks is only shown when it FITS:
   the fade-out must fit into the rest of the current track and the
   fade-in must fit into the beginning of the next one. Otherwise the
   transition is sudden and immediate (no fading at all). */

/* Set once a timeupdate observed the current track with more than the
   fade duration remaining. Only then does crossing the threshold
   (remaining <= fade duration) actually START the fade-out — a track
   that is shorter than the fade duration (or opened in theater mode
   too late) never reaches an eligible state and ends without any
   fading. Reset for every newly shown track. */
let theaterFadeOutPossible = false;

/* True when the fade-in would fit into the NEW track currently loaded
   in the audio element. Unknown duration (NaN) counts as fitting; the
   loadedmetadata listener aborts the fade later if it turns out too
   short. */
function fadeInFitsNextTrack(): boolean {
  return !(audio.duration < getTransitionMs() / 1000);
}

/* Swap to the already-updated content without ANY fade animation. */
function revealInstantly(): void {
  transitioning = false;
  overlay.classList.add("theater-no-anim");
  overlay.classList.remove("theater-transitioning");
  void overlay.offsetWidth; /* style flush so the removal applies instantly */
  requestAnimationFrame(() => overlay.classList.remove("theater-no-anim"));
}

audio.addEventListener("play", async () => {
  theaterPlayBtn.classList.add("playing");
  theaterPlayBtn.title = t("Pause");
  if (overlay.style.display !== "flex") return;
  const path = decodeURIComponent(audio.src.replace(/^file:\/\//, ""));
  if (!path || path === currentPath) return;
  const fadeInFits = fadeInFitsNextTrack();
  if (isManualTransition) {
    isManualTransition = false;
    /* The blackout hold before the swap is part of the fading; skip
       it when the transition is going to be sudden anyway. */
    if (fadeInFits && transitioning) {
      await new Promise((r) => setTimeout(r, getTransitionMs()));
    }
  }
  try {
    await updateContent(path);
  } catch { /* ignore */ }
  if (transitioning && fadeInFits) {
    transitioning = false;
    overlay.classList.remove("theater-transitioning"); /* animated fade-in from black */
  } else {
    revealInstantly(); /* sudden immediate swap */
  }
  updateNavButtons();
});
audio.addEventListener("pause", () => {
  theaterPlayBtn.classList.remove("playing");
  theaterPlayBtn.title = t("Play");
});
audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    theaterCurrentTimeEl.textContent = formatTime(audio.currentTime);
    const pct = (audio.currentTime / audio.duration) * 100;
    if (!theaterDragging) {
      theaterProgressFill.style.width = pct + "%";
    }
    if (overlay.style.display === "flex" && currentPath && !transitioning) {
      const remaining = (audio.duration - audio.currentTime) * 1000;
      const transitionMs = getTransitionMs();
      if (remaining > transitionMs && onCanNextTrack?.()) {
        theaterFadeOutPossible = true; /* plenty of runway left, fade-out may start at the threshold */
      } else if (remaining > 0 && theaterFadeOutPossible) {
        /* threshold crossed from above: the fade-out fits into the
           rest of this track (to timeupdate tick accuracy) */
        transitioning = true;
        overlay.classList.add("theater-transitioning");
      }
      /* else: remaining <= fade duration and never eligible — the
         fade-out cannot fit into this track -> sudden transition */
    }
  }
});
audio.addEventListener("loadedmetadata", () => {
  theaterDurationEl.textContent = formatTime(audio.duration);
  syncProgress();
  /* A fade-in that is already running but cannot fit into the new
     track (its duration only became known now) is aborted and the
     content revealed instantly instead. */
  if (
    overlay.style.display === "flex" &&
    transitioning &&
    audio.duration &&
    audio.duration * 1000 < getTransitionMs()
  ) {
    revealInstantly();
  }
});
audio.addEventListener("seeked", () => {
  syncProgress();
  if (transitioning && overlay.style.display === "flex") {
    const remaining = audio.duration - audio.currentTime;
    if (remaining * 1000 > getTransitionMs()) {
      transitioning = false;
      overlay.classList.remove("theater-transitioning");
    }
  }
});
audio.addEventListener("ended", () => {
  theaterPlayBtn.classList.remove("playing");
  theaterPlayBtn.title = t("Play");
  theaterProgressFill.style.width = "0%";
  theaterCurrentTimeEl.textContent = "00:00";
  if (overlay.style.display === "flex" && !transitioning && theaterFadeOutPossible && onCanNextTrack?.()) {
    /* Fade-out was eligible but got missed between timeupdate ticks:
       keep the screen black through the track gap so the next track
       can fade in. Never armed when the fade could not fit anyway. */
    transitioning = true;
    overlay.classList.add("theater-transitioning");
  }
});

function syncProgress(): void {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  theaterProgressFill.style.width = pct + "%";
  theaterCurrentTimeEl.textContent = formatTime(audio.currentTime);
}

function theaterPctFromClientX(clientX: number): number {
  if (!audio.duration) return 0;
  const rect = theaterProgressTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

let theaterDragging = false;
let theaterDragPct = 0;

theaterProgressTrack.addEventListener("mousedown", (e) => {
  theaterDragging = true;
  theaterDragPct = theaterPctFromClientX(e.clientX);
  theaterProgressFill.style.width = theaterDragPct * 100 + "%";
  theaterCurrentTimeEl.textContent = formatTime(theaterDragPct * audio.duration);
});

document.addEventListener("mousemove", (e) => {
  if (!theaterDragging) return;
  theaterDragPct = theaterPctFromClientX(e.clientX);
  theaterProgressFill.style.width = theaterDragPct * 100 + "%";
  theaterCurrentTimeEl.textContent = formatTime(theaterDragPct * audio.duration);
});

document.addEventListener("mouseup", () => {
  if (!theaterDragging) return;
  theaterDragging = false;
  audio.currentTime = theaterDragPct * audio.duration;
});

const NBSP = "\u00A0";

/* Matches catalogue numbers like "op. 123", "Op.123", "opus 456",
   "Opus 456", "KV 525", "k.v. 525", "K.V. 525", "No. 5", "no 5",
   "nr. 12", the French forms "№ 7", "N° 5", "nº 8" (numero glyph,
   degree sign or masculine ordinal as the "o") — any casing, any
   number of spaces, including none — plus comma-joined sub-numbers
   like "op. 3,2" or "op. 3, 2". Glues them to their number with
   non-breaking spaces, so the number never gets wrapped to a new line. */
function placeNonbreakingSpace(text: string): string {
  return text.replace(
    /(?:№|\b(op\.?|opus|k\.?v\.?|n[roº°]\.?))\s*(\d+(?:,\s*\d+)*)/gi,
    (_match, cat: string | undefined, num: string) =>
      (cat ?? "№") + NBSP + num.replace(/\s+/g, NBSP),
  );
}

let currentPath: string | null = null;

function hide(): void {
  stopCursorTimer();
  /* Kill every CSS transition/animation before the overlay disappears so
     there is zero visual fade when returning to the main UI. */
  overlay.classList.add("theater-no-anim");
  overlay.classList.remove("theater-transitioning");
  overlay.style.display = "none";
  /* Strip the no-anim flag on the next frame so a future show is not
     permanently stuck in no-animation mode. */
  requestAnimationFrame(() => overlay.classList.remove("theater-no-anim"));
  currentPath = null;
  transitioning = false;
  isManualTransition = false;
  theaterFadeOutPossible = false;
  theaterAutoSkips = 0;
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

const coverImg = overlay.querySelector("#theater-cover") as HTMLImageElement;
const coverPlaceholder = overlay.querySelector("#theater-cover-placeholder") as HTMLElement;
const titleEl = overlay.querySelector("#theater-title") as HTMLDivElement;
const artistEl = overlay.querySelector("#theater-artist") as HTMLDivElement;
const albumLineEl = overlay.querySelector("#theater-album-line") as HTMLDivElement;
const yearEl = overlay.querySelector("#theater-year") as HTMLDivElement;

/* ── Front cover / extra images cycling ─────────────────── */

let frontCoverUrl: string | null = null;
let extraImageUrls: string[] = [];
let extraImageIndex = -1; // -1 = front cover

coverImg.addEventListener("click", cycleCover);
coverPlaceholder.addEventListener("click", cycleCover);

function cycleCover(): void {
  if (!currentPath || extraImageUrls.length === 0) return;
  extraImageIndex = extraImageIndex + 1 >= extraImageUrls.length ? -1 : extraImageIndex + 1;
  const url = extraImageIndex < 0 ? frontCoverUrl : extraImageUrls[extraImageIndex];
  if (url) {
    coverImg.src = url;
    coverImg.style.display = "block";
    coverPlaceholder.style.display = "none";
  } else {
    coverImg.removeAttribute("src");
    coverImg.style.display = "none";
    coverPlaceholder.style.display = "flex";
  }
}

function imageMeetsMinSize(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(img.naturalWidth >= MIN_EXTRA_IMAGE_SIZE && img.naturalHeight >= MIN_EXTRA_IMAGE_SIZE);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/* Titles ending in a known media extension ("Song.wav") get it chopped
   off, case-insensitively. */
function stripMediaExtension(text: string): string {
  const lower = text.toLowerCase();
  for (const ext of MEDIA_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return text.slice(0, -ext.length);
  }
  return text;
}

function renderTrackMetadata(row: Track, filePath: string): void {
  const title = stripMediaExtension(row.title) || row.filename.replace(/\.[^.]+$/, "");
  const artist = row.artist || "";
  const year = row.year || "";
  const album = (row.album && row.album !== title) ? row.album : "";

  artistEl.textContent = artist;
  artistEl.style.display = artist ? "" : "none";
  titleEl.innerHTML = placeNonbreakingSpace(title).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ \(/g, "<br>(");
  albumLineEl.textContent = album;
  albumLineEl.style.display = album ? "" : "none";
  yearEl.textContent = year;
  yearEl.style.display = year ? "" : "none";

  const ratingEl = overlay.querySelector("#theater-rating-inner") as HTMLSpanElement;
  setupRatingHover(ratingEl, row.rating ?? 0, filePath);
}

/* A tag re-scan may change the tags of the track currently shown:
   refresh only the metadata texts and the rating widget — cover art,
   fade state and playback are untouched. */
export async function refreshTheaterModeMetadata(filePath: string): Promise<void> {
  if (overlay.style.display !== "flex" || currentPath !== filePath) return;
  let rows;
  try {
    rows = await window.electronAPI.lookupPaths([filePath]);
  } catch { return; }
  const row = rows?.[0];
  if (!row || currentPath !== filePath) return;
  renderTrackMetadata(row, filePath);
}

async function updateContent(filePath: string): Promise<void> {
  currentPath = filePath;
  theaterFadeOutPossible = false; /* fresh fade-out eligibility per track */
  frontCoverUrl = null;
  extraImageUrls = [];
  extraImageIndex = -1;

  /* One call yields the three disjunct groups; cycle order is rear
     covers first, then extra images. Sub-100px images are dropped. */
  const groupsPromise = window.electronAPI.getCoverArtGroups(filePath)
    .then((groups) => {
      if (currentPath !== filePath) return null;
      return groups;
    })
    .catch(() => null);
  void (async () => {
    const groups = await groupsPromise;
    if (!groups || currentPath !== filePath) return;
    const largeEnough: string[] = [];
    for (const url of [...groups.rearCovers, ...groups.extraImages]) {
      if (currentPath !== filePath) return;
      if (await imageMeetsMinSize(url)) largeEnough.push(url);
    }
    if (currentPath === filePath) extraImageUrls = largeEnough;
  })();

  let rows;
  try {
    rows = await window.electronAPI.lookupPaths([filePath]);
  } catch { return; }
  const row = rows?.[0];
  if (!row || currentPath !== filePath) return;

  renderTrackMetadata(row, filePath);

  let dataUrl: string | null = null;
  try {
    const groups = await groupsPromise;
    dataUrl = groups?.front ?? null;
  } catch { /* ignore */ }

  if (currentPath !== filePath) return;

  if (dataUrl) {
    frontCoverUrl = dataUrl;
    coverImg.src = dataUrl;
    coverImg.style.display = "block";
    coverPlaceholder.style.display = "none";

    await new Promise<void>((resolve) => {
      const onReady = () => {
        if (currentPath === filePath) {
          try {
            const bgData = getBackground(coverImg);
            const bgEl = overlay.querySelector("#theater-bg") as HTMLElement;
            if (bgEl) {
              bgEl.style.backgroundImage = `url(${bgData})`;
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
    const bgEl = overlay.querySelector("#theater-bg") as HTMLElement;
    if (bgEl) bgEl.style.backgroundImage = "";
    syncProgress();
  }
}

export async function showTheaterMode(filePath: string): Promise<void> {
  theaterAutoSkips = 0;
  await updateContent(filePath);
  if (currentPath === filePath) {
    syncProgress();
    resetCursorTimer();
    const playingPath = decodeURIComponent(audio.src.replace(/^file:\/\//, ""));
    const isPlaying = currentPath === playingPath;
    /* Nothing loaded yet: preload the SHOWN track (paused) right away
so prev/next reflect its real position; playback itself waits for the
      play button. Controls appear in this state for exactly that. */
    const wasIdle = !audio.src;
    if (wasIdle && onLoadShownTrack) onLoadShownTrack(currentPath);
    /* controlsUsable must use the PRE-preload state: loading above
       already filled audio.src. */
    const controlsUsable = isPlaying || wasIdle;
    theaterBottomGroup.style.display = controlsUsable ? "" : "none";
    theaterVolumeHoverArea.style.display = controlsUsable ? "" : "none";
    theaterOpenedAt = Date.now();
    /* Suppress all CSS transitions on first paint so the overlay
       appears with zero animation delay. */
    overlay.classList.add("theater-no-anim");
    overlay.style.display = "flex";
    requestAnimationFrame(() => overlay.classList.remove("theater-no-anim"));
    updateNavButtons();
    try { await document.documentElement.requestFullscreen(); } catch { /* ignored */ }
    /* No fade-out pre-arming here: if the current track is already
       within its final fade-duration window (or shorter), the fade
       cannot fit and the timeupdate eligibility logic will produce a
       sudden transition instead. */
  }
}
