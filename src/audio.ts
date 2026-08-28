export function formatTime(sec: number): string {
  const totalSec = Math.floor(sec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/* Plays half a second of silence right after app start so the audio
 * device gets acquired and initialized; otherwise the beginning of
 * the first played track can be inaudible. Uses a throwaway element
 * so playback state and playcount tracking stay untouched. */
export function warmUpAudioDevice(seconds = 0.5): void {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * seconds);
  const bytes = new Uint8Array(44 + numSamples * 2);
  const dv = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  dv.setUint32(4, 36 + numSamples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true); // PCM
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  dv.setUint32(40, numSamples * 2, true);

  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const warmer = new Audio(url);
  const cleanup = (): void => {
    URL.revokeObjectURL(url);
  };
  warmer.addEventListener("ended", cleanup, { once:true });
  warmer.addEventListener("error", cleanup, { once:true });
  warmer.play().catch(cleanup);
}

export const audio = new Audio();
warmUpAudioDevice();
