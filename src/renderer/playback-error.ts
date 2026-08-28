/* ── Playback failure handling ────────────────────────── */

import { probeFileForErrors, extractMp3FromWavMp3, FILE_PROBE_ERROR } from "./file-probe.js";
import { clearPlayingIndicators, isRestoringPersistedState, noteExternalPlays } from "./now-playing.js";
import { getExternalPlayer, getExternalPlayerDisplayName } from "./external-player.js";
import { audio } from "./audio.js";
import { t } from "../common/i18n/index.js";

let handlingSource: string | null = null;
let activeBlobUrl: string | null = null;

/* Theater mode registers a handler here that silently skips over an
   unplayable track instead of letting the dialog below appear.
   Returning true means the failure was handled (or swallowed). */
let silentSkipHandler: (() => boolean) | null = null;

export function setSilentSkipHandler(handler: (() => boolean) | null): void {
  silentSkipHandler = handler;
}

/**
 * Attempts to play a WAV-wrapped MP3 by stripping the wrapper and playing
 * the raw MP3 data from a blob URL.  Returns true on success, false if
 * extraction or playback failed.
 */
async function tryWavWrappedMp3Workaround(filePath: string): Promise<boolean> {
  try {
    const buf = await window.electronAPI.readFile(filePath);
    if (!buf) return false;
    const mp3Data = extractMp3FromWavMp3(buf);
    if (!mp3Data) return false;

    const ab = new ArrayBuffer(mp3Data.length);
    new Uint8Array(ab).set(mp3Data);
    const blob = new Blob([ab], { type: "audio/mpeg" });
    const blobUrl = URL.createObjectURL(blob);

    // Revoke any previously-created blob URL to free memory.
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }
    activeBlobUrl = blobUrl;

    return await new Promise<boolean>((resolve) => {
      const onLoaded = () => {
        cleanup();
        audio.play().then(() => resolve(true)).catch(() => resolve(false));
      };
      const onError = () => {
        cleanup();
        URL.revokeObjectURL(blobUrl);
        if (activeBlobUrl === blobUrl) activeBlobUrl = null;
        resolve(false);
      };
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("error", onError);
      audio.src = blobUrl;
    });
  } catch {
    return false;
  }
}

/**
 * Runs the file probe for a failed playback and shows an explanatory dialog
 * (with an external-player fallback when available).  For WAV-wrapped MP3 files under
 * 20 MB the raw MP3 stream is extracted and played from memory first.
 * Guarded so that both the <audio> "error" event and a rejected play()
 * promise for the same file only ever produce one dialog.
 */
export async function handleAudioPlaybackError(filePath: string | null): Promise<void> {
  if (!filePath || handlingSource === filePath) return;
  if (isRestoringPersistedState()) return;
  if (silentSkipHandler?.()) return;
  handlingSource = filePath;
  clearPlayingIndicators();
  try {
    const name = filePath.split("/").pop()?.split("\\").pop() || filePath || t("Unknown file");
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const isMpegAudio = ext === "mp3" || ext === "mp2";
    let isWavWrapped = false;
    let isLayerII = false;
    if (isMpegAudio) {
      const workaroundOk = await tryWavWrappedMp3Workaround(filePath);
      if (workaroundOk) return; // file is now playing from memory

      // Probe for known structural defects / unsupported codecs.
      try {
        const buf = await window.electronAPI.readFile(filePath);
        if (buf) {
          const errs = probeFileForErrors(buf);
          isWavWrapped = errs.includes(FILE_PROBE_ERROR.WAV_WRAPPED_MP3);
          isLayerII = errs.includes(FILE_PROBE_ERROR.MPEG_LAYER_II);
        }
      } catch { /* treat as not probed */ }
    }

    /* Layer II files play fine in external players — route there
       silently instead of showing a dialog the user would just click
       through. */
    if (isLayerII) {
      const player = getExternalPlayer();
      const playerAvailable = await window.electronAPI.isExternalPlayerAvailable(player);
      if (playerAvailable) {
        const opened = await window.electronAPI.openInExternalPlayer(filePath, player);
        if (opened) noteExternalPlays([filePath]);
        return;
      }
    }

    let message = isWavWrapped
      ? t("This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.")
      : isLayerII
        ? t("This file is MPEG Layer II audio, which the built-in player cannot decode.")
        : t("Very sorry, but this file appears to be unplayable by MusicPenguin.");
    message += "\n" + t("Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.");
    const buttons: string[] = [];
    const player = getExternalPlayer();
    const playerAvailable = await window.electronAPI.isExternalPlayerAvailable(player);
    if (playerAvailable) buttons.push(t("Try to play in $1 instead", getExternalPlayerDisplayName()));
    buttons.push(t("OK"));
    const clicked = await window.electronAPI.showMessageBox({
      title: t('Cannot play "$1"', name),
      message,
      buttons,
    });
    if (playerAvailable && clicked === 0) {
      const opened = await window.electronAPI.openInExternalPlayer(filePath, player);
      if (opened) noteExternalPlays([filePath]);
    }
  } finally {
    handlingSource = null;
  }
}

/**
 * Callback for a rejected audio.play() promise. AbortError (play interrupted by
 * a newer src or pause) and NotAllowedError (autoplay restriction) are not file
 * errors and are only logged; every other failure runs the file probe.
 */
export function onPlaybackFailure(filePath: string | null, err: unknown): void {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "NotAllowedError") {
    console.warn("playback aborted:", err);
    return;
  }
  console.warn("playback failed:", err);
  void handleAudioPlaybackError(filePath);
}
