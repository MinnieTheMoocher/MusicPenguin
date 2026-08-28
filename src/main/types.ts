export interface SqlJsStatement {
  bind(params?: Record<string, unknown> | unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  reset(): void;
  free(): boolean;
}

export interface SqlJsDatabase {
  run(sql: string, params?: Record<string, unknown>): SqlJsDatabase;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): SqlJsStatement;
  create_function(name: string, fn: (...args: unknown[]) => unknown): void;
  export(): Uint8Array;
  close(): void;
  /* Rows modified by the most recently stepped statement (UPDATE/DELETE
     have no result rows — this is how their effect is observed). */
  getRowsModified(): number;
}

export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
}

export type SendToRenderer = (channel: string, data: unknown) => void;

export interface ScannedFileInfo {
  name: string;
  relativePath: string;
  fullPath: string;
}

export interface TagUpdate {
  path: string;
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
  tags_error: number;
}

/* One audio track enumerated from a DLNA server. `url` is the res stream
   URL and doubles as the DB primary key / filename for the row.
   `track_art_url` mirrors upnp:albumArtURI (DB column of the same name);
   an item may announce several art URIs, stored newline-separated in
   announcement order. URIs may be relative — they are resolved against
   the stream URL when fetched. */
export interface DlnaTrackRecord {
  url: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track_no: string;
  disc_no: string;
  genre: string;
  year: string;
  composer: string;
  conductor: string;
  duration: number;
  track_art_url: string;
}

export interface SearchOptions {
  query: string;
  columns?: string[];
  regex?: boolean;
}
