import {
  app, BrowserWindow, ipcMain, dialog, Menu, screen, shell,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";

import { SETTINGS_DIR, SETTINGS_PATH } from "./paths";
import { setLanguage, t } from "../common/i18n/index";

app.setPath("userData", path.join(os.homedir(), ".cache", "musicpenguin"));
app.setAppUserModelId("musicpenguin");
import { detectInitialDesign } from "./desktop";
import { discoverDesigns, designHrefMap } from "./designs";
import { initDb, loadFiles, storeFiles, lookupPaths, searchFiles, countProblematicFiles, getProblematicFiles, clearAllFiles, setRating, moveFilePath, incrementPlaycount, deleteFiles, saveDb, fillMissingDuration } from "./database";
import { initTagReader, startTagRead, stopTagReader, prioritizeFiles, runIncrementalScan, scanSpecificFiles, donePromise, rescanFiles } from "./tag-reader";
import { scanDlnaLibrary, fixupMissingDurations } from "./dlna";
import { discoverDlnaServers } from "./ssdp";
import type { DlnaScanTarget } from "./dlna";
import { getCoverArt, getCoverArtGroups, fetchDlnaCoverArt, resizeToThumbnail } from "./cover-art";
import { getTrackArtUrls, setTrackArtUrls } from "./database";
import { walkDirectory, commandExists, jsonStringify, isExecutableCommand } from "./utils";
import { PLAYABLE_FILE_EXTENSIONS } from "../common/config";
import { execFileSync, spawn } from "child_process";

import type { SqlJsDatabase, ScannedFileInfo } from "./types";

import { DEFAULT_SEARCH_URLS, MAX_PROBE_FILE_SIZE } from "../common/config";
import { initMpris, updateMprisState } from "./mpris";
import { IS_LINUX, IS_MACOS } from "./platform";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const APP_ICON = path.join(PROJECT_ROOT, "src", "renderer", "musicpenguin256.png");
const PRELOAD_PATH = path.join(PROJECT_ROOT, "src", "preload", "preload.js");
const RENDERER_HTML = path.join(PROJECT_ROOT, "src", "renderer", "index.html");

let mainWindow: BrowserWindow | null = null;
let db: SqlJsDatabase | null = null;
let dbReady: Promise<SqlJsDatabase> = Promise.resolve(null as any);

/* ── Settings serialization mutex ─────────────────────────────
   Every read-modify-write of the settings file in the main process
   goes through this single lock so no two writers can interleave
   their read+write pair. Without it, a read-then-write in one handler
   can clobber a concurrent write from another (e.g. the left-panel
   group persistence being overwritten by the UI-state save). */
let settingsLock: Promise<unknown> = Promise.resolve();
function runWithSettingsLock<T>(fn: () => T): Promise<T> {
  const run = settingsLock.then(fn, fn);
  settingsLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
function readSettingsFile(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeSettingsFile(settings: Record<string, unknown>): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, jsonStringify(settings), "utf-8");
}
/* Merge `partial` into the persisted settings under the lock, then
   return the resulting full settings object. */
function mutateSettings(partial: Record<string, unknown>): Record<string, unknown> {
  const settings = readSettingsFile();
  if (!settings["search-urls"]) {
    settings["search-urls"] = DEFAULT_SEARCH_URLS;
  }
  Object.assign(settings, partial);
  writeSettingsFile(settings);
  return settings;
}

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
  if (locale.startsWith("es")) return "es-es";
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
    const windowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: isMax,
      "display-id": getWindowDisplayId(),
    };
    void runWithSettingsLock(() => {
      mutateSettings({ "window-state": windowState });
    });
  } catch { /* best-effort */ }
}

/* ── Window minimum size ──────────────────────────────────
   The now-playing bar must always stay fully visible in the OS root
   window (the BrowserWindow). Its height comes from `--now-playing-h`
   in the base CSS (64px) and grows for custom skins (up to 104px); the
   renderer reports the measured value after each design switch, and 64
   acts as a fallback before that report.

   Enforcement never throttles a normal resize: the WM min-size hint is
   refreshed only when the computed value actually changes, and a fast
   (30 ms) "enforcement burst" runs ONLY while the bounds are at/below
   the minimum, stopping the moment the window is back at or above it —
   so a drag that dips under the limit snaps back smoothly instead of
   hanging at the goal size. */
const NOW_PLAYING_FALLBACK_HEIGHT = 64;
const MIN_WINDOW_WIDTH = 240;
const MIN_ENFORCE_INTERVAL_MS = 30;
let nowPlayingBarHeight = NOW_PLAYING_FALLBACK_HEIGHT;
let minHintSetWidth = 0;
let minHintSetHeight = 0;
let frameHeight = 0;
let frameKnown = false;
let minEnforceTimer: NodeJS.Timeout | null = null;

function currentMinWindowHeight(): number {
  if (!frameKnown && mainWindow) {
    try {
      const bounds = mainWindow.getBounds();
      const contentBounds = mainWindow.getContentBounds();
      frameHeight = Math.max(0, bounds.height - contentBounds.height);
      frameKnown = true;
    } catch { /* keep frame 0 */ }
  }
  return Math.ceil(nowPlayingBarHeight) + frameHeight;
}

/* WM min-size hint — refreshed only when its value really changes, so
   interactive drags are not interrupted by hint churn. */
function updateMinSizeHint(): void {
  if (!mainWindow) return;
  const minH = currentMinWindowHeight();
  if (minHintSetWidth === MIN_WINDOW_WIDTH && minHintSetHeight === minH) return;
  minHintSetWidth = MIN_WINDOW_WIDTH;
  minHintSetHeight = minH;
  try { mainWindow.setMinimumSize(MIN_WINDOW_WIDTH, minH); } catch { /* window gone */ }
}

/* Hard clamp on the OS root window: pull its bounds back to the minimum
   the moment they fall below it. Returns true when a correction ran. */
function clampWindowToMinimum(): boolean {
  if (!mainWindow) return false;
  try {
    const cur = mainWindow.getBounds();
    const minH = currentMinWindowHeight();
    if (cur.width < MIN_WINDOW_WIDTH || cur.height < minH) {
      mainWindow.setSize(Math.max(cur.width, MIN_WINDOW_WIDTH), Math.max(cur.height, minH));
      return true;
    }
  } catch { /* window gone */ }
  return false;
}

/* Keep re-clamping on a tight loop only while the window is still below
   the minimum; stop as soon as it is back at/above the limit. */
function startEnforcementBurst(): void {
  if (minEnforceTimer) return;
  minEnforceTimer = setInterval(() => {
    clampWindowToMinimum();
    const cur = mainWindow?.getBounds();
    if (cur && cur.width >= MIN_WINDOW_WIDTH && cur.height >= currentMinWindowHeight()) {
      if (minEnforceTimer) { clearInterval(minEnforceTimer); minEnforceTimer = null; }
    }
  }, MIN_ENFORCE_INTERVAL_MS);
  minEnforceTimer.unref?.();
}

/* Stop the enforcement burst immediately. Called on quit so the resize
   watchdog can never hold up app shutdown (e.g. when the user closes the
   window via the top-right X button): the timer is unref'd as well, but
   an explicit clear here guarantees the guard is gone for good. */
function stopEnforcementBurst(): void {
  if (minEnforceTimer) { clearInterval(minEnforceTimer); minEnforceTimer = null; }
}

function enforceWindowMinimumSize(): void {
  updateMinSizeHint();
  if (clampWindowToMinimum()) startEnforcementBurst();
}

/* ── Window ──────────────────────────────────────────────── */
function createWindow() {
  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    /* Coarse standby before the renderer reports the exact now-playing
       bar height (see enforceWindowMinimumSize): keeps the bar visible
       even right after the window appears. */
    minHeight: 160,
    show: false,
    backgroundColor: "#000000",
    icon: APP_ICON,
    webPreferences: {
      preload: PRELOAD_PATH,
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
    enforceWindowMinimumSize();
  });

  mainWindow.on("resize", enforceWindowMinimumSize);
  mainWindow.on("restore", enforceWindowMinimumSize);
  mainWindow.on("unmaximize", enforceWindowMinimumSize);
  mainWindow.on("close", saveWindowState);
  mainWindow.on("closed", () => { if (minEnforceTimer) { clearInterval(minEnforceTimer); minEnforceTimer = null; } });

  /* The initial design id is resolved here (saved setting → desktop scheme →
     default) and validated against the designs discovered at runtime, which
     covers both built-in and user-provided custom designs. */
  const availableDesigns = discoverDesigns(path.dirname(RENDERER_HTML));
  const designIds = new Set<string>(designHrefMap(availableDesigns).keys());
  const initialDesignId = detectInitialDesign(SETTINGS_PATH, designIds);
  const initialDesignHref =
    designHrefMap(availableDesigns).get(initialDesignId) ??
    path.join("designs", "dark_gray", "musicpenguin-design.css");

  mainWindow.loadFile(RENDERER_HTML, {
    query: {
      /* base64 so the href survives the URL query round-trip losslessly
         (WHATWG query encoding maps spaces to "+" and would otherwise
         corrupt folder names containing spaces, `+`, `%`, "&" ...) */
      design: Buffer.from(initialDesignHref, "utf8").toString("base64"),
      lang: detectInitialLanguage(),
    },
  });
}

/* ── IPC handlers ────────────────────────────────────────── */

/* now-playing:save (sync, for unload) */
ipcMain.on("now-playing:save", (_event, data: Record<string, unknown> | null) => {
  try {
    if (!data?.path) return;
    const partial: Record<string, unknown> = {};
    partial["now-playing"] = { path: data.path, "current-time": data["current-time"] };
    if (data["search-query"] !== undefined) partial["search-query"] = data["search-query"];
    if (data.volume !== undefined) partial.volume = data.volume;
    if (data.muted !== undefined) partial.muted = data.muted;
    void runWithSettingsLock(() => {
      mutateSettings(partial);
    });
  } catch { /* best-effort */ }
});

ipcMain.on("settings:saveSync", (_event, partial: Record<string, unknown>) => {
  void runWithSettingsLock(() => {
    mutateSettings(partial || {});
  });
});

/* The renderer reports the measured now-playing bar height (on startup
   and after every design switch) so the window's minimum height keeps
   that bar fully visible regardless of the active design. */
ipcMain.on("window:setNowPlayingHeight", (_event, height: number) => {
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  nowPlayingBarHeight = h > 0 ? h : NOW_PLAYING_FALLBACK_HEIGHT;
  enforceWindowMinimumSize();
});

/* settings */
ipcMain.handle("settings:load", async () => {
  return runWithSettingsLock(() => {
    try {
      if (!fs.existsSync(SETTINGS_PATH)) {
        return null;
      }
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      if (!data["search-urls"]) {
        data["search-urls"] = [...DEFAULT_SEARCH_URLS];
        writeSettingsFile(data);
      }
      return data;
    } catch {
      return null;
    }
  });
});

ipcMain.handle("settings:save", async (_event, partial: Record<string, unknown>) => {
  await runWithSettingsLock(() => {
    mutateSettings(partial || {});
  });
});

/* designs:list — runtime design discovery (built-in + custom folders) */
ipcMain.handle("designs:list", async () => {
  return discoverDesigns(path.dirname(RENDERER_HTML));
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
    void runWithSettingsLock(() => {
      mutateSettings({ "playlist-folder": dir });
    });
  } catch { /* best-effort */ }
}

function getPlaylistFile(): string | null {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    if (typeof settings["playlist-file"] === "string" && settings["playlist-file"]) {
      return settings["playlist-file"];
    }
  } catch { /* ignore */ }
  return null;
}

function setPlaylistFile(filePath: string): void {
  try {
    void runWithSettingsLock(() => {
      mutateSettings({ "playlist-file": filePath });
    });
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
    /* Scheme detection is case-SENSITIVE: "file://" is the valid URL
       spelling, "FILE://" is not — such lines are rejected outright
       instead of being silently turned into broken playlist entries. */
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(line)?.[1];
    if (scheme && !/^[a-z][a-z0-9+.-]*$/.test(scheme)) continue;
    /* file:// URLs denote LOCAL files (other players write them into
       m3u exports): decode to plain filesystem paths — including
       percent-encoding — so library lookup and playback work. */
    if (scheme === "file") {
      try {
        paths.push(fileURLToPath(line));
        continue;
      } catch { /* malformed or non-local file:// URL — fall through */ }
    }
    /* Stream URLs (e.g. DLNA http(s) rows) are already "absolute" —
       path.isAbsolute() is false for them and joining would corrupt
       the entry into <baseDir>/http:/host/... */
    paths.push(scheme || path.isAbsolute(line) ? line : path.join(baseDir, line));
  }
  return paths;
}

ipcMain.handle("playlist:save", async (_event, paths: string[]) => {
  const storedFile = getPlaylistFile();
  const defaultPath = storedFile && fs.existsSync(storedFile)
    ? storedFile
    : path.join(getPlaylistFolder(), "playlist.m3u8");
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: t("Save Playlist"),
    defaultPath,
    filters: PLAYLIST_FILE_FILTERS,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, serializeM3u(paths), "utf-8");
  setPlaylistFolder(path.dirname(result.filePath));
  setPlaylistFile(result.filePath);
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
  setPlaylistFile(filePath);
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
ipcMain.handle("db:storeFiles", async (_event, files: ScannedFileInfo[]) => {
  await dbReady;
  storeFiles(db!, files);
});

/* db:loadFiles */
ipcMain.handle("db:loadFiles", async () => {
  await dbReady;
  return loadFiles(db!);
});

/* db:lookupPaths */
ipcMain.handle("db:lookupPaths", async (_event, paths: string[]) => {
  await dbReady;
  return lookupPaths(db!, paths);
});

/* db:searchFiles */
ipcMain.handle("db:searchFiles", async (_event, opts: { query: string; columns?: string[]; regex?: boolean }) => {
  await dbReady;
  return searchFiles(db!, opts);
});

/* db:prioritizeFiles */
ipcMain.handle("db:prioritizeFiles", (_event, orderedPaths: string[]) => {
  prioritizeFiles(orderedPaths);
});

/* db:rescanFiles */
ipcMain.handle("db:rescanFiles", async (_event, paths: string[], opts?: { onlyIfModified?: boolean }) => {
  await rescanFiles(paths, opts);
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
ipcMain.handle("db:runIncrementalScan", async (_event, files: ScannedFileInfo[], allowedPaths?: string[]) => {
  const result = await runIncrementalScan(files, allowedPaths);
  /* Duration fixup belongs to scanning workflows only — it never runs
     silently in the background of an app start. */
  await runDurationFixupAndNotify();
  return result;
});

/* ── Background DLNA server discovery ────────────────────── */

/* Shape of a persisted "dlna-servers" entry (mirrors the renderer's
   DlnaServerEntry; dashed names mirror the JSON keys). */
interface DlnaPersistedServer {
  name: string;
  "control-url": string;
  "description-url"?: string;
  "icon-url"?: string;
  enabled?: boolean;
}

/* SSDP M-SEARCH runs in the background shortly after app start,
   detached from any dialog: every responding media server is merged
   into the persisted "dlna-servers" setting — known entries get their
   name/location/icon refreshed, unknown ones are appended UNCHECKED
   (opt-in) — and the renderer is notified via dlna:servers-changed so
   an open folders dialog picks the list up immediately. A few bounded
   retries cover machines whose network is not fully up yet at launch;
   the search stops early once something was found. */
const DLNA_DISCOVERY_DELAYS_MS = [3000, 20000, 45000];

async function runStartupDlnaDiscovery(): Promise<void> {
  const readSettings = (): Record<string, unknown> => {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) ?? {}; }
    catch { return {}; }
  };

  for (let attempt = 0; attempt < DLNA_DISCOVERY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, DLNA_DISCOVERY_DELAYS_MS[attempt]));
    }
    let found;
    try {
      found = await discoverDlnaServers();
    } catch (err) {
      debugLog("[dlna] background discovery failed:", err);
      continue;
    }
    if (found.length === 0) continue;

    /* Merge into the persisted server list. */
    const stored = readSettings()["dlna-servers"];
    const servers: DlnaPersistedServer[] = Array.isArray(stored)
      ? stored.filter((s): s is DlnaPersistedServer =>
          !!s && typeof s === "object" && typeof (s as DlnaPersistedServer)["control-url"] === "string")
      : [];
    let changed = false;
    for (const server of found) {
      const existing = servers.find(
        (s) => s["control-url"] === server.controlUrl
          || (!!server.location && s["description-url"] === server.location),
      );
      if (existing) {
        if (server.name && server.name !== existing.name) { existing.name = server.name; changed = true; }
        if (!existing["description-url"] && server.location) {
          existing["description-url"] = server.location; changed = true;
        }
        if (server.icon && server.icon !== existing["icon-url"]) {
          existing["icon-url"] = server.icon; changed = true;
        }
      } else {
        servers.push({
          name: server.name ?? "",
          "control-url": server.controlUrl,
          "description-url": server.location,
          "icon-url": server.icon ?? undefined,
          enabled: false,
        });
        changed = true;
      }
    }

    if (!changed) {
      debugLog(`[dlna] ${found.length} known audio server(s) already persisted`);
      return;
    }
    try {
      await runWithSettingsLock(() => {
        mutateSettings({ "dlna-servers": servers });
      });
    } catch (err) {
      debugLog("[dlna] persisting discovered audio servers failed:", err);
      return;
    }
    debugLog(`[dlna] ${found.length} audio server(s) discovered at startup`);
    mainWindow?.webContents.send("dlna:servers-changed");
    return;
  }
}

/* dlna:scan — enumerate every enabled DLNA server's audio library and
   sync it into the database. Only invoked explicitly (folders dialog
   close / Scan button), never automatically, and always after all
   filesystem scans completed. Tracks are pushed to the renderer in
   batches as they are discovered so the main list grows live. */
ipcMain.handle("dlna:scan", async (_event, servers: DlnaScanTarget[]) => {
  await dbReady;
  const result = await scanDlnaLibrary(db!, servers, (found, name, addedRows) => {
    mainWindow?.webContents.send("dlna:progress", { found, name, added: addedRows ?? [] });
  });
  /* Layer 2 duration fixup for rows the servers announced without a
     res@duration (NULL); corrections land in the DB + renderer. */
  await runDurationFixupAndNotify();
  return result;
});

/* One ffprobe pass over every track whose duration is still unknown;
   learned values are persisted and pushed to the renderer. Called ONLY
   as a fixup after scanning workflows (incremental file scan, DLNA
   scan) — never silently at app start. */
async function runDurationFixupAndNotify(): Promise<void> {
  await dbReady;
  try {
    const fixedPaths = await fixupMissingDurations(db!);
    if (fixedPaths.length === 0) return;
    saveDb(db!);
    const rows = lookupPaths(db!, fixedPaths);
    mainWindow?.webContents.send("library:durations-fixed", { rows });
  } catch (err) {
    debugLog("[dlna] duration fixup pass failed:", err);
  }
}

/* db:fillDuration — layer 3 gap filler: the renderer learned the real
   duration of the currently playing track from its <audio> element.
   Only fills NULL gaps; returns whether the DB changed. */
ipcMain.handle("db:fillDuration", async (_event, filePath: string, seconds: number) => {
  await dbReady;
  if (!filePath) return false;
  const updated = fillMissingDuration(db!, filePath, seconds);
  if (updated) saveDb(db!);
  return updated;
});

/* db:scanSpecificFiles — tag-read only the given files */
ipcMain.handle("db:scanSpecificFiles", async (_event, files: ScannedFileInfo[]) => {
  const result = await scanSpecificFiles(files);
  await runDurationFixupAndNotify();
  return result;
});

/* db:getProblematicFileCount */
/* Temporary local test hook: set MUSICPENGUIN_TEST_PROBLEMATIC=1 to expose
   the problematic-files UI even when the current database has no errors. */
const FORCE_PROBLEMATIC_TEST = process.env.MUSICPENGUIN_TEST_PROBLEMATIC === "1";

ipcMain.handle("db:getProblematicFileCount", async () => {
  await dbReady;
  const count = countProblematicFiles(db!);
  return FORCE_PROBLEMATIC_TEST ? Math.max(1, count) : count;
});

/* db:getProblematicFiles */
ipcMain.handle("db:getProblematicFiles", async () => {
  await dbReady;
  const actualPaths = getProblematicFiles(db!);
  const paths = actualPaths.length > 0 || !FORCE_PROBLEMATIC_TEST
    ? actualPaths
    : [{ path: path.join(os.tmpdir(), "musicpenguin-test-problematic.mp3") }];
  if (paths.length === 0) {
    return { count: 0, path: "", opened: false };
  }

  const outPath = path.join(os.tmpdir(), "musicpenguin_problematic_files.txt");
  const lines = paths.map((p) => String(p.path ?? "")).join("\n");
  fs.writeFileSync(outPath, lines + "\n");

  let opened = false;
  try {
    /* Open the generated text file with the OS default application. */
    const error = await shell.openPath(outPath);
    opened = error === "";
  } catch {
    opened = false;
  }

  if (!opened) {
    dialog.showErrorBox(t("Error"), t("Could not open text editor. File saved at:\n$1", outPath));
  }

  return { count: paths.length, path: outPath, opened };
});

/* db:clearDatabase */
ipcMain.handle("db:clearDatabase", async () => {
  await dbReady;
  stopTagReader();
  if (donePromise) {
    await donePromise;
  }
  clearAllFiles(db!);
  mainWindow?.webContents.send("library:changed");
});

/* DLNA rows have http(s) stream URLs instead of file paths; their cover
   art is fetched from the server via the stored upnp:albumArtURI(s).
   Once the largest candidate has been determined it is written back to
   the DB — replacing all others — so every later lookup needs only a
   single request. */
function isStreamUrl(p: string): boolean {
  return /^https?:\/\//i.test(p);
}

async function resolveDlnaCover(streamUrl: string): Promise<string | null> {
  const spec = getTrackArtUrls(db!, streamUrl);
  if (!spec) return null;
  const result = await fetchDlnaCoverArt(streamUrl, spec);
  if (!result) return null;
  if (result.artUrl !== spec) {
    setTrackArtUrls(db!, streamUrl, result.artUrl);
    saveDb(db!);
  }
  return result.dataUrl;
}

/* db:getCoverArt */
ipcMain.handle("db:getCoverArt", async (_event, filePath: string, maxSize?: number) => {
  await dbReady;
  if (isStreamUrl(filePath)) {
    const dataUrl = await resolveDlnaCover(filePath);
    if (dataUrl && maxSize) return resizeToThumbnail(dataUrl, maxSize);
    return dataUrl;
  }
  return getCoverArt(filePath, maxSize);
});

/* db:getCoverArtGroups — remote tracks only ever have a single front
   image; rear covers / extra images are a local-folder concept. */
ipcMain.handle("db:getCoverArtGroups", async (_event, filePath: string) => {
  await dbReady;
  if (isStreamUrl(filePath)) {
    const front = await resolveDlnaCover(filePath);
    return { front, rearCovers: [], extraImages: [] };
  }
  return getCoverArtGroups(filePath);
});

/* db:deleteFiles */
ipcMain.handle("db:deleteFiles", async (_event, paths: string[]) => {
  await dbReady;
  deleteFiles(db!, paths);
});

/* db:deleteFilesFromDisk */
ipcMain.handle("db:deleteFilesFromDisk", async (_event, paths: string[]) => {
  await dbReady;
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch { /* file may not exist */ }
  }
  deleteFiles(db!, paths);
});

/* db:setRating */
ipcMain.handle("db:setRating", async (_event, filePath: string, rating: number) => {
  await dbReady;
  setRating(db!, filePath, rating);
});

/* db:incrementPlaycount */
ipcMain.handle("db:incrementPlaycount", async (_event, filePath: string) => {
  await dbReady;
  return incrementPlaycount(db!, filePath);
});

/* db:moveFile */
ipcMain.handle("db:moveFile", async (_event, oldPath: string, newPath: string) => {
  await dbReady;
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
  await runWithSettingsLock(() => {
    const settings = readSettingsFile();
    if (settings["now-playing"] && typeof settings["now-playing"] === "object" &&
        (settings["now-playing"] as Record<string, unknown>)["path"] === oldPath) {
      (settings["now-playing"] as Record<string, unknown>)["path"] = newPath;
      writeSettingsFile(settings);
    }
  });
  return { ok: true, oldPath, newPath, newFilename };
});

/* shell:openExternal
   Delegate URL handling to the operating system's default browser through
   Electron. This avoids requiring a browser executable such as `firefox`
   to be present on PATH and works across Linux, macOS and Windows. */
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
  try {
    await shell.openExternal(url);
  } catch (err) {
    console.error("[shell] openExternal failed:", err);
  }
});

/* shell:openInExternalPlayer */
interface ExternalPlayerResult {
  ok: boolean;
  error?: string;
}

/** Resolve a macOS application name or .app bundle without requiring a CLI
 * executable to be present on PATH. Direct executable paths are handled by
 * isExecutableCommand() before this resolver is called. */
function findMacApplication(player: string): string | null {
  if (!IS_MACOS) return null;
  const trimmed = player.trim();
  if (!trimmed) return null;

  if (/\.app$/i.test(trimmed) && fs.existsSync(trimmed)) return trimmed;

  const appName = path.basename(trimmed).replace(/\.app$/i, "");
  if (!appName || appName.includes("/")) return null;

  for (const root of ["/Applications", path.join(os.homedir(), "Applications")]) {
    const candidate = path.join(root, `${appName}.app`);
    if (fs.existsSync(candidate)) return candidate;
  }

  /* Spotlight also finds applications installed outside the conventional
     Applications folders. The literal is escaped before it becomes part of
     the mdfind query. */
  try {
    const escaped = appName.replace(/\\/g, "\\\\").replace(/'/g, "\\\\'");
    const result = execFileSync("mdfind", [`kMDItemFSName == '${escaped}.app'c`], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const found = result.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch { /* Spotlight unavailable or no matching application */ }

  return null;
}

function spawnExternalPlayerCommand(command: string, files: string[]): Promise<ExternalPlayerResult> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, files, { detached: true, stdio: "ignore" });
      proc.once("error", (err) => resolve({ ok: false, error: err.message }));
      proc.once("spawn", () => {
        proc.unref();
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

function openMacApplication(appPath: string, files: string[]): Promise<ExternalPlayerResult> {
  return new Promise((resolve) => {
    let stderr = "";
    try {
      const proc = spawn("/usr/bin/open", ["-a", appPath, ...files], {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.once("error", (err) => resolve({ ok: false, error: err.message }));
      proc.once("close", (code) => {
        if (code === 0) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: stderr.trim() || `open exited with code ${code ?? "unknown"}` });
        }
      });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function launchExternalPlayer(player: string, files: string[]): Promise<ExternalPlayerResult> {
  const trimmed = player.trim();
  if (!trimmed) return { ok: false, error: "No external player configured." };

  if (isExecutableCommand(trimmed)) {
    return spawnExternalPlayerCommand(trimmed, files);
  }

  const appPath = findMacApplication(trimmed);
  if (appPath) {
    return openMacApplication(appPath, files);
  }

  return {
    ok: false,
    error: IS_MACOS
      ? `External player not found as a command or macOS application: ${trimmed}`
      : `External player command not found: ${trimmed}`,
  };
}

function isExternalPlayerAvailable(player: string): boolean {
  const trimmed = player.trim();
  return trimmed.length > 0 && (isExecutableCommand(trimmed) || findMacApplication(trimmed) !== null);
}

ipcMain.handle("shell:openInExternalPlayer", async (_event, filePaths: string | string[], player?: string) => {
  const exe = (player ?? "").trim() || "vlc";
  const files = Array.isArray(filePaths) ? filePaths : [filePaths];
  const result = await launchExternalPlayer(exe, files);
  if (result.ok) {
    // playing a file in an external player counts as a play
    await dbReady;
    for (const f of files) incrementPlaycount(db!, f);
  }
  return result;
});

/* shell:isExternalPlayerAvailable */
ipcMain.handle("shell:isExternalPlayerAvailable", (_event, player?: string) => {
  return isExternalPlayerAvailable((player ?? "").trim() || "vlc");
});

/* shell:checkCommand */
ipcMain.handle("shell:checkCommand", (_event, cmd: string) => {
  return isExecutableCommand(String(cmd ?? ""));
});

/* app:getVersion */
ipcMain.handle("app:getVersion", () => {
  return app.getVersion();
});

/* app:getPlayableExtensions */
ipcMain.handle("app:getPlayableExtensions", () => {
  return Array.from(PLAYABLE_FILE_EXTENSIONS);
});

/* debug:log */
const DEBUG_LOG_PATH = path.join(os.homedir(), ".config", "musicpenguin", "musicpenguin.log");

function isDebugLogEnabled(): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    return data["debug-log"] === true;
  } catch { return false; }
}

function debugLog(...args: unknown[]): void {
  if (!isDebugLogEnabled()) return;
  const ts = new Date().toISOString();
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  try { fs.appendFileSync(DEBUG_LOG_PATH, ts + " " + msg + "\n"); } catch { /* ignore */ }
}

ipcMain.handle("debug:log", (_event, line: string) => {
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, line + "\n");
  } catch { /* ignore */ }
});

/* mpris:updateState */
ipcMain.on("mpris:updateState", (_event, state) => {
  try {
    updateMprisState(state);
  } catch (err) {
    console.error("[MPRIS] mpris:updateState IPC failed:", err);
  }
});

/* shell:showInExternalFileExplorer */
ipcMain.handle("shell:showInExternalFileExplorer", async (_event, filePath: string, isFolder: boolean) => {
  try {
    if (isFolder) {
      /* Open folders directly through the platform's default file manager. */
      const error = await shell.openPath(filePath);
      if (error) throw new Error(error);
    } else {
      /* Show the file and select it when the file manager supports that. */
      shell.showItemInFolder(filePath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(t("Error"), message || t("Could not open file manager."));
  }
});

/* shell:openWithDefaultApplication
   Open local files with the operating system's associated application.
   HTTP(S) stream URLs are intentionally ignored because shell.openPath()
   is for filesystem paths; the renderer only offers this action for local
   files. Returns the subset that was opened successfully. */
ipcMain.handle("shell:openWithDefaultApplication", async (_event, filePaths: string | string[]) => {
  const candidates = Array.isArray(filePaths) ? filePaths : [filePaths];
  const localFiles = candidates.filter(
    (filePath): filePath is string => typeof filePath === "string" && filePath.length > 0 && !isStreamUrl(filePath),
  );
  const opened: string[] = [];

  for (const filePath of localFiles) {
    try {
      const error = await shell.openPath(filePath);
      if (error === "") {
        opened.push(filePath);
      } else {
        console.error("[shell] openWithDefaultApplication failed:", filePath, error);
      }
    } catch (err) {
      console.error("[shell] openWithDefaultApplication failed:", filePath, err);
    }
  }

  if (opened.length > 0) {
    await dbReady;
    for (const filePath of opened) incrementPlaycount(db!, filePath);
  }
  return opened;
});

/* ── App lifecycle ───────────────────────────────────────── */

app.on("before-quit", () => {
  stopEnforcementBurst();
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

function sendToRendererChannel(channel: string, data: unknown): void {
  mainWindow?.webContents.send(channel, data);
}

/* Re-read the database file after a second instance modified it. */
let reloadTimer: NodeJS.Timeout | null = null;
function scheduleDbReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void (async () => {
      try {
        stopTagReader();
        dbReady = initDb();
        db = await dbReady;
        initTagReader(db, sendToRendererChannel);
        startTagRead();
        mainWindow?.webContents.send("library:changed");
      } catch (e) {
        console.error("reloading database failed:", e);
      }
    })();
  }, 400);
}

export async function start() {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    scheduleDbReload();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  Menu.setApplicationMenu(null);
  setLanguage(detectInitialLanguage());

  dbReady = initDb();
  db = await dbReady;
  initTagReader(db, sendToRendererChannel);

  createWindow();

  /* Fire & forget: discover DLNA audio servers in the background. */
  void runStartupDlnaDiscovery();

  /* ── MPRIS (Linux D-Bus media key integration) ─────────────── */
  if (IS_LINUX) {
    try {
      initMpris((action: string) => {
        debugLog("[MPRIS]", action);
        mainWindow?.webContents.send("media-key", action);
      });
    } catch (e) {
      console.error("[MPRIS] initMpris failed:", e);
    }
  }
}
