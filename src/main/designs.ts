import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { SETTINGS_DIR } from "./paths";

export const DESIGN_CSS_FILENAME = "musicpenguin_design.css";

const HOME_DIR = os.homedir();

/** Absolute path with the user's home substituted by `~`, when inside it. */
function displayPath(p: string): string {
  if (p === HOME_DIR) return "~";
  if (HOME_DIR && p.startsWith(HOME_DIR + path.sep)) return "~" + p.slice(HOME_DIR.length);
  return p;
}

/** A folder inside a designs directory that ships a design stylesheet. */
export interface DiscoveredDesign {
  /** Folder name of the design — its id in settings and the dropdown. */
  id: string;
  /** Path of the design folder for display, `~` for the user's home (possibly a symlink). */
  path: string;
  /** Stylesheet href: relative ("designs/<id>/...") for built-ins, absolute for custom ones. */
  href: string;
}

export interface DesignList {
  builtin: DiscoveredDesign[];
  custom: DiscoveredDesign[];
}

/** Folder name → UI label: underscores become spaces, each word capitalized. */
export function designDisplayName(id: string): string {
  const words = id.split("_").filter(Boolean);
  return words.length === 0
    ? id
    : words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
}

function scanDesignDir(rootDir: string, hrefFor: (id: string, cssPath: string) => string): DiscoveredDesign[] {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return []; // directory does not exist — nothing to scan
  }
  const found: DiscoveredDesign[] = [];
  for (const entry of entries) {
    const designDir = path.join(rootDir, entry.name);
    // statSync() follows symlinks, so a symlink to a design folder is treated
    // like a real folder; broken symlinks are silently skipped.
    let isDesignDir = false;
    try {
      isDesignDir = fs.statSync(designDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDesignDir) continue;
    const cssPath = path.join(designDir, DESIGN_CSS_FILENAME);
    if (!fs.existsSync(cssPath)) continue;
    found.push({ id: entry.name, path: displayPath(designDir), href: hrefFor(entry.name, cssPath) });
  }
  found.sort((a, b) => a.id.localeCompare(b.id));
  return found;
}

/**
 * Runtime discovery of available designs:
 * - built-in designs shipping with the app live in `<renderer>/designs/<id>/`;
 * - custom designs live in `~/.config/musicpenguin/designs/<id>/`.
 * A custom design whose folder name collides with a built-in shadows it
 * (ids must stay unique), so it is removed from the built-in list.
 */
export function discoverDesigns(rendererDir: string): DesignList {
  const builtinBase = path.join(rendererDir, "designs");
  const builtin = scanDesignDir(builtinBase, (id) => path.join("designs", id, DESIGN_CSS_FILENAME));
  const customBase = path.join(SETTINGS_DIR, "designs");
  const custom = scanDesignDir(customBase, (_id, cssPath) => cssPath);
  const customIds = new Set(custom.map((d) => d.id));
  return {
    builtin: builtin.filter((d) => !customIds.has(d.id)),
    custom,
  };
}

/** Flattened id → href lookup; a custom design shadows a built-in with the same id. */
export function designHrefMap(list: DesignList): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of [...list.builtin, ...list.custom]) map.set(d.id, d.href);
  return map;
}