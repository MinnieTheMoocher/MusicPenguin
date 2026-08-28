import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

import type { SqlJsDatabase, DlnaTrackRecord } from "./types";
import { SETTINGS_PATH } from "./paths";
import { dnsNameForIp, ipLiteralOf, withAliasedHost } from "./utils";
import {
  storeDlnaTracks,
  deleteStaleDlnaTracks,
  getTotalFileCount,
  saveDb,
  getMissingDurationPaths,
  fillMissingDuration,
} from "./database";
import { tryFfprobeForDuration } from "./tag-reader";

/* ── DLNA / UPnP AV ContentDirectory scanner ──────────────────
 *
 * Recursively enumerates every audio item offered by one or more
 * UPnP/DLNA media servers via SOAP Browse calls over HTTP, starting
 * at the ContentDirectory root object ("0"). Servers are found via
 * SSDP discovery (ssdp.ts) and identified by their ContentDirectory
 * control URL; the device description URL is kept as a fallback for
 * re-resolving stale control URLs.
 *
 * Results are synced into the files table: path/filename = stream
 * URL, dlna flag = 1, metadata taken from the DIDL-Lite fragment
 * (no local tag reading involved). Because remote enumeration is
 * slow, tracks are stored page by page as they are discovered and
 * pushed to the renderer for a live-updating main list. Rows no
 * longer offered by any enabled server are removed; rating/playcount
 * of surviving rows persist.
 */

const SOAP_ACTION_BROWSE = '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"';
const REQUEST_TIMEOUT_MS = 20000;
const BROWSE_PAGE_SIZE = 500;
const MAX_DLNA_ITEMS = 100000;
/* Enumeration is slow, so discovered tracks are stored page by page;
   the database file itself is flushed to disk at most this often. */
const SAVE_INTERVAL_MS = 2000;
/* Consecutive full-size pages that yield nothing new before a container
   is treated as exhausted (misbehaving servers, see enumerate loop). */
const MAX_STALE_PAGES = 2;

export interface DlnaScanResult {
  added: number;
  removed: number;
  total: number;
  /* One message per server that failed (enumeration continues with
     the remaining servers) */
  errors: string[];
}

/* A single DLNA source to enumerate (mirrors the persisted
   "dlna-servers" entry keys). `control-url` is the ContentDirectory
   control URL; `description-url` (device description URL) is used as a
   fallback to re-resolve the control URL when it went stale. */
export interface DlnaScanTarget {
  name: string;
  "control-url": string;
  "description-url"?: string;
}

/* Progress push during enumeration: `foundSoFar` counts the tracks of
   one server, `serverName` identifies it and `addedRows` carries the
   row snapshots of the latest batch so the renderer can show them
   while discovery is still running. */
export type DlnaProgress = (
  foundSoFar: number,
  serverName?: string,
  addedRows?: Record<string, unknown>[],
) => void;

export type XmlNode = Record<string, unknown>;

/* ── Debug logging (same file & gate as main index.ts; kept local to
   avoid an import cycle through it) ─────────────────────────── */

const DEBUG_LOG_PATH = path.join(os.homedir(), ".config", "musicpenguin", "musicpenguin.log");

function dlnaDebug(line: string): void {
  try {
    if (JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"))["debug-log"] !== true) return;
    fs.appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

/* Dumped once per scan run: the first raw DIDL-Lite page, so metadata
   mapping questions (e.g. how the server announces composer/conductor)
   can be answered from real output instead of guesswork. */
let didlSampleLogged = false;

/* ── HTTP ──────────────────────────────────────────────────── */

/* Some media servers (e.g. Synology DSM) reset rapid back-to-back
   connections with an abrupt socket close; retrying those transient
   transport errors after a short delay recovers transparently. All
   requests made here are read-only (GET / SOAP Browse), so retries
   are always safe. */
const TRANSIENT_ERROR_RE = /hang up|ECONNRESET|EPIPE|ECONNREFUSED/i;

async function retryTransient<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT_ERROR_RE.test(message) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface HttpTextResponse {
  status: number;
  body: string;
}

export function httpRequestText(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<HttpTextResponse> {
  return retryTransient(() => new Promise<HttpTextResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported protocol: ${url.protocol}`));
      return;
    }
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method, headers }, (res) => {
      res.setEncoding("utf8");
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs / 1000}s`)));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  }));
}

interface HttpBinaryResponse {
  status: number;
  body: Buffer;
  contentType: string;
}

export function httpRequestBuffer(urlStr: string, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<HttpBinaryResponse> {
  return retryTransient(() => new Promise<HttpBinaryResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported protocol: ${url.protocol}`));
      return;
    }
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, { method: "GET", headers: { "User-Agent": "MusicPenguin" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
        contentType: String(res.headers["content-type"] ?? ""),
      }));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs / 1000}s`)));
    req.on("error", reject);
    req.end();
  }));
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ── XML helpers (fast-xml-parser) ─────────────────────────── */

/* removeNSPrefix normalizes dc:title/upnp:artist/etc. to local names,
   so servers with differing namespace prefixes are handled alike.
   Tag/attribute value parsing stays off so years like "198x" survive. */
export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function findAll(node: unknown, tag: string, out: XmlNode[] = []): XmlNode[] {
  if (node === null || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      /* Childless elements arrive as plain strings — wrap them so
         elementText() can read their content uniformly. */
      if (key === tag && (typeof v !== "object" || v === null)) {
        out.push({ "#text": v });
      }
      if (typeof v === "object" && v !== null) {
        if (key === tag) out.push(v as XmlNode);
        findAll(v, tag, out);
      }
    }
  }
  return out;
}

export function elementText(v: unknown): string {
  if (v === null || typeof v !== "object") return typeof v === "string" ? v : "";
  const t = (v as XmlNode)["#text"];
  return typeof t === "string" ? t : "";
}

/* Parse a DIDL-Lite fragment with this module's parser configuration
   (also used by offline unit checks). */
export function parseDidl(xml: string): unknown {
  return parser.parse(xml);
}

export function findText(node: unknown, tag: string): string {
  for (const hit of findAll(node, tag)) {
    const s = elementText(hit).trim();
    if (s) return s;
  }
  return "";
}

function findAllTexts(node: unknown, tag: string): string[] {
  const out: string[] = [];
  for (const hit of findAll(node, tag)) {
    const s = elementText(hit).trim();
    if (s) out.push(s);
  }
  return out;
}

function joinAllTexts(node: unknown, tag: string, separator: string): string {
  return [...new Set(findAllTexts(node, tag))].join(separator);
}

/* ── SOAP Browse ───────────────────────────────────────────── */

interface BrowsePage {
  didl: unknown;
  numberReturned: number;
}

function browseEnvelope(objectId: string, startingIndex: number, requestedCount: number): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    '<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">',
    `<ObjectID>${escapeXml(objectId)}</ObjectID>`,
    "<BrowseFlag>BrowseDirectChildren</BrowseFlag>",
    "<Filter>*</Filter>",
    `<StartingIndex>${startingIndex}</StartingIndex>`,
    `<RequestedCount>${requestedCount}</RequestedCount>`,
    "<SortCriteria></SortCriteria>",
    "</u:Browse>",
    "</s:Body>",
    "</s:Envelope>",
  ].join("");
}

async function browsePage(controlUrl: string, objectId: string, startingIndex: number): Promise<BrowsePage> {
  const res = await httpRequestText(
    controlUrl,
    "POST",
    {
      "Content-Type": 'text/xml; charset="utf-8"',
      SOAPACTION: SOAP_ACTION_BROWSE,
      "User-Agent": "MusicPenguin",
    },
    browseEnvelope(objectId, startingIndex, BROWSE_PAGE_SIZE),
  );
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status} from ContentDirectory`);
  }

  const envelope = parser.parse(res.body) as XmlNode;
  const faults = findAll(envelope, "Fault");
  if (faults.length > 0) {
    throw new Error(findText(faults[0], "faultstring") || "SOAP fault");
  }

  let resultXml = "";
  const results = findAll(envelope, "Result");
  if (results.length > 0) resultXml = elementText(results[0]).trim();

  if (resultXml && !didlSampleLogged) {
    didlSampleLogged = true;
    dlnaDebug(`[dlna] first DIDL page from ${controlUrl}: ${resultXml.slice(0, 4000)}`);
  }

  /* processEntities already unescaped the Result payload, so it is
     plain XML here and can be fed straight back into the parser. */
  const didl = resultXml ? parser.parse(resultXml) : {};

  const nrRaw = findAll(envelope, "NumberReturned");
  const numberReturned = parseInt(elementText(nrRaw[0]).trim(), 10);
  return { didl, numberReturned: Number.isFinite(numberReturned) ? numberReturned : 0 };
}

/* ── Control URL discovery ─────────────────────────────────── */

function findContentDirectoryControlUrl(descriptionXml: string, docUrl: string): string | null {
  let parsed: unknown;
  try {
    parsed = parser.parse(descriptionXml);
  } catch {
    return null;
  }
  for (const service of findAll(parsed, "service")) {
    const serviceType = findText(service, "serviceType");
    if (!/ContentDirectory/i.test(serviceType)) continue;
    let controlUrl = findText(service, "controlURL");
    if (!controlUrl) continue;
    try {
      controlUrl = new URL(controlUrl, docUrl).toString();
    } catch {
      continue;
    }
    return controlUrl;
  }
  return null;
}

/* Well-known device-description locations of popular media servers
   (ReadyMedia/minidlna, Rygel, Gerbera, ...), tried when the user
   entered something that is neither a control URL nor a description. */
function descriptionCandidates(input: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (u: string): void => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };
  pushUnique(input);
  try {
    const url = new URL(input);
    const origin = url.origin;
    pushUnique(new URL("/MediaServerDevicedesc.xml", origin).toString());
    pushUnique(new URL("/description.xml", origin).toString());
    pushUnique(new URL("/DeviceDescription.xml", origin).toString());
    pushUnique(new URL("/MediaServerDevice.xml", origin).toString());
    pushUnique(new URL(input.endsWith("/") ? "description.xml" : "/description.xml", input).toString());
  } catch { /* invalid URL — caller reports the error */ }
  return candidates;
}

export async function resolveContentDirectoryControlUrl(input: string): Promise<string> {
  /* Case 1: the URL itself already answers Browse calls */
  try {
    await browsePage(input, "0", 1);
    return input;
  } catch { /* fall through to description probing */ }

  /* Case 2: the URL points at (or leads to) a device description */
  for (const candidate of descriptionCandidates(input)) {
    let res: HttpTextResponse;
    try {
      res = await httpRequestText(candidate, "GET", { "User-Agent": "MusicPenguin", Accept: "*/*" });
    } catch {
      continue;
    }
    if (res.status !== 200) continue;
    const controlUrl = findContentDirectoryControlUrl(res.body, candidate);
    if (!controlUrl) continue;
    try {
      await browsePage(controlUrl, "0", 1);
      return controlUrl;
    } catch { /* try next candidate */ }
  }

  throw new Error(`No UPnP ContentDirectory service found at ${input}`);
}

/* ── DIDL-Lite item extraction ─────────────────────────────── */

function parseDurationSeconds(value: string): number {
  if (!value) return 0;
  const parts = value.split(":").map((p) => parseFloat(p));
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return 0;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return seconds;
}

function titleFromUrl(url: string): string {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const base = pathname.split("/").filter(Boolean).pop() ?? "";
    return base;
  } catch {
    return url;
  }
}

function extractAudioItem(item: XmlNode): DlnaTrackRecord | null {
  const upnpClass = findText(item, "class");
  if (!/^object\.item\.audio/i.test(upnpClass)) return null;

  /* Pick the first res URL, preferring one whose protocolInfo
     announces an audio MIME type. */
  let url = "";
  let duration = 0;
  let fallbackUrl = "";
  for (const res of findAll(item, "res")) {
    const candidate = elementText(res).trim();
    if (!/^https?:\/\//i.test(candidate)) continue;
    const protocolInfo = String((res as XmlNode)["@_protocolInfo"] ?? "");
    const resDuration = parseDurationSeconds(String((res as XmlNode)["@_duration"] ?? ""));
    if (/audio\//i.test(protocolInfo)) {
      url = candidate;
      duration = resDuration;
      break;
    }
    if (!fallbackUrl) {
      fallbackUrl = candidate;
      duration = resDuration;
    }
  }
  if (!url && !fallbackUrl) return null;
  if (!url) {
    url = fallbackUrl;
  }

  let year = "";
  const dateMatch = findText(item, "date").match(/\d{4}/);
  if (dateMatch) {
    year = dateMatch[0];
  } else {
    year = findText(item, "year");
  }

  /* upnp:artist and upnp:author carry an optional @role attribute in
     DIDL-Lite ("Composer", "Conductor", "AlbumArtist", ...). Dedicated
     composer/conductor elements do not exist in the UPnP schema — only
     some non-conformant servers emit them, kept as fallbacks in the
     return below. Most servers also put the file's COMPOSER tag into
     an UNLABELLED upnp:author (verified e.g. against ReadyDLNA), so
     unlabelled authors feed the composer column. Conductors are only
     announced by role-aware servers. */
  const performingArtists: string[] = [];
  const composers: string[] = [];
  const conductors: string[] = [];
  const albumArtists: string[] = [];
  /* `isArtistTag`: unlabelled artists are performers, and any extra
     named role (Performer, Soloist, ...) rides along with them. On
     author elements only an UNLABELLED name feeds the composer column;
     named non-credit roles there (Lyricist, Arranger, ...) are ignored. */
  const collectCredits = (tag: string, isArtistTag: boolean): void => {
    for (const node of findAll(item, tag)) {
      const name = elementText(node).trim();
      if (!name) continue;
      const role = String((node as XmlNode)["@_role"] ?? "").trim().toLowerCase();
      switch (role === "" && !isArtistTag ? "(unlabelled author)" : role) {
        case "(unlabelled author)":
          composers.push(name);
          break;
        case "composer":
          composers.push(name);
          break;
        case "conductor":
          conductors.push(name);
          break;
        case "albumartist":
        case "album artist":
          albumArtists.push(name);
          break;
        default:
          if (isArtistTag) performingArtists.push(name);
      }
    }
  };
  collectCredits("artist", true);
  collectCredits("author", false);

  /* Some servers assemble the DIDL dc:title as
     "<track title><separator><artist>" — ReadyDLNA uses "<title>/<artist>",
     others "<title> - <artist>", etc. — duplicating a credit. Strip that
     appended name again, together with the separator run and its
     surrounding whitespace, whenever the title ends in one of the
     announced credits (case-insensitive). Titles without a separator
     or with legitimate separators elsewhere are left untouched. */
  let rawTitle = findText(item, "title");
  {
    const SEPARATORS = "/-\u2013\u2014\u2022|:,;\u00b7";
    const credits = [
      ...performingArtists,
      findText(item, "creator"),
      findText(item, "albumArtist"),
    ];
    const lowered = rawTitle.toLowerCase();
    for (const credit of credits) {
      const needle = credit.trim().toLowerCase();
      if (!needle) continue;
      const end = lowered.lastIndexOf(needle);
      if (end < 0 || end + needle.length !== lowered.length) continue;
      /* Walk back over the separator run in front of the duplicated
         credit; it must contain at least one actual separator
         character (a bare space does not count) and may not eat the
         whole title. */
      let cut = end;
      let sawSeparator = false;
      while (cut > 0) {
        const ch = rawTitle.charAt(cut - 1);
        if (/\s/.test(ch)) {
          cut--;
        } else if (SEPARATORS.includes(ch)) {
          sawSeparator = true;
          cut--;
        } else {
          break;
        }
      }
      if (sawSeparator && cut > 0) {
        rawTitle = rawTitle.slice(0, cut).trimEnd();
        break;
      }
    }
  }

  return {
    url,
    title: rawTitle || titleFromUrl(url),
    artist: [...new Set(performingArtists)].join("; ") || findText(item, "creator"),
    album: findText(item, "album"),
    album_artist: [...new Set(albumArtists)].join("; ") || findText(item, "albumArtist"),
    track_no: findText(item, "originalTrackNumber"),
    disc_no: findText(item, "originalDiscNumber"),
    genre: joinAllTexts(item, "genre", ", "),
    year,
    composer: [...new Set(composers)].join("; ") || findText(item, "composer"),
    conductor: [...new Set(conductors)].join("; ") || findText(item, "conductor"),
    duration,
    /* All upnp:albumArtURI occurrences in announcement order — servers
       list thumbnail and full-size variants without labelling sizes,
       so the largest is chosen by measurement when fetched. */
    track_art_url: findAllTexts(item, "albumArtURI").join("\n"),
  };
}

export function didlAudioItems(didl: unknown): { audioItems: DlnaTrackRecord[]; childContainerIds: string[] } {
  const audioItems: DlnaTrackRecord[] = [];
  const childContainerIds: string[] = [];
  for (const container of findAll(didl, "container")) {
    const id = String((container as XmlNode)["@_id"] ?? "");
    const childCount = Number((container as XmlNode)["@_childCount"] ?? NaN);
    if (!id) continue;
    if (Number.isFinite(childCount) && childCount === 0) continue;
    childContainerIds.push(id);
  }
  for (const item of findAll(didl, "item")) {
    const record = extractAudioItem(item);
    if (record) audioItems.push(record);
  }
  return { audioItems, childContainerIds };
}

/* ── Recursive enumeration ─────────────────────────────────── */

export interface EnumerateOptions {
  /* Dedupe set; pass a shared instance so duplicate URLs are skipped
     across servers of the same scan run. */
  seenUrls?: Set<string>;
  /* Invoked once per browse page with the newly discovered audio
     items of that page, so they can be persisted immediately while
     enumeration continues. */
  onNewTracks?: (batch: DlnaTrackRecord[]) => void;
  /* Rewrites stream/art URLs from this IP literal to the given DNS
     name BEFORE dedup/storage/progress see them, keeping every
     downstream consumer consistent. */
  alias?: { ip: string; host: string };
}

function applyAlias(batch: DlnaTrackRecord[], alias: { ip: string; host: string }): DlnaTrackRecord[] {
  return batch.map((track) => ({
    ...track,
    url: withAliasedHost(track.url, alias.ip, alias.host),
    track_art_url: track.track_art_url
      .split("\n")
      .map((artUrl) => withAliasedHost(artUrl, alias.ip, alias.host))
      .join("\n"),
  }));
}

export async function enumerateDlnaAudioItems(
  controlUrl: string,
  onProgress?: DlnaProgress,
  options?: EnumerateOptions,
): Promise<DlnaTrackRecord[]> {
  const tracks: DlnaTrackRecord[] = [];
  const seenUrls = options?.seenUrls ?? new Set<string>();
  const visitedContainers = new Set<string>();
  /* Container ids already queued, so fresh-page detection can tell a
     genuinely new container from one seen before. */
  const enqueuedContainers = new Set<string>(["0"]);
  const queue: string[] = ["0"];
  let progressCounter = 0;

  while (queue.length > 0 && tracks.length < MAX_DLNA_ITEMS) {
    const objectId = queue.shift()!;
    if (visitedContainers.has(objectId)) continue;
    visitedContainers.add(objectId);

    let startingIndex = 0;
    /* Servers that ignore StartingIndex or clamp past-the-end requests
       would serve the same full-size page forever; after this many
       consecutive pages without any newly discovered item or container
       the object counts as exhausted instead of looping endlessly. */
    let stalePages = 0;
    for (;;) {
      const { didl, numberReturned } = await browsePage(controlUrl, objectId, startingIndex);
      const parsed = didlAudioItems(didl);
      const audioItems = options?.alias ? applyAlias(parsed.audioItems, options.alias) : parsed.audioItems;
      const childContainerIds = parsed.childContainerIds;
      queue.push(...childContainerIds);
      const freshChildren = childContainerIds.filter(
        (id) => !visitedContainers.has(id) && !enqueuedContainers.has(id),
      );
      for (const id of freshChildren) enqueuedContainers.add(id);

      const freshBatch: DlnaTrackRecord[] = [];
      for (const track of audioItems) {
        if (!seenUrls.has(track.url)) {
          seenUrls.add(track.url);
          tracks.push(track);
          freshBatch.push(track);
          progressCounter++;
        }
      }

      if (freshBatch.length > 0) options?.onNewTracks?.(freshBatch);

      if (onProgress && progressCounter > 0) {
        onProgress(progressCounter);
        progressCounter = 0;
      }

      const parsedCount = audioItems.length + childContainerIds.length;
      if (parsedCount === 0 || numberReturned <= 0 || numberReturned < BROWSE_PAGE_SIZE) break;

      if (freshBatch.length === 0 && freshChildren.length === 0) {
        if (++stalePages >= MAX_STALE_PAGES) break;
      } else {
        stalePages = 0;
      }
      startingIndex += numberReturned;
    }
  }

  return tracks;
}

/* ── Scan entry point ──────────────────────────────────────── */

export async function scanDlnaLibrary(
  db: SqlJsDatabase,
  servers: DlnaScanTarget[],
  onProgress?: DlnaProgress,
): Promise<DlnaScanResult> {
  /* An empty list means no DLNA source is enabled: drop every imported
     DLNA track (nothing else is touched). */
  if (servers.length === 0) {
    const removed = deleteStaleDlnaTracks(db, []);
    if (removed > 0) saveDb(db);
    return { added: 0, removed, total: getTotalFileCount(db), errors: [] };
  }

  didlSampleLogged = false;

  /* Phase 1 — locate each server's ContentDirectory control URL. */
  const controlUrls = new Map<DlnaScanTarget, string>();
  const errors: string[] = [];
  for (const target of servers) {
    /* Fire an immediate progress event so the UI shows which server
       is being worked on before the first Browse result arrives. */
    onProgress?.(0, target.name);
    try {
      let controlUrl: string;
      try {
        controlUrl = await resolveContentDirectoryControlUrl(target["control-url"]);
      } catch {
        /* The stored control URL went stale — re-resolve it from the
           device description URL discovered via SSDP */
        const fallback = target["description-url"] || "";
        if (!fallback) throw new Error(`No UPnP ContentDirectory service found at ${target["control-url"]}`);
          controlUrl = await resolveContentDirectoryControlUrl(fallback);
      }
      controlUrls.set(target, controlUrl);
    } catch (err) {
      const label = target.name || target["control-url"];
      errors.push(`${label}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  /* Phase 2 — the DNS magic, done centrally BEFORE any track is read:
     every server whose host reverse-resolves to a name that verifies
     forward gets its stream/art URLs persisted under that name instead
     of the raw IP; unresolvable hosts keep their IP-based URLs. */
  const aliases = new Map<DlnaScanTarget, { ip: string; host: string }>();
  await Promise.all([...controlUrls].map(async ([target, controlUrl]) => {
    try {
      const ip = ipLiteralOf(new URL(controlUrl).hostname);
      if (!ip) return;
      const host = await dnsNameForIp(ip);
      if (host) aliases.set(target, { ip, host });
    } catch { /* keep raw IP-based URLs */ }
  }));

  /* Phase 3 — enumerate and store. Only DISCOVERED tracks are written,
     under their final URL form; rows already in the database are never
     modified. */
  const seenUrls = new Set<string>();
  let added = 0;
  let lastSave = Date.now();

  for (const target of servers) {
    const controlUrl = controlUrls.get(target);
    if (!controlUrl) continue; /* already reported as an error */
    try {
      /* Enumeration is slow: store each browse page's tracks right
         away and report them to the UI instead of waiting for the
         whole server to finish. */
      let foundForServer = 0;
      await enumerateDlnaAudioItems(controlUrl, undefined, {
        seenUrls,
        alias: aliases.get(target),
        onNewTracks: (batch) => {
          const { added: batchAdded, rows } = storeDlnaTracks(db, batch);
          added += batchAdded;
          foundForServer += batch.length;
          if (Date.now() - lastSave >= SAVE_INTERVAL_MS) {
            saveDb(db);
            lastSave = Date.now();
          }
          onProgress?.(foundForServer, target.name, rows);
        },
      });
    } catch (err) {
      const label = target.name || target["control-url"];
      errors.push(`${label}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  /* Stale cleanup runs against everything discovered in this run; a
     server that failed mid-enumeration keeps its already-found tracks. */
  const removed = deleteStaleDlnaTracks(db, [...seenUrls]);
  saveDb(db);

  return { added, removed, total: getTotalFileCount(db), errors };
}

/* ── Duration gap fixup (layer 2 of 3) ─────────────────────── */
/* Tracks whose duration is unknown (NULL) — e.g. MinimServer omits
   res@duration for some .m4a files — get one ffprobe attempt per scan
   run / app start. Whatever still survives NULL is left for layer 3:
   the <audio> element at play time. */

const DURATION_FIXUP_CONCURRENCY = 3;
const DURATION_FFPROBE_TIMEOUT_MS = 30000;
/* A dead server must not turn the pass into a long retry storm: after
   this many probes in a row yielding nothing, the rest is skipped. */
const MAX_CONSECUTIVE_FFPROBE_FAILURES = 5;

export async function fixupMissingDurations(db: SqlJsDatabase): Promise<string[]> {
  const pending = getMissingDurationPaths(db);
  if (pending.length === 0) return [];
  dlnaDebug(`[dlna] duration fixup: probing ${pending.length} track(s) without a known length`);

  const fixed: string[] = [];
  let consecutiveFailures = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < pending.length && consecutiveFailures < MAX_CONSECUTIVE_FFPROBE_FAILURES) {
      const path = pending[next++]!;
      const dur = await tryFfprobeForDuration(path, DURATION_FFPROBE_TIMEOUT_MS);
      if (dur > 0 && fillMissingDuration(db, path, dur)) {
        fixed.push(path);
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DURATION_FIXUP_CONCURRENCY, pending.length) }, () => worker()),
  );

  if (consecutiveFailures >= MAX_CONSECUTIVE_FFPROBE_FAILURES) {
    dlnaDebug(`[dlna] duration fixup aborted early after ${MAX_CONSECUTIVE_FFPROBE_FAILURES} consecutive failures`);
  }
  dlnaDebug(`[dlna] duration fixup: learned ${fixed.length} duration(s)`);
  return fixed;
}
