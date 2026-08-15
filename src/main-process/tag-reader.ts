import { spawn } from "child_process";
import * as fs from "fs";
import { parseFile } from "music-metadata";

import { withTimeout } from "./utils";
import { saveDb } from "./database";
import { TAG_BATCH_SIZE, NUM_TAG_READER_THREADS } from "../config";
import type { SqlJsDatabase, SendToRenderer } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function strField(v: unknown, key: string): string {
  if (isRecord(v)) {
    const val = v[key];
    return typeof val === "string" ? val : "";
  }
  return "";
}

/*
 * ── nas-bench.js ──────────────────────────────────────────────
 * Standalone benchmark used to determine NUM_TAG_READER_THREADS.
 * Run from the project root:  node nas-bench.js [num-files]
 *
 * Results for 50 random MP3s, clean run:
 *
 *   Conc │  Files │   Time (s) │  Files/s │ Errors
 *   ─────┼────────┼────────────┼──────────┼───────
 *     1  │    50  │     2.68   │    18.6  │     0
 *     2  │    50  │     0.66   │    76.1  │     0
 *     3  │    50  │     0.27   │   185.5  │     0
 *     4  │    50  │     0.23   │   220.1  │     0
 *     5  │    50  │     0.24   │   207.6  │     0
 *     6  │    50  │     0.21   │   237.0  │     0
 *     7  │    50  │     0.25   │   203.6  │     0
 *     8  │    50  │     0.25   │   201.6  │     0
 *     9  │    50  │     0.20   │   250.5  │     0
 *    10  │    50  │     0.26   │   195.4  │     0
 *    14  │    50  │     0.17   │   290.2  │     0
 *    20  │    50  │     0.20   │   246.2  │     0
 *    30  │    50  │     0.17   │   286.1  │     0
 *
 * Throughput plateaus around concurrency 4-6; higher values add noise
 * but no measurable gain.
 * ──────────────────────────────────────────────────────────────
 *
 * ── nas-bench.js source ──────────────────────────────────────
 * const fs   = require("fs");
 * const path = require("path");
 * const os   = require("os");
 *
 * function shuffle(arr) {
 *   for (let i = arr.length - 1; i > 0; i--) {
 *     const j = Math.floor(Math.random() * (i + 1));
 *     [arr[i], arr[j]] = [arr[j], arr[i]];
 *   }
 *   return arr;
 * }
 *
 * async function pickFiles(count) {
 *   const initSqlJs = require("sql.js");
 *   const SQL = await initSqlJs();
  *   const dbPath = path.join(os.homedir(), ".config/musicpenguin/musicpenguin-library.sqlite");
 *   const db = new SQL.Database(fs.readFileSync(dbPath));
 *   const result = db.exec(
 *     `SELECT path FROM files
 *      WHERE path LIKE '%/mnt/nas/music/%'
 *        AND (path LIKE '%.mp3' OR path LIKE '%.m4a' OR path LIKE '%.flac')
 *      ORDER BY random()
 *      LIMIT ${count * 3}`
 *   );
 *   const all = (result[0]?.values || []).map(r => String(r[0]));
 *   const existing = all.filter(p => {
 *     try { fs.accessSync(p); return true; } catch { return false; }
 *   });
 *   shuffle(existing);
 *   return existing.slice(0, count);
 * }
 *
 * async function benchConcurrency(parseFile, files, concurrency) {
 *   let index = 0;
 *   let errors = 0;
 *   const t0 = performance.now();
 *
 *   async function worker() {
 *     while (index < files.length) {
 *       const i = index++;
 *       try {
 *         await Promise.race([
 *           parseFile(files[i]),
 *           new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000)),
 *         ]);
 *       } catch {
 *         errors++;
 *       }
 *     }
 *   }
 *
 *   const workers = Array.from(
 *     { length: Math.min(concurrency, files.length) },
 *     () => worker(),
 *   );
 *   await Promise.all(workers);
 *
 *   const elapsed = (performance.now() - t0) / 1000;
 *   const throughput = files.length / elapsed;
 *   return { elapsed, throughput, errors };
 * }
 *
 * (async () => {
 *   const numFiles = parseInt(process.argv[2], 10) || 50;
 *   console.log(`Picking ${numFiles} random files from the NAS...`);
 *   const files = await pickFiles(numFiles);
 *   console.log(`Found ${files.length} existing files.\n`);
 *   if (files.length === 0) {
 *     console.error("No files found – is the NAS mounted?");
 *     process.exit(1);
 *   }
 *   const { parseFile } = require("music-metadata");
 *   const MAX_CONCURRENCY = 30;
 *   const results = [];
 *   console.log("Conc │  Files │   Time (s) │  Files/s │ Errors");
 *   console.log("─────┼────────┼────────────┼──────────┼───────");
 *   for (let c = 1; c <= MAX_CONCURRENCY; c++) {
 *     shuffle(files);
 *     const { elapsed, throughput, errors } = await benchConcurrency(parseFile, files, c);
 *     results.push({ c, elapsed, throughput, errors });
 *     const conc  = String(c).padStart(3);
 *     const fcount = String(files.length).padStart(5);
 *     const time  = elapsed.toFixed(2).padStart(8);
 *     const tput  = throughput.toFixed(1).padStart(7);
 *     const errs  = String(errors).padStart(5);
 *     console.log(`${conc} │ ${fcount} │ ${time} │ ${tput} │ ${errs}`);
 *   }
 *   const best = results.reduce((a, b) => b.throughput > a.throughput ? b : a);
 *   console.log(`\nBest throughput: concurrency ${best.c} → ${best.throughput.toFixed(1)} files/s (${best.elapsed.toFixed(2)}s for ${files.length} files)`);
 * })();
 * ──────────────────────────────────────────────────────────────
 */

interface ParsedTags {
  filePath: string;
  title: string;
  artist: string;
  album: string;
  track_no: string;
  album_artist: string;
  genre: string;
  disc_no: string;
  year: string;
  composer: string;
  conductor: string;
  comment: string;
  rating: number;
  bpm: number;
  duration: number;
  hadError: boolean;
}

let queue: string[] = [];
let running = false;
let stopped = false;
let restartAfterStop = false;
let doneResolve: (() => void) | null = null;
export let donePromise: Promise<void> | null = null;
let scanWriteCount = 0;
let db: SqlJsDatabase | null = null;
let sendToRenderer: SendToRenderer | null = null;

export function initTagReader(database: SqlJsDatabase, send: SendToRenderer) {
  db = database;
  sendToRenderer = send;
}

export function stopTagReader() {
  stopped = true;
  queue = [];
}

export function isTagReaderRunning(): boolean {
  return running;
}

function refillQueue() {
  if (stopped) return;
  if (queue.length >= TAG_BATCH_SIZE) return;
  const limit = TAG_BATCH_SIZE - queue.length;
  const stmt = db!.prepare(
    "SELECT path FROM files WHERE tags_scanned_at IS NULL ORDER BY path LIMIT $limit"
  );
  stmt.bind({ $limit: limit });
  while (stmt.step()) {
    queue.push(stmt.getAsObject().path as string);
  }
  stmt.free();
}

async function tryFfprobeForDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("error", () => resolve(0));
    proc.on("close", (code) => {
      if (code !== 0) return resolve(0);
      try {
        const data = JSON.parse(stdout);
        const dur = data?.format?.duration;
        if (dur && dur !== "0") return resolve(parseFloat(dur));
      } catch {}
      resolve(0);
    });
  });
}

async function parseFileTags(filePath: string): Promise<ParsedTags> {
  let title = "", artist = "", album = "", track_no = "", album_artist = "", genre = "", disc_no = "";
  let year = "", composer = "", conductor = "", comment = "";
  let duration = 0;
  let rating = 0;
  let bpm = 0;
  let hadError = false;
  try {
    const meta = await withTimeout(parseFile(filePath), 30000);
    const { common, native, format } = meta;
    duration = format.duration != null ? format.duration : 0;
    if (duration > 0) {
      const ext = filePath.toLowerCase().split(".").pop();
      if (ext === "mp3" || ext === "mp2") {
        const stat = fs.statSync(filePath);
        const impliedBitrate = Math.round((stat.size * 8) / duration);
        if (impliedBitrate < 48000 || impliedBitrate > 400000) {
          const fbDur = await tryFfprobeForDuration(filePath);
          if (fbDur) duration = fbDur;
        }
      }
    }
    title = common.title ?? "";
    artist = common.artist ?? "";
    album = common.album ?? "";
    track_no = common.track?.no !== undefined ? String(common.track.no) : "";
    album_artist = common.albumartist ?? "";
    genre = Array.isArray(common.genre) ? common.genre.join(", ") : (common.genre ?? "");
    disc_no = common.disk?.no != null ? String(common.disk.no) : "";
    // Prefer raw native tag value (e.g. "198x" instead of parsed number 198) for year
    const YEAR_NATIVE_IDS = new Set(["TYER", "TDRC", "TDRL", "TDA", "TDAT", "YEAR", "DATE", "\xa9day"]);
    let rawYear = "";
    for (const fmt of Object.keys(native)) {
      for (const tag of native[fmt] || []) {
        if (YEAR_NATIVE_IDS.has(tag.id) && typeof tag.value === "string" && tag.value.trim()) {
          rawYear = tag.value.trim();
          break;
        }
      }
      if (rawYear) break;
    }
    year = rawYear || (common.year != null ? String(common.year) : (common.originaldate != null ? String(common.originaldate) : ""));
    composer = Array.isArray(common.composer) ? common.composer.join(", ") : (common.composer ?? "");
    conductor = Array.isArray(common.conductor) ? common.conductor.join(", ") : (common.conductor ?? "");
    const commentVal = common.comment;
    if (Array.isArray(commentVal)) {
      comment = commentVal
        .map((c) => (c.descriptor ? "" : c.text ?? ""))
        .filter(Boolean)
        .join("; ");
    } else {
      comment = commentVal ?? "";
    }
    if (Array.isArray(common.rating) && common.rating.length > 0) {
      const r = Math.round((common.rating[0]?.rating ?? 0) * 255);
      rating = Number.isFinite(r) ? r : 0;
    }
    if (!rating && native) {
      for (const tagType of Object.keys(native)) {
        for (const tag of native[tagType] || []) {
          if (/popm|popularimeter|rating|fmps_rating/i.test(tag.id)) {
            let raw: number;
            if (typeof tag.value === "string") {
              raw = parseFloat(tag.value.trim());
            } else if (typeof tag.value === "number") {
              raw = tag.value;
            } else if (Array.isArray(tag.value)) {
              const first = tag.value[0];
              raw = typeof first === "number" ? first : parseFloat(String(first ?? ""));
            } else {
              raw = 0;
            }
            if (raw && Number.isFinite(raw)) {
              if (raw <= 1) { rating = Math.round(raw * 255); break; }
              else if (raw <= 5.5) { rating = Math.round(raw * 51); break; }
              else if (raw <= 100) { rating = Math.round(raw * 2.55); break; }
              else { rating = Math.min(Math.round(raw), 255); break; }
            }
          }
        }
        if (rating) break;
      }
    }
    if (!composer && native) {
      for (const tagType of Object.keys(native)) {
        for (const tag of native[tagType] || []) {
          if (/(?:composer|writer|songwriter)/i.test(tag.id)) {
            const val = typeof tag.value === "string" ? tag.value : String(tag.value ?? "");
            if (val) { composer = val; break; }
          }
        }
        if (composer) break;
      }
    }
    if (common.bpm != null) bpm = common.bpm;
    if (!bpm && native) {
      for (const tagType of Object.keys(native)) {
        for (const tag of native[tagType] || []) {
          if (/tmpo|bpm/i.test(tag.id)) {
            const val = typeof tag.value === "string" ? parseInt(tag.value, 10) : (typeof tag.value === "number" ? tag.value : 0);
            if (val && Number.isFinite(val)) { bpm = val; break; }
          }
        }
        if (bpm) break;
      }
    }
    if (!conductor && native) {
      for (const tagType of Object.keys(native)) {
        for (const tag of native[tagType] || []) {
          if (/conductor|©con/i.test(tag.id)) {
            const val = typeof tag.value === "string" ? tag.value : String(tag.value ?? "");
            if (val) { conductor = val; break; }
          }
        }
        if (conductor) break;
      }
    }
    if (native) {
      for (const tagType of Object.keys(native)) {
        for (const tag of native[tagType] || []) {
          const isCommentFrame = /comm|notes|©cmt|descript/i.test(tag.id);
          const isTxxxComment = tag.id === "TXXX" && /comm|notes/i.test(strField(tag.value, "description"));
          if (!isCommentFrame && !isTxxxComment) continue;
          if (strField(tag.value, "descriptor")) continue;
          let val: string;
          if (typeof tag.value === "string") {
            val = tag.value;
          } else if (Array.isArray(tag.value)) {
            val = tag.value.map((v) => isRecord(v) ? strField(v, "text") : (typeof v === "string" ? v : String(v))).filter(Boolean).join("; ");
          } else if (isRecord(tag.value)) {
            val = strField(tag.value, "text") || String(tag.value);
          } else {
            val = String(tag.value ?? "");
          }
          if (val && !comment) { comment = val; break; }
        }
        if (comment) break;
      }
    }
  } catch {
    hadError = true;
  }

  if (!duration || duration === 0) {
    const ffprobeDur = await tryFfprobeForDuration(filePath);
    if (ffprobeDur) duration = ffprobeDur;
  }

  return { filePath, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, bpm, duration, hadError };
}

function writeTagsToDb(result: ParsedTags): void {
  scanWriteCount++;
  let rating = result.rating;

  if (rating === 0) {
    const getStmt = db!.prepare("SELECT rating FROM files WHERE path = $path");
    getStmt.bind({ $path: result.filePath });
    if (getStmt.step()) {
      const existingRating = getStmt.getAsObject().rating as number;
      if (existingRating) rating = existingRating;
    }
    getStmt.free();
  }

  const now = new Date().toISOString();
  const updateStmt = db!.prepare(
    `UPDATE files SET title = $title, artist = $artist, album = $album,
     track_no = $track_no, album_artist = $album_artist, genre = $genre, disc_no = $disc_no,
      year = $year, composer = $composer, conductor = $conductor, comment = $comment, rating = $rating,
      bpm = $bpm, duration = $duration, tags_scanned_at = $ts, tags_error = $error WHERE path = $path`
  );
  updateStmt.bind({
    $path: result.filePath,
    $title: result.title,
    $artist: result.artist,
    $album: result.album,
    $track_no: result.track_no,
    $album_artist: result.album_artist,
    $genre: result.genre,
    $disc_no: result.disc_no,
    $year: result.year,
    $composer: result.composer,
    $conductor: result.conductor,
    $comment: result.comment,
    $rating: rating,
    $bpm: result.bpm,
    $duration: result.duration,
    $ts: now,
    $error: result.hadError ? 1 : 0,
  });
  updateStmt.step();
  updateStmt.reset();
  updateStmt.free();

  sendToRenderer!("tags:updated", {
    path: result.filePath,
    title: result.title,
    artist: result.artist,
    album: result.album,
    track_no: result.track_no,
    album_artist: result.album_artist,
    genre: result.genre,
    disc_no: result.disc_no,
    year: result.year,
    composer: result.composer,
    conductor: result.conductor,
    comment: result.comment,
    rating,
    bpm: result.bpm,
    duration: result.duration,
    tags_error: result.hadError ? 1 : 0,
  });
}

async function processQueue() {
  if (running) return;
  running = true;
  stopped = false;
  let saved = false;

  doneResolve = null;
  donePromise = new Promise<void>((resolve) => { doneResolve = resolve; });

  const totalFiles = db!.exec("SELECT COUNT(*) FROM files")[0]?.values[0]?.[0] as number ?? 0;
  let scannedCount = db!.exec("SELECT COUNT(*) FROM files WHERE tags_scanned_at IS NOT NULL")[0]?.values[0]?.[0] as number ?? 0;

  try {
    while (true) {
      if (stopped) break;
      while (queue.length > 0) {
        // Drain a batch from the queue
        const batch: string[] = [];
        while (queue.length > 0 && batch.length < TAG_BATCH_SIZE) {
          batch.push(queue.shift()!);
        }

        // Parse files concurrently, report progress and write to DB as each completes
        let batchIndex = 0;
        const parseNext = async (): Promise<void> => {
          while (batchIndex < batch.length) {
            const i = batchIndex++;
            const result = await parseFileTags(batch[i]!);
            writeTagsToDb(result);
            saved = true;
            scannedCount++;
            sendToRenderer!("tags:scanning", { path: batch[i]!, scanned: scannedCount, total: totalFiles });
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(NUM_TAG_READER_THREADS, batch.length) }, () => parseNext()),
        );
      }
      const version: number = db!.exec("PRAGMA user_version")[0]?.values[0]?.[0] as number ?? 0;
      if (version < 1) {
        db!.run("PRAGMA user_version = 1");
      }
      saveDb(db!);
      if (stopped) break;
      refillQueue();
      if (queue.length === 0) break;
    }
  } finally {
    if (saved) saveDb(db!);
    db!.run("VACUUM");
    running = false;
    if (doneResolve) {
      doneResolve();
      doneResolve = null;
      donePromise = null;
    }
    sendToRenderer!("tags:scanning", { path: null });
    if (restartAfterStop && !stopped && queue.length > 0) {
      restartAfterStop = false;
      running = true;
      donePromise = new Promise<void>((resolve) => { doneResolve = resolve; });
      processQueue();
    }
  }
}

export function startTagRead() {
  stopped = false;
  refillQueue();
  if (running) {
    if (queue.length > 0) restartAfterStop = true;
  } else if (queue.length > 0) {
    processQueue();
  }
}

export function prioritizeFiles(orderedPaths: string[]) {
  if (!Array.isArray(orderedPaths) || orderedPaths.length === 0) return;

  const stmt = db!.prepare("SELECT path FROM files WHERE path = $path AND tags_scanned_at IS NULL");
  const unscanned: string[] = [];
  for (const p of orderedPaths) {
    stmt.bind({ $path: p });
    if (stmt.step()) {
      unscanned.push(p);
    }
    stmt.reset();
  }
  stmt.free();

  if (unscanned.length === 0) return;

  const prioritySet = new Set(unscanned);
  queue = queue.filter((p) => !prioritySet.has(p));

  queue.unshift(...unscanned);

  if (queue.length > TAG_BATCH_SIZE) {
    queue = queue.slice(0, TAG_BATCH_SIZE);
  }

  if (!running && queue.length > 0) {
    processQueue();
  }
}

export async function rescanFiles(paths: string[]) {
  if (!paths.length) return;
  stopped = true;
  queue = [];
  if (donePromise) {
    await donePromise;
  }
  const updStmt = db!.prepare("UPDATE files SET tags_scanned_at = NULL, tags_error = 0 WHERE path = $path");
  for (const p of paths) {
    updStmt.bind({ $path: p });
    updStmt.step();
    updStmt.reset();
  }
  updStmt.free();
  saveDb(db!);
  stopped = false;
  prioritizeFiles(paths);
}

export async function runIncrementalScan(files: Array<{ fullPath: string; name: string }>) {
  stopped = true;
  queue = [];
  if (donePromise) {
    await donePromise;
  }

  const stmt = db!.prepare(
    `INSERT OR IGNORE INTO files (path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, bpm)
     VALUES ($path, $filename, '', '', '', '', '', '', '', '', '', '', '', 0, 0, 0)`
  );
  db!.exec("BEGIN");
  for (const f of files) {
    stmt.bind({ $path: f.fullPath, $filename: f.name });
    stmt.step();
    stmt.reset();
  }
  db!.exec("COMMIT");
  stmt.free();
  saveDb(db!);

  stopped = false;
  // Re-queue previously errored files so they get another attempt
  db!.run("UPDATE files SET tags_scanned_at = NULL WHERE tags_error = 1");
  saveDb(db!);

  // Check all DB files: remove missing entries, re-queue files modified since last scan
  const allResult = db!.exec("SELECT path, tags_scanned_at FROM files")[0]?.values ?? [];
  const toRemove: string[] = [];
  const requeuePaths: string[] = [];

  for (const row of allResult) {
    const p = row[0] as string;
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(p);
    } catch {
      toRemove.push(p);
      continue;
    }
    const tagsScannedAt = row[1] as string | null;
    if (tagsScannedAt) {
      const mtimeMs = stat.mtimeMs;
      const scannedMs = new Date(tagsScannedAt).getTime();
      if (mtimeMs > scannedMs) {
        requeuePaths.push(p);
      }
    }
  }

  // Re-queue files whose mtime is newer than last tag scan
  if (requeuePaths.length > 0) {
    const updStmt = db!.prepare("UPDATE files SET tags_scanned_at = NULL WHERE path = $path");
    for (const p of requeuePaths) {
      updStmt.bind({ $path: p });
      updStmt.step();
      updStmt.reset();
    }
    updStmt.free();
  }

  // Remove entries for files that no longer exist on disk
  if (toRemove.length > 0) {
    const delStmt = db!.prepare("DELETE FROM files WHERE path = $path");
    for (const p of toRemove) {
      delStmt.bind({ $path: p });
      delStmt.step();
      delStmt.reset();
    }
    delStmt.free();
  }

  saveDb(db!);

  // Refill queue — picks up error-reset and mtime-reset files
  const refillStmt = db!.prepare("SELECT path FROM files WHERE tags_scanned_at IS NULL ORDER BY path LIMIT ?");
  refillStmt.bind([TAG_BATCH_SIZE]);
  queue = [];
  while (refillStmt.step()) {
    queue.push(refillStmt.getAsObject().path as string);
  }
  refillStmt.free();

  // Count only the files whose tags were actually (re)read in this scan:
  // newly-inserted files AND files re-read because they were errored or
  // modified. Known, unchanged files are not counted.
  scanWriteCount = 0;
  if (queue.length > 0) {
    await processQueue();
  }

  const total = db!.exec("SELECT COUNT(*) FROM files")[0]?.values[0]?.[0] as number ?? 0;
  const errors = db!.exec("SELECT COUNT(*) FROM files WHERE tags_error = 1")[0]?.values[0]?.[0] as number ?? 0;

  return { added: scanWriteCount, removed: toRemove.length, total, errors };
}
