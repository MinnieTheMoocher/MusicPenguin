import * as fs from "fs";
import * as path from "path";
import initSqlJs from "sql.js";

import { getDbPath, SETTINGS_DIR } from "./paths";
import { ensureDir } from "./utils";
import type { SqlJsDatabase, ScannedFileInfo, SearchOptions, DlnaTrackRecord } from "./types";

/*
Database version understood and written by this app version. Version history:
database version 1: released with MusicPenguin 0.0.1: initial database format
database version 2: released with MusicPenguin 0.0.2: added dlna flag, file pathes now can be http(s) URLs
*/
export const DB_VERSION = 2;

/* Unicode-aware case/accent folding used by searchFiles(): SQLite's LIKE
   only case-folds ASCII, so both compared sides are wrapped in unicase().
   Decomposition + mark stripping additionally makes searches ignore
   accents (ö ~ o) and precomposed/decomposed forms compare equal.

   sql.js's Database.export() unregisters every custom function and
   closes/reopens the underlying connection, so this must be re-run after
   EVERY export (see saveDb) or queries referencing unicase fail with
   "no such function". */
function registerCustomSqlFunctions(db: SqlJsDatabase): void {
  db.create_function("unicase", (s: unknown) =>
    typeof s === "string"
      ? s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      : s
  );
}

export async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  ensureDir(SETTINGS_DIR);
  const dbPath = getDbPath();
  ensureDir(path.dirname(dbPath));
  let db: SqlJsDatabase;
  try {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } catch {
    db = new SQL.Database();
  }

  /* Explicitly pin the text encoding to UTF-8. Only takes effect while the
     database is still empty (before the first table is created); on an
     existing database this is silently ignored by SQLite. */
  db.run("PRAGMA encoding = 'UTF-8'");

  /* Unicode-aware case/accent folding used by searchFiles() — see
     registerCustomSqlFunctions() above. */
  registerCustomSqlFunctions(db);

  /* Initial database schema released with app version 0.0.1
     This is database format version 1.
   */
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      path             TEXT PRIMARY KEY,
      filename         TEXT NOT NULL,
      title            TEXT DEFAULT '',
      artist           TEXT DEFAULT '',
      album            TEXT DEFAULT '',
      track_no         TEXT DEFAULT '',
      album_artist     TEXT DEFAULT '',
      genre            TEXT DEFAULT '',
      disc_no          TEXT DEFAULT '',
      year             TEXT DEFAULT '',
      composer         TEXT DEFAULT '',
      conductor        TEXT DEFAULT '',
      comment          TEXT DEFAULT '',
      rating           INTEGER DEFAULT 0,
      duration         REAL,
      playcount        INTEGER DEFAULT 0,
      bpm              INTEGER DEFAULT 0,
      tags_scanned_at  TEXT,
      tags_error       INTEGER DEFAULT 0
    )
  `);

  const existingDbVersion_ = db.exec("PRAGMA user_version");
  const existingDbVersion: number = (existingDbVersion_[0]?.values[0]?.[0] as number) ?? 1;

  /* upgrade the database to this app's format and version: */
  try {
    db.run("ALTER TABLE files ADD COLUMN dlna INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE files ADD COLUMN track_art_url TEXT DEFAULT ''");
  } catch { /* column already exists */ }

  if (existingDbVersion < DB_VERSION) {
    db.run(`PRAGMA user_version = ${DB_VERSION}`);
  }

  saveDb(db);
  return db;
}

export function saveDb(db: SqlJsDatabase) {
  const dbPath = getDbPath();
  ensureDir(path.dirname(dbPath));
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  /* export() dropped the custom functions — restore them immediately
     so the connection stays fully usable after every save. */
  registerCustomSqlFunctions(db);
}

export function loadFiles(db: SqlJsDatabase): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const stmt = db.prepare(
    "SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm, dlna FROM files ORDER BY filename"
  );
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.duration = String(row.duration ?? "");
    results.push(row);
  }
  stmt.free();
  return results;
}

export function storeFiles(db: SqlJsDatabase, files: ScannedFileInfo[]) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO files (path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, bpm)
    VALUES ($path, $filename, '', '', '', '', '', '', '', '', '', '', '', 0, NULL, 0)
  `);
  db.exec("BEGIN");
  for (const f of files) {
    stmt.bind({ $path: f.fullPath, $filename: f.name });
    stmt.step();
    stmt.reset();
  }
  db.exec("COMMIT");
  stmt.free();
  saveDb(db);
}

export function lookupPaths(db: SqlJsDatabase, paths: string[]): Record<string, unknown>[] {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const placeholders = paths.map(() => "?").join(",");
  const stmt = db.prepare(
    `SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm, dlna FROM files WHERE path IN (${placeholders})`
  );
  stmt.bind(paths);
  const results: Record<string, unknown>[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.duration = String(row.duration ?? "");
    results.push(row);
  }
  stmt.free();
  return results;
}

export function searchFiles(db: SqlJsDatabase, opts: SearchOptions & { columns?: string[] }): Record<string, unknown>[] {
  const query = typeof opts === "string" ? opts : opts?.query;
  if (!query || typeof query !== "string") return [];
  const columns = Array.isArray(opts?.columns) ? opts.columns : ["filename", "path", "title", "artist", "album", "album_artist", "genre", "disc_no", "year", "composer", "conductor", "comment", "rating"];
  const validCols = new Set(["filename", "path", "title", "artist", "album", "album_artist", "genre", "disc_no", "year", "composer", "conductor", "comment", "rating", "bpm"]);
  const safeCols = columns.filter((c) => validCols.has(c));
  if (safeCols.length === 0) return [];

  if (opts?.regex) {
    let re: RegExp;
    try { re = new RegExp(query, "i"); } catch { return []; }
    const stmt = db.prepare(
      `SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm, dlna FROM files`
    );
    const results: Record<string, unknown>[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      row.duration = String(row.duration ?? "");
      for (const col of safeCols) {
        if (re.test(String(row[col] ?? ""))) {
          results.push(row);
          break;
        }
      }
    }
    stmt.free();
    return results;
  }

  const pattern = `%${query}%`;
  const whereClause = safeCols.map((c) => `unicase(${c}) LIKE unicase($q)`).join(" OR ");
  const results: Record<string, unknown>[] = [];
  const stmt = db.prepare(
    `SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm, dlna FROM files
     WHERE ${whereClause}
     ORDER BY filename`
  );
  stmt.bind({ $q: pattern });
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.duration = String(row.duration ?? "");
    results.push(row);
  }
  stmt.free();
  return results;
}

export function countProblematicFiles(db: SqlJsDatabase): number {
  const rows = db.exec("SELECT COUNT(*) AS cnt FROM files WHERE tags_error = 1");
  return (rows.length > 0 && rows[0]!.values.length > 0) ? Number(rows[0]!.values[0]![0]) : 0;
}

export function getProblematicFiles(db: SqlJsDatabase): Record<string, unknown>[] {
  const stmt = db.prepare("SELECT path FROM files WHERE tags_error = 1 ORDER BY path ASC");
  const paths: Record<string, unknown>[] = [];
  while (stmt.step()) {
    paths.push(stmt.getAsObject());
  }
  stmt.free();
  return paths;
}

export function clearAllFiles(db: SqlJsDatabase) {
  db.run("DELETE FROM files");
  saveDb(db);
}

export function setRating(db: SqlJsDatabase, path: string, rating: number) {
  const stmt = db.prepare("UPDATE files SET rating = $rating WHERE path = $path");
  stmt.bind({ $path: path, $rating: rating });
  stmt.step();
  stmt.free();
  saveDb(db);
}

/* Paths of tracks whose duration is still unknown (NULL) — input for
   the ffprobe-based duration fixup pass. */
export function getMissingDurationPaths(db: SqlJsDatabase): string[] {
  const out: string[] = [];
  const stmt = db.prepare("SELECT path FROM files WHERE duration IS NULL ORDER BY path");
  while (stmt.step()) {
    out.push(stmt.getAsObject().path as string);
  }
  stmt.free();
  return out;
}

/* Gap filler for tracks whose duration could not be determined at scan
   time (stored as NULL): writes the value learned later (e.g. from the
   <audio> element at play time). Never overwrites a known duration.
   Returns whether a gap was actually filled — caller persists via saveDb. */
export function fillMissingDuration(db: SqlJsDatabase, path: string, duration: number): boolean {
  if (!path || !Number.isFinite(duration) || duration <= 0) return false;
  const stmt = db.prepare(
    "UPDATE files SET duration = $duration WHERE path = $path AND duration IS NULL"
  );
  stmt.bind({ $path: path, $duration: duration });
  stmt.step();
  /* UPDATE has no result rows — the affected-row count comes from the
     database handle's last-statement counter. */
  const changed = db.getRowsModified() > 0;
  stmt.free();
  return changed;
}

export function moveFilePath(db: SqlJsDatabase, oldPath: string, newPath: string, newFilename: string) {
  const stmt = db.prepare("UPDATE files SET path = $newPath, filename = $newFilename WHERE path = $oldPath");
  stmt.bind({ $newPath: newPath, $newFilename: newFilename, $oldPath: oldPath });
  stmt.step();
  stmt.free();
  saveDb(db);
}

export function getTotalFileCount(db: SqlJsDatabase): number {
  const result = db.exec("SELECT COUNT(*) FROM files");
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

export function getScannedFileCount(db: SqlJsDatabase): number {
  const result = db.exec("SELECT COUNT(*) FROM files WHERE tags_scanned_at IS NOT NULL");
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

export function deleteFiles(db: SqlJsDatabase, paths: string[]): void {
  const stmt = db.prepare("DELETE FROM files WHERE path = $path");
  for (const p of paths) {
    stmt.bind({ $path: p });
    stmt.step();
    stmt.reset();
  }
  stmt.free();
  saveDb(db);
}

export function incrementPlaycount(db: SqlJsDatabase, path: string): number {
  const stmt = db.prepare("UPDATE files SET playcount = playcount + 1 WHERE path = $path");
  stmt.bind({ $path: path });
  stmt.step();
  stmt.free();
  saveDb(db);
  const sel = db.prepare("SELECT playcount FROM files WHERE path = $path");
  sel.bind({ $path: path });
  let count = 0;
  if (sel.step()) {
    const row = sel.getAsObject() as Record<string, unknown>;
    count = (row.playcount as number) ?? 0;
  }
  sel.free();
  return count;
}

/* ── DLNA tracks ─────────────────────────────────────────── */

export interface DlnaStoreResult {
  added: number;
  /* One row-shaped snapshot per processed track (same shape as the
     db:loadFiles result), so callers can push live UI updates while
     enumeration is still running. */
  rows: Record<string, unknown>[];
}

/* Insert/update tracks enumerated from a DLNA server. The stream URL is
   used as both `path` (primary key) and `filename`; the dlna flag is set
   to 1 and tags_scanned_at is stamped so the background tag reader never
   tries to parse the remote URL as a local file. Existing rows keep
   their rating/playcount; only metadata columns are refreshed. Returns
   how many rows were newly inserted plus row snapshots for the UI. */
export function storeDlnaTracks(db: SqlJsDatabase, tracks: DlnaTrackRecord[]): DlnaStoreResult {
  if (tracks.length === 0) return { added: 0, rows: [] };
  const existsStmt = db.prepare(
    "SELECT rating, playcount, comment, bpm, duration FROM files WHERE path = $path"
  );
  /* An absent res@duration arrives as 0 and must be stored as NULL
     ("unknown"), never overwriting a previously learned value — hence
     COALESCE on the update path. */
  const insertStmt = db.prepare(
    `INSERT INTO files (path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm, track_art_url)
     VALUES ($path, $path, '', '', '', '', '', '', '', '', '', '', '', 0, $duration, 0, 0, $art)`
  );
  const updateStmt = db.prepare(
    `UPDATE files SET filename = $path, title = $title, artist = $artist, album = $album,
       track_no = $track_no, album_artist = $album_artist, genre = $genre, disc_no = $disc_no,
       year = $year, composer = $composer, conductor = $conductor,
       duration = COALESCE($duration, duration),
       track_art_url = $art, tags_scanned_at = $ts, tags_error = 0, dlna = 1
     WHERE path = $path`
  );
  const now = new Date().toISOString();
  let added = 0;
  const rows: Record<string, unknown>[] = [];
  db.exec("BEGIN");
  try {
    for (const t of tracks) {
      existsStmt.bind({ $path: t.url });
      let rating = 0;
      let playcount = 0;
      let comment = "";
      let bpm = 0;
      let prevDuration: number | null = null;
      const existed = existsStmt.step();
      if (existed) {
        const prev = existsStmt.getAsObject();
        rating = Number(prev.rating ?? 0);
        playcount = Number(prev.playcount ?? 0);
        comment = String(prev.comment ?? "");
        bpm = Number(prev.bpm ?? 0);
        prevDuration = prev.duration === null || prev.duration === undefined ? null : Number(prev.duration);
      }
      existsStmt.reset();

      const announcedDuration = t.duration > 0 ? t.duration : null;

      if (!existed) {
        insertStmt.bind({ $path: t.url, $duration: announcedDuration, $art: t.track_art_url });
        insertStmt.step();
        insertStmt.reset();
        added++;
      }

      updateStmt.bind({
        $path: t.url,
        $title: t.title,
        $artist: t.artist,
        $album: t.album,
        $track_no: t.track_no,
        $album_artist: t.album_artist,
        $genre: t.genre,
        $disc_no: t.disc_no,
        $year: t.year,
        $composer: t.composer,
        $conductor: t.conductor,
        $duration: announcedDuration,
        $art: t.track_art_url,
        $ts: now,
      });
      updateStmt.step();
      updateStmt.reset();

      rows.push({
        path: t.url,
        filename: t.url,
        title: t.title,
        artist: t.artist,
        album: t.album,
        track_no: t.track_no,
        album_artist: t.album_artist,
        genre: t.genre,
        disc_no: t.disc_no,
        year: t.year,
        composer: t.composer,
        conductor: t.conductor,
        comment,
        rating,
        duration: String(announcedDuration ?? prevDuration ?? ""),
        playcount,
        bpm,
        dlna: 1,
      });
    }
  } finally {
    db.exec("COMMIT");
    existsStmt.free();
    insertStmt.free();
    updateStmt.free();
  }
  return { added, rows };
}

export function getDlnaPaths(db: SqlJsDatabase): string[] {
  const paths: string[] = [];
  const stmt = db.prepare("SELECT path FROM files WHERE dlna = 1");
  while (stmt.step()) {
    paths.push(stmt.getAsObject().path as string);
  }
  stmt.free();
  return paths;
}

/* The upnp:albumArtURI(s) stored with a DLNA track — multiple values
   are newline-separated (null when absent) — used to fetch cover art
   over HTTP on demand. */
export function getTrackArtUrls(db: SqlJsDatabase, path: string): string | null {
  const stmt = db.prepare("SELECT track_art_url FROM files WHERE path = $path");
  stmt.bind({ $path: path });
  let artUrl: string | null = null;
  if (stmt.step()) {
    const value = String(stmt.getAsObject().track_art_url ?? "");
    artUrl = value || null;
  }
  stmt.free();
  return artUrl;
}

/* Collapse a DLNA track's art URL candidates down to the one winning
   (largest) URI after it was determined by fetching. */
export function setTrackArtUrls(db: SqlJsDatabase, path: string, artUrl: string): void {
  const stmt = db.prepare("UPDATE files SET track_art_url = $art WHERE path = $path");
  stmt.bind({ $path: path, $art: artUrl });
  stmt.step();
  stmt.free();
}

/* Remove DLNA rows that are no longer offered by the server (or whose
   server URL changed). Does not save — caller persists once at the end. */
export function deleteStaleDlnaTracks(db: SqlJsDatabase, keepUrls: string[]): number {
  const keep = new Set(keepUrls);
  const stale = getDlnaPaths(db).filter((p) => !keep.has(p));
  if (stale.length === 0) return 0;
  db.exec("BEGIN");
  try {
    const stmt = db.prepare("DELETE FROM files WHERE path = $path");
    for (const p of stale) {
      stmt.bind({ $path: p });
      stmt.step();
      stmt.reset();
    }
    stmt.free();
  } finally {
    db.exec("COMMIT");
  }
  return stale.length;
}
