# MusicPenguin Implementation

## Build & Run

```bash
npm ci                  # install dependencies
npm run build           # typecheck, then builds both bundles (main + renderer)
npm run typecheck       # tsc --noEmit — strict type-check only (no output emitted)
npm run build:main      # esbuild bundles src/main-process/ → dist/main-bundle.js (CJS)
npm run build:renderer  # esbuild bundles src/ → dist/bundle.js (ESM)
npm run start           # build + launch Electron window
npm run electron        # launch without re-building
npm run watch           # typecheck once, then rebuild renderer bundle on file changes
./pack-deb.bash         # create .deb distribution package
```

## Files

| File                   | Purpose
|------------------------|--------
| main.js                | Electron entry (CommonJS shim)
| dist/main-bundle.js    | Bundled main process (src/main-process)
| preload.js             | contextBridge → window.electronAPI
| index.html             | HTML layout with all panels
| style.css              | Full stylesheet, dark/light themes
| dist/bundle.js         | Bundled renderer (src/index.ts, ESM)
| src/main-process/      | Main-process TypeScript source files
| src/i18n/              | Localization module (`ITranslate` contract, `en-us`/`de-de`/`fr-fr` dictionaries, `t()` lookup)
| src/                   | Renderer TypeScript source files

**Key point**: `main.js` and `preload.js` are plain CommonJS, never transpiled. `src/` and
`src/main-process/` files are TypeScript bundled by esbuild (types stripped). TypeScript syntax
(`as`, generics, etc.) must never appear in main.js or preload.js.

**No inline `require()` in TypeScript**: all module loading in `src/` (renderer and main process)
must go through top-level `import` statements — never inline `require()` calls. Only `main.js`,
`preload.js`, and `pack-deb.bash` (plain CommonJS / shell) may use `require`. Since `sql.js` ships
no type declarations, its type is provided by the ambient `declare module "sql.js"` in
`src/main-process/sqljs.d.ts`. Type casts must be typed assertions to concrete types (e.g.
`as Buffer`); `as any` is forbidden because it bypasses the strict type check.

## App Files Used at Runtime

| File                                               | Purpose
|----------------------------------------------------|--------
| ~/.config/musicpenguin/musicpenguin-settings.json  | persisted user preferences
| ~/.config/musicpenguin/musicpenguin-library.sqlite | SQLite database storing the known tags of all known files
| ~/.cache/musicpenguin/                             | Electron/Chromium cache

## Supported Media Formats

Scanner discovers files with these extensions (defined in `MEDIA_FILE_EXTENSIONS`):

**Audio**: `.mp3`, `.mp2`, `.m2a`, `.aac`, `.m4a`, `.wav`, `.flac`, `.ogg`, `.opus`, `.oga`, `.ogm`, `.ogx`, `.spx`, `.aif`, `.aiff`, `.aifc`, `.au`
**Video / containers**: `.mpg`, `.mpeg`, `.mp4`, `.m4v`, `.mov`, `.mkv`, `.webm`, `.ogv`, `.asf`, `.wma`, `.wmv`

Tag reading is handled by `music-metadata` (supports audio formats). If that fails,
`tags_error` is set to 1 and the file only retried on a manual re-scan invocation.
Duration is always verified via `ffprobe` as a fallback when `music-metadata` returns 0.

Built-in playback via `<audio>` handles: `.mp3`, `.aac`, `.m4a`, `.mp4`, `.m4v`, `.ogg`, `.opus`, `.oga`, `.webm`, `.wav`, `.flac`.
Other formats (video files, `.aif`/`.aiff`/`.au`, `.asf`/`.wma`/`.wmv`) can be played
via an external player (VLC integration available through the context menu).

**`~/.config/musicpenguin/`** — our own persistence directory. Contains exactly two files:
`musicpenguin-settings.json` (preferences) and `musicpenguin-library.sqlite` (the music library). Created on first launch
by `ensureDir()`. No Chromium internals here.

**`~/.cache/musicpenguin/`** — Electron/Chromium userData directory. Holds all the browser engine
caches: `Cache/`, `Code Cache/`, `GPUCache/`, `Local Storage/`, `blob_storage/`, `Crashpad/`,
`Dictionaries/`, `DawnGraphiteCache/`, `DawnWebGPUCache/`, `Shared Dictionary/`, plus various SQLite
WAL files and state files (`Local State`, `Network Persistent State`, `Preferences`, `Trust Tokens`,
`SharedStorage`, `DIPS`). Not created by us — Electron populates it automatically. Can be safely
deleted (caches will be rebuilt). Set via `app.setPath("userData", ...)` at the top of main.js.

## UI Layout

```text
┌───────────────────────────────────────────────────────────┐
│  Now Playing (title row + controls row)                   │
├────────┬────────────────────────┬─────────────────────────┤
│ Groups │  List View (table)     │  Search (bar + tags)    │
│ Panel  │                        ├─────────────────────────┤
│        ├────────────────────────┤  Playlist               │
│        │  Detail Panel          │  (drag-drop, shuffle,   │
│        │  (form + cover art)    │   repeat, randomize)    │
├────────┴────────────────────────┴─────────────────────────┤
│  Status Bar                                               │
└───────────────────────────────────────────────────────────┘
```

Draggable splitters between all three vertical columns, a horizontal splitter between list and detail,
and cross-handle knobs at both intersections (left: groups×list, right: playlist×list).

The bottom of the groups panel has four icon buttons:
**Folders** (opens the folder manager), **Scan** (re-scans all folders), **Problematic** (lists
files with tag errors), and **Settings** (dark mode toggle).

## Database

Stored at `~/.config/musicpenguin/musicpenguin-library.sqlite`
(configurable via `db-path` in musicpenguin-settings.json).
sql.js (WASM) — no native compilation needed.

```sql
CREATE TABLE files (
  path             TEXT PRIMARY KEY,   -- absolute file path
  filename         TEXT NOT NULL,       -- just the file name
  title            TEXT DEFAULT '',     -- tag: title
  artist           TEXT DEFAULT '',     -- tag: artist
  album            TEXT DEFAULT '',     -- tag: album
  track_no         TEXT DEFAULT '',     -- tag: track number
  album_artist     TEXT DEFAULT '',     -- tag: album artist
  genre            TEXT DEFAULT '',     -- tag: genre
  disc_no          TEXT DEFAULT '',     -- tag: disc number
  year             TEXT DEFAULT '',     -- tag: year
  composer         TEXT DEFAULT '',     -- tag: composer
  conductor        TEXT DEFAULT '',     -- tag: conductor
  comment          TEXT DEFAULT '',     -- tag: comment
  rating           INTEGER DEFAULT 0,   -- tag: rating (0-255)
  duration         REAL DEFAULT 0,      -- duration in seconds
  playcount        INTEGER DEFAULT 0,   -- number of times played
  bpm              INTEGER DEFAULT 0,   -- tag: beats per minute
  tags_scanned_at  TEXT,                -- UTC ISO timestamp when tag reading was attempted
  tags_error       INTEGER DEFAULT 0    -- 1 if tag reading failed
);
```

Schema version tracked via `PRAGMA user_version`. If the DB file doesn't exist at
startup, it's created from scratch.

DB is saved to disk via `saveDb()` which calls `db.export()` → `fs.writeFileSync`. Saved after every
batch during tag reading, after storeFiles, after runIncrementalScan, after clearDatabase, and once at startup.

Cover art is NOT stored in the DB. It is read on-the-fly by `db:getCoverArt` — first from embedded
pictures via `music-metadata`, then falling back to the first filename matching
`^(folder|cover|front)\.(jpg|jpeg|png)$` next to the audio file (JPEG/PNG identified by magic bytes).

## Settings

Stored at `~/.config/musicpenguin/musicpenguin-settings.json`. JSON file with all user preferences:

```json
{
  "theme": "light" | "dark",
  "language": "en-us" | "de-de" | "fr-fr",
  "folders": [{ "caption": "Music", "path": "/home/..." }, ...],
  "volume": 0.8,
  "muted": false,
  "now-playing": { "path": "/path/to/file.mp3", "current-time": 42.5 },
  "sort-column": "artist",
  "sort-direction": "asc" | "desc",
  "column-widths": ["24px", "40px", "50px", "150px", "120px", "100px", "100px", "100px", "100px", "60px", "80px", "55px", "60px", "60px", "50px", "150px"],
  "groups-width": 260,
  "list-height": 300,
  "playlist-width": 256,
  "window-state": { "x": 0, "y": 0, "width": 800, "height": 600, "maximized": false, "display-id": "..." },
  "shuffle": false,
  "repeat": "off" | "one" | "all",
  "playlist": ["/path/to/song.mp3", ...],
  "search-query": "",
  "search-regex": false,
  "search-tag-columns": { "search-tag-title": true, ... },
  "search-urls": ["https://www.discogs.com/search?...&title=${title}&artist=${artist}", ...],
  "browser": "firefox",
  "selected-group-id": "grp-allfiles",
  "list-scroll-top": 0,
  "playlist-sort-column": "",
  "playlist-sort-direction": "asc",
  "hidden-columns": [],
  "db-path": "/custom/path/to/musicpenguin-library.sqlite"
}
```

## IPC — Main Process Handlers

| Channel                            | Direction | Purpose
|------------------------------------|-----------|--------
| `settings:load`                    | invoke    | Read musicpenguin-settings.json
| `settings:save`                    | invoke    | Write musicpenguin-settings.json
| `settings:saveSync`                | sync      | Write musicpenguin-settings.json synchronously
| `dialog:pickFolder`                | invoke    | Native directory picker, returns `{ path }` or `null` on cancel
| `dialog:showMessageBox`            | invoke    | Native message box, returns the index of the clicked button
| `fs:scanFolder`                    | invoke    | Recursive walk of a directory, returns `ScannedFileInfo[]`
| `fs:listSubdirs`                   | invoke    | List immediate subdirectories of a path (skips dotfiles)
| `fs:readFile`                      | invoke    | Read a file's full contents as `Uint8Array` if its size is ≤ 20 MB, else `null`
| `db:loadFiles`                     | invoke    | SELECT rows from `files` (tag + playback columns, omits `tags_scanned_at` and `tags_error`)
| `db:storeFiles`                    | invoke    | INSERT OR IGNORE file paths (in a transaction)
| `db:runIncrementalScan`            | invoke    | Stop tag reader, INSERT OR IGNORE files, re-scan tags, DELETE missing files, return `{ added, removed, total, errors }`
| `db:searchFiles`                   | invoke    | SELECT with LIKE or regex across specified columns
| `db:lookupPaths`                   | invoke    | SELECT rows matching given paths
| `db:startTagRead`                  | invoke    | Start/refill the tag reader queue (no-op if already running)
| `db:stopTagRead`                   | invoke    | Stop the tag reader and wait for it to finish
| `db:prioritizeFiles`               | invoke    | Prepend paths to the queue (only unscanned ones pass filter)
| `db:rescanFiles`                   | invoke    | Re-queue files for tag re-reading (clears tags_scanned_at, re-prioritizes)
| `db:getCoverArt`                   | invoke    | Read cover from embedded metadata or folder image → data URL
| `db:getProblematicFiles`           | invoke    | List files with `tags_error = 1`, write to `/tmp/musicpenguin_problematic_files.txt`, attempt to open in text editor (xdg-open → code → codium → desktop-specific fallback: kate on KDE, gedit on GNOME)
| `db:clearDatabase`                 | invoke    | Stop tag reader, DELETE all rows, save DB
| `db:deleteFiles`                   | invoke    | DELETE rows for given paths from the database
| `db:deleteFilesFromDisk`           | invoke    | DELETE rows for given paths and also remove the files from disk
| `db:setRating`                     | invoke    | SET rating for a given file path
| `db:moveFile`                      | invoke    | Rename file on disk and UPDATE path/filename in DB
| `db:incrementPlaycount`            | invoke    | Increment play count for a file, return new count
| `shell:showInExternalFileExplorer` | invoke    | Open system file manager and select the given file (xdg-open → dolphin → nautilus)
| `shell:openExternal`               | invoke    | Open URL in configured browser (default: firefox)
| `shell:openInVlc`                  | invoke    | Open file(s) in VLC
| `shell:isVlcAvailable`             | invoke    | Return whether VLC is installed
| `app:getVersion`                   | invoke    | Return app version string
| `app:getPlayableExtensions`        | invoke    | Return list of built-in playable file extensions
| `now-playing:save`                 | sync      | Save `now-playing`, `search-query`, `volume`, `muted` (called on beforeunload)
| `tags:updated`                     | push      | Sent after each file's tags are read (all tag fields + tags_error)
| `tags:scanning`                    | push      | Sent before each file is read `{ path, scanned, total }`, plus `{ path: null }` on completion

## Tag Reader (Background Queue)

The tag reader lives in `src/main-process/tag-reader.ts`. It maintains a `queue` array (max
`TAG_BATCH_SIZE` = 100 paths) and parses files concurrently using `NUM_TAG_READER_THREADS` (= 4)
workers per batch. The loop:

1. **Drain** — parse files concurrently via `parseFileTags()` (calls `music-metadata` with
   30s timeout, then falls back to `ffprobe` for duration if still 0), bind params, `UPDATE` row,
   `webContents.send("tags:updated", ...)`.
2. **Flush** — `saveDb()` + `VACUUM` after the queue is fully drained (in the `finally` block).
3. **Refill** — `refillQueue()` pulls up to 100 unscanned rows
   (`WHERE tags_scanned_at IS NULL ORDER BY path LIMIT ?`).
4. **Loop** — if refill found work, continue draining. If not, send `{ path: null }` completion
   signal (after a final `saveDb()`).

**Progress counting**: at the start of `processQueue()`, a single query
(`SELECT COUNT(*) FROM files`) captures the total number of files in the library, and another query
(`SELECT COUNT(*) FROM files WHERE tags_scanned_at IS NOT NULL`) captures how many are already
tagged. Each `tags:scanning` event increments `scanned` so it climbs from the already-tagged count
to `total` — the status bar displays `(n/total)`.

**Error handling**: `readSingleFile` wraps `parseFile` in try/catch — on failure, `tags_error`
is set to 1 and `tags_scanned_at` is still recorded with a timestamp, so the file is never
retried. Duration is always verified via `ffprobe` as a last resort before the row is written.
The outer `processQueue()` also wraps every call in try/catch so no single file crash stops
the queue.

**Priority**: The renderer sends visible file paths via `db:prioritizeFiles`. The main process first
filters out already-scanned files (checks `tags_scanned_at IS NULL` in DB), then prepends them to the
queue in order (selected track first, then visible rows in DOM order, deduped via Set).

**Stopping**: Both `db:clearDatabase` and `db:stopTagRead` set `stopped = true`, clear the
queue, and await a `donePromise` that resolves when the loop exits. The loop checks
`stopped` before each iteration and before calling `refillQueue()`, which also checks the flag.

**Startup**: `startTagRead()` is called once at app startup after settings and folders are initialized.
If the DB already has files from a previous session, only unscanned entries are queued. No filesystem
access occurs on startup.

**Scan triggers**: A full folder scan happens when:

* The user adds/removes a folder in the folders dialog and closes it (the `foldersChanged` flag
  triggers `runFullScan()`)
* The user clicks the Scan button in the groups panel (runs `db:runIncrementalScan` directly)

## Source Files

### `src/main-process/index.ts`

Main process entry point (bundled to `dist/main-bundle.js`). Creates BrowserWindow with
context-isolated preload, registers all `ipcMain.handle` handlers (settings, db, dialog,
cover art, shell), and manages window state persistence (position/size/maximized per display).

### `src/main-process/database.ts`

SQLite operations: `initDb()` creates/migrates the schema, `loadFiles()`, `storeFiles()`,
`lookupPaths()`, `searchFiles()` (LIKE or regex), `getProblematicFiles()`, `clearAllFiles()`,
`setRating()`, `moveFilePath()`, `deleteFiles()`, `incrementPlaycount()`.
`saveDb()` writes the WASM DB to disk.

### `src/main-process/tag-reader.ts`

Background tag queue (see Tag Reader section above). Functions: `initTagReader()`,
`startTagRead()`, `stopTagReader()`, `prioritizeFiles()`, `runIncrementalScan()`,
`rescanFiles()`.

### `src/main-process/cover-art.ts`

`getCoverArt(filePath)` — reads embedded picture via `music-metadata` (10s timeout,
`{ duration: false }`), or falls back to `folder.jpg`/`cover.jpg`/`front.jpg`/`front.png` (and `.jpeg` variants) next to the file.
Returns a data URL or null.

### `src/main-process/kde-theme.ts`

`detectInitialTheme(settingsPath)` — precedence: saved theme → KDE color scheme (parses
`kdeglobals` for `ColorScheme` name or `BackgroundNormal`/`ForegroundNormal` luminance) → dark.

### `src/main-process/types.ts`

Shared TypeScript types: `SqlJsDatabase`, `SqlJsStatement`, `SqlJsStatic`, `ScannedFileInfo`,
`TagUpdate`, `SearchOptions`, `SendToRenderer` callback type.

### `src/main-process/sqljs.d.ts`

Ambient declaration for `sql.js` (which ships no types): declares its default export as
`() => Promise<SqlJsStatic>`, enabling a plain top-level `import initSqlJs from "sql.js"`.

### `src/main-process/paths.ts`

`SETTINGS_DIR`, `SETTINGS_PATH`, `DEFAULT_DB_PATH` — resolves `~/.config/musicpenguin/...`.
`getDbPath()` — reads `db-path` from musicpenguin-settings.json, falls back to default.

### `src/main-process/utils.ts`

`walkDirectory()` — recursive file scan matching `MEDIA_FILE_EXTENSIONS`. `withTimeout()` —
Promise race with timeout. `ensureDir()`. `commandExists()` — checks `which`. `jsonStringify()`
— JSON.stringify with 2-space indent and Unicode unescaping.

### `src/config.ts`

Central constants: `TAG_BATCH_SIZE` (100), `NUM_TAG_READER_THREADS` (4), `MEDIA_FILE_EXTENSIONS`
(all scannable audio/video extensions), `PLAYABLE_FILE_EXTENSIONS` (built-in `<audio>` playback),
and `DEFAULT_SEARCH_URLS` (5 search URL templates: Discogs, Amazon, Google, MusicBrainz, DNB).

### `src/index.ts`

Renderer entry point (bundled to `dist/bundle.js`). Initializes all panels: groups, list,
detail, now-playing, split-panes, playlist, search, settings. Handles the Scan and Problematic
files buttons in the groups panel. Loads tracks from DB, restores
sort/column/splitter state from settings. Registers `tags:updated` handler (patches in-memory
track data and re-renders), `tags:scanning` handler (updates status bar). Integrates playlist
and main-list track advancement via `onTrackEnd` and theater mode nav callbacks.
Uses `requestAnimationFrame` to let the browser paint the shell before loading DB data.

### `src/types.ts`

* `TreeNode` — `id`, `label`, `children?`, `coverArt?`
* `ListItem` — flattened display row (`id`, `path`, `filename`, `title`, `artist`, `album`, `trackNo`, `albumArtist`, `genre`, `year`, `ext`, `discNo`, `rawTrackNo`, `trackPath`, `composer`, `conductor`, `comment`, `rating`, `bpm`, `duration`, `playcount`)
* `PlaylistEntry` — `path`, `title`, `artist`, `duration`, `album`, `trackNo`, `albumArtist`, `genre`, `year`, `composer`, `conductor`, `comment`, `rating`, `bpm`, `playcount`, `filename`, `ext`, `trackPath`, `id`

### `src/electron-types.d.ts`

Declares `Track`, `ScannedFileInfo`, `TagUpdate`, `ElectronAPI` interface (all IPC methods
exposed via preload), and `Window` augmentation.

### `src/groups-view.ts`

Renders a flat `<ul>` from `TreeNode[]`. Click selects a node; double-click opens it.
Supports cover art thumbnails, drag-to-playlist, and context menu (Show in Folder for folders).
Flat despite `TreeNode.children` existing in the type.

### `src/list-view.ts`

CSS Grid table with resizable columns (drag handles update CSS variables → saved to settings).
Multi-selection (Ctrl/Shift/Arrow keys), drag-to-playlist, context menu (Show in Folder, Play in
VLC, Copy Path, Rescan Tags, Goto Album, Goto Folder, Sort by column). Click → `onSelect` +
priority paths. Double-click → `onDblClick` play.
`formatTime()` converts seconds string to `MM:SS`/`HH:MM:SS`.

**Column resize mechanism**: Each column's width is stored as a pixel CSS custom property
(e.g. `--col-album: 300px`) on `#list-table`. The `grid-template-columns` uses
`var(--col-album, 110px)` with pixel fallbacks (never `fr` or `%`). The grid rows are
`width: max-content` so they're as wide as the sum of all column tracks regardless of the
container width. `thead` and `tbody` set `align-self: flex-start; min-width: 100%` so they
don't stretch to the container — when grid rows overflow the container, the flex items
grow beyond `#list-table`'s `overflow-x: auto` triggers a horizontal scrollbar. Persisted
to `musicpenguin-settings.json` as `"400px"` strings. Hidden columns get `--col-NAME: 0px` (set by `setColumnVisibility` and context menu)
so they don't occupy space. `saveColumnWidths()` saves `""` for hidden columns and is only
called on mouseup (never on mousemove).

### `src/detail-panel.ts`

Display form: path (editable — renames/moves file on disk via `db:moveFile`), title, artist, album,
album artist, track/disc/year/genre/composer/conductor/rating/comment. Cover art loaded lazily
via `getCoverArt()`. Double-click cover → theater mode.

### `src/now-playing.ts`

Manages `<audio>` element. Two-row bar: track info + controls (play/pause, seek bar, time,
duration, volume). Saves `now-playing`/`volume`/`muted` to settings on `beforeunload`.
Restores position on startup. Double-click track info → theater mode.

### `src/theatermode.ts`

Fullscreen cover art overlay with playback controls, progress bar, prev/next buttons, cursor
auto-hide, and crossfade transition. Triggered by double-clicking cover art or now-playing
info. Integrates with both playlist and main-list navigation via callbacks.

### `src/file-probe.ts`

`probeFileForErrors(bytes)` — inspects an in-memory file for known structural
defects and returns the found errors as an array of `FILE_PROBE_ERROR` enum
constants (currently just `FILE_PROBE_ERROR.WAV_WRAPPED_MP3`, matching the
detection in `fix_wav_mp3.py`). The read size limit (`MAX_PROBE_FILE_SIZE`)
lives in `src/config.ts`.

### `src/playback-error.ts`

`handleAudioPlaybackError(filePath)` — probes a failed playback (see
`src/file-probe.ts`) and shows an explanatory dialog with an optional "Try to
play in VLC instead" action. Guarded so the `<audio>` "error" event and a
rejected `play()` promise for the same file yield only one dialog.
`onPlaybackFailure(filePath, err)` is the shared `play()` rejection callback
(ignores `AbortError`/`NotAllowedError`); every play entry point — now-playing,
theater mode, playlist — funnels through it, while the "error" event listener in
`src/now-playing.ts` covers the decode-failure path for all of them.

### `src/audio.ts`

Exports the shared `HTMLAudioElement` instance and a `formatTime(number)` helper for the
now-playing bar and theater mode.

### `src/settings.ts`

Overlay dialog with a dark mode toggle and close button. The folders dialog is opened
independently by the Folders button in the groups panel (handled by `src/folders-dialog.ts`).

### `src/folders-dialog.ts`

Separate overlay for managing scanned folders: add/remove folders, expand/collapse subdirectories,
toggle per-folder checkboxes, and delete selected folders. Opened by the Folders button in the
groups panel. On close, triggers `runFullScan()` if any folder configuration changed.

### `src/scanner.ts`

`scanFolders(folders, onProgress?)` — iterates folders, calls `electronAPI.scanFolder()` for
each. Returns `{ files, errors }`. Each folder independently try/caught.

### `src/split-pane.ts`

Draggable dividers for groups width, list height, playlist width. Cross-handle knobs adjust
both axes. State persisted to settings.

### `src/playlist-panel.ts`

Playlist with drag-drop reorder, shuffle (random next), repeat (off/one/all), randomize
(Fisher-Yates), clear, multi-select, keyboard delete, auto-advance via `onTrackEnd`.
Entries rebuilt from DB paths on load. Lazy cover art loading.

### `src/search-panel.ts`

Library-wide search (regex mode, column checkboxes for path/title/artist/album/album artist/
year/genre/composer/conductor/comment). Persists query, regex mode, and tag column state
to settings.

## Key Behaviors

* **Startup**: No folder scanning. `requestAnimationFrame` lets the browser paint the shell before
  loading DB data. Reads SQLite, checks for unscanned entries, starts tag reader only if needed.
  Sort state, column widths, and splitter state are restored from settings before first render.
  Loads persisted now-playing track and restores playback position.
* **Double-click to play**: Double-clicking any row in the list view immediately sets it as the
  current track and starts playback via `playTrack()`.
* **Theater mode**: Double-click cover art in the detail panel or the track info in the now-playing
  bar opens a fullscreen overlay with cover art, playback controls, and prev/next navigation.
* **Scan**: Full scan happens via `db:runIncrementalScan` when the Scan button in the groups panel
  is clicked, or when the folders dialog closes with changes. Each folder is independently try/caught
  and `runIncrementalScan` also removes DB entries for files that no longer exist on disk.
* **Cover art**: Read on-the-fly via `db:getCoverArt` — tries embedded picture first (via
  `music-metadata`), then searches the file's directory for the first filename matching
  `^(folder|cover|front)\.(jpg|jpeg|png)$`. JPEG/PNG are identified by magic bytes. Never
  stored in DB. Returns a data URL.
* **Tag reading is idempotent**: Once `tags_scanned_at` is set (even on error), the file is never
  re-read. The priority queue filters against `tags_scanned_at IS NULL` before adding work.
* **Audio uses `file://` protocol**: Works in Electron because Node.js integration is off but
  `file://` is allowed by default.
* **Empty fields**: Missing artist/album/etc. show as empty string `""`, never as a placeholder
  character like `"—"`.
* **Problematic files**: Exported to `/tmp/musicpenguin_problematic_files.txt` and auto-opened in
  the system's default text editor (via `xdg-open`). Falls back to `code`/`codium`, then
  desktop-specific editors (`kate` on KDE, `gedit` on GNOME).

## TypeScript Strictness

`tsconfig.json` enforces `strict: true`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`.

## Theme Detection

On startup, the initial theme is detected with this precedence:

1. Saved `theme` in musicpenguin-settings.json
2. KDE color scheme detection (parses `~/.config/kdeglobals` and `kdedefaults/kdeglobals` for
   `ColorScheme` name or `BackgroundNormal`/`ForegroundNormal` colors using relative luminance)
3. Default: dark

The chosen theme is passed as `?theme=` query parameter when loading `index.html`, where an inline
script applies `data-theme` before the page renders to avoid flash.

## Language (i18n)

All user-visible strings go through `t()` in `src/i18n/index.ts`. Lookup keys are the English
source strings themselves; `en-us` needs no dictionary, other languages provide a translation map
under `src/i18n/` (`de-de`, `fr-fr`). Dynamic text uses `$1`, `$2`, ... placeholders, e.g.
`t("Loaded $1 $2 from library.", 5, "files")`.

On startup the language is resolved with this precedence:

1. Saved `language` in musicpenguin-settings.json
2. OS locale (`app.getLocale()` — `de` → `de-de`, `fr` → `fr-fr`, otherwise `en-us`)
3. Default: `en-us`

The chosen language is passed as `?lang=` query parameter when loading `index.html`, so the page
renders in the right language without a flash. Changing the language in **Settings** applies
instantly (static text via `data-i18n`/`data-i18n-title`/`data-i18n-placeholder` attributes,
dynamic labels re-render on a `language-changed` event) and is persisted.
