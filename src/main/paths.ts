import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export const SETTINGS_DIR = path.join(os.homedir(), ".config", "musicpenguin");
export const SETTINGS_PATH = path.join(SETTINGS_DIR, "musicpenguin-settings.json");
export const DEFAULT_DB_NAME = "musicpenguin-library.sqlite";
export const DEFAULT_DB_PATH = path.join(SETTINGS_DIR, DEFAULT_DB_NAME);
export function getDbPath(): string {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(raw);
    if (typeof settings["db-path"] === "string" && settings["db-path"].trim()) {
      return settings["db-path"];
    }
  } catch { /* settings file may not exist or be corrupt — use default */ }
  return DEFAULT_DB_PATH;
}
