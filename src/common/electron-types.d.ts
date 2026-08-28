interface Track {
  path: string;
  filename: string;
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
  duration: string;
  playcount: number;
  bpm: number;
  dlna: number;
}

interface ScannedFileInfo {
  name: string;
  relativePath: string;
  fullPath: string;
}

interface TagUpdate {
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

/* One DLNA source configured in the folders dialog (persisted as
   "dlna-servers" in musicpenguin-settings.json). `control-url` is the
   ContentDirectory control URL (SOAP Browse endpoint used for
   enumeration), `description-url` the device description URL — kept as
   a stable identity and fallback to re-derive a stale control URL.
   `icon-url` is a data URL captured during discovery so the dialog can
   render it immediately on reopen ("" when the server announced none).
   The dashed property names mirror the persisted JSON keys exactly. */
interface DlnaServerEntry {
  name: string;
  "control-url": string;
  "description-url": string;
  "icon-url": string;
  enabled: boolean;
}

interface ElectronAPI {
  pickFolder: () => Promise<{ path: string } | null>;
  showMessageBox: (opts: { title?: string; message: string; buttons: string[] }) => Promise<number>;
  scanFolder: (dirPath: string) => Promise<ScannedFileInfo[]>;
  readFile: (filePath: string) => Promise<Uint8Array | null>;
  listSubdirs: (dirPath: string) => Promise<string[]>;
  storeFiles: (files: ScannedFileInfo[]) => Promise<void>;
  loadFiles: () => Promise<Track[]>;
  runIncrementalScan: (files: ScannedFileInfo[], allowedPaths?: string[]) => Promise<{ added: number; removed: number; total: number; errors: number }>;
  scanSpecificFiles: (files: ScannedFileInfo[]) => Promise<{ added: number; removed: number; total: number; errors: number }>;
  scanDlna: (servers: DlnaServerEntry[]) => Promise<{ added: number; removed: number; total: number; errors?: string[] }>;
  startTagRead: () => Promise<void>;
  getCoverArt: (filePath: string, maxSize?: number) => Promise<string | null>;
  getCoverArtGroups: (filePath: string) => Promise<{ front: string | null; rearCovers: string[]; extraImages: string[] }>;
  getProblematicFiles: () => Promise<{ count: number; path: string; opened: boolean }>;
  getProblematicFileCount: () => Promise<number>;
  stopTagRead: () => Promise<void>;
  clearDatabase: () => Promise<void>;
  searchFiles: (opts: { query: string; columns: string[]; regex?: boolean }) => Promise<Track[]>;
  lookupPaths: (paths: string[]) => Promise<Track[]>;
  prioritizeFiles: (orderedPaths: string[]) => Promise<void>;
  /* `onlyIfModified` skips files whose mtime is unchanged since their
     last tag scan (used by the play-time refresh; context-menu rescans
     omit it to force a re-read) */
  rescanFiles: (paths: string[], opts?: { onlyIfModified?: boolean }) => Promise<void>;
  onTagUpdate: (callback: (data: TagUpdate) => void) => () => void;
  onTagScanning: (callback: (data: { path: string; scanned?: number; total?: number }) => void) => () => void;
  /* `added` carries row snapshots of the tracks discovered since the
     previous event, so the main list can grow while enumeration runs */
  onDlnaProgress: (callback: (data: { found: number; name?: string; added?: Track[] }) => void) => () => void;
  /* Pushed by the main process after its background SSDP discovery
     merged new/refreshed servers into the persisted list */
  onDlnaServersChanged: (callback: () => void) => () => void;
  /* Pushed when the library database changed underneath us — reload
     all tracks from the DB */
  onLibraryChanged: (callback: () => void) => () => void;
  /* Pushed after the main process learned durations for tracks stored
     with NULL ("unknown") — rows carry full track snapshots */
  onDurationsFixed: (callback: (data: { rows: Track[] }) => void) => () => void;
  /* Gap filler: persist a duration learned at play time from the
     <audio> element. Only fills unknown (NULL) gaps; resolves whether
     the database was changed. */
  fillTrackDuration: (filePath: string, seconds: number) => Promise<boolean>;
  deleteFiles: (paths: string[]) => Promise<void>;
  deleteFilesFromDisk: (paths: string[]) => Promise<void>;
  setRating: (filePath: string, rating: number) => Promise<void>;
  showInExternalFileExplorer: (filePath: string, isFolder: boolean) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openInExternalPlayer: (filePaths: string | string[], player?: string) => Promise<boolean>;
  isExternalPlayerAvailable: (player?: string) => Promise<boolean>;
  checkCommand: (command: string) => Promise<boolean>;
  moveFile: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string; oldPath?: string; newPath?: string; newFilename?: string }>;
  saveNowPlayingSync: (data: { path: string; "current-time": number; "search-query"?: string; volume?: number; muted?: boolean } | null) => void;
  loadSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  saveSettingsSync: (settings: any) => void;
  incrementPlaycount: (filePath: string) => Promise<number>;
  savePlaylist: (paths: string[]) => Promise<{ canceled: boolean; path?: string }>;
  loadPlaylist: () => Promise<{ canceled: boolean; paths?: string[]; filePath?: string }>;
  savePlaylistStateFile: (paths: string[]) => Promise<boolean>;
  loadPlaylistStateFile: () => Promise<string[]>;
  getVersion: () => Promise<string>;
  getPlayableExtensions: () => Promise<string[]>;
  onMediaKey: (callback: (action: string) => void) => () => void;
  updateMprisState: (state: {
    status?: string;
    track?: { title?: string; artist?: string; album?: string; path?: string; duration?: string } | null;
    position?: number;
    volume?: number;
    canNext?: boolean;
    canPrev?: boolean;
  }) => void;
  debugLog: (line: string) => Promise<void>;
}

interface Window {
  electronAPI: ElectronAPI;
}
