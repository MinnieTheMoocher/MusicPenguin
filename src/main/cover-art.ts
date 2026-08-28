import * as path from "path";
import * as fs from "fs";
import { parseFile } from "music-metadata";
import { nativeImage } from "electron";

import { withTimeout } from "./utils";
import { httpRequestBuffer } from "./dlna";
import {
  COVER_IMAGE_EXTENSIONS,
  FRONT_COVER_FILENAMES,
  REAR_COVER_FILENAMES,
} from "../common/config";

const EXT_PATTERN = COVER_IMAGE_EXTENSIONS.join("|");
const FRONT_FOLDER_IMAGE_RE = new RegExp(`^(?:${FRONT_COVER_FILENAMES.join("|")})\\.(?:${EXT_PATTERN})$`, "i");
const ANY_FOLDER_IMAGE_RE = new RegExp(`.*\\.(?:${EXT_PATTERN})$`, "i");

export function resizeToThumbnail(dataUrl: string, maxSize: number): string {
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    const { width, height } = img.getSize();
    if (width <= maxSize && height <= maxSize) return dataUrl;
    const resized = img.resize({ width: maxSize, height: maxSize, quality: "best" });
    return resized.toDataURL();
  } catch {
    return dataUrl;
  }
}

function ensureJpegComplete(buf: Buffer): Buffer {
  if (buf.length >= 2 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9) return buf;
  const out = new Uint8Array(buf.length + 2);
  out.set(buf);
  out[buf.length] = 0xff;
  out[buf.length + 1] = 0xd9;
  return Buffer.from(out);
}

function pictureToDataUrl(pic: { format: string; data: Uint8Array }): string {
  let raw: Buffer = Buffer.from(pic.data);
  if (raw[0] === 0xff && raw[1] === 0xd8) raw = ensureJpegComplete(raw);
  return `data:${pic.format};base64,${raw.toString("base64")}`;
}

/* Image file named like the audio track itself ("song.mp3" → "song.jpg")
   — takes precedence over folder-wide cover names. */
function findTrackNamedImage(entries: string[], filePath: string): string | null {
  const base = path.basename(filePath);
  const dot = base.lastIndexOf(".");
  const stem = (dot >= 0 ? base.slice(0, dot) : base).toLowerCase();
  if (!stem) return null;
  return entries.find((e) =>
    COVER_IMAGE_EXTENSIONS.some((ext) => e.toLowerCase() === `${stem}.${ext}`)) ?? null;
}

export async function getCoverArt(filePath: string, maxSize?: number): Promise<string | null> {
  let dataUrl: string | null = null;

  try {
    const { common } = await withTimeout(parseFile(filePath, { duration: false }), 10000);
    if (common.picture && common.picture.length > 0) {
      dataUrl = pictureToDataUrl(common.picture[0]!);
    }
  } catch { /* fall through */ }

  if (!dataUrl) {
    try {
      const dir = path.dirname(filePath);
      const entries = fs.readdirSync(dir);
      const trackImage = findTrackNamedImage(entries, filePath);
      if (trackImage) {
        dataUrl = readFolderImage(path.join(dir, trackImage));
      }
      if (!dataUrl) {
        const folderImage = entries.find((e) => FRONT_FOLDER_IMAGE_RE.test(e));
        if (folderImage) {
          dataUrl = readFolderImage(path.join(dir, folderImage));
        }
      }
    } catch { /* fall through */ }
  }

  if (dataUrl && maxSize) dataUrl = resizeToThumbnail(dataUrl, maxSize);
  return dataUrl;
}

function readFolderImage(fullPath: string): string | null {
  try {
    const data = fs.readFileSync(fullPath);
    if (data[0] === 0xff && data[1] === 0xd8) {
      return `data:image/jpeg;base64,${ensureJpegComplete(data).toString("base64")}`;
    }
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return `data:image/png;base64,${data.toString("base64")}`;
    }
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) { // "GIF"
      return `data:image/gif;base64,${data.toString("base64")}`;
    }
    if (
      data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && // "RIFF"
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50 // "WEBP"
    ) {
      return `data:image/webp;base64,${data.toString("base64")}`;
    }
  } catch { /* ignore */ }
  return null;
}

/* ── DLNA cover art (upnp:albumArtURI) ────────────────────── */

/* Magic bytes win over the declared content type — servers
   occasionally mislabel their album art responses. */
function bufferToImageDataUrl(buf: Buffer, contentType: string): string | null {
  const base64 = buf.toString("base64");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return `data:image/jpeg;base64,${base64}`;
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return `data:image/png;base64,${base64}`;
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return `data:image/gif;base64,${base64}`;
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // "WEBP"
  ) {
    return `data:image/webp;base64,${base64}`;
  }
  const match = /^image\/(jpeg|png|gif|webp)/i.exec(contentType.trim());
  return match ? `data:${match[1]!.toLowerCase()};base64,${base64}` : null;
}

/* Pixel dimensions from image header bytes (JPEG SOF scan, PNG IHDR,
   GIF logical screen). WEBP variants are not decoded — those fall
   back to byte-length comparison. */
function pixelDimensions(buf: Buffer): { w: number; h: number } | null {
  const isPng = buf.length >= 24 && buf[0] === 0x89 && buf.readUInt32BE(12) === 0x49484452; // "IHDR"
  if (isPng) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) { // "GIF"
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) { // JPEG marker walk
    let pos = 2;
    while (pos + 9 <= buf.length) {
      if (buf[pos] !== 0xff) { pos++; continue; }
      const marker = buf[pos + 1]!;
      /* fill bytes / standalone markers carry no length */
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(pos + 5), w: buf.readUInt16BE(pos + 7) };
      }
      pos += 2 + buf.readUInt16BE(pos + 2);
    }
  }
  return null;
}

interface ArtCandidate {
  dataUrl: string;
  /* resolved absolute URI of this candidate */
  artUrl: string;
  /* ranking score: pixel area when decodable, else byte size */
  score: number;
}

export interface DlnaCoverResult {
  dataUrl: string;
  /* The winning (largest) candidate's resolved URL — callers persist it
     back to the DB so later lookups need only a single request. */
  artUrl: string;
}

/* Fetch a DLNA track's cover and turn it into a data URL. An item may
   announce several art URIs (thumbnail + full-size variants, unlabelled
   by the UPnP spec): all candidates are downloaded in parallel and the
   largest image wins. Relative art URIs are resolved against the
   track's stream URL. Returns null only when nothing usable arrives. */
export async function fetchDlnaCoverArt(streamUrl: string, artUrlSpec: string): Promise<DlnaCoverResult | null> {
  const candidates = [...new Set(
    artUrlSpec.split("\n").map((s) => s.trim()).filter(Boolean),
  )].slice(0, 8);
  if (candidates.length === 0) return null;

  const settled = await Promise.all(candidates.map(async (artUrl): Promise<ArtCandidate | null> => {
    let url = artUrl;
    try {
      url = new URL(artUrl, streamUrl).toString();
    } catch { /* keep as-is; httpRequestBuffer rejects invalid URLs */ }
    try {
      const res = await httpRequestBuffer(url, 10000);
      if (res.status !== 200 || res.body.length === 0) return null;
      const dims = pixelDimensions(res.body);
      const dataUrl = bufferToImageDataUrl(res.body, res.contentType);
      if (!dataUrl) return null;
      return { dataUrl, artUrl: url, score: dims ? dims.w * dims.h : res.body.length };
    } catch {
      return null;
    }
  }));

  let best: ArtCandidate | null = null;
  for (const candidate of settled) {
    if (!candidate) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best ? { dataUrl: best.dataUrl, artUrl: best.artUrl } : null;
}

/* The three cover-art groups for a track, disjunct by construction:
   front = embedded picture #1 > track-named image > front-named file;
   rearCovers = embedded pictures #2+ and rear/back-named files (config
   order); extraImages = all remaining images in the folder,
   alphabetically. Every image source lands in at most one group. */
export interface CoverArtGroups {
  front: string | null;
  rearCovers: string[];
  extraImages: string[];
}

function isRearNamedFile(entry: string): boolean {
  const lower = entry.toLowerCase();
  return REAR_COVER_FILENAMES.some((base) =>
    COVER_IMAGE_EXTENSIONS.some((ext) => lower === `${base}.${ext}`));
}

export async function getCoverArtGroups(filePath: string): Promise<CoverArtGroups> {
  const groups: CoverArtGroups = { front: null, rearCovers: [], extraImages: [] };
  const dir = path.dirname(filePath);

  let pictures: { format: string; data: Uint8Array }[] = [];
  try {
    const { common } = await withTimeout(parseFile(filePath, { duration: false }), 10000);
    pictures = common.picture ?? [];
  } catch { /* fall through */ }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch { /* fall through */ }

  const named = findTrackNamedImage(entries, filePath);
  if (pictures.length > 0) {
    groups.front = pictureToDataUrl(pictures[0]!);
  }
  if (!groups.front && named) {
    groups.front = readFolderImage(path.join(dir, named));
  }
  if (!groups.front) {
    const frontNamed = entries.find((e) => FRONT_FOLDER_IMAGE_RE.test(e));
    if (frontNamed) {
      groups.front = readFolderImage(path.join(dir, frontNamed));
    }
  }

  for (const pic of pictures.slice(1)) {
    groups.rearCovers.push(pictureToDataUrl(pic));
  }
  const extras: string[] = [];
  for (const entry of entries) {
    if (!ANY_FOLDER_IMAGE_RE.test(entry)) continue;
    if (FRONT_FOLDER_IMAGE_RE.test(entry)) continue; // front-type files stay out of the cycle
    if (entry === named) continue; // already the front cover
    if (isRearNamedFile(entry)) {
      const dataUrl = readFolderImage(path.join(dir, entry));
      if (dataUrl) groups.rearCovers.push(dataUrl);
    } else {
      extras.push(entry);
    }
  }
  for (const entry of extras.sort((a, b) => a.localeCompare(b))) {
    const dataUrl = readFolderImage(path.join(dir, entry));
    if (dataUrl) groups.extraImages.push(dataUrl);
  }

  return groups;
}
