import { t } from "../common/i18n/index.js";

export interface ScannedFileInfo {
  name: string;
  relativePath: string;
  fullPath: string;
}

export interface FolderEntry {
  path: string;
}

export interface FolderNode {
  path: string;
  enabled: boolean;
  children?: FolderNode[];
}

export function fileCountLabel(n: number): string {
  return n === 1 ? t("file") : t("files");
}

export function flattenEnabled(nodes: FolderNode[]): FolderEntry[] {
  const result: FolderEntry[] = [];
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      result.push(...flattenEnabled(n.children));
    } else if (n.enabled) {
      result.push({ path: n.path });
    }
  }
  return result;
}

export async function scanFolders(
  nodes: FolderNode[],
  onProgress?: (msg: string) => void
): Promise<{ files: ScannedFileInfo[]; errors: string[] }> {
  const folders = flattenEnabled(nodes);
  const allFiles: ScannedFileInfo[] = [];
  const errors: string[] = [];

  for (const folder of folders) {
    const cap = folder.path.replace(/\/+$/, "").split("/");
    const name = cap[cap.length - 1] || "/";
    onProgress?.(t("Finding files in: $1", name));
    try {
      const files = await window.electronAPI.scanFolder(folder.path);
      allFiles.push(...files);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return { files: allFiles, errors };
}

/* ── DLNA audio sources ───────────────────────────────────── */

export interface DlnaScanSummary {
  added: number;
  removed: number;
  total: number;
  errors?: string[];
}

/* Persisted list of known DLNA servers ("dlna-servers" setting). */
export async function loadDlnaServers(): Promise<DlnaServerEntry[]> {
  try {
    const data = await window.electronAPI.loadSettings();
    const stored = data?.["dlna-servers"];
    if (Array.isArray(stored)) {
      return stored
        .filter((s): s is DlnaServerEntry => typeof s?.["control-url"] === "string")
        .map((s) => ({
          name: typeof s.name === "string" ? s.name : "",
          "control-url": s["control-url"],
          "description-url": typeof s["description-url"] === "string" ? s["description-url"] : "",
          "icon-url": typeof s["icon-url"] === "string" ? s["icon-url"] : "",
          enabled: s.enabled === true,
        }));
    }
  } catch { /* ignore */ }
  return [];
}

export async function loadFolders(): Promise<FolderNode[]> {
  try {
    const data = await window.electronAPI.loadSettings();
    return data?.folders ?? [];
  } catch { /* ignore */ }
  return [];
}

export async function saveDlnaServers(servers: DlnaServerEntry[]): Promise<void> {
  try {
    await window.electronAPI.saveSettings({ "dlna-servers": servers });
  } catch { /* ignore */ }
}

function enabledServers(servers: DlnaServerEntry[]): DlnaServerEntry[] {
  return servers.filter((s) => s.enabled && s["control-url"]);
}

/* Enumerates every enabled DLNA server and syncs it into the database.
   MUST be called only after all filesystem scans completed — remote
   browsing is much slower than local disk access. When `overrides` is
   given it takes precedence over the persisted list (the folders dialog
   passes its in-memory state so a scan never races a pending save).
   An empty enabled list cleans up previously imported DLNA tracks;
   null is returned when no DLNA source was ever involved. Progress is
   reported via the dlna:progress push channel (see subscribeDlnaProgress). */
/* Liveness tracking so progress push events can never outlive their
   scan: once scanDlnaSource settled, late events (IPC races, an older
   overlapping scan finishing after a newer one started) are dropped,
   keeping the status bar on its final state instead of regressing to
   "Scanning ..." text. The sequence counter stops an older scan's
   completion from silencing a newer scan that is still running. */
let dlnaScanSeq = 0;
let dlnaScanActive = false;

export async function scanDlnaSource(overrides?: DlnaServerEntry[]): Promise<DlnaScanSummary | null> {
  const servers = overrides ?? await loadDlnaServers();
  if (servers.length === 0) return null;
  const seq = ++dlnaScanSeq;
  dlnaScanActive = true;
  try {
    return await window.electronAPI.scanDlna(enabledServers(servers));
  } finally {
    if (seq === dlnaScanSeq) dlnaScanActive = false;
  }
}

/* ── Centralised full scan ──────────────────────────────────── */

export interface FullScanResult {
  total: number;
  removed: number;
  errors: number;
}

/* Single entry-point that (a) removes DB entries from disabled/removed
   folders and DLNA servers, (b) discovers new files in enabled folders,
   and (c) re-reads tags for files whose timestamps changed.  Called
   from the folders dialog close AND the explicit "Scan" button. */
export async function runFullScan(opts?: {
  folders?: FolderNode[];
  dlnaServers?: DlnaServerEntry[];
  onProgress?: (msg: string) => void;
}): Promise<FullScanResult> {
  const folders = opts?.folders ?? await loadFolders();
  const dlnaServers = opts?.dlnaServers ?? await loadDlnaServers();
  const allowedPaths = flattenEnabled(folders).map((f) => f.path);

  let removed = 0;
  let total = 0;
  let errors = 0;

  /* ── 1. Filesystem scans (fast local access) ──────────── */
  try {
    const { files } = await scanFolders(folders, opts?.onProgress);
    const r = await window.electronAPI.runIncrementalScan(files, allowedPaths);
    removed += r.removed;
    total = r.total;
    errors += r.errors;
  } catch (err) {
    errors++;
  }

  /* ── 2. DLNA enumeration (slow remote browsing) ───────── */
  try {
    const dlna = await scanDlnaSource(dlnaServers);
    if (dlna) {
      removed += dlna.removed;
      total = dlna.total || total;
      errors += dlna.errors?.length ?? 0;
    }
  } catch (err) {
    errors++;
  }

  return { total, removed, errors };
}

export function subscribeDlnaProgress(
  onProgress: (foundSoFar: number, serverName: string | undefined, addedTracks: Track[]) => void,
): void {
  window.electronAPI.onDlnaProgress((data) => {
    if (!dlnaScanActive) return;
    onProgress(data.found, data.name, data.added ?? []);
  });
}

/* Main process runs SSDP discovery in the background at app start and
   pushes once new/refreshed servers were persisted. */
export function subscribeDlnaServerChanges(callback: () => void): () => void {
  return window.electronAPI.onDlnaServersChanged(callback);
}
