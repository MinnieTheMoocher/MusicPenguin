export enum FILE_PROBE_ERROR {
  WAV_WRAPPED_MP3 = 1,
}

function bytesToString(data: Uint8Array, i: number, count: number): string {
  let s = "";
  for (let k = 0; k < count; k++) {
    s += String.fromCharCode(data[i + k] ?? 0);
  }
  return s;
}

function readU32le(data: Uint8Array, i: number): number {
  return (data[i] ?? 0) | ((data[i + 1] ?? 0) << 8) | ((data[i + 2] ?? 0) << 16) | ((data[i + 3] ?? 0) << 24);
}

function readU16le(data: Uint8Array, i: number): number {
  return (data[i] ?? 0) | ((data[i + 1] ?? 0) << 8);
}

function syncsafe(data: Uint8Array, i: number): number {
  return ((data[i] ?? 0) & 0x7f) << 21 |
    ((data[i + 1] ?? 0) & 0x7f) << 14 |
    ((data[i + 2] ?? 0) & 0x7f) << 7 |
    ((data[i + 3] ?? 0) & 0x7f);
}

/**
 * Detects a file that carries the .mp3 extension but whose payload is a
 * RIFF/WAVE container (WAVE_FORMAT_MPEGLAYER3 = 0x55) holding the real
 * MPEG-3 stream — the defect found by fix_wav_mp3.py. Such files are not
 * playable by an HTML <audio> element.
 */
function checkWavWrappedMp3(data: Uint8Array): boolean {
  let pos = 0;
  if (bytesToString(data, 0, 3) === "ID3") {
    if (data.length < 10) return false;
    pos = 10 + syncsafe(data, 6);
  }
  if (bytesToString(data, pos, 4) !== "RIFF") return false;
  if (bytesToString(data, pos + 8, 4) !== "WAVE") return false;
  let q = pos + 12;
  for (let guard = 0; guard < 30; guard++) {
    if (q + 8 > data.length) return false;
    const cid = bytesToString(data, q, 4);
    const csize = readU32le(data, q + 4);
    if (cid === "fmt ") {
      if (q + 10 > data.length) return false;
      return readU16le(data, q + 8) === 0x55;
    }
    q += 8 + csize + (csize & 1);
  }
  return false;
}

/**
 * Inspects an in-memory file for known structural defects. New checks can be
 * added here as more error types are discovered.
 */
export function probeFileForErrors(data: Uint8Array): FILE_PROBE_ERROR[] {
  const errors: FILE_PROBE_ERROR[] = [];
  if (checkWavWrappedMp3(data)) {
    errors.push(FILE_PROBE_ERROR.WAV_WRAPPED_MP3);
  }
  return errors;
}
