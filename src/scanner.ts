import { t } from "./i18n/index.js";

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
