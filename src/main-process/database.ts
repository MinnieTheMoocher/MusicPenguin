import * as fs from "fs";
import * as path from "path";
import initSqlJs from "sql.js";

import { getDbPath, SETTINGS_DIR } from "./paths";
import { ensureDir } from "./utils";
import type { SqlJsDatabase, ScannedFileInfo, SearchOptions } from "./types";

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
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      title TEXT DEFAULT '',
      artist TEXT DEFAULT '',
      album TEXT DEFAULT '',
      track_no TEXT DEFAULT '',
      album_artist TEXT DEFAULT '',
      tags_scanned_at TEXT,
      tags_error INTEGER DEFAULT 0
    )
  `);
  const textCols = ["track_no", "album_artist", "genre", "disc_no", "year", "composer", "conductor", "comment", "tags_scanned_at", "tags_error"];
  for (const col of textCols) {
    try {
      db.run(`ALTER TABLE files ADD COLUMN ${col} TEXT`);
    } catch { /* column already exists */ }
  }
  try {
    db.run("ALTER TABLE files ADD COLUMN rating INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE files ADD COLUMN duration REAL DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE files ADD COLUMN playcount INTEGER DEFAULT 0");
  } catch { /* column already exists */ }
  try {
    db.run("ALTER TABLE files ADD COLUMN bpm INTEGER DEFAULT 0");
  } catch { /* column already exists */ }

  const result = db.exec("PRAGMA user_version");
  const version: number = (result[0]?.values[0]?.[0] as number) ?? 0;
  if (version < 1) {
    db.run("PRAGMA user_version = 1");
  }
  saveDb(db);
  return db;
}

export function saveDb(db: SqlJsDatabase) {
  const dbPath = getDbPath();
  ensureDir(path.dirname(dbPath));
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export function loadFiles(db: SqlJsDatabase): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const stmt = db.prepare(
    "SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm FROM files ORDER BY filename"
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
    VALUES ($path, $filename, '', '', '', '', '', '', '', '', '', '', '', 0, 0, 0)
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
    `SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm FROM files WHERE path IN (${placeholders})`
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
      `SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm FROM files`
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
  const whereClause = safeCols.map((c) => `${c} LIKE $q`).join(" OR ");
  const results: Record<string, unknown>[] = [];
  const stmt = db.prepare(
    `SELECT path, filename, title, artist, album, track_no, album_artist, genre, disc_no, year, composer, conductor, comment, rating, duration, playcount, bpm FROM files
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
