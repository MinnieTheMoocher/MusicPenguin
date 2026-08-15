import { audio, formatTime } from "./audio.js";
import { showTheaterMode } from "./theatermode.js";
import { setupRatingHover } from "./list-view.js";
import { updatePlaylistPlayingIndicator } from "./playlist-panel.js";
import { handleAudioPlaybackError, onPlaybackFailure } from "./playback-error.js";
import { t } from "./i18n/index.js";

const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const currentTimeEl = document.getElementById("current-time") as HTMLSpanElement;
const durationEl = document.getElementById("duration") as HTMLSpanElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressTrack = document.getElementById("progress-track") as HTMLDivElement;
const infoEl = document.getElementById("now-playing-info") as HTMLDivElement;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
const volumeIcon = document.getElementById("volume-icon") as HTMLButtonElement;
const nowPlayingRating = document.getElementById("now-playing-rating") as HTMLSpanElement;

let playableExtensions: Set<string> = new Set();

export async function initPlayableExtensions(): Promise<void> {
  try {
    const exts = await window.electronAPI.getPlayableExtensions();
    playableExtensions = new Set(exts);
  } catch { /* ignore */ }
}

export let selectedPath: string | null = null;
let selectedTitle: string | null = null;
let playcountListener: ((this: HTMLAudioElement, ev: Event) => void) | null = null;

let actuallyPlaying = false;

export function isActuallyPlaying(): boolean {
  return actuallyPlaying;
}

function toFileUrl(path: string): string {
  return "file://" + path.split("/").map((s) => encodeURIComponent(s)).join("/");
}

function setAudioSource(filePath: string): void {
  actuallyPlaying = false;
  audio.src = toFileUrl(filePath);
}

function updateListPlayingIndicator(): void {
  const tbody = document.getElementById("list");
  if (!tbody) return;
  for (const row of tbody.children as HTMLCollectionOf<HTMLTableRowElement>) {
    const cell = row.cells[0];
    if (cell) {
      cell.textContent = actuallyPlaying && row.dataset.path === selectedPath ? "🔊" : "";
    }
  }
  updatePlaylistPlayingIndicator();
}

export function clearPlayingIndicators(): void {
  actuallyPlaying = false;
  updateListPlayingIndicator();
}

function updateVolumeIcon(): void {
  if (audio.muted || audio.volume === 0) {
    volumeIcon.innerHTML = "&#128263;";
    volumeIcon.title = t("Unmute");
  } else {
    volumeIcon.innerHTML = audio.volume < 0.5 ? "&#128265;" : "&#128266;";
    volumeIcon.title = t("Mute");
  }
}

function updateInfoText(): void {
  if (selectedTitle) {
    infoEl.textContent = selectedTitle;
  } else if (selectedPath) {
    const name = selectedPath.split("/").pop()?.split("\\").pop() || selectedPath;
    infoEl.textContent = name.replace(/\.[^.]+$/, "");
  } else {
    infoEl.textContent = t("No track selected");
  }
}

function setPlayButton(playing: boolean): void {
  playBtn.textContent = playing ? "⏸️" : "▶️";
  playBtn.title = t(playing ? "Pause" : "Play");
}

document.addEventListener("language-changed", () => {
  updateInfoText();
  updateVolumeIcon();
  setPlayButton(!audio.paused && !!audio.src);
});

function resetProgress(): void {
  progressFill.style.transition = "none";
  progressFill.style.width = "0%";
  currentTimeEl.textContent = "0:00";
}

audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    currentTimeEl.textContent = formatTime(audio.currentTime);
  }
});

function startProgressAnimation(): void {
  if (!audio.duration || !isFinite(audio.duration)) return;
  const remaining = audio.duration - audio.currentTime;
  if (remaining <= 0) return;
  progressFill.style.transition = "none";
  const startPct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.width = startPct + "%";
  progressFill.offsetHeight;
  progressFill.style.transition = `width ${remaining}s linear`;
  progressFill.style.width = "100%";
}

function stopProgressAnimation(): void {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  progressFill.style.transition = "none";
  progressFill.style.width = pct + "%";
}

audio.addEventListener("loadedmetadata", () => {
  durationEl.textContent = formatTime(audio.duration);
  resetProgress();
});

let trackEndCallbacks: Array<() => void> = [];
let navStateChangeCallbacks: Array<() => void> = [];

export function onNavStateChange(cb: () => void): void {
  navStateChangeCallbacks.push(cb);
}

export function onTrackEnd(cb: () => void): void {
  trackEndCallbacks.push(cb);
}

audio.addEventListener("ended", () => {
  actuallyPlaying = false;
  setPlayButton(false);
  resetProgress();
  trackEndCallbacks.forEach((cb) => cb());
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("pause", () => {
  actuallyPlaying = false;
  setPlayButton(false);
  stopProgressAnimation();
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("play", () => {
  setPlayButton(true);
  startProgressAnimation();
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("playing", () => {
  actuallyPlaying = true;
  startProgressAnimation();
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("error", () => {
  actuallyPlaying = false;
  setPlayButton(false);
  resetProgress();
  durationEl.textContent = "0:00";
  updateListPlayingIndicator();
  void handleAudioPlaybackError(selectedPath);
});

audio.addEventListener("volumechange", () => {
  updateVolumeIcon();
  updateSliderFill();
});

function pctFromClientX(clientX: number): number {
  if (!audio.duration) return 0;
  const rect = progressTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

const hoverTimeEl = document.getElementById("progress-hover-time") as HTMLDivElement;

let dragging = false;

progressTrack.addEventListener("mousemove", (e) => {
  if (!audio.duration) return;
  const rect = progressTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  hoverTimeEl.textContent = formatTime(pct * audio.duration);
  hoverTimeEl.style.left = `${pct * 100}%`;
});

let dragPct = 0;

progressTrack.addEventListener("mousedown", (e) => {
  dragging = true;
  progressFill.style.transition = "none";
  dragPct = pctFromClientX(e.clientX);
  progressFill.style.width = dragPct * 100 + "%";
  currentTimeEl.textContent = formatTime(dragPct * audio.duration);
});

document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  dragPct = pctFromClientX(e.clientX);
  progressFill.style.width = dragPct * 100 + "%";
  currentTimeEl.textContent = formatTime(dragPct * audio.duration);
  hoverTimeEl.textContent = formatTime(dragPct * audio.duration);
  hoverTimeEl.style.left = `${dragPct * 100}%`;
});

document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  audio.currentTime = dragPct * audio.duration;
  if (!audio.paused) {
    startProgressAnimation();
  } else {
    stopProgressAnimation();
  }
});

function updateSliderFill(): void {
  const pct = (audio.muted ? 0 : audio.volume) * 100;
  volumeSlider.style.setProperty("--slider-fill", pct + "%");
}

volumeSlider.addEventListener("input", () => {
  audio.volume = parseFloat(volumeSlider.value);
  audio.muted = false;
  updateSliderFill();
});

volumeIcon.addEventListener("click", () => {
  audio.muted = !audio.muted;
});

infoEl.addEventListener("dblclick", () => {
  const path = decodeURIComponent(audio.src.replace(/^file:\/\//, ""));
  if (path) showTheaterMode(path);
});

async function updateNowPlayingRating(filePath: string | null): Promise<void> {
  if (!filePath) {
    nowPlayingRating.innerHTML = "";
    delete nowPlayingRating.dataset.trackPath;
    return;
  }
  try {
    const rows = await window.electronAPI.lookupPaths([filePath]);
    const row = rows?.[0];
    if (row) {
      setupRatingHover(nowPlayingRating, row.rating ?? 0, filePath);
    }
  } catch { /* ignore */ }
}

export function setSelectedTrack(filePath: string | null, title?: string): void {
  if (!audio.src) selectedPath = filePath;
  selectedTitle = title ?? null;
  updateNowPlayingRating(filePath);
}

export async function playTrack(filePath: string, title?: string): Promise<void> {
  if (!isPlayableFile(filePath)) {
    audio.pause();
    const opened = await window.electronAPI.openInVlc(filePath);
    if (!opened) {
      const name = filePath.split("/").pop() ?? filePath;
      alert(t('Cannot play "$1"\n\nInstall VLC to play this file format.', name));
    }
    return;
  }
  selectedPath = filePath;
  selectedTitle = title ?? null;
  updateInfoText();
  updateNowPlayingRating(filePath);
  setAudioSource(filePath);
  audio.play().catch((err) => onPlaybackFailure(filePath, err));

  if (playcountListener) {
    audio.removeEventListener("timeupdate", playcountListener);
    playcountListener = null;
  }

  const trackedPath = filePath;
  const listener = () => {
    if (selectedPath === trackedPath && audio.currentTime >= 10) {
      audio.removeEventListener("timeupdate", listener);
      playcountListener = null;
      window.electronAPI.incrementPlaycount(trackedPath).then((count) => {
        document.dispatchEvent(new CustomEvent("playcount-updated", {
          detail: { path: trackedPath, playcount: count },
        }));
      });
    }
  };
  playcountListener = listener;
  audio.addEventListener("timeupdate", listener);
}

export async function togglePlayPause(): Promise<void> {
  if (!selectedPath) return;

  if (!isPlayableFile(selectedPath)) {
    audio.pause();
    const opened = await window.electronAPI.openInVlc(selectedPath);
    if (!opened) {
      const name = selectedPath.split("/").pop() ?? selectedPath;
      alert(t('Cannot play "$1"\n\nInstall VLC to play this file format.', name));
    }
    return;
  }

  if (audio.src && !audio.paused) {
    audio.pause();
    return;
  }

  if (audio.src && audio.paused) {
    audio.play().catch((err) => onPlaybackFailure(selectedPath, err));
    return;
  }

  updateInfoText();
  setAudioSource(selectedPath!);
  audio.play().catch((err) => onPlaybackFailure(selectedPath, err));
}

playBtn.addEventListener("click", togglePlayPause);

let onPrev: (() => void) | null = null;
let onNext: (() => void) | null = null;

export function setNavCallbacks(prev: () => void, next: () => void): void {
  onPrev = prev;
  onNext = next;
}

export function updateNavButtons(canPrev: boolean, canNext: boolean): void {
  prevBtn.disabled = !canPrev;
  nextBtn.disabled = !canNext;
}

prevBtn.addEventListener("click", () => onPrev?.());
nextBtn.addEventListener("click", () => onNext?.());

/* ── Persistence ─────────────────────────────────────────── */

async function loadPersistedState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data) {
      if (data.volume !== undefined && data.volume !== null) {
        audio.volume = parseFloat(data.volume);
        volumeSlider.value = String(audio.volume);
      }
      if (data.muted !== undefined && data.muted !== null) {
        audio.muted = !!data.muted;
      }
      updateSliderFill();
      const np = data["now-playing"];
      if (np && typeof np === "object" && np.path && typeof np.path === "string") {
        let row;
        try {
          const rows = await window.electronAPI.lookupPaths([np.path]);
          row = rows?.[0];
        } catch { /* ignore */ }
        if (row) {
          selectedPath = np.path;
          selectedTitle = row.title ?? null;
          updateInfoText();
          updateNowPlayingRating(np.path);
          await new Promise<void>((resolve) => {
            const onMeta = () => {
              audio.removeEventListener("loadedmetadata", onMeta);
              audio.removeEventListener("error", onError);
              if (np["current-time"] > 0 && np["current-time"] < audio.duration) {
                audio.currentTime = np["current-time"];
                const pct = (np["current-time"] / audio.duration) * 100;
                progressFill.style.transition = "none";
                progressFill.style.width = pct + "%";
              }
              currentTimeEl.textContent = formatTime(audio.currentTime);
              resolve();
            };
            const onError = () => {
              audio.removeEventListener("loadedmetadata", onMeta);
              audio.removeEventListener("error", onError);
              resolve();
            };
            audio.addEventListener("loadedmetadata", onMeta);
            audio.addEventListener("error", onError);
            setAudioSource(np.path);
          });
        }
      }
    }
  } catch { /* ignore */ }
}

window.addEventListener("beforeunload", () => {
  audio.pause();
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  if (selectedPath) {
    const payload = {
      path: selectedPath,
      "current-time": audio.currentTime,
      "search-query": searchInput?.value,
      volume: audio.volume,
      muted: audio.muted,
    };
    window.electronAPI.saveNowPlayingSync(payload);
  }
});

export function refreshListIndicator(): void { updateListPlayingIndicator(); }

function isPlayableFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return playableExtensions.has("." + ext);
}

export { loadPersistedState as initNowPlaying };
