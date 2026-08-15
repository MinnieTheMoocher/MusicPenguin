import {
  app, BrowserWindow, ipcMain, dialog, Menu, screen, shell,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { SETTINGS_DIR, SETTINGS_PATH } from "./paths";

import { setLanguage, t } from "../i18n/index";

app.setPath("userData", path.join(os.homedir(), ".cache", "musicpenguin"));
import { detectInitialTheme } from "./kde-theme";
import { initDb, loadFiles, storeFiles, lookupPaths, searchFiles, getProblematicFiles, clearAllFiles, setRating, moveFilePath, incrementPlaycount, deleteFiles, saveDb } from "./database";
import { initTagReader, startTagRead, stopTagReader, prioritizeFiles, runIncrementalScan, donePromise, rescanFiles } from "./tag-reader";
import { getCoverArt } from "./cover-art";
import { walkDirectory, commandExists, jsonStringify } from "./utils";
import { PLAYABLE_FILE_EXTENSIONS } from "../config";
import { spawn } from "child_process";

import type { SqlJsDatabase, ScannedFileInfo } from "./types";

import { DEFAULT_SEARCH_URLS, MAX_PROBE_FILE_SIZE } from "../config";

const PROJECT_ROOT = path.resolve(__dirname, "..");

let mainWindow: BrowserWindow | null = null;
let db: SqlJsDatabase | null = null;

/* ── Language ────────────────────────────────────────────── */
function detectInitialLanguage(): string {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const saved = JSON.parse(raw);
    if (saved.language) return saved.language;
  } catch { /* fall through to OS locale */ }

  const locale = app.getLocale().toLowerCase();
  if (locale.startsWith("de")) return "de-de";
  if (locale.startsWith("fr")) return "fr-fr";
  return "en-us";
}

/* ── Window state persistence ────────────────────────────── */
function getWindowDisplayId(): string | null {
  try {
    const bounds = mainWindow!.getNormalBounds();
    const cx = bounds.x + Math.round(bounds.width / 2);
    const cy = bounds.y + Math.round(bounds.height / 2);
    const display = screen.getDisplayNearestPoint({ x: cx, y: cy });
    return display ? String(display.id) : null;
  } catch {
    return null;
  }
}

function findDisplayById(id: string | null): Electron.Display | null {
  if (!id) return null;
  return screen.getAllDisplays().find((d) => String(d.id) === id) ?? null;
}

function saveWindowState() {
  try {
    if (!mainWindow) return;
    const isMax = mainWindow.isMaximized();
    const bounds = mainWindow.getNormalBounds();
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    } catch { /* settings file may not exist yet */ }
    settings["window-state"] = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: isMax,
      "display-id": getWindowDisplayId(),
    };
    fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
  } catch { /* best-effort */ }
}

/* ── Window ──────────────────────────────────────────────── */
function createWindow() {
  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    show: false,
    backgroundColor: "#000000",
    icon: path.join(PROJECT_ROOT, "res", "musicpenguin.png"),
    webPreferences: {
      preload: path.join(PROJECT_ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  mainWindow = new BrowserWindow(winOpts);

  function applySavedState() {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const savedState = JSON.parse(raw)["window-state"] as Record<string, unknown> | undefined;
      if (!savedState) { mainWindow!.maximize(); return; }

      const x = savedState.x as number | undefined;
      const y = savedState.y as number | undefined;
      const w = savedState.width as number | undefined;
      const h = savedState.height as number | undefined;

      let targetDisplay = findDisplayById(savedState["display-id"] as string | null);

      if (!targetDisplay && x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
        const cx = x + Math.round(w / 2);
        const cy = y + Math.round(h / 2);
        try {
          targetDisplay = screen.getDisplayMatching({ x: cx, y: cy, width: 1, height: 1 });
        } catch { /* no matching display */ }
      }

      if (savedState.maximized) {
        if (targetDisplay) {
          mainWindow!.setPosition(targetDisplay.workArea.x, targetDisplay.workArea.y);
        }
        mainWindow!.maximize();
      } else if (targetDisplay && x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
        mainWindow!.setPosition(x, y);
        mainWindow!.setSize(w, h);
      }
    } catch { mainWindow!.maximize(); }
  }

  mainWindow.once("ready-to-show", () => {
    applySavedState();
    mainWindow!.show();
  });

  mainWindow.on("close", saveWindowState);

  mainWindow.loadFile(path.join(PROJECT_ROOT, "index.html"), {
    query: {
      theme: detectInitialTheme(SETTINGS_PATH),
      lang: detectInitialLanguage(),
    },
  });
}

/* ── IPC handlers ────────────────────────────────────────── */

/* now-playing:save (sync, for unload) */
ipcMain.on("now-playing:save", (_event, data: Record<string, unknown> | null) => {
  try {
    if (!data?.path) return;
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")); } catch { /* ignore */ }
    settings["now-playing"] = { path: data.path, "current-time": data["current-time"] };
    if (data["search-query"] !== undefined) settings["search-query"] = data["search-query"];
    if (data.volume !== undefined) settings.volume = data.volume;
    if (data.muted !== undefined) settings.muted = data.muted;
    fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
  } catch { /* best-effort */ }
});

ipcMain.on("settings:saveSync", (_event, partial: Record<string, unknown>) => {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")); } catch { /* ignore */ }
  if (!settings["search-urls"]) {
    settings["search-urls"] = DEFAULT_SEARCH_URLS;
  }
  Object.assign(settings, partial);
  fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
});

/* settings */
ipcMain.handle("settings:load", () => {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    if (!data["search-urls"]) {
      data["search-urls"] = [...DEFAULT_SEARCH_URLS];
      fs.writeFileSync(SETTINGS_PATH, jsonStringify(data), "utf-8");
    }
    return data;
  } catch {
    return null;
  }
});

ipcMain.handle("settings:save", (_event, partial: Record<string, unknown>) => {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")); } catch { /* ignore */ }
  if (!settings["search-urls"]) {
    settings["search-urls"] = DEFAULT_SEARCH_URLS;
  }
  Object.assign(settings, partial);
  fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
});

/* dialog:pickFolder */
ipcMain.handle("dialog:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { path: result.filePaths[0]! };
});

/* dialog:showMessageBox */
ipcMain.handle("dialog:showMessageBox", async (_event, opts: { title?: string; message: string; buttons: string[] }) => {
  const buttons = Array.isArray(opts.buttons) && opts.buttons.length > 0 ? opts.buttons : ["OK"];
  const defaultId = buttons.length - 1;
  const result = await dialog.showMessageBox(mainWindow!, {
    type: "error",
    title: opts.title || "MusicPenguin",
    message: opts.message,
    buttons,
    defaultId,
    cancelId: defaultId,
  });
  return result.response;
});

/* playlist:save */
function getPlaylistFolder(): string {
  let result = "";
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      if (typeof settings["playlist-folder"] === "string" && settings["playlist-folder"].trim()) {
        result = settings["playlist-folder"];
      }
    } catch { /* settings file may not exist or be corrupt — fall through */
       result = "";
    }
  }
  if(result?.length<=0 || !fs.existsSync(result)) { result = path.join(os.homedir(), "Music"); }
  if(!fs.existsSync(result)) { result = path.join(os.homedir(), "Documents"); }
  if(!fs.existsSync(result)) { result = os.homedir(); }
  return result;
}

function setPlaylistFolder(dir: string): void {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")); } catch { /* ignore */ }
    settings["playlist-folder"] = dir;
    fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
  } catch { /* best-effort */ }
}

const PLAYLIST_FILE_FILTERS = [
  { name: "M3U Playlist (*.m3u8, *.m3u)", extensions: ["m3u8", "m3u"] },
];

function serializeM3u(paths: string[]): string {
  return ["#EXTM3U", ...paths].join("\n") + "\n";
}

function parseM3u(content: string, baseDir: string): string[] {
  const paths: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    paths.push(path.isAbsolute(line) ? line : path.join(baseDir, line));
  }
  return paths;
}

ipcMain.handle("playlist:save", async (_event, paths: string[]) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: t("Save Playlist"),
    defaultPath: path.join(getPlaylistFolder(), "playlist.m3u8"),
    filters: PLAYLIST_FILE_FILTERS,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, serializeM3u(paths), "utf-8");
  setPlaylistFolder(path.dirname(result.filePath));
  return { canceled: false, path: result.filePath };
});

/* playlist:load */
ipcMain.handle("playlist:load", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: t("Load Playlist"),
    defaultPath: getPlaylistFolder(),
    properties: ["openFile"],
    filters: PLAYLIST_FILE_FILTERS,
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  const filePath = result.filePaths[0]!;
  const content = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  setPlaylistFolder(path.dirname(filePath));
  return { canceled: false, paths: parseM3u(content, path.dirname(filePath)), filePath };
});

/* persisted musicpenguin playlist state */
const PLAYLIST_STATE_PATH = path.join(SETTINGS_DIR, "musicpenguin-playlist.m3u8");

ipcMain.handle("playlist:saveStateFile", (_event, paths: string[]) => {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(PLAYLIST_STATE_PATH, serializeM3u(paths), "utf-8");
    return true;
  } catch { /* best-effort */ }
  return false;
});

ipcMain.handle("playlist:loadStateFile", () => {
  try {
    if (!fs.existsSync(PLAYLIST_STATE_PATH)) return [];
    const content = fs.readFileSync(PLAYLIST_STATE_PATH, "utf-8").replace(/^\uFEFF/, "");
    return parseM3u(content, SETTINGS_DIR);
  } catch { /* best-effort */ }
  return [];
});

/* fs:scanFolder */
ipcMain.handle("fs:scanFolder", async (_event, dirPath: string) => {
  return walkDirectory(dirPath, dirPath);
});

/* fs:listSubdirs */
ipcMain.handle("fs:listSubdirs", async (_event, dirPath: string) => {
  const entries: string[] = [];
  try {
    const names = fs.readdirSync(dirPath);
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, name);
      if (fs.statSync(fullPath).isDirectory()) {
        entries.push(fullPath);
      }
    }
  } catch { /* ignore inaccessible dirs */ }
  return entries;
});

/* fs:readFile */
ipcMain.handle("fs:readFile", async (_event, filePath: string) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_PROBE_FILE_SIZE) return null;
    const buf = await fs.promises.readFile(filePath);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
});

/* db:storeFiles */
ipcMain.handle("db:storeFiles", (_event, files: ScannedFileInfo[]) => {
  storeFiles(db!, files);
});

/* db:loadFiles */
ipcMain.handle("db:loadFiles", () => {
  return loadFiles(db!);
});

/* db:lookupPaths */
ipcMain.handle("db:lookupPaths", (_event, paths: string[]) => {
  return lookupPaths(db!, paths);
});

/* db:searchFiles */
ipcMain.handle("db:searchFiles", (_event, opts: { query: string; columns?: string[]; regex?: boolean }) => {
  return searchFiles(db!, opts);
});

/* db:prioritizeFiles */
ipcMain.handle("db:prioritizeFiles", (_event, orderedPaths: string[]) => {
  prioritizeFiles(orderedPaths);
});

/* db:rescanFiles */
ipcMain.handle("db:rescanFiles", async (_event, paths: string[]) => {
  await rescanFiles(paths);
});

/* db:stopTagRead */
ipcMain.handle("db:stopTagRead", async () => {
  stopTagReader();
  if (donePromise) {
    await donePromise;
  }
});

/* db:startTagRead */
ipcMain.handle("db:startTagRead", async () => {
  startTagRead();
});

/* db:runIncrementalScan */
ipcMain.handle("db:runIncrementalScan", async (_event, files: ScannedFileInfo[]) => {
  return runIncrementalScan(files);
});

/* db:getProblematicFiles */
ipcMain.handle("db:getProblematicFiles", async () => {
  const paths = getProblematicFiles(db!);
  if (paths.length === 0) {
    return { count: 0, path: "", opened: false };
  }

  const outPath = "/tmp/musicpenguin_problematic_files.txt";
  const lines = paths.map((p) => String(p.path ?? "")).join("\n");
  fs.writeFileSync(outPath, lines + "\n");

  const desktop = (process.env.XDG_CURRENT_DESKTOP || "").toLowerCase();

  async function tryEditor(name: string, args: string[]): Promise<boolean> {
    try {
      const proc = spawn(name, args, { detached: true, stdio: "ignore" });
      proc.unref();
      return await new Promise<boolean>((resolve) => {
        proc.on("error", () => resolve(false));
        proc.on("spawn", () => resolve(true));
      });
    } catch {
      return false;
    }
  }

  let opened = false;

  // Try the OS default editor first
  if (commandExists("xdg-open")) opened = await tryEditor("xdg-open", [outPath]);

  // Then try well-known GUI editors
  if (!opened && commandExists("code"))    opened = await tryEditor("code", [outPath]);
  if (!opened && commandExists("codium"))  opened = await tryEditor("codium", [outPath]);

  // KDE/GNOME fallbacks
  if (!opened && desktop.includes("kde")  && commandExists("kate"))  opened = await tryEditor("kate", [outPath]);
  if (!opened && desktop.includes("gnome") && commandExists("gedit")) opened = await tryEditor("gedit", [outPath]);

  if (!opened) {
    dialog.showErrorBox(t("Error"), t("Could not open text editor. File saved at:\n$1", outPath));
  }

  return { count: paths.length, path: outPath, opened };
});

/* db:clearDatabase */
ipcMain.handle("db:clearDatabase", async () => {
  stopTagReader();
  if (donePromise) {
    await donePromise;
  }
  clearAllFiles(db!);
});

/* db:getCoverArt */
ipcMain.handle("db:getCoverArt", async (_event, filePath: string) => {
  return getCoverArt(filePath);
});

/* db:deleteFiles */
ipcMain.handle("db:deleteFiles", (_event, paths: string[]) => {
  deleteFiles(db!, paths);
});

/* db:deleteFilesFromDisk */
ipcMain.handle("db:deleteFilesFromDisk", (_event, paths: string[]) => {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* file may not exist */ }
  }
  deleteFiles(db!, paths);
});

/* db:setRating */
ipcMain.handle("db:setRating", (_event, filePath: string, rating: number) => {
  setRating(db!, filePath, rating);
});

/* db:incrementPlaycount */
ipcMain.handle("db:incrementPlaycount", (_event, filePath: string) => {
  return incrementPlaycount(db!, filePath);
});

/* db:moveFile */
ipcMain.handle("db:moveFile", async (_event, oldPath: string, newPath: string) => {
  if (!oldPath || !newPath || oldPath === newPath) return { ok: false, error: "no change" };
  if (!newPath.trim()) return { ok: false, error: "path is empty" };
  try {
    const newDir = path.dirname(newPath);
    fs.mkdirSync(newDir, { recursive: true });
    fs.renameSync(oldPath, newPath);
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "move failed" };
  }
  const newFilename = path.basename(newPath);
  moveFilePath(db!, oldPath, newPath, newFilename);
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(raw);
    if (settings["now-playing"]?.path === oldPath) {
      settings["now-playing"].path = newPath;
      fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
    }
  } catch { /* best-effort */ }
  return { ok: true, oldPath, newPath, newFilename };
});

/* shell:openExternal */
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
  let browser = "firefox";
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const saved = JSON.parse(raw);
    if (saved.browser) browser = saved.browser;
  } catch { /* use default */ }
  try {
    spawn(browser, [url], { detached: true, stdio: "ignore" }).unref();
  } catch { /* ignore */ }
});

/* shell:openInVlc */
ipcMain.handle("shell:openInVlc", async (_event, filePaths: string | string[]) => {
  if (!commandExists("vlc")) return false;
  try {
    const files = Array.isArray(filePaths) ? filePaths : [filePaths];
    spawn("vlc", files, { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch { return false; }
});

/* shell:isVlcAvailable */
ipcMain.handle("shell:isVlcAvailable", () => commandExists("vlc"));

/* app:getVersion */
ipcMain.handle("app:getVersion", () => {
  return app.getVersion();
});

/* app:getPlayableExtensions */
ipcMain.handle("app:getPlayableExtensions", () => {
  return Array.from(PLAYABLE_FILE_EXTENSIONS);
});

/* shell:showInExternalFileExplorer */
ipcMain.handle("shell:showInExternalFileExplorer", async (_event, filePath: string, isFolder: boolean) => {
  const desktop = (process.env.XDG_CURRENT_DESKTOP || "").toLowerCase();

  // Try the OS default file manager first
  if (commandExists("xdg-open")) {
    const target = isFolder ? filePath : path.dirname(filePath);
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  // KDE fallback — dolphin supports --select for highlighting a specific file
  if (desktop.includes("kde") && commandExists("dolphin")) {
    const args = isFolder ? [filePath] : ["--select", filePath];
    spawn("dolphin", args, { detached: true, stdio: "ignore" }).unref();
    return;
  }

  // GNOME fallback — nautilus supports --select
  if (desktop.includes("gnome") && commandExists("nautilus")) {
    const args = isFolder ? [filePath] : ["--select", filePath];
    spawn("nautilus", args, { detached: true, stdio: "ignore" }).unref();
    return;
  }

  dialog.showErrorBox(t("Error"), t("Could not open file manager."));
});

/* ── App lifecycle ───────────────────────────────────────── */

app.on("before-quit", () => {
  saveWindowState();
});

app.on("window-all-closed", () => {
  stopTagReader();
  if (db) { saveDb(db); db.close(); }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ── Startup ─────────────────────────────────────────────── */
export async function start() {
  Menu.setApplicationMenu(null);
  setLanguage(detectInitialLanguage());
  db = await initDb();

  initTagReader(db, (channel: string, data: unknown) => {
    mainWindow?.webContents.send(channel, data);
  });

  createWindow();
}
