import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

import type { ScannedFileInfo } from "./types";
import { MEDIA_FILE_EXTENSIONS } from "../config";

export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function walkDirectory(
  dirPath: string,
  rootPath: string,
): Promise<ScannedFileInfo[]> {
  const results: ScannedFileInfo[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      try {
        const sub = await walkDirectory(fullPath, rootPath);
        results.push(...sub);
      } catch {
        // skip inaccessible subdirectories
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MEDIA_FILE_EXTENSIONS.has(ext)) {
        const rel = path.relative(rootPath, fullPath);
        results.push({ name: entry.name, relativePath: rel, fullPath });
      }
    }
  }
  return results;
}

export function jsonStringify(obj: unknown): string {
  return JSON.stringify(obj, null, 2).replace(
    /\\u([\da-fA-F]{4})/g,
    (_, cp: string) => String.fromCharCode(parseInt(cp, 16)),
  );
}

export function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
