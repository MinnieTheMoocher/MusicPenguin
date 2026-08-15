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
  export(): Uint8Array;
  close(): void;
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

export interface SearchOptions {
  query: string;
  columns?: string[];
  regex?: boolean;
}
