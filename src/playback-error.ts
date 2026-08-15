/* ── Playback failure handling ────────────────────────── */

import { probeFileForErrors, FILE_PROBE_ERROR } from "./file-probe.js";
import { clearPlayingIndicators } from "./now-playing.js";
import { t } from "./i18n/index.js";

let handlingSource: string | null = null;

/**
 * Runs the file probe for a failed playback and shows an explanatory dialog
 * (with a VLC fallback when available). Guarded so that both the <audio>
 * "error" event and a rejected play() promise for the same file only ever
 * produce one dialog.
 */
export async function handleAudioPlaybackError(filePath: string | null): Promise<void> {
  if (!filePath || handlingSource === filePath) return;
  handlingSource = filePath;
  clearPlayingIndicators();
  try {
    const name = filePath.split("/").pop()?.split("\\").pop() || filePath || t("Unknown file");
    const isMp3 = filePath.toLowerCase().endsWith(".mp3");
    let isWavWrapped = false;
    if (isMp3) {
      try {
        const buf = await window.electronAPI.readFile(filePath);
        if (buf) {
          isWavWrapped = probeFileForErrors(buf).includes(FILE_PROBE_ERROR.WAV_WRAPPED_MP3);
        }
      } catch { /* treat as not probed */ }
    }
    let message = isWavWrapped
      ? t("This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.")
      : t("Very sorry, but this file appears to be unplayable by MusicPenguin.");
    message += "\n" + t("Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.");
    const buttons: string[] = [];
    const vlcAvailable = await window.electronAPI.isVlcAvailable();
    if (vlcAvailable) buttons.push(t("Try to play in VLC instead"));
    buttons.push(t("OK"));
    const clicked = await window.electronAPI.showMessageBox({
      title: t('Cannot play "$1"', name),
      message,
      buttons,
    });
    if (vlcAvailable && clicked === 0) {
      await window.electronAPI.openInVlc(filePath);
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
