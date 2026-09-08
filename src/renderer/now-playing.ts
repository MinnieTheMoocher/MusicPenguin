import { audio, formatTime } from "./audio.js";
import { showTheaterMode } from "./theatermode.js";
import { setupRatingHover } from "./list-view.js";
import { updatePlaylistPlayingIndicator } from "./playlist-panel.js";
import { onPlaybackFailure } from "./playback-error.js";
import { getExternalPlayer } from "./external-player.js";
import { t } from "../common/i18n/index.js";
import { debugLog } from "./debug-log.js";
import { ICON_SPEAKER, ICON_MUTE, ICON_SHUFFLE_ON, ICON_SHUFFLE_OFF, ICON_REPEAT_OFF, ICON_REPEAT_ONE, ICON_REPEAT_ALL } from "./icons.js";

const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const currentTimeEl = document.getElementById("current-time") as HTMLSpanElement;
const durationEl = document.getElementById("duration") as HTMLSpanElement;
const progressFill = document.getElementById("progress-fill") as HTMLDivElement;
const progressTrack = document.getElementById("progress-track") as HTMLDivElement;
const nowPlayingTitle = document.getElementById("now-playing-title") as HTMLDivElement;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
const volumeIcon = document.getElementById("volume-icon") as HTMLButtonElement;
const nowPlayingRating = document.getElementById("now-playing-rating") as HTMLSpanElement;

/* ── Global play mode (shuffle / repeat) ─────────────────────── */

export type RepeatMode = "off" | "one" | "all";

let shuffle = false;
let repeat: RepeatMode = "off";

const REPEAT_CYCLE: RepeatMode[] = ["off", "one", "all"];
const REPEAT_ICONS: Record<RepeatMode, string> = {
  off: ICON_REPEAT_OFF,
  one: ICON_REPEAT_ONE,
  all: ICON_REPEAT_ALL,
};

let playModeChangeCallbacks: Array<() => void> = [];

export function onPlayModeChange(cb: () => void): void {
  playModeChangeCallbacks.push(cb);
}

export function getShuffle(): boolean { return shuffle; }
export function getRepeat(): RepeatMode { return repeat; }

const shuffleBtn = document.getElementById("shuffle-btn") as HTMLButtonElement;
const repeatBtn = document.getElementById("repeat-btn") as HTMLButtonElement;

function updateShuffleBtn(): void {
  shuffleBtn.innerHTML = shuffle ? ICON_SHUFFLE_ON : ICON_SHUFFLE_OFF;
  shuffleBtn.title = t(shuffle ? "Disable Shuffle" : "Enable Shuffle");
  shuffleBtn.classList.toggle("active", shuffle);
}

function updateRepeatBtn(): void {
  const next = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(repeat) + 1) % REPEAT_CYCLE.length]!;
  repeatBtn.innerHTML = REPEAT_ICONS[repeat];
  repeatBtn.title = t(next === "all" ? "Repeat All" : next === "one" ? "Repeat 1" : "Repeat Off");
  repeatBtn.classList.toggle("active", repeat !== "off");
}

shuffleBtn.addEventListener("click", async () => {
  shuffle = !shuffle;
  if (shuffle) shuffleHistory.clear();
  updateShuffleBtn();
  dispatchPlayModeChange();
  await persistPlayMode();
});

repeatBtn.addEventListener("click", async () => {
  const idx = REPEAT_CYCLE.indexOf(repeat);
  repeat = REPEAT_CYCLE[(idx + 1) % REPEAT_CYCLE.length]!;
  updateRepeatBtn();
  dispatchPlayModeChange();
  await persistPlayMode();
});

function dispatchPlayModeChange(): void {
  playModeChangeCallbacks.forEach((cb) => cb());
  document.dispatchEvent(new CustomEvent("playmode-changed"));
}

/* ── Smart shuffle history ───────────────────────────────────── */

let shuffleHistory: Set<string> = new Set();
let shuffleHistorySourceId: string = "";

export function resetShuffleHistory(sourceId?: string): void {
  const id = sourceId ?? "";
  if (shuffleHistorySourceId !== id) {
    shuffleHistory.clear();
    shuffleHistorySourceId = id;
  }
}

export function pickRandomExcluding(paths: string[], currentPath: string | null): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0]!;

  let candidates = paths.filter((p) => p !== currentPath && !shuffleHistory.has(p));
  if (candidates.length === 0) {
    shuffleHistory.clear();
    candidates = paths.filter((p) => p !== currentPath);
  }
  if (candidates.length === 0) return null;

  const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
  shuffleHistory.add(pick);
  return pick;
}

let playableExtensions: Set<string> = new Set();

export async function initPlayableExtensions(): Promise<void> {
  try {
    const exts = await window.electronAPI.getPlayableExtensions();
    playableExtensions = new Set(exts);
  } catch { /* ignore */ }
}

export let selectedPath: string | null = null;
let selectedTitle: string | null = null;

/* ── Significant-play tracking (playcount) ───────────────────── */
/* Only "significant" plays increment the playcount: a play counts
 * when at least MIN_PLAY_SECONDS were played without skipping ahead,
 * or when playback reached the natural end of the track (which also
 * covers tracks shorter than MIN_PLAY_SECONDS). Briefly testing a
 * file (play a few seconds, stop/skip) never counts. */
const MIN_PLAY_SECONDS = 20;
let pcPath: string | null = null;
let pcPlayedSeconds = 0;
let pcLastPosition = -1;
let pcCounted = false;

function resetPlaycountTracking(filePath: string | null): void {
  pcPath = filePath;
  pcPlayedSeconds = 0;
  pcLastPosition = -1;
  pcCounted = false;
}

function registerPlaycount(): void {
  const trackedPath = pcPath;
  if (!trackedPath || pcCounted) return;
  pcCounted = true;
  window.electronAPI.incrementPlaycount(trackedPath).then((count) => {
    document.dispatchEvent(new CustomEvent("playcount-updated", {
      detail: { path: trackedPath, playcount: count },
    }));
  });
}

function evaluatePlaycount(): void {
  if (!pcPath || pcCounted) return;
  const dur = audio.duration;
  const required = Number.isFinite(dur) && dur > 0
    ? Math.min(MIN_PLAY_SECONDS, dur)
    : MIN_PLAY_SECONDS;
  if (pcPlayedSeconds >= required) registerPlaycount();
}

/* After playing files in an external player (context menu or unplayable-file
 * fallback, counted in the main process), refresh the playcount in the UI. */
export function noteExternalPlays(paths: string[]): void {
  if (paths.length === 0) return;
  window.electronAPI.lookupPaths(paths).then((rows) => {
    for (const row of rows ?? []) {
      document.dispatchEvent(new CustomEvent("playcount-updated", {
        detail: { path: row.path, playcount: row.playcount },
      }));
    }
  }).catch(() => { /* ignore */ });
}

audio.addEventListener("timeupdate", () => {
  if (!pcPath || pcCounted) return;
  const pos = audio.currentTime;
  const delta = pcLastPosition < 0 ? 0 : pos - pcLastPosition;
  pcLastPosition = pos;
  // ignore seeks/jumps: only continuously played time accrues
  if (delta <= 0 || delta > 1) return;
  pcPlayedSeconds += delta;
  evaluatePlaycount();
});

let actuallyPlaying = false;
let mprisCanNext = false;
let mprisCanPrev = false;
let restoringPersistedState = false;
export function isRestoringPersistedState(): boolean { return restoringPersistedState; }

let onPathChangeCallback: ((path: string | null) => void) | null = null;
export function onSelectedPathChange(cb: (path: string | null) => void): void {
  onPathChangeCallback = cb;
}

export function isActuallyPlaying(): boolean {
  return actuallyPlaying;
}

function sendMprisState(extra?: Record<string, unknown>): void {
  const status = audio.paused ? "Stopped" : "Playing";
  window.electronAPI.updateMprisState({
    status,
    track: selectedPath ? {
      title: selectedTitle || undefined,
      path: selectedPath,
    } : null,
    position: audio.currentTime,
    volume: audio.muted ? 0 : audio.volume,
    canNext: mprisCanNext,
    canPrev: mprisCanPrev,
    ...extra,
  });
}

export function setMprisNavState(canPrev: boolean, canNext: boolean): void {
  mprisCanPrev = canPrev;
  mprisCanNext = canNext;
  sendMprisState();
}

function isHttpUrl(p: string): boolean {
  return /^https?:\/\//i.test(p);
}

function toFileUrl(path: string): string {
  /* DLNA tracks are stored with their stream URL as "path" */
  if (isHttpUrl(path)) return path;
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
      cell.innerHTML = actuallyPlaying && row.dataset.path === selectedPath ? ICON_SPEAKER : "";
    }
  }
  updatePlaylistPlayingIndicator();
}

export function clearPlayingIndicators(): void {
  actuallyPlaying = false;
  updateListPlayingIndicator();
}

/* Tear down the Now Playing widget entirely — used when the database is
   emptied so it does not keep pointing at a track (or showing an audio
   element) for files that no longer exist. */
export function resetNowPlayingWidget(): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  selectedPath = null;
  selectedTitle = null;
  onPathChangeCallback?.(null);
  updateInfoText();
  setPlayButton(false);
  progressFill.style.transition = "none";
  progressFill.style.width = "0%";
  currentTimeEl.textContent = "00:00";
  durationEl.textContent = "00:00";
  nowPlayingRating.innerHTML = "";
  delete nowPlayingRating.dataset.trackPath;
}

function updateVolumeIcon(): void {
  const muted = audio.muted || audio.volume === 0;
  volumeIcon.innerHTML = muted ? ICON_MUTE : ICON_SPEAKER;
  volumeIcon.title = t(muted ? "Unmute" : "Mute");
}

function updateInfoText(): void {
  if (selectedTitle) {
    nowPlayingTitle.textContent = selectedTitle;
  } else if (selectedPath) {
    const name = selectedPath.split("/").pop()?.split("\\").pop() || selectedPath;
    nowPlayingTitle.textContent = name.replace(/\.[^.]+$/, "");
  } else {
    nowPlayingTitle.textContent = "";
  }
}

function setPlayButton(playing: boolean): void {
  playBtn.classList.toggle("playing", playing);
  playBtn.title = t(playing ? "Pause" : "Play");
}

document.addEventListener("language-changed", () => {
  updateInfoText();
  updateVolumeIcon();
  setPlayButton(!audio.paused && !!audio.src);
  updateShuffleBtn();
  updateRepeatBtn();
});

function resetProgress(): void {
  progressFill.style.transition = "none";
  progressFill.style.width = "0%";
  currentTimeEl.textContent = "00:00";
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
  /* Layer-3 duration gap filler: tracks stored with an unknown length
     (NULL) get their real duration from this <audio> element once the
     browser demuxer knows it, and it is persisted back to SQLite. */
  const path = selectedPath;
  if (path && Number.isFinite(audio.duration) && audio.duration > 0) {
    window.electronAPI.fillTrackDuration(path, audio.duration).then((updated) => {
      if (updated) {
        document.dispatchEvent(new CustomEvent("track-duration-known", {
          detail: { path, duration: audio.duration },
        }));
      }
    }).catch(() => { /* ignore */ });
  }
});

let trackEndCallbacks: Array<() => void> = [];
let navStateChangeCallbacks: Array<() => void> = [];

export function onNavStateChange(cb: () => void): void {
  navStateChangeCallbacks.push(cb);
}

export function onTrackEnd(cb: () => void): void {
  trackEndCallbacks.push(cb);
}

/* Registered before the general "ended" handler below so the count is
 * recorded before auto-advance switches to the next track. */
audio.addEventListener("ended", () => {
  // reaching the natural end counts as playing (the rest of) the track
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    pcPlayedSeconds = Math.max(pcPlayedSeconds, audio.duration);
  }
  evaluatePlaycount();
  resetPlaycountTracking(null);
});

audio.addEventListener("ended", () => {
  actuallyPlaying = false;
  setPlayButton(false);
  resetProgress();
  sendMprisState({ status: "Stopped" });
  trackEndCallbacks.forEach((cb) => cb());
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("pause", () => {
  actuallyPlaying = false;
  setPlayButton(false);
  stopProgressAnimation();
  sendMprisState({ status: "Paused" });
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("play", () => {
  // safety net: start tracking whenever playback of an untracked track begins
  if (selectedPath && pcPath !== selectedPath) resetPlaycountTracking(selectedPath);
  setPlayButton(true);
  startProgressAnimation();
  sendMprisState({ status: "Playing" });
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("playing", () => {
  actuallyPlaying = true;
  startProgressAnimation();
  sendMprisState({ status: "Playing" });
  updateListPlayingIndicator();
  navStateChangeCallbacks.forEach((cb) => cb());
});

audio.addEventListener("error", () => {
  actuallyPlaying = false;
  setPlayButton(false);
  resetProgress();
  durationEl.textContent = "00:00";
  updateListPlayingIndicator();
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

let dragging = false;

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

nowPlayingTitle.addEventListener("dblclick", () => {
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

/* A tag re-scan may change the tags of the currently loaded track:
   refresh the now-playing text, its rating widget and the MPRIS
   metadata — the <audio> element itself is never touched. */
export async function refreshNowPlayingMetadata(path: string): Promise<void> {
  if (path !== selectedPath) return;
  try {
    const rows = await window.electronAPI.lookupPaths([path]);
    const row = rows?.[0];
    if (!row || path !== selectedPath) return;
    selectedTitle = row.title || null;
    setupRatingHover(nowPlayingRating, row.rating ?? 0, path);
  } catch { /* ignore */ }
  updateInfoText();
  sendMprisState();
}

export function setSelectedTrack(filePath: string | null, title?: string): void {
  if (!audio.src) {
    selectedPath = filePath;
    onPathChangeCallback?.(selectedPath);
  }
  selectedTitle = title ?? null;
  /* Deliberately NO rating update here: this fires on mere list
     selection. The widget must only ever show the LOADED/PLAYED
     track (loadTrack/playTrack/persisted-state restore). */
}

export async function loadTrack(filePath: string, title?: string): Promise<void> {
  if (!isPlayableFile(filePath)) {
    audio.pause();
    const player = getExternalPlayer();
    const result = await window.electronAPI.openInExternalPlayer(filePath, player);
    if (result.ok) {
      noteExternalPlays([filePath]);
    } else {
      const name = filePath.split("/").pop() ?? filePath;
      alert(t('Cannot play "$1"\n\nInstall an external player like VLC to play this file format.', name) +
        (result.error ? `\n\n${result.error}` : ""));
    }
    return;
  }
  selectedPath = filePath;
  onPathChangeCallback?.(selectedPath);
  selectedTitle = title ?? null;
  updateInfoText();
  updateNowPlayingRating(filePath);
  setAudioSource(filePath);
  resetPlaycountTracking(filePath);
}

/* ── Refresh tags on play ──────────────────────────────────── */
/* Playing a local file is a free opportunity to re-read its tags and
   update the database (fresh title/artist/... plus any duration gap).
   Stream URLs (DLNA) are skipped — no locally readable tags; their
   duration is learned from this very <audio> element instead. A short
   cooldown keeps pause/resume cycles and instant replays from hammering
   the background queue with redundant reads of the same file. */
const TAG_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const lastTagRefreshAt = new Map<string, number>();

function refreshTagsOnPlay(filePath: string): void {
  if (/^https?:\/\//i.test(filePath)) return;
  const now = Date.now();
  const last = lastTagRefreshAt.get(filePath) ?? 0;
  if (now - last < TAG_REFRESH_COOLDOWN_MS) return;
  lastTagRefreshAt.set(filePath, now);
  /* onlyIfModified: files whose mtime is unchanged since their last
     tag scan are skipped entirely — the read only happens when the
     file actually changed (or was never scanned). */
  window.electronAPI.rescanFiles([filePath], { onlyIfModified: true }).catch(() => { /* ignore */ });
}

export async function playTrack(filePath: string, title?: string): Promise<void> {
  if (!isPlayableFile(filePath)) {
    audio.pause();
    const player = getExternalPlayer();
    const result = await window.electronAPI.openInExternalPlayer(filePath, player);
    if (result.ok) {
      noteExternalPlays([filePath]);
    } else {
      const name = filePath.split("/").pop() ?? filePath;
      alert(t('Cannot play "$1"\n\nInstall an external player like VLC to play this file format.', name) +
        (result.error ? `\n\n${result.error}` : ""));
    }
    return;
  }
  selectedPath = filePath;
  onPathChangeCallback?.(selectedPath);
  selectedTitle = title ?? null;
  updateInfoText();
  updateNowPlayingRating(filePath);
  setAudioSource(filePath);
  audio.play().catch((err) => onPlaybackFailure(filePath, err));
  resetPlaycountTracking(filePath);
  refreshTagsOnPlay(filePath);
}

export async function togglePlayPause(): Promise<void> {
  if (!selectedPath) return;

  if (!isPlayableFile(selectedPath)) {
    audio.pause();
    const player = getExternalPlayer();
    const result = await window.electronAPI.openInExternalPlayer(selectedPath, player);
    if (result.ok) {
      noteExternalPlays([selectedPath]);
    } else {
      const name = selectedPath.split("/").pop() ?? selectedPath;
      alert(t('Cannot play "$1"\n\nInstall an external player like VLC to play this file format.', name) +
        (result.error ? `\n\n${result.error}` : ""));
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
  refreshTagsOnPlay(selectedPath!);
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

async function persistPlayMode(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      shuffle,
      repeat,
    });
  } catch { /* ignore */ }
}

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
      if (typeof data.shuffle === "boolean") shuffle = data.shuffle;
      if (data.repeat === "one" || data.repeat === "all") repeat = data.repeat;
      updateShuffleBtn();
      updateRepeatBtn();
      const np = data["now-playing"];
      if (np && typeof np === "object" && np.path && typeof np.path === "string") {
        let row;
        try {
          const rows = await window.electronAPI.lookupPaths([np.path]);
          row = rows?.[0];
        } catch { /* ignore */ }
        if (row) {
          selectedPath = np.path;
          onPathChangeCallback?.(selectedPath);
          selectedTitle = row.title ?? null;
          updateInfoText();
          updateNowPlayingRating(np.path);
          restoringPersistedState = true;
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
          restoringPersistedState = false;
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

export function isPlayableFile(filePath: string): boolean {
  /* Strip query/hash from stream URLs before the extension check */
  const clean = isHttpUrl(filePath) ? filePath.split(/[?#]/)[0] ?? filePath : filePath;
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return playableExtensions.has("." + ext);
}

export { loadPersistedState as initNowPlaying };

/* ── Media keys (globalShortcut from main process) ───────────── */
window.electronAPI.onMediaKey?.((action: string) => {
  debugLog("[media-key IPC]", action, "onNext:", !!onNext, "onPrev:", !!onPrev);
  if (action === "play-pause") togglePlayPause();
  else if (action === "next") onNext?.();
  else if (action === "previous") onPrev?.();
});

/* ── Media keys (fallback for when globalShortcut doesn't fire) ── */
document.addEventListener("keydown", (e) => {
  if (e.code === "MediaPlayPause" || e.code === "MediaTrackNext" || e.code === "MediaTrackPrevious") {
    debugLog("[keydown]", e.code, "onNext:", !!onNext, "onPrev:", !!onPrev);
  }
  if (e.code === "MediaPlayPause") {
    e.preventDefault();
    togglePlayPause();
  } else if (e.code === "MediaTrackNext") {
    e.preventDefault();
    onNext?.();
  } else if (e.code === "MediaTrackPrevious") {
    e.preventDefault();
    onPrev?.();
  }
});
