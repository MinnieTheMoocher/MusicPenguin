# MusicPenguin Implementation

<img src="doc/musicpenguin256.png" width=150 alt="MusicPenguin icon">

## Build & Run

```bash
npm ci                  # install dependencies
npm run build           # typecheck, then builds both bundles (main + renderer)
npm run typecheck       # tsc --noEmit — strict type-check only (no output emitted)
npm run build:main      # esbuild bundles src/main/ → dist/main-bundle.js (CJS)
npm run build:renderer  # esbuild bundles src/ → dist/bundle.js (ESM); loads *.svg as raw text (`--loader:.svg=text`)
npm run start           # build + launch Electron window
npm run electron        # launch without re-building
npm run watch           # typecheck once, then rebuild renderer bundle on file changes (same svg loader as build:renderer)
```

## Files

| File                                 | Purpose
|--------------------------------------|----------------------------------------------
| main.js                              | Electron entry (CommonJS shim)
| dist/main-bundle.js                  | Bundled main process (src/main)
| src/preload/preload.js               | contextBridge → window.electronAPI (plain CommonJS, never transpiled)
| src/main/                            | Main-process TypeScript source files
| src/common/                          | Shared code used by both processes: `config.ts`, `i18n/`, `electron-types.d.ts`
| src/common/i18n/                     | Localization module (`ITranslate` contract, `en-us`/`de-de`/`fr-fr`/`es-es` dictionaries, `t()` lookup)
| src/renderer/index.html              | HTML layout, containing no styling at all, just logical structure
| src/renderer/musicpenguin_base.css   | base stylesheet; every design loads on top of it
| src/renderer/designs/<id>            | custom designs layered on top of musicpenguin_base.css
| src/renderer/icons/                  | icon set of this app, currently tabler-icons
| ~/.config/musicpenguin/designs/<id>/ | custom designs provided by the user, discovered at runtime
| package/custom_designs/              | example custom designs, copied to `~/.config/musicpenguin/designs/` upon app installation

**Key point**: `main.js` and `src/preload/preload.js` are plain CommonJS, never transpiled. `src/` and
`src/main/` + `src/renderer/` files are TypeScript bundled by esbuild (types stripped). TypeScript
syntax (`as`, generics, etc.) must never appear in main.js or src/preload/preload.js.

**Versions are not documented here**: the single source of truth for dependency versions (Electron,
npm packages, TypeScript toolchain) is `package.json` / the lockfile.

**TypeScript config is split per process** in two top-level files:
`tsconfig.main.json` (includes `src/main` + shared `src/common/electron-types.d.ts`) and
`tsconfig.renderer.json` (includes `src` except `src/main`, i.e. `src/renderer` + `src/common`).
Each is a self-contained project with its own `target`, so the main process and renderer can be
downgraded independently. `npm run typecheck` runs `tsc --noEmit` for each. All emitted JS is
produced by esbuild, not `tsc`.

**No inline `require()` in TypeScript**: all module loading in `src/` (renderer and main process)
must go through top-level `import` statements — never inline `require()` calls. Only `main.js`
and `src/preload/preload.js` (plain CommonJS) may use `require`. Packages that ship
no type declarations get an ambient `declare module` shim: `sql.js` in `src/main/sqljs.d.ts`
and `dbus-native` in `src/main/dbus-native.d.ts`. Type casts must be typed assertions to
concrete types (e.g. `as Buffer`); `as any` is forbidden because it bypasses the strict type
check.

## App Files Used at Runtime

| File                                               | Purpose
|----------------------------------------------------|--------
| ~/.config/musicpenguin/musicpenguin-settings.json  | persisted user preferences
| ~/.config/musicpenguin/musicpenguin-library.sqlite | SQLite database storing the known tags of all known files
| ~/.config/musicpenguin/designs                     | custom user-edited designs
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
via an external player (configurable in settings, default `vlc`, available through the
context menu and as playback fallback).

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

The main playback ("Now Playing") bar can sit at the top (default) or at the bottom,
directly above the status bar — configured via the **Place main playback bar** setting
in the settings dialog (`playback-bar-position` in musicpenguin-settings.json).

### Variant 1: playback bar at the TOP (default)

```text
┌───────────────────────────────────────────────────────────┐
│  Now Playing                                              │
│                                                           │
├────────┬────────────────────────┬─────────────────────────┤
│ Groups │  List View (table)     │  Search                 │
│ Panel  │                        ├─────────────────────────┤
│        ├────────────────────────┤  Playlist               │
│        │  Details Panel         │                         │
│        │                        │                         │
├────────┴────────────────────────┴─────────────────────────┤
│  Status Bar                                               │
└───────────────────────────────────────────────────────────┘
```

### Variant 2: playback bar at the BOTTOM

```text
┌────────┬────────────────────────┬─────────────────────────┐
│ Groups │  List View (table)     │  Search                 │
│ Panel  │                        ├─────────────────────────┤
│        ├────────────────────────┤  Playlist               │
│        │  Details Panel         │                         │
│        │                        │                         │
├────────┴────────────────────────┴─────────────────────────┤
│  Now Playing                                              │
├───────────────────────────────────────────────────────────┤
│  Status Bar                                               │
└───────────────────────────────────────────────────────────┘
```

Draggable splitters between all three vertical columns, a horizontal splitter between list and detail,
and invisible (handle-only, no visible knob) cross-handle drag areas at both intersections
(left: groups×list, right: playlist×list).

The bottom of the groups panel has four icon buttons:
**Folders** (opens the folder manager), **Scan** (re-scans all folders), **Problematic** (lists
files with tag errors), and **Settings** (dark mode toggle). The Problematic button is always
visible to keep the toolbar layout stable, but remains disabled when the library has no tag
errors; it is enabled after a scan finds at least one problematic file.

The logo and bottom button row are fixed in place: the group list lives in `#groups-container`,
which is `flex: 1` with `min-height: 0` and `overflow-y: auto`, so when the groups outgrow the
panel they scroll internally instead of pushing the logo/buttons down. The panel's right padding
is removed so the container's vertical scrollbar sits flush at the panel's right edge; the right
spacing is applied as internal `padding-right` on the container, logo, and button row. An
`<hr class="panel-divider">` element separates the fixed bottom section from the scrolling group
list — the same class used between the search and playlist sections on the right panel.

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
  duration         REAL,                -- duration in seconds; NULL = unknown
  playcount        INTEGER DEFAULT 0,   -- number of times played
  bpm              INTEGER DEFAULT 0,   -- tag: beats per minute
  dlna             INTEGER DEFAULT 0,   -- 1 if track comes from a DLNA server
  tags_scanned_at  TEXT,                -- UTC ISO timestamp when tag reading was attempted
  tags_error       INTEGER DEFAULT 0    -- 1 if tag reading failed
);
```

Schema version tracked via `PRAGMA user_version` (`DB_VERSION` in database.ts).

DB is saved to disk via `saveDb()` which calls `db.export()` → `fs.writeFileSync`. Saved after every
batch during tag reading, after storeFiles, after runIncrementalScan, after clearDatabase, and once at startup.

Cover art is NOT stored in the DB. It is read on-the-fly by `db:getCoverArt` — first from embedded
pictures via `music-metadata`, then a track-named image (e.g. `song.mp3` → `song.jpg`), then falling
back to the first folder-front filename matching `^(folder|cover|front)\.(jpg|jpeg|png|webp|gif)$`
next to the audio file (extension list from `COVER_IMAGE_EXTENSIONS`; image type identified by
magic bytes).
DLNA rows are the exception: their `track_art_url` column holds every `upnp:albumArtURI`
the item announced (newline-separated; servers list thumbnail/full-size variants
unlabelled). On demand all candidates are fetched over HTTP in parallel and the largest
image wins — chosen by decoded pixel dimensions (JPEG/PNG/GIF header parse), byte length
as tiebreaker. The winning URI is written back to the column, replacing all others, so
every later lookup needs only a single request. Relative URIs are resolved against the
stream URL; magic bytes win over declared content types when converting to a data URL.

`getCoverArt(filePath, maxSize?)` accepts an optional `maxSize` parameter (pixels). When
provided, the main process uses Electron's `nativeImage` to resize the image before
returning a data URL — useful for small UI elements (playlist rows, group thumbnails)
where the full-resolution image is wasteful. `getCoverArtGroups()` always returns full
resolution (used by theater mode).

## Thumbnail Cache

`src/thumbnail-cache.ts` is an application-wide singleton (`Map<string, string>`) that
caches cover art data URLs keyed by file path. Both the playlist and groups panel share
this cache via `fetchThumbnail(filePath)`, which calls `getCoverArt` with `maxSize: 32`
on a cache miss and stores the result. `getThumbnail(filePath)` provides synchronous
cache lookup. The 32×32 px thumbnails are ~1–2 KB data URLs vs ~300 KB for the originals.
`TreeNode.thumbnail` and `PlaylistEntry` use this cache instead of fetching cover art
independently — the same file appearing in both playlist and groups triggers only one
IPC round-trip.

## Settings

Stored at `~/.config/musicpenguin/musicpenguin-settings.json`. JSON file with all user preferences.

**Naming policy (mandatory)**: every settings key — at every nesting level — MUST be
`lowercase-with-dashes` (kebab-case). CamelCase (`dbPath`) and under_score (`db_path`)
are FORBIDDEN. This applies to top-level keys as well as fields inside nested objects
(`now-playing`, `window-state`, entries of the `folders` / `dlna-servers` arrays, the
ids inside `search-tag-columns`, ...). Existing keys all follow this rule; do not
introduce new ones that violate it.

**Write serialization (mandatory)**: all settings writes in the main process — the
`settings:save` / `settings:saveSync` IPC handlers, `now-playing:save`, `saveWindowState`,
`setPlaylistFolder`, `setPlaylistFile`, the background DLNA persistence, and the
`db:moveFile` now-playing rewrite — go through a single promise-based mutex
(`runWithSettingsLock`) that wraps a fresh read-modify-write (`readSettingsFile` +
`mutateSettings`). This guarantees no two readers-then-writers can interleave and
clobber each other's keys (this previously lost left-panel `group-items` when a
concurrent `saveUIState` wrote back a stale full object).

**Partial-write convention (mandatory)**: renderer save helpers must pass ONLY the keys
they own to `saveSettings` — never a spread of a previously `loadSettings()`-ed object
(`...(data || {})`). The main process merges the partial into a fresh read under the
lock, so a stale read can never overwrite another component's keys (e.g.
`group-items`). To remove a key, send it with value `undefined` (JSON drops it on
write).

```json
{
  "design": "folder name of a discovered design (built-in or custom)",
  "language": "en-us" | "de-de" | "fr-fr" | "es-es",
  "folders": [{ "caption": "Music", "path": "/home/Music/..." }, ...],
  "dlna-servers": [{ "name": "My NAS", "control-url": "http://nas:8200/ctl/CDS", "description-url": "http://nas:8200/desc/device.xml", "icon-url": "data:image/png;base64,...", "enabled": true }, ...],
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
  "playlist-folder": "/home/user/Music",
  "playlist-file": "/home/user/Music/playlist.m3u",
  "search-query": "",
  "search-regex": false,
  "search-tag-columns": { "search-tag-title": true, ... },
  "search-urls": ["https://www.discogs.com/search?...&title=${title}&artist=${artist}", ...],
  "external-player": "vlc",
  "min-autoplay-rating": null | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5,
  "sort-manual": false,
  "playback-bar-position": "top" | "bottom",
  "selected-group-id": "grp-allfiles",
  "group-items": [{ "kind": "album", "value": "..." }, ...],
  "list-scroll-top": 0,
  "playlist-sort-column": "",
  "playlist-sort-direction": "asc",
  "hidden-columns": [],
  "db-path": "/custom/path/to/musicpenguin-library.sqlite",
  "debug-log": false
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
| `designs:list`                     | invoke    | Runtime design discovery — list of built-in and custom design folders
| `window:setNowPlayingHeight`       | send      | Set the now-playing bar height (clamped, enforces window minimum size)
| `fs:scanFolder`                    | invoke    | Recursive walk of a directory, returns `ScannedFileInfo[]`
| `fs:listSubdirs`                   | invoke    | List immediate subdirectories of a path (skips dotfiles)
| `fs:readFile`                      | invoke    | Read a file's full contents as `Uint8Array` if its size is ≤ 20 MB, else `null`
| `playlist:save`                    | invoke    | Save-as dialog → write current playlist paths as `.m3u8`; returns `{ canceled, path }`, remembers folder/file
| `playlist:load`                    | invoke    | Open dialog → read a `.m3u8`; returns `{ canceled, paths, filePath }`, remembers folder/file
| `playlist:saveStateFile`           | invoke    | Persist the current playlist to `~/.config/musicpenguin/musicpenguin-playlist.m3u8` (best-effort)
| `playlist:loadStateFile`           | invoke    | Read the persisted playlist state file, returns paths (empty when absent/corrupt)
| `db:loadFiles`                     | invoke    | SELECT rows from `files` (tag + playback columns, omits `tags_scanned_at` and `tags_error`)
| `db:storeFiles`                    | invoke    | INSERT OR IGNORE file paths (in a transaction)
| `db:runIncrementalScan`            | invoke    | Stop tag reader, INSERT OR IGNORE files, re-scan tags, DELETE missing files, return `{ added, removed, total, errors }`. `removed` is computed as `countBefore - countAfter` (accurate for all deletions). Optional `allowedPaths` parameter prunes non-DLNA entries whose paths don't reside under any of the given prefixes.
| `dlna:discover`                    | invoke    | SSDP M-SEARCH over UDP multicast (239.255.255.250:1900, several targeted probes); fetches each respondent's device description, resolves the ContentDirectory control URL and the best icon (as data URL); returns `{ name, location, controlUrl, icon }[]` — media renderers and devices without a ContentDirectory are filtered out
| `dlna:scan`                        | invoke    | Takes a list of DLNA servers (`{ name, control-url, description-url }`, from the folders dialog selection) instead of a single URL; enumerates every server (recursive ContentDirectory Browse), merges the tracks into the DB (`path`/`filename` = stream URL, `dlna` = 1, metadata from DIDL-Lite), DELETEs stale rows; empty list clears all DLNA rows; returns `{ added, removed, total, errors }`. Invoked by `runFullScan()` in `src/scanner.ts` after filesystem scans completed.
| `dlna:progress`                    | push      | Sent during DLNA enumeration `{ found, name, added }` — audio items discovered so far plus the server being read; `added` carries row snapshots of the latest batch so the renderer can grow the main list live; an immediate `{ found: 0, name }` event fires when each server starts
| `db:searchFiles`                   | invoke    | SELECT with LIKE or regex across specified columns
| `db:lookupPaths`                   | invoke    | SELECT rows matching given paths
| `db:startTagRead`                  | invoke    | Start/refill the tag reader queue (no-op if already running)
| `db:stopTagRead`                   | invoke    | Stop the tag reader and wait for it to finish
| `db:prioritizeFiles`               | invoke    | Prepend paths to the queue (only unscanned ones pass filter)
| `db:rescanFiles`                   | invoke    | Re-queue files for tag re-reading (clears tags_scanned_at, re-prioritizes); http(s) stream URLs are ignored; `onlyIfModified` restricts the re-read to files whose mtime moved past their last scan
| `db:scanSpecificFiles`             | invoke    | Tag-read only the given file list (e.g. right-click "Rescan Tags"); runs the ffprobe duration fixup pass afterwards
| `db:getCoverArt`                   | invoke    | Local files: read cover from embedded metadata or folder image → data URL. Optional `maxSize` param resizes via `nativeImage` before returning. DLNA rows (http(s) path): GET the stored `track_art_url` from the server → data URL
| `db:getCoverArtGroups`             | invoke    | Track's cover art in 3 disjunct groups (front / rearCovers / extraImages) → data URLs; DLNA rows return the fetched art as `front` only
| `db:getProblematicFiles`           | invoke    | List files with `tags_error = 1`, write to the OS temporary directory as `musicpenguin_problematic_files.txt`, then open it with Electron `shell.openPath()` in the system's default application
| `db:getProblematicFileCount`       | invoke    | Return the count of files with `tags_error = 1`
| `db:clearDatabase`                 | invoke    | Stop tag reader, DELETE all rows, save DB, then emit `library:changed` so the renderer reloads the empty library
| `db:deleteFiles`                   | invoke    | DELETE rows for given paths from the database
| `db:deleteFilesFromDisk`           | invoke    | DELETE rows for given paths and also remove the files from disk
| `db:setRating`                     | invoke    | SET rating for a given file path
| `db:fillDuration`                  | invoke    | Layer-3 duration gap filler: persist a duration learned at play time from the `<audio>` element; only fills `duration IS NULL` gaps, resolves whether the DB changed
| `db:moveFile`                      | invoke    | Rename file on disk and UPDATE path/filename in DB
| `db:incrementPlaycount`            | invoke    | Increment play count for a file, return new count
| `shell:showInExternalFileExplorer` | invoke    | Show a file in the platform's default file manager via Electron `shell.showItemInFolder()` (select when supported), or open a folder via `shell.openPath()`; avoids desktop-specific `xdg-open`/Dolphin/Nautilus detection
| `shell:openWithDefaultApplication` | invoke    | Open local file(s) with the operating system's associated application via Electron `shell.openPath()`; returns the successfully opened paths and increments their play counts
| `shell:openExternal`               | invoke    | Open URL in the operating system's default browser via Electron `shell.openExternal()`
| `shell:openInExternalPlayer`       | invoke    | Open file(s) in the configured external player (default `vlc`); supports executable commands/paths and macOS `.app` bundles, counts one play per file, returns `{ ok, error? }`
| `shell:isExternalPlayerAvailable`  | invoke    | Return whether the configured external player is available as an executable or, on macOS, an installed application
| `shell:checkCommand`               | invoke    | Return whether a command name/path is executable (`command -v`)
| `app:getVersion`                   | invoke    | Return app version string
| `app:getPlayableExtensions`        | invoke    | Return list of built-in playable file extensions
| `now-playing:save`                 | sync      | Save `now-playing`, `search-query`, `volume`, `muted` (called on beforeunload). Shuffle/repeat are saved separately via `settings:save` on toggle.
| `tags:updated`                     | push      | No longer sent during scanning. Single `library:changed` refreshes UI after scan completes
| `tags:scanning`                    | push      | Sent before each file is read `{ path, scanned, total }`, plus `{ path: null }` on completion
| `media-key`                        | push      | Sent from main process to renderer when a media key is pressed (MPRIS, globalShortcut, or before-input-event). Payload: `"play-pause"`, `"play"`, `"pause"`, `"stop"`, `"next"`, or `"previous"`
| `library:durations-fixed`          | push      | Sent after the ffprobe duration fixup pass learned durations for rows stored with NULL (`{ rows }` carries full track snapshots); renderer merges them into its models
| `mpris:updateState`                | send      | Sent from renderer to main process to update MPRIS properties (PlaybackStatus, Metadata, Position, Volume, CanGoNext, CanGoPrevious)
| `debug:log`                        | invoke    | Append a line to `~/.config/musicpenguin.log`

## Tag Reader (Background Queue)

The tag reader lives in `src/main/tag-reader.ts`. It maintains a `queue` array (max
`TAG_BATCH_SIZE` = 20 paths) and parses files concurrently using `NUM_TAG_READER_THREADS` (= 4)
workers per batch. The loop:

1. **Drain** — parse files concurrently via `parseFileTags()` (calls `music-metadata` with
   30s timeout, then falls back to `ffprobe` for duration if still 0), bind params, `UPDATE` row.
   No per-file UI updates are pushed during scanning.
2. **Flush** — checkpoint `saveDb()` only every `TAG_SAVE_INTERVAL` (= 1000) written tags, since
   `db.export()` serializes the whole database and blocks the main process (stalling all IPC,
   including freshly imported files). After the queue drains, the final save + `VACUUM` (only
   after substantial work) are deferred via `setImmediate` so queued IPC is served first.
3. **Refill** — `refillQueue()` pulls up to 20 unscanned rows
   (`WHERE tags_scanned_at IS NULL ORDER BY path LIMIT ?`).
4. **Loop** — if refill found work, continue draining. If not, send `{ path: null }` completion
   signal (after a final `saveDb()`).

**Progress counting**: at the start of `processQueue()`, a single query
(`SELECT COUNT(*) FROM files WHERE tags_scanned_at IS NULL`) captures how many files need
tag scanning in this run. A local `scannedInRun` counter starts at 0 and increments per file.
The status bar displays `(scannedInRun/totalToScan)` — purely progress of the current scan,
unrelated to the DB's total row count.

**Error handling**: `readSingleFile` wraps `parseFile` in try/catch — on failure, `tags_error`
is set to 1 and `tags_scanned_at` is still recorded with a timestamp, so the file is never
retried. Duration is always verified via `ffprobe` as a last resort before the row is written.
The outer `processQueue()` also wraps every call in try/catch so no single file crash stops
the queue.

**Priority**: The renderer sends visible file paths via `db:prioritizeFiles`. The main process first
filters out already-scanned files (checks `tags_scanned_at IS NULL` in DB), then prepends them to the
queue in order (selected track first, then visible rows in DOM order, deduped via Set).
Playlist imports (`db:scanSpecificFiles`) use the same mechanism: after inserting the
rows, the unscanned paths are prepended to the queue, so a fresh import is always tag-read before
anything else queued — including files from an earlier import that are still waiting (most recent import
wins). Imports do not run a private parser pool; they share the background loop.

**Stopping**: Both `db:clearDatabase` and `db:stopTagRead` set `stopped = true`, clear the
queue, and await a `donePromise` that resolves when the loop exits. The loop checks
`stopped` before each iteration and before calling `refillQueue()`, which also checks the flag.

**Startup**: `startTagRead()` is NOT called at app startup. Tag reading only begins when the user
explicitly clicks the Scan button or closes the folders dialog after making changes. The DB is
read at startup to populate the track list, but no tag processing occurs.

**Scan triggers**: A full folder scan happens when:

* The user adds/removes a folder in the folders dialog and closes it (the `foldersChanged` flag
  triggers `runFullScan()`)
* The user clicks the Scan button in the groups panel (also runs `runFullScan()`)

Both call the centralised `runFullScan()` in `src/scanner.ts` which: (a) prunes DB entries from
disabled/removed folders via `allowedPaths`, (b) discovers new files in enabled folders, and
(c) re-reads tags for files whose timestamps changed. Scanning always runs even when no
folders or DLNA servers are enabled — this ensures DB pruning still sweeps stale entries
from previously removed folders/servers.

## Source Files

### `src/main/index.ts`

Main process entry point (bundled to `dist/main-bundle.js`). Creates BrowserWindow with
context-isolated preload, registers all `ipcMain.handle` handlers (settings, db, dialog,
cover art, shell), and manages window state persistence (position/size/maximized per display).
The window's minimum size is bound to the now-playing bar: the renderer reports the bar's
measured height on startup and after every design switch (`window:setNowPlayingHeight`, via
`ipcMain.on`), and the main process enforces it on the BrowserWindow (the OS root window).
Because some Linux compositors ignore WM min-size hints and suppress resize events during
interactive drags, enforcement is three-fold and applied directly to the root window:
`setMinimumSize` (WM hint), a `setSize` clamp on every `resize`/`restore`/`unmaximize`, and a
30 ms background poll (the "enforcement burst") that snaps the window bounds back up the moment
they fall below `barHeight + frame` (frame = outer bounds − content bounds) and stops as soon as
the window is back at/above the limit. A modest minimum width (240px)
acts as an absolute floor too. The poll timer is `unref()`'d (it never keeps the process alive)
and is explicitly cleared on quit (`stopEnforcementBurst()` in `before-quit`), so the resize
watchdog can never hold up app shutdown — e.g. when the user closes the window via the top-right
X button.

### `src/main/database.ts`

SQLite operations: `initDb()` creates/migrates the schema, `loadFiles()`, `storeFiles()`,
`lookupPaths()`, `searchFiles()` (LIKE or regex), `getProblematicFiles()`, `clearAllFiles()`,
`setRating()`, `moveFilePath()`, `deleteFiles()`, `incrementPlaycount()`.
`saveDb()` writes the WASM DB to disk.

### `src/main/tag-reader.ts`

Background tag queue (see Tag Reader section above). Functions: `initTagReader()`,
`startTagRead()`, `stopTagReader()`, `prioritizeFiles()`, `runIncrementalScan()`,
`rescanFiles()`. `runIncrementalScan()` accepts an optional `allowedPaths` parameter:
when provided, it prunes non-DLNA DB entries whose paths don't reside under any
of the given path prefixes. DLNA rows (`dlna = 1`) are excluded from its filesystem sweep —
they are remote stream URLs with no local file to stat. The `removed` count in the result
is computed as `countBefore - countAfter` (total rows before and after the sweep), so it
accurately reflects all deletions — both allowedPaths pruning and missing-file cleanup.

### `src/main/dlna.ts`

DLNA / UPnP AV ContentDirectory scanner. `scanDlnaLibrary(db, servers, onProgress)`
takes a LIST of servers (`{ name, control-url, description-url }`, from the folders-dialog selection) and
enumerates them one after another: each `control-url` is resolved to the ContentDirectory
control URL (accepts the control URL directly or a device-description URL;
well-known description paths of common servers are probed as fallback; if the
description can't be fetched but `description-url` is known, the description URL is
re-derived and probed once more), then recursively Browse-enumerates every
container starting at object id `"0"` via SOAP over HTTP (`fast-xml-parser` parses
both the SOAP envelope and the escaped DIDL-Lite result fragments). Items whose
`upnp:class` starts with `object.item.audioItem` become tracks: metadata (title,
artist(s), album, album artist, track/disc number, genre, year, composer, conductor)
is extracted from DIDL-Lite, duration from `res@duration`, and the `res` stream URL
becomes both `path` and `filename` in the DB with `dlna = 1`. The DIDL-Lite schema has
no composer/conductor elements and no BPM property: composers/conductors arrive as
`upnp:artist|upnp:author role="Composer|Conductor"` (album artists as `role="AlbumArtist"`,
unlabelled entries are the performing artists resp. song authors) — roles are split accordingly,
with non-standard `<upnp:composer>`/`<upnp:conductor>` elements kept as fallbacks. Many
servers (e.g. ReadyDLNA) put the file's composer tag into an UNLABELLED `upnp:author`,
which therefore feeds the composer column; conductors are only announced by role-aware
servers. BPM therefore stays 0 for DLNA rows; it would require reading tags off the stream.
With "debug-log" enabled, the first raw DIDL page of each scan is dumped to
musicpenguin.log so tag-to-DIDL mappings can be verified against server output.
All of the item's
`upnp:albumArtURI` values are stored newline-separated in the `track_art_url`
column for on-demand cover fetching. Because remote
enumeration is slow, tracks are stored page by page as they are discovered
(`storeDlnaTracks` per Browse page, database file flushed to disk at most every
2 s) and each batch is pushed to the renderer via `dlna:progress { found, added }`
so the main list grows live. Tracks from all servers are merged (keyed by stream
URL — duplicates across servers are stored once), then synced: rows no longer
offered by ANY enabled server are removed, rating/playcount of surviving rows
persist. A server that fails mid-enumeration keeps its already-found tracks.
Per-server failures are collected into `errors`
(`name: message`) and returned alongside `{ added, removed, total }` so the UI can
report which server failed while keeping the others' results. All HTTP requests
retry transient transport errors (some servers — e.g. Synology DSM — reset rapid
back-to-back connections), and each server's enumeration emits an immediate
`found = 0` progress event so the status bar shows activity right away.
Progress events never outlive their scan: the renderer drops any event arriving
after `scanDlnaSource()` settled (sequence + active guard in `scanner.ts`), so the
status bar always ends on a final state instead of stale "Scanning ..." text
(dropped batches lose nothing — rows were already persisted and return via
the post-scan `loadFiles()` reload). During enumeration the status bar only ever
reports tracks DISCOVERED SO FAR — the total is unknowable while browsing, so it is
never implied. Containers whose pages repeatedly come back full-size without any
newly discovered item/container are treated as exhausted after 2 such pages,
protecting against servers that ignore `StartingIndex` and would otherwise be
enumerated forever.

After every scanning workflow (incremental file scan, DLNA scan — never at app start) `fixupMissingDurations(db)` runs the
layer-2 duration fixup: ffprobe is called on every row with `duration IS NULL`
(3 in parallel, 30 s kill-timeout each, aborted after 5 consecutive failures so
a dead server can't stall the pass), learned values are written back through
`fillMissingDuration()` (NULL gaps only) and reported to the renderer via
`library:durations-fixed`. Tracks that survive with NULL fall through to the
layer-3 `<audio>` element gap filler at play time (see now-playing.ts).

### `src/main/ssdp.ts`

SSDP discovery of UPnP/DLNA media servers on the local network.
`discoverDlnaServers()` sends M-SEARCH requests to UDP multicast 239.255.255.250:1900
(several targeted probes — `ssdp:all`, `upnp:rootdevice`,
`urn:schemas-upnp-org:device:MediaServer:1`, `urn:schemas-upnp-org:service:ContentDirectory:1` —
because some servers only answer specific STs), collects all unique HTTP description
URLs from RESPONSE/NOTIFY packets for ~3 s (NOTIFY alive packets are also accepted,
so servers that missed the M-SEARCH still show up), fetches every device description,
and for the deepest device that offers a ContentDirectory service resolves:
* `name` — its `friendlyName` (more specific than the root device name)
* `location` — the description URL it was found at
* `controlUrl` — absolute ContentDirectory control URL (`scpdurl`/`URLBase` relative resolution)
* `icon` — best icon as data URL (PNG/JPEG preferred by raster size + area, ≤ 512 KB,
  ancestor devices' icons are used when the matched device has none)

Media renderers and other devices without a ContentDirectory are filtered out.
Results are deduped by control URL and sorted by name. No third-party SSDP library.

### `src/main/cover-art.ts`

`getCoverArtGroups(filePath)` — the track's cover art as three disjunct
groups in one call (single tag parse): `front` = embedded picture #1, else
the track-named image (`song.mp3` → `song.jpg`/`.png`/…), else a front-named
file; `rearCovers` = additional embedded pictures plus `rear`/`back`-named
files (`REAR_COVER_FILENAMES`, config order); `extraImages` = all remaining
images in the folder, alphabetically. Front-named files and the track-named
image never leak into the other groups. Filename lists live in
`FRONT_COVER_FILENAMES` / `REAR_COVER_FILENAMES` / `COVER_IMAGE_EXTENSIONS`
in `src/common/config.ts`. `getCoverArt(filePath, maxSize?)` (front group only)
accepts an optional `maxSize` parameter: when provided, `resizeToThumbnail()`
uses Electron's `nativeImage` to resize the image before returning a data
URL. `getCoverArtGroups()` always returns full resolution (used by theater
mode). `fetchDlnaCoverArt(streamUrl, artUrlSpec)` fetches a DLNA track's
announced `upnp:albumArtURI` candidates over HTTP (relative URIs resolved
against the stream URL, max 8 in parallel) and picks the largest image by
pixel dimensions — so theater mode always gets the full-size variant. The IPC
handlers route http(s) paths there instead of the local-file logic.

### `src/main/desktop.ts`

`detectInitialDesign(settingsPath, knownDesignIds)` — initial design precedence:
- a saved design setting (any id discovered at runtime — built-in or custom), or the special `system` choice meaning
  "follow the operating system at startup"; a saved id that is **not** found at runtime is ignored and the flow
  continues exactly as on first run;
- default by desktop color scheme: a dark desktop scheme maps to the **Dark Gray** design, a light desktop
  scheme to the **White** design, using Electron's cross-platform `nativeTheme.shouldUseDarkColors` API.

The saved setting is read once here; the special `system` choice and a missing setting use Electron's cross-platform
`nativeTheme.shouldUseDarkColors` API. A dark system scheme maps to **Dark Gray**, a light system scheme to
**White**. This keeps the initial design selection independent of KDE-, GNOME-, GTK- or D-Bus-specific settings
files and also covers macOS and Windows. Live changes are handled in the renderer through the corresponding
`prefers-color-scheme` media query, but only while the persisted choice is `system`; an explicitly selected design
never changes automatically.

### `src/main/types.ts`

Shared TypeScript types: `SqlJsDatabase`, `SqlJsStatement`, `SqlJsStatic`, `ScannedFileInfo`,
`TagUpdate`, `SearchOptions`, `SendToRenderer` callback type.

### `src/main/sqljs.d.ts`

Ambient declaration for `sql.js` (which ships no types): declares its default export as
`() => Promise<SqlJsStatic>`, enabling a plain top-level `import initSqlJs from "sql.js"`.

### `src/main/dbus-native.d.ts`

Ambient declaration for `dbus-native` (which ships no types): declares its named exports
(`sessionBus`, `defineInterface`, `Variant`) plus the `DbusBus` / `DbusConnection` / `DbusMessage`
and `InterfaceDefinition` / `InterfaceProperty` / `InterfaceMethod` types, so `mpris.ts` can use
plain top-level imports under the strict config instead of inline `require()` + `// @ts-nocheck`.

### `src/main/paths.ts`

`SETTINGS_DIR`, `SETTINGS_PATH`, `DEFAULT_DB_PATH` — resolves `~/.config/musicpenguin/...`.
`getDbPath()` — reads `db-path` from musicpenguin-settings.json, falls back to default.

### `src/main/mpris.ts`

MPRIS (Media Player Remote Interfacing Specification) server for Linux desktop integration.
Registers MusicPenguin on the D-Bus session bus as `org.mpris.MediaPlayer2.MusicPenguin`
so desktop environments route media keys to the app. Uses `dbus-native` to define the
`org.mpris.MediaPlayer2` and `org.mpris.MediaPlayer2.Player` interfaces with properties
(PlaybackStatus, Metadata, Volume, CanGoNext, CanGoPrevious) and methods (Play, Pause,
PlayPause, Stop, Next, Previous).

**Media key handling is DE-specific** (detected via `XDG_CURRENT_DESKTOP`):

*KDE*: KDE's `kglobalaccel` intercepts all media keys and fires D-Bus broadcast signals
(`org.kde.kglobalaccel.Component.globalShortcutPressed`) on the session bus. KDE's
`plasma-shell` then forwards these as MPRIS method calls — but **silently drops PlayPause**
(and sometimes Next/Previous). To work around this, MusicPenguin subscribes directly to
the `globalShortcutPressed` signal and handles all media keys itself. MPRIS method handlers
are set to no-op to prevent double-firing from plasma-shell's incomplete forwarding.

*GNOME / other*: Media keys are routed directly as MPRIS method calls to the active player.
No `globalShortcutPressed` signals exist. MusicPenguin overrides the MPRIS method handlers
to fire actions via the `onAction` callback.

**PropertiesChanged emission**: `updateMprisState()` emits `PropertiesChanged` D-Bus signals
via `bus.emitPropertiesChanged()` whenever player state changes. Without this, KDE's media
controller does not recognise MusicPenguin as the active player and may route media keys to
other MPRIS clients (e.g. Firefox).

The renderer sends state updates via the `mpris:updateState` IPC channel, and MPRIS method
calls (or globalShortcutPressed signals) are forwarded to the renderer as `media-key` IPC
messages.

### `src/main/utils.ts`

`walkDirectory()` — recursive file scan matching `MEDIA_FILE_EXTENSIONS`. `withTimeout()` —
Promise race with timeout. `ensureDir()`. `commandExists()` — checks `which`. `jsonStringify()`
— JSON.stringify with 2-space indent and Unicode unescaping. DNS alias helpers used by DLNA:
`dnsNameForIp(ip)` — reverse lookup (dns.reverse + dns.lookupService) with forward verification,
shortest verified name wins (`expandFritzBoxCandidates` adds `.fritz.box`-stripped variants);
`ipLiteralOf()`, `withAliasedHost(url, ip, dnsName)` — swap a stored IP-literal host for the
readable DNS name.

### `src/common/config.ts`

Central constants: `TAG_BATCH_SIZE` (20), `NUM_TAG_READER_THREADS` (4), `MEDIA_FILE_EXTENSIONS`
(all scannable audio/video extensions), `PLAYABLE_FILE_EXTENSIONS` (built-in `<audio>` playback,
including `.mp2` which Chromium can decode for MPEG-1 Layer II but not MPEG Layer II),
`DEFAULT_SEARCH_URLS` (5 search URL templates: Discogs, Amazon, Google, MusicBrainz, DNB),
`MIN_EXTRA_IMAGE_SIZE` (100, minimum size for theater mode extra images),
and `THEATER_FADE_TOTAL_MS` (2000, combined theater mode fade-out + fade-in time; half per
direction).

### `src/renderer/debug-log.ts`

Debug logging for the renderer process. `initDebugLog()` reads the `debug-log` setting.
`debugLog(...args)` sends timestamped lines to the main process over the `debug:log` IPC channel,
which appends them to `~/.config/musicpenguin.log` (the renderer itself does no file I/O) when
enabled, or no-ops when disabled. `isDebugLogEnabled(): boolean` exposes the current toggle state.
Used for media key event tracing.

### `src/renderer/external-player.ts`

Configurable external player used as a fallback for formats Chromium cannot decode
(e.g. MPEG Layer II) or via the context-menu "Play in …" action. `getExternalPlayer()` returns
the persisted command (default `vlc`); `getExternalPlayerDisplayName()` derives the short label
(last path segment without extension). `initExternalPlayer()` loads the `external-player`
setting; `checkExternalPlayerCommand(name)` tests availability via the `shell:isExternalPlayerAvailable` IPC;
`saveExternalPlayer(name)` persists the kebab-case `external-player` key.
On macOS, a configured executable path is launched directly; a bare application name such as
`vlc` is resolved as an installed `.app` bundle and opened through the native `open -a` command.
Launch failures return an error to the renderer instead of failing silently.

### `src/renderer/min-autoplay-rating.ts`

`getMinAutoplayRating()` / `initMinAutoplayRating()` / `saveMinAutoplayRating()` manage the
`min-autoplay-rating` setting (0.5 steps, 0.5..5; absent = no limit). `passesMinAutoplayRating(rating)`
returns whether a track clears the threshold for AUTO-advance: unrated (0) and hated (−1) tracks can
never reach even the lowest 0.5 limit and are always skipped; manual starts are never filtered.

### `src/renderer/index.ts`

Renderer entry point (bundled to `dist/bundle.js`). Initializes all panels: groups, list,
detail, now-playing, split-panes, playlist, search, settings. Handles the Scan button (delegates
to `runFullScan()` in `src/scanner.ts`) and Problematic files button in the groups panel.
Loads tracks from DB, restores
sort/column/splitter state from settings. Registers `tags:scanning` handler (updates status bar)
and `library:changed` handler (full track list reload after scan completes). Integrates playlist
and main-list track advancement via `onTrackEnd` and theater mode nav callbacks. Main list
navigation (`mainListNext`/`mainListPrev`) respects global shuffle/repeat modes — shuffle
picks random tracks from the unplayed set, repeat-all wraps at list boundaries, repeat-one
replays on auto-advance only (a MANUAL next/prev always advances — repeat never governs the
user pressing next). Uses `requestAnimationFrame` to let the browser paint the shell
before loading DB data. Prev/next (MPRIS, buttons, keys) start from the last **established selection** when nothing
is playing: a `navFromList` flag remembers whether the user last selected in the main list or
the playlist, and a manual step falls back to `selectedTrackPath` (main list) or the last-clicked
playlist row rather than a stale "currently playing" track — auto-advance always continues from
the just-finished track, and an actively-playing main-list track always uses the main list.
**Standard sorting modes** live in `src/sorting.ts`: `SORTING_MODES` is a named registry of reusable
library sorts (`{ id, name, sort }`), with the canonical **"Artist, Album, TrackNo"** mode (`id`
`artist-album-trackno`, exported as `ARTIST_ALBUM_TRACKNO`) as its first element (plus a `filename`
mode, `FILENAME`). `applySortingMode(id, arr)` looks up a mode by id and applies its `sort` to a
`Track[]` array in place; `sortPlaylistByArtistAlbumTrackNo()` is the `PlaylistEntry[]` variant.
The "Artist, Album, TrackNo" mode (`ARTIST_ALBUM_TRACKNO`) is offered at the top of the "Sort by:"
section of both the main-list and playlist context menus (the other modes are currently only invoked
programmatically). The active mode is shown highlighted; the main list highlights it via the list
controller's `setSortingMode()`, and applying it clears the manual column-sort arrows
(`clearManualSortIndicator`).

Context-menu Goto actions apply context-appropriate sort orders without updating the
global sort state or column header sort indicators. Each Goto action (and the equivalent album/
artist/composer/folder group click) calls `clearManualSortIndicator()`, which resets `sortColumn`/
`sortDirection`, clears the column-header arrows via `updateSortIndicators()`, and clears the list's
`setSortState` — so no manual-sort arrow is shown (arrows reappear only when the user sorts manually):
- **Goto Album**: sorts by track number ascending via `applySortingMode("trackno", ...)`.
- **Goto Artist**: sorts by artist ascending, then album ascending, then track number ascending via `applySortingMode("artist-album-trackno", ...)`.
- **Goto Composer**: sorts by artist ascending, then album ascending, then track number ascending via `applySortingMode("artist-album-trackno", ...)` (composer-based sort is intentionally omitted).
- **Goto Folder**: for local files sorts by filename ascending via `applySortingMode("filename", ...)`; for DLNA tracks sorts by artist/album/track via `applySortingMode("artist-album-trackno", ...)`.

All goto functions use `captureSelectionAnchor()` before the sort and `restoreSelectionAnchor()` after, falling back to `setScrollOffset(0)` only when no anchor exists, so the user's scroll position is preserved across re-sorts.

**Actively clicking a group** (selecting it in the left panel) applies that group's sorting
scheme to the main list the same way a Goto action would — overriding and clearing any
differing manual sort (`manualSortApplied = false`): album, artist and composer groups sort by
artist→album→track; folder groups by filename (artist→album→track for DLNA). "All Tracks",
"Search Result" and "Most Played" keep using the global sort state (Most Played still forces
playcount descending).

**Left-panel group persistence**: The groups created by a Goto action are persisted to
`musicpenguin-settings.json` under `group-items` — a flat array of `{ "kind", "value" }`
entries (`kind` ∈ album/artist/composer/folder; `value` is the string that populated the
group: album/artist/composer name, or the folder path for folder groups). Only the KIND and
that string are stored — never the computed result tracks. The array is written in the exact
order the sections render on the left panel (album groups, then artist, then composer, then
folder), so within each section the order survives a restart. Saved whenever a Goto action
additionally creates a new group or the user DEL-removes one; restored at startup
(`loadGroupItems()` runs before the first `refreshGroupsUI()`) by rebuilding the four group
arrays from the `kind`/`value` pairs and re-deriving the node ids and folder basename labels.

### `src/renderer/types.ts`

* `TreeNode` — `id`, `label`, `children?`, `thumbnail?`
* `ListItem` — flattened display row (`id`, `path`, `filename`, `title`, `artist`, `album`, `trackNo`, `albumArtist`, `genre`, `year`, `ext`, `discNo`, `rawTrackNo`, `trackPath`, `composer`, `conductor`, `comment`, `rating`, `bpm`, `duration`, `playcount`)
* `PlaylistEntry` — `path`, `title`, `artist`, `duration`, `album`, `trackNo`, `albumArtist`, `genre`, `year`, `composer`, `conductor`, `comment`, `rating`, `bpm`, `playcount`, `filename`, `ext`, `trackPath`, `id`, `_playing?` (thumbnail cache is in `src/thumbnail-cache.ts`)

### `src/renderer/thumbnail-cache.ts`

Application-wide singleton (`Map<string, string>`) caching 32×32 px cover art data URLs
keyed by file path. `fetchThumbnail(filePath)` checks the cache, then calls `getCoverArt`
with `maxSize: 32` on miss and stores the result. `getThumbnail(filePath)` provides
synchronous cache lookup. Shared by the playlist and groups panel — the same file
triggers only one IPC round-trip.

### `src/common/electron-types.d.ts`

Declares `Track`, `ScannedFileInfo`, `TagUpdate`, `ElectronAPI` interface (all IPC methods
exposed via preload), and `Window` augmentation.

### `src/renderer/groups-view.ts`

Renders a flat `<ul>` from `TreeNode[]`. Click selects a node; double-click opens it.
Supports cover art thumbnails (via the shared `ThumbnailCache`, 32×32 px), drag-to-playlist,
and context menu (Show in Folder for folders; skipped for URL-derived folder groups — no
physical directory to reveal). Flat despite `TreeNode.children` existing in the type.
DEL key removes the selected album, artist, composer, or folder group item from the
left panel (fixed groups and headings are not removable; the change is persisted via the
`group-items` setting). After removal, selection moves
to the next item in the same section, or the previous one, or falls back to "All Tracks".

### `src/renderer/list-view.ts`

CSS Grid table with resizable columns (drag handles update CSS variables → saved to settings).
Multi-selection (Ctrl/Shift/Arrow keys), drag-to-playlist, context menu (Show in Folder — reveals
the folder of the first local file in the selection and is omitted only when the selection holds no
local files at all, Open with Default Application for local files, Play
in external player, Copy Path, Rescan Tags, Goto Album, Goto Folder, Goto Artist, Goto Composer, Sort by column). Click → `onSelect` +
priority paths. Double-click → `onDblClick` play.
`formatTime()` converts seconds string to `MM:SS`/`HH:MM:SS`.
The `#` column wraps its number in a `span.track-no-badge` (`setTrackNoCell()`) so skins can draw a
square box around just the track number; skins that don't restyle it inherit the unboxed inline text,
so the badge is visually transparent there.

**Goto sorting**: Context-menu Goto actions apply a context-appropriate sort order without
updating the global sort state or column header sort indicators. Goto Album sorts by track number
ascending. Goto Artist and Goto Composer sort by artist, then album, then track number ascending
(composer-based sort is intentionally omitted). Goto Folder sorts by filename ascending for local
files, or by artist/album/track for DLNA tracks. Sort indicators only reappear when the user
interactively clicks a column header.

**Manual vs. discovery sort**: A `manualSortApplied` flag (persisted in settings) records
whether the user has actively sorted by clicking a column header (`onHeaderClick` / context-menu
`applySort`). `renderTrackList()` only re-sorts the list when this flag is set; otherwise it
leaves the source exactly as-is (initial library discovery order, or the custom order produced by
a Goto action). Goto actions mark the flag as false and pass their already-sorted source array
directly to `renderTrackList(source)` so the custom artist→album→track order is preserved and
never clobbered by the stale global column sort.

**Scroll stabilization**: Goto actions preserve scroll position via `captureSelectionAnchor()`
and `restoreSelectionAnchor()`. Before a sort, the currently selected track's ID and its pixel
offset from the scroll container's top are captured. After the sort, `selectAndScrollTo()` locates
the same track in the re-sorted list and scrolls it back to its original offset. If the track
is no longer visible (e.g. filtered out), the scroll position falls back to the top of the list.
This prevents jarring jumps when the user navigates via Goto Album/Artist/Folder/Composer.

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

### `src/renderer/detail-panel.ts`

Display form: path (editable — renames/moves file on disk via `db:moveFile`), title, artist, album,
album artist, track/disc/year/genre/composer/conductor/rating/comment. Cover art loaded lazily
via `getCoverArt()`; tracks without art show a music-icon placeholder instead. Clicking or double-clicking
the cover area — art or placeholder alike — always opens theater mode for the shown track
(no track selected → click is ignored).

Detail-form layout (see `index.html`): the left half carries four small metadata fields
Disc No / Track No / Year / BPM, grouped in a `.detail-row-field-group` flex row, plus a
separate rating label (`label.field-rating`). Default (`musicpenguin_base.css`) sizing keeps
all five labels `flex: 1` and reserves `min-width: 100px` for the rating label
(`label:has(#field-rating)`), guaranteeing the stars always fit. The field-group wrapper is
purely structural sugar: a skin that wants a wider rating can override just two flex factors
(`.detail-row-field-group { flex ... }` and `#detail-form .field-rating { flex: 0 0 <px> }`)
without touching four sibling elements.

### `src/renderer/now-playing.ts`

Manages `<audio>` element. Two-row bar: track info + controls (play/pause, seek bar, time,
duration, rating, **shuffle**, **repeat**, volume). Global playmode state (shuffle on/off,
repeat off/one/all) lives here — affects both main list and playlist navigation. Includes
smart shuffle: maintains a history set so no track repeats until all tracks in the current
source have been played. Saves `now-playing`/`volume`/`muted` to settings on `beforeunload`;
shuffle/repeat are persisted via `saveSettings` on toggle. Restores position on startup.
Double-click track info → theater mode.

**All UI toggle/transport icons are stroke-based tabler outline SVGs**
 single-sourced from `src/renderer/icons/`; esbuild bundles them as
 raw text (`--loader:.svg=text`) and `src/renderer/icons.ts` exports each file
 as an `ICON_*` string — nothing is hardcoded into `index.html`. One-time
 `injectStaticIcons()` (first call in `init()`) fills every static slot
 (prev/next/play/pause, repeat/shuffle, volume/mute, folders, scan, settings,
 search, regex, randomize, clear/save/load playlist, warning, music-note
 placeholder) via `innerHTML`; state-driven slots (play/pause, volume/mute,
 repeat modes, shuffle, playlist play, the list "now playing" speaker
 indicator, cover placeholders, folder open/close) are then overwritten by
 their engines as soon as the state is known. For raw-file preview (opening
  `index.html` directly in a browser, before startup runs), each slot carries a
  monochrome Unicode placeholder glyph that `injectStaticIcons()` overwrites. All of them use
 `stroke: currentColor`, so icons inside buttons take the button's design
 `color` (the rating stars are the only remaining glyphs — deliberately left
alone). Sizing AND stroke style are centralized in ONE base rule: the
  tabler SVGs carry fixed 24×24 attributes (plus `stroke-linecap/linejoin:
  round`) and the shared base rule `.icon { width: 1.15em; height:
  1.15em; stroke-linecap: round; stroke-linejoin: round; ... }` scales every
  one relative to its surrounding font size (the `.delete-dialog-warning
  svg` rule overrides it to 1em). The `stroke-*` values inherit to all paths,
  so a design skin restyles every icon in one place by overriding `.icon` (e.g. a skin can set
  `stroke-linecap: square; stroke-linejoin: miter`).
  Icons are full SVG markup, so TS injects them via `innerHTML`
   (never `textContent`). The play/pause buttons (`#play-btn`,
   `#playlist-play-btn`, `#theater-play-btn`) embed **both** icons at once, wrapped as
   `<span class="icon-play">` + `<span class="icon-pause">` (via the `ICON_PLAY_PAUSE`
   constant), and instead of swapping `innerHTML` the code merely toggles a `playing`
   class on the button. The base stylesheet picks which icon shows: `.icon-pause` hidden
   by default and shown only under `button.playing`; a skin can override this so the same
   icon represents both states (e.g. always show the play triangle) or add per-state
   styling (e.g. a "live LED" glow on the play triangle while playing).
   Sort-direction arrows are SVGs too: the context-menu ascending/descending buttons
   (`.playlist-sort-btn` in the list and playlist menus) and the column-header
   `.sort-badge` use `ICON_CARET_UP`/`ICON_CARET_DOWN` instead of Unicode triangles,
   so skins can glow them like any other icon. Base CSS squeezes them to half their
   natural width (`.sort-badge svg, .playlist-sort-btn svg { width: 1.2em; height: 2.4em }`).
   Each transport button uses its palette family consistently:

  the now-playing bar `#prev-btn`/`#play-btn`/`#next-btn` use the `--primary*`
  family, and the theater overlay `#theater-prev-btn`/`#theater-play-btn`/`#theater-next-btn`
  use their own `--theater-btn-*` variables, which the base `:root` initializes **from** the
  `--primary*` family (`--theater-btn-bg: var(--primary)`, `--theater-btn-hover`,
  `--theater-btn-text`, `--theater-btn-disabled`, `--theater-btn-text-disabled`), so theater
  controls match the main transport bar by default but a skin can later diverge them. Each skin
  redeclares these theater vars from its own primary values (see the consistency note below).
  Repeat/shuffle are toggles: off = dimmed `--accent-disabled` pill, on = `--accent` pill with
  the `--button-text-accent` glyph. The same enabled (`--accent`/`--button-text-accent`) vs dimmed
  (`--accent-disabled` bg + `--button-text-accent-disabled` glyph) treatment applies to the playlist
 action buttons (`.enabled`), the sidebar `#groups-buttons` buttons, and the search bar's
 `#regex-btn` (`.active` toggle), `#search-btn` (`:disabled`) and `#load-playlist-btn`.
 Hover adds a glow but
 only when truly clickable: repeat/shuffle/regex always (both states
 toggle), playlist/search/load only when enabled. The hover glow is unified the same way as the
 transport buttons — `text-shadow: 0 0 10px var(--*)` with a `drop-shadow(0 0 4px var(--*))` and no
 background/border change on hover — and each button never mixes colour families: buttons use
  either `--accent*` (groups, repeat/shuffle/regex, playlist/search/load) or `--primary*`
  (transport `#prev/#play/#next`, theater `#theater-prev/#theater-play/#theater-next`,
  `#playlist-play-btn`), consistently for fill, text and glow.
  Each button family still owns its own styling rules for future per-button customization.
  The now-playing progress/knob and the volume slider are primary-level controls too: base
  defines `--progress-fill: var(--primary)` (with `--progress-track` for the track), so they
  follow the `--primary*` family rather than the accent. Their counterparts in the theater
  overlay keep their own dedicated `#theater-*` selectors but reuse the same base variables
  (`--progress-fill`/`--progress-track`), so theater's progress, knob and volume slider look
  identical to the main bar in every skin.
  New palette vars: `--accent-disabled`,
  `--button-text-accent-disabled` — a skin must override these too (e.g. the blue skin dims to a
 navy `#1e3a5f`), otherwise the disabled pill falls back to the dark base colour. The
 playlist play button `#playlist-play-btn` is the exception: it uses the `--primary*`
  family (`--primary-disabled` when empty) rather than `--accent`.
  The `tropical_sorbet` skin overrides all four disabled vars to a subdued melon
  (`#e7b6c1` bg + `#9a6b76` text) so disabled buttons match the `--watermelon` accent
  instead of falling back to the brownish base colours.

  The `tropical_sorbet` skin also overrides the non-primary `.btn-normal` (e.g. "+ Add
  Folder") from the peachy base to a light blue (`#dcecfb` bg + `#2c5a7a` text, hover
  `#c2e1f7`) for a cooler secondary-button look, and sets `--accent`/`--accent-hover` to
  light blue (`#5aa6d6` / `#3f8fc4`) so accent buttons (`.btn-icon.active`, search/playlist
  buttons, toggles) match. Its primary family is the melon `--tropical-sorbet-gradient`
  (`--primary`/`--primary-hover`), so the transport buttons, the playlist play button and the
  theater buttons (via the `--theater-btn-*` vars) all follow the watermelon→mango look.

Only "significant" plays increment the play count (`MIN_PLAY_SECONDS` = 20): a play counts
when at least 20 continuously played seconds were accumulated via `timeupdate` (seeks and
jumps are ignored), or when playback reached the natural end of the track ("ended" event,
which also covers tracks shorter than 20 s).

`resetNowPlayingWidget()` tears the widget down entirely (pauses audio, clears src, resets the
selected track, info text, play button, progress/time, duration and rating) — used after the
database is emptied.

Layer-3 duration gap filler: when `loadedmetadata` fires for a track whose stored
duration is unknown (NULL), the duration reported by this `<audio>` element is
persisted via `db:fillDuration`; on success a `track-duration-known` DOM event
lets the main list/playlist models pick the value up immediately.

Tags refresh on play: starting playback of a LOCAL file re-queues it for a tag
re-read (`db:rescanFiles` with `onlyIfModified`), so title/artist/... in the DB
are corrected from the real file whenever it actually changed (mtime newer than
the last tag scan — same staleness rule as the incremental sweep; unchanged
files are skipped without touching the queue, never-scanned ones are read).
Results arrive via the normal `library:changed` refresh after scan completes. A 5-minute per-path cooldown
keeps pause/resume cycles and instant replays from re-stat-ing redundantly;
stream URLs (DLNA) are skipped entirely (`rescanFiles()` ignores http(s) paths —
no locally readable tags), their duration gap being filled by the `<audio>`
mechanism above.

### `src/renderer/theatermode.ts`

Fullscreen cover art overlay with playback controls, progress bar, prev/next buttons, cursor
auto-hide, and crossfade transition (fade to black over the end of the current track, content
swap while hidden, fade back in over the start of the next). Triggered by clicking or
double-clicking the detail
panel's cover art (works with and without cover art) or double-clicking the now-playing
info. Integrates with both playlist and main-list navigation via callbacks. Clicking the
cover cycles rear covers first, then extra images (`getCoverArtGroups()`), then back to
the front cover; sub-100×100 px images are skipped. Closing is via the close button,
Escape, or clicking anywhere outside an interactive control (buttons, sliders, rating
stars and the cover are exempt). Clicks within a short grace window after opening are
ignored, so the second click of a double-click cannot instantly re-close the overlay.
The `#theater-mode` stage sets `user-select: none` so track text and cover art cannot
be text-selected, which keeps the "click anywhere to close" and progress-slider
semantics clean.
The fading only runs when it FITS — otherwise the transition is sudden and immediate:
the fade-out is skipped when the current track's remaining time was never longer than the
per-direction fade duration (track shorter than that, or theater mode opened too
late), and the fade-in is skipped when the next track is shorter than the fade duration.
If either side skips, no black hold and no animation happens at all. The combined
fade-out + fade-in time is configured via `THEATER_FADE_TOTAL_MS` in `src/common/config.ts`;
half of it is used per direction (also applied to the `--theater-transition-duration` CSS
variable at startup).

### `src/renderer/file-probe.ts`

`probeFileForErrors(bytes)` — inspects an in-memory file for known structural
defects and returns the found errors as an array of `FILE_PROBE_ERROR` enum
constants: `FILE_PROBE_ERROR.WAV_WRAPPED_MP3` (matching the detection in
`fix_wav_mp3.py`) and `FILE_PROBE_ERROR.MPEG_LAYER_II` (MPEG-1 Layer II audio,
which Chromium cannot decode). The read size limit (`MAX_PROBE_FILE_SIZE`)
lives in `src/common/config.ts`.

### `src/renderer/playback-error.ts`

`handleAudioPlaybackError(filePath)` — probes a failed playback (see
`src/file-probe.ts`) and shows an explanatory dialog with an optional "Try to
play in the external player instead" action. MPEG Layer II files are auto-routed
to the external player if one is configured; otherwise a descriptive error is shown.
Guarded so the `<audio>` "error" event and a
rejected `play()` promise for the same file yield only one dialog.
`onPlaybackFailure(filePath, err)` is the shared `play()` rejection callback
(ignores `AbortError`/`NotAllowedError`); every play entry point — now-playing,
theater mode, playlist — funnels through it, while the "error" event listener in
`src/now-playing.ts` covers the decode-failure path for all of them.
While theater mode is open, `setSilentSkipHandler()` (registered by
`src/theatermode.ts`) swallows that dialog and skips forward to the next track
instead; consecutive skips are capped and reset when playback actually starts.

### `src/renderer/audio.ts`

Exports the shared `HTMLAudioElement` instance and a `formatTime(number)` helper for the
now-playing bar and theater mode.

### `src/renderer/settings.ts`

Overlay dialog with a dark mode toggle and close button. The folders dialog is opened
independently by the Folders button in the groups panel (handled by `src/folders-dialog.ts`).
While an overlay is open, its launcher button (`#settings-btn` / `#folders-btn`) carries an
 `active` class that is removed again on close, so a design skin can light the launcher up
 for as long as the dialog is visible.
 Every standard popup dialog (settings, folders, about) shares the same base `.dialog`
 container class, the same `.dialog-close` button class on its header "×", and the same
 `.dialog-ok` button class (with the shared `btn btn-primary` look) in its footer, so all
 dialogs render identically; only their ids and optional size modifiers
 (`.folders-dialog`/`.about-dialog`) differ.

Also contains a **Danger Zone** section: a red "Empty MusicPenguin Library" button (left-aligned, styled
like the delete-confirmation red button) that opens a confirmation overlay asking "Are you
sure to empty the MusicPenguin library?...". Confirming calls `window.electronAPI.clearDatabase()`
(`db:clearDatabase`), which stops the tag reader, deletes every row, saves the DB, emits
`library:changed` so the renderer reloads the empty library, then resets the Now Playing
widget (`resetNowPlayingWidget` in `src/now-playing.ts`) and clears the details panel
(`showDetails(null)`). It also fires the `setOnDatabaseCleared` callback (registered by
`src/index.ts`), which empties the playlist (`clearPlaylist` in `src/playlist-panel.ts`: clears
the entries, the current/selected state, re-renders, persists an empty playlist, resets the play
button and notifies the state-change callbacks so the navigation buttons update), drops every
user-built `album`/`artist`/`composer`/`folder` group
section from the left panel (empties the arrays, persists empty `group-items`, and, if the
 current group was one of those sections, resets the selection to "All Tracks"), then closes
 the settings dialog. In this confirmation the destructive action is the red
 `delete-dialog-btn-danger` button, so **Cancel** is styled as the default/primary action via the
 standard `btn btn-primary` classes (the same "OK" look as every other dialog), matching the
 `.btn` helpers rather than the neutral `delete-dialog-btn`. Danger buttons (`#empty-db-btn` and
 `.delete-dialog-btn-danger`) use the existing `--danger*` family (analogous to `--accent*`/`--primary*`):
  a solid `--danger` fill with `--button-text-danger` glyph, kept as a slightly muted red so it doesn't
 stand out too strongly, and on hover it uses the *same glow technique as the primary/accent
 buttons* — only `text-shadow: 0 0 10px var(--danger)` + `drop-shadow(0 0 4px var(--danger))`,
  with `background: var(--danger-hover)` (the fill brightens slightly on hover) plus the glow
    effect (`text-shadow: 0 0 10px var(--danger)` + `drop-shadow(0 0 4px var(--danger))`).

The external-player command field in Settings marks an invalid/empty value by adding the
`invalid-command` class (see `markPlayerValidity` in `src/renderer/settings.ts`). Its
background reuses the same `--danger` / `--button-text-danger` pair as the danger buttons
(`.toggle-row input[type="text"].invalid-command` in the base CSS, mirrored in the custom
skins), so the error highlight always matches the danger default background instead of a
divergent hardcoded red.

The confirmation's explanation text (`.delete-dialog-question`) and its neutral buttons
(`.delete-dialog-btn`, always rendered on a light `--panel-bg`/`--input-bg` box) use the plain
`--text` color — not `--button-text-accent` — so they stay readable even on light skins like
"white" where `--button-text-accent` is white. Skins must not override these to a hardcoded
light color.

### `src/renderer/index.ts` — About dialog & icon license

The About dialog (`#about-overlay`) is opened by clicking the app logo. Besides the version,
the BlueSky/GitHub links (opened via `shell:openExternal`) and the iconset link, the iconset row
also carries a **License** button (`#about-license-btn`, styled with the small `.internet-btn`
class used by the detail-panel internet-search buttons, inline in `#about-iconset1`, laid out as a
centered flex row so the button shares the icons URL's line). Clicking it opens a modal
(`#license-overlay` with a `.license-overlay`/`.license-box`/`.license-text` layout in the base
CSS) whose title is the localized `t("Icons License: $1", "tabler-icons")` (key present in every
language dictionary) and that displays the
bundled icon license **verbatim** — `iconLicense` is imported as raw text from
`src/renderer/icons/LICENSE` (esbuild bundles it with the same `--loader:.md=text`
mechanism used for the `--loader:.svg=text` icon files; the `*.md` ambient module is declared in
`src/renderer/svg-assets.d.ts`). The text is never translated and the source file is not shipped
or read at runtime. The modal closes via its header "×", Escape, or clicking the backdrop.

### `src/renderer/folders-dialog.ts`
Separate overlay for managing scanned folders: add/remove folders, expand/collapse subdirectories,
toggle per-folder checkboxes, and delete selected folders. Opened by the Folders button in the
groups panel. Also holds the DLNA server list: on open it runs SSDP discovery
(`dlna:discover`) and renders every found media server as a checkbox row with its icon,
name with its host address in parentheses; new servers default to unchecked, existing selections are persisted as
`dlna-servers` including each server's icon data URL — captured during discovery and
reused on reopen so rows render with their logo immediately, before the next search
finishes (with a status line for searching/empty/failed states). On close, calls
`runFullScan()` from `src/scanner.ts` (passing its in-memory folder/DLNA state as `folders`
and `dlnaServers` overrides) if any configuration changed; its summary is written after
`onScanComplete()` (list reload) so it is deterministically the status bar's final state.
Scanning always runs even when no folders or DLNA servers are enabled — this ensures
DB pruning still sweeps stale entries from previously removed folders/servers.
The `.folder-item .btn-expand` expand/collapse buttons reuse the shared primary styling
(`--accent` bg + `--button-text-accent` glyph, `--accent-disabled` when disabled), matching the
main-app buttons. On hover they use the *same unified glow as every other accent button* —
only `text-shadow: 0 0 10px var(--accent)` + `drop-shadow(0 0 4px var(--accent))`, with no
background/border change (previously the hover fill switched to `--accent-hover`, which made
these buttons glow a different, darker/orangish shade than the main UI). The folder SVG icon
inherits `currentColor` so its stroke follows the button foreground. The dialog uses the
`.folders-dialog` class to fix its size (`width`/`height` of `min(960px,90vw)`/`min(720px,90vh)`,
with matching `min-width`/`min-height`) so expanding/collapsing folders or showing the DLNA
section never resize or move the dialog; only the user's manual `resize: both` grip changes its
size, and the internal `#folder-list` / `#dlna-server-list` lists scroll (`overflow-y: auto`)
within that fixed box. A folder with no
subfolders (known-empty `children === []`) gets a disabled button — assigned at build,
after a failed expansion, and for newly added empty folders. The folder tree (`#folder-list`)
and DLNA server list (`#dlna-server-list`) scroll areas use the darker `--panel-bg` background
(same as the details UI panel), with a `--border` and radius, so they read as inset panels.

**Panel background variables**: the three main UI sub-surfaces have dedicated CSS vars so skins can
style each independently — `--groups-panel-bg` (`#groups-panel`, was `--panel-bg`),
`--details-panel-bg` (`#detail-panel`, was `--bg`), and `--search-panel-bg` (`#search-panel`, was
 `--playlist-bg`). Each is initialized to its old value per skin (no visual change) so designs that
 override panels directly remain unaffected.

### `src/renderer/scanner.ts`

Centralised scan orchestration. `runFullScan(opts?)` is the single entry-point for both the
folders dialog close and the Scan button: loads folders/DLNA servers from settings (or uses
the `folders`/`dlnaServers` overrides), computes `allowedPaths` via `flattenEnabled()`, runs
filesystem scan → `runIncrementalScan(files, allowedPaths)` (prunes entries outside allowed
paths), then DLNA enumeration → `scanDlnaSource()`. Returns `FullScanResult` with
`total` (entries in DB after scan), `removed` (entries deleted during this sweep), and
`errors` (files with tags_error = 1). Status bar shows a single unified line.

`scanFolders(folders, onProgress?)` — iterates folders, calls `electronAPI.scanFolder()` for
each. Returns `{ files, errors }`. Each folder independently try/caught.
`loadFolders()` — reads the `folders` tree from settings.
`flattenEnabled(nodes)` — recursively collects enabled leaf folders.

DLNA source handling: `loadDlnaServers()` / `saveDlnaServers()` persist the server selection
(`dlna-servers` setting), `enabledServers()` filters the checked entries, and `scanDlnaSource(overrides?)` invokes
`dlna:scan` with the enabled list (optionally overridden by an in-memory list from the
folders dialog) and returns `{ added, removed, total, errors }` — or `null` when no DLNA
server was ever involved. `subscribeDlnaProgress()` wraps the `dlna:progress` push channel;
its events carry the newly discovered track rows so `src/index.ts` can merge them into the
library live (re-render throttled to ~400 ms) while enumeration is still running.

### `src/renderer/split-pane.ts`

Draggable dividers for groups width, list height, playlist width. Invisible cross-handle drag
areas (no visible knob) adjust both axes. State persisted to settings.

### `src/renderer/playlist-panel.ts`

Playlist with drag-drop reorder, randomize (Fisher-Yates), clear (`clearPlaylist`, also invoked
when the library database is emptied — see the settings "Empty Database" section), multi-select, keyboard delete,
auto-advance via `onTrackEnd`. Entries rebuilt from DB paths on load. Shuffle and repeat modes
are global (managed by `src/now-playing.ts`); playlist reads them via `getShuffle()`/`getRepeat()`
and subscribes to `onPlayModeChange` for re-rendering.
Prev/next navigation (`prevPlaylist`/`advancePlaylist`/`canPlaylistPrev`/`canPlaylistNext`) uses
a `navBaseIndex()`: the currently playing row when a playlist is active, otherwise the last
row the user clicked in the playlist (so a MANUAL prev/next works on a merely-selected entry
with nothing playing). `hasPlaylistNavBase()` lets `src/index.ts` decide whether idle navigation
should target the playlist.
The playlist context menu offers **Open with Default Application** for local files in addition to
the configured external-player action; HTTP(S) stream entries are excluded from this action.
Whenever new tracks are ADDED to the playlist while a MAIN-LIST track is currently
playing and that track is part of the (resulting) playlist, `adoptPlayingTrackIntoPlaylist()`
adopts it as the playlist's current entry: the playlist play/pause button shows the pause
state, the speaker indicator anchors to that row, and prev/next (now-playing bar and MPRIS) operate
on the playlist from then on — including auto-advance on track end. This covers every add path:
internal drags from the main list or groups panel (viewport and
item-level drop handlers; pure internal reorders do not adopt). No adoption happens when playback
is paused or when the playing track is not in the playlist; if playlist mode was already active,
the existing re-anchor behavior applies unchanged.

**Playlist cover art**

Cover art thumbnails (32×32 px) are lazily loaded via the application-wide `ThumbnailCache`
(`src/thumbnail-cache.ts`). The cache stores data URLs keyed by file path and is shared by
both the playlist and groups panel — the same file triggering only one IPC round-trip.

**Approach considered — eager per-row loading:** Fire `getCoverArt()` on every `populate()` call,
loading art for any visible row that lacks it. This was tried and rejected. With virtual scrolling,
DOM row elements are recycled to display different data indices as the user scrolls. Eager loading
fires fetches continuously during scroll; by the time results arrive, the DOM bindings have shifted.
Stale results land on wrong rows, fetches for rows already scrolled off-screen waste IPC calls, and
concurrent fetches pile up faster than they resolve. The result is a visual mess where images never
appear correctly.

**Chosen approach — scroll-stop loading:** Fetches only fire after scrolling settles, so row→data
bindings are stable when results arrive. A debounce timer resets on every `populate()` call; only
when the timer expires (200 ms of inactivity) does the actual fetch batch execute.

**How it works:**
1. `populate()` renders visible rows. If `getThumbnail(path)` returns a cached data URL, it is
   shown immediately (placeholder hidden, `<img>` created/swapped). No IPC needed.
2. `populate()` calls `scheduleCoverLoad()` which sets a 200 ms debounce timer.
3. Each subsequent `populate()` (during scroll) resets the timer. Only when scrolling stops
   does `loadVisibleCoverArt()` execute.
4. `loadVisibleCoverArt()` increments a generation counter, then collects visible entries that
   lack a thumbnail in the cache. `fetchThumbnail()` checks the cache first; on miss it calls
   `getCoverArt` with `maxSize: 32` via IPC. Fetches run with concurrency cap (6); each result
   is guarded by the generation counter — if a new scroll started, stale callbacks are silently
   dropped.
5. On resolution, `applyCoverArt()` updates the DOM row directly.

**Cache lifecycle:** The ThumbnailCache persists for the session (survives scroll, reorder, filter).
It is shared across all consumers (playlist, groups panel, any future UI).

### `src/renderer/search-panel.ts`

Library-wide search (regex mode, column checkboxes for path/title/artist/album/album artist/
year/genre/composer/conductor/comment). Persists query, regex mode, and tag column state
to settings.

## Key Behaviors

* **Startup**: No folder scanning and no tag reading. `requestAnimationFrame` lets the browser paint the shell before
  loading DB data. A full-screen black `#startup-overlay` div covers `<body>` from the first paint to hide the
  unfinalized layout and prevent startup flicker; it is removed from the DOM after tracks load, the list renders,
  and the scroll position is restored (end of `init()` in `src/renderer/index.ts`).
  Reads SQLite and populates the main track list. Sort state, column widths,
  and splitter state are restored from settings before first render. Loads persisted now-playing
  track and restores playback position. Tag reading only starts when the user clicks the Scan
  button or closes the folders dialog after making changes.
* **Double-click to play**: Double-clicking any row in the list view immediately sets it as the
  current track and starts playback via `playTrack()`.
* **Theater mode**: Clicking or double-clicking the cover art in the detail panel (with or
  without cover art — the music-icon placeholder is clickable too) or double-clicking the track info in
  the now-playing bar opens a fullscreen overlay with cover art, playback controls, and
  prev/next navigation.
* **Scan**: Full scan happens via the centralised `runFullScan()` in `src/scanner.ts` when the
  Scan button in the groups panel is clicked, or when the folders dialog closes with changes.
  The scan (a) prunes DB entries from disabled/removed folders via `allowedPaths`, (b) discovers
  new files in enabled folders, and (c) re-reads tags for files whose timestamps changed.
  Each folder is independently try/caught and `runIncrementalScan` also removes DB entries for
  files that no longer exist on disk — but only when their surrounding tree is verifiably
  reachable: missing files are grouped by their nearest existing ancestor directory and deleted
  only when a sibling file under that ancestor still stats or the ancestor lists non-empty
  content. Unreachable trees (unmounted/sleeping NAS, EIO) keep their rows — including ratings
  and play counts — until a later successful scan; permanently removed shares must be removed
  deliberately via the folders dialog.
  After the tag queue finishes, a single `library:changed` event triggers a full UI refresh
  with all newly read metadata at once. The status bar shows a single unified line:
  total tracks in DB, removed count, and error count (if any).
* **DLNA scan**: Enabled DLNA servers (`dlna-servers` setting, selected via checkbox in the
  folders dialog after SSDP network discovery) have their audio libraries recursively enumerated
  and synced via `dlna:scan` — always AFTER all filesystem scans completed, because remote
  browsing is much slower than local disk access. DLNA tracks play through `<audio>` directly
  from their stream URL (`http(s)://` paths bypass the `file://` conversion). Unchecking all
  servers removes all imported DLNA tracks on the next full scan.
* **Cover art**: Read on-the-fly via `db:getCoverArt` — tries embedded picture first (via
  `music-metadata`), then a track-named image, then searches the file's directory for the first
  folder-front filename matching `^(folder|cover|front)\.(jpg|jpeg|png|webp|gif)$`
  (`COVER_IMAGE_EXTENSIONS`). JPEG/PNG are identified by magic bytes. Never
  stored in DB. Returns a data URL.
* **Tag reading is idempotent**: Once `tags_scanned_at` is set (even on error), the file is never
  re-read. The priority queue filters against `tags_scanned_at IS NULL` before adding work.
* **Audio uses `file://` protocol**: Works in Electron because Node.js integration is off but
  `file://` is allowed by default.
* **Empty fields**: Missing artist/album/etc. show as empty string `""`, never as a placeholder
  character like `"—"`.
* **Problematic files**: Exported to the OS temporary directory as
  `musicpenguin_problematic_files.txt` and opened through Electron's platform-neutral
  `shell.openPath()` API. This delegates to the system's default application for text files
  and avoids requiring `xdg-open`, VS Code, Kate, Gedit, or another desktop-specific editor.
* **External file manager**: The "show in folder" action uses Electron's platform-neutral
  shell integration: `shell.showItemInFolder()` for files (selecting them when supported) and
  `shell.openPath()` for folders. This avoids requiring or detecting `xdg-open`, Dolphin,
  Nautilus, or another particular Linux desktop and also works with Finder on macOS and
  Explorer on Windows. File selection remains dependent on the capabilities of the native
  file manager.
* **External links**: Links use Electron's platform-neutral `shell.openExternal()` API and
  therefore open in the operating system's default browser. No browser executable such as
  Firefox needs to be installed on `PATH`; the old `browser` setting is no longer used.

## Media Keys

Hardware media keys (play/pause, next track, previous track) are handled via two
independent layers:

1. **MPRIS (D-Bus)** — the standard Linux mechanism. Registers MusicPenguin on the session
   bus as `org.mpris.MediaPlayer2.MusicPenguin`. Desktop environments route media key
   presses to the active MPRIS player via D-Bus, bypassing the normal keyboard shortcut
   system entirely. This is how KDE/GNOME know a media player is running and should
   receive media key events. State updates (playback status, current track metadata,
   position, volume, navigation capability) are sent from the renderer to the main
   process via the `mpris:updateState` IPC channel whenever playback state changes.

2. **keydown (renderer)** — DOM-level `document.addEventListener("keydown", ...)` fallback
   that checks `event.code` for media key codes. Catches any key events that reach the
   renderer's DOM.

Note: Electron's `globalShortcut` API does **not** support media key names on Linux
(`MediaPlayPause`, `MediaTrackNext`, `MediaTrackPrevious` all fail to register), so it is
not used. The `before-input-event` approach was also found to not reliably fire for media
keys on KDE.

All layers send the same `media-key` IPC messages (`play-pause`, `play`, `pause`,
`stop`, `next`, `previous`) to the renderer, which routes them to the existing playback
functions (`togglePlayPause`, `onNext`, `onPrev`). The handler in `now-playing.ts` is
idempotent — duplicate events from multiple layers are harmless since toggle/state
functions are naturally safe to call multiple times.

## Debug Log

When enabled in Settings, writes timestamped diagnostic messages to
`~/.config/musicpenguin.log`. Covers MPRIS events, media key IPC, and keydown events.
Disabled by default (`"debug-log": false` in settings). The renderer logs via
`debugLog()` from `src/debug-log.ts` (sends IPC to the main process). The main process
logs directly to the file using its own `debugLog()` helper, reading the setting on each
write to allow toggling without restart.

## TypeScript Strictness

The TypeScript configs (`tsconfig.main.json` and `tsconfig.renderer.json`) enforce `strict: true`,
`noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.

## Design Detection

On startup, the available designs are discovered at runtime (`src/main/designs.ts`): every folder containing a
`musicpenguin_design.css` under `<renderer>/designs` (built-in, href relative to `index.html`) or under
`~/.config/musicpenguin/designs` (custom, absolute href) counts as a design whose **folder name is its id**. A custom
design sharing a built-in folder name shadows the built-in. The initial design is picked with this precedence:

1. Saved `design` in musicpenguin-settings.json — validated against the discovered ids. A saved id that is **not
   found** is ignored and detection continues exactly as on first run.
2. Default by desktop color scheme: Electron's cross-platform
   `nativeTheme.shouldUseDarkColors` maps a dark system scheme to the **Dark Gray** design and a light system
   scheme to the **White** design. The value is read once during startup; live system theme changes are not handled
   yet.
3. Default: dark_gray

The chosen design's **stylesheet href** (not the id) is base64-encoded and passed as `?design=` when loading
`src/renderer/index.html` (base64 makes the href survive the URL query round-trip losslessly — folder names may
contain spaces, `+`, `%`, `&` …);
an inline script in the `<head>` decodes and sets `<link id="design-css" href="…">`
defaulting to `designs/dark_gray/musicpenguin_design.css`, before the page renders to avoid flash. The loader is
resilient: it only accepts `file:` stylesheets and, if the requested stylesheet fails to load (e.g. index.html is
opened directly from the file system during development, or a custom design went missing), the link's `onerror`
swaps it to the built-in dark gray design. `src/renderer/settings.ts` decodes the same way to keep the dropdown's
default in sync with the active startup design. The renderer then
re-applies the saved design only if it is still resolvable; otherwise it leaves the main process's choice untouched,
so an unknown saved design falls back to the usual first-time-default design. All designs are loaded on top of a
**shared base stylesheet**, `src/renderer/musicpenguin_base.css`, which is linked first in `src/renderer/index.html`
(line 7) before the design stylesheet. The base is a copy of the built-in `dark_gray` UI spec, so a design only needs
to override what it cares about. Built-in and custom designs are minimal **overlays**: each rule the design does not
restyle falls back to the base, `:root` palettes override the base variables, and any rule whose selector and
declaration body are byte-identical to a base rule can be dropped from the overlay (the custom design files in
`package/custom_designs` are kept minimal this way). Switching designs at runtime just swaps the link's
`href` (see `applyDesign`
in `src/renderer/settings.ts`). User-initiated switches (settings dropdown) can later be cross-faded over e.g. 0.5s
via the View Transitions API (`document.startViewTransition`);
the duration and a `prefers-reduced-motion` fallback live in the designs as
`::view-transition-*` rules. We currently have set this transition time to 0s, might change later again.

Editable input boxes / text areas carry a convention shared by every skin (the base once dimmed
`#detail-form.fields-readonly input/textarea` to `--text-muted`; that rule has been removed so the
read-only state no longer alters the text). Each design highlights editable inputs
(`#detail-form input/textarea`, `#field-rating`, `#search-input`, `.toggle-row select/input[type="text"]`)
with a primary-colored border plus a soft outer glow, but **only while the field is focused**
(the `:focus`/`:focus-within` glow shows only while the user is editing). Inactive read-only/disabled
fields fall back to a plain `--input-border` with no glow and keep the exact same text color as an
editable field. The custom skins mirror this convention in their own stylesheet — `tropical_sorbet`
hardcodes its gradient's primary tones since `--primary` there is a gradient and cannot be used as a
border color/glow color. (The `80s_stereo` easter-egg skin keeps a plain neutral border on its input
wrappers with no focus glow at all.)

**Theater info text pinning**: the four theater metadata elements (`#theater-title`, `#theater-artist`,
`#theater-album-line`, `#theater-year`) always use the exact style from the base CSS — regardless of
which design is active. Every `*_design.css` file carries an explicit copy of these four rules at its
end, so no custom-design variable or selector can accidentally recolor or restyle them. The IDs remain
in the DOM so a user-authored design *can* intentionally override them if desired.

The settings dropdown (`#design-select`) is populated via the `designs:list` IPC (exposed as
`window.electronAPI.listDesigns()`, see `src/preload/preload.js`) with the discovered folders grouped under the
 non-localized headings **Built-In Designs** and **Custom Designs**. Folder names are polished for display: `_`
 becomes a space and each word is capitalized. Design names are never
 translated — the discovery list is re-queried every time the settings dialog is opened (`refreshDesigns()` in
`src/renderer/settings.ts`), so designs added to or removed from `~/.config/musicpenguin/designs` (folders or
symlinks, even broken ones, which are skipped) are reflected immediately. A custom design sharing a built-in folder name is
offered in the dropdown instead of the built-in (single, non-ambiguous "Custom" entry) and wins on startup
and at runtime; the persisted setting stays the bare folder name, never the path.

The install packages do not ship custom designs as part of the app: on installation their post-install scripts
(`package/deb/postinst`, rpm `%post`) copy the custom designs from `package/custom_designs` into
`~/.config/musicpenguin/designs/` of the installing user (resolved via the sudo context or the first human account),
skipping any folder that already exists. This gives a user a starting point for own designs.

**No styling in TypeScript**: all visual styling (colors, sizes, cursors, etc.) lives exclusively in the design
stylesheets. Renderer code only (a) toggles classes / hidden states, (b) feeds dynamic runtime data to CSS via custom
properties (`--groups-w`, `--list-h`, `--playlist-w`, `--col-*`, `--slider-fill`, `--depth`, …) and (c) sets a handful
of necessarily-runtime values (progress widths, scroll-thumb positions, context-menu coordinates, measured spacer
heights, the blurred theater background's data-URL image).

## Language (i18n)

All user-visible strings go through `t()` in `src/common/i18n/index.ts`. Lookup keys are the English
source strings themselves; `en-us` needs no dictionary, other languages provide a translation map
under `src/common/i18n/` (`de-de`, `fr-fr`, `es-es`). Dynamic text uses `$1`, `$2`, ... placeholders, e.g.
`t("$1 $2 in MusicPenguin database.", 5, "files")`.

On startup the language is resolved with this precedence:

1. Saved `language` in musicpenguin-settings.json
2. OS locale (`app.getLocale()` — `de` → `de-de`, `fr` → `fr-fr`, `es` → `es-es`, otherwise `en-us`)
3. Default: `en-us`

The chosen language is passed as `?lang=` query parameter when loading `src/renderer/index.html`, so the page
renders in the right language without a flash. Changing the language in **Settings** applies
instantly (static text via `data-i18n`/`data-i18n-title`/`data-i18n-placeholder` attributes,
dynamic labels re-render on a `language-changed` event) and is persisted.
