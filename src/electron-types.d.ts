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

interface ElectronAPI {
  pickFolder: () => Promise<{ path: string } | null>;
  showMessageBox: (opts: { title?: string; message: string; buttons: string[] }) => Promise<number>;
  scanFolder: (dirPath: string) => Promise<ScannedFileInfo[]>;
  readFile: (filePath: string) => Promise<Uint8Array | null>;
  listSubdirs: (dirPath: string) => Promise<string[]>;
  storeFiles: (files: ScannedFileInfo[]) => Promise<void>;
  loadFiles: () => Promise<Track[]>;
  runIncrementalScan: (files: ScannedFileInfo[]) => Promise<{ added: number; removed: number; total: number; errors: number }>;
  startTagRead: () => Promise<void>;
  getCoverArt: (filePath: string) => Promise<string | null>;
  getProblematicFiles: () => Promise<{ count: number; path: string; opened: boolean }>;
  stopTagRead: () => Promise<void>;
  clearDatabase: () => Promise<void>;
  searchFiles: (opts: { query: string; columns: string[]; regex?: boolean }) => Promise<Track[]>;
  lookupPaths: (paths: string[]) => Promise<Track[]>;
  prioritizeFiles: (orderedPaths: string[]) => Promise<void>;
  rescanFiles: (paths: string[]) => Promise<void>;
  onTagUpdate: (callback: (data: TagUpdate) => void) => () => void;
  onTagScanning: (callback: (data: { path: string; scanned?: number; total?: number }) => void) => () => void;
  deleteFiles: (paths: string[]) => Promise<void>;
  deleteFilesFromDisk: (paths: string[]) => Promise<void>;
  setRating: (filePath: string, rating: number) => Promise<void>;
  showInExternalFileExplorer: (filePath: string, isFolder: boolean) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  openInVlc: (filePaths: string | string[]) => Promise<boolean>;
  isVlcAvailable: () => Promise<boolean>;
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
}

interface Window {
  electronAPI: ElectronAPI;
}
