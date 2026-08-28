import * as dgram from "dgram";

import {
  elementText,
  findText,
  httpRequestBuffer,
  httpRequestText,
  parser,
} from "./dlna";

import type { XmlNode } from "./dlna";

/* ── SSDP discovery of UPnP/DLNA media servers ────────────────
 *
 * Sends M-SEARCH queries over UDP multicast (239.255.255.250:1900),
 * collects the unicast responses for a few seconds and resolves every
 * unique device-description LOCATION into a DlnaDiscoveredServer:
 * friendly name, ContentDirectory control URL and — when offered — the
 * device icon as a data URL. Only devices that actually expose a
 * ContentDirectory service (media servers) are returned; renderers and
 * other UPnP devices are filtered out during description parsing.
 */

const SSDP_MULTICAST_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const MSEARCH_SPACING_MS = 150;
const RESPONSE_WINDOW_MS = 3000;
const DISCOVERY_TIMEOUT_MS = 5000;
const ICON_MAX_BYTES = 512 * 1024;

/* Several targeted probes: "ssdp:all" alone is ignored by some servers,
   MediaServer/ContentDirectory targets reach the rest. */
const SEARCH_TARGETS = [
  "ssdp:all",
  "upnp:rootdevice",
  "urn:schemas-upnp-org:device:MediaServer:1",
  "urn:schemas-upnp-org:service:ContentDirectory:1",
];

export interface DlnaDiscoveredServer {
  name: string;
  /* Device description document URL — stable identity across restarts */
  location: string;
  /* Resolved ContentDirectory control URL */
  controlUrl: string;
  /* Device icon as a data URL, or null when none is offered */
  icon: string | null;
}

/* ── UDP multicast M-SEARCH ────────────────────────────────── */

function msearchMessage(searchTarget: string): string {
  return [
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_MULTICAST_ADDRESS}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    "MX: 2",
    `ST: ${searchTarget}`,
    "",
    "",
  ].join("\r\n");
}

interface SsdpHit {
  location: string;
  searchTarget: string;
}

function parseSsdpPacket(data: Buffer): SsdpHit | null {
  const lines = data.toString("utf8").split(/\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!(key in headers)) headers[key] = line.slice(idx + 1).trim();
  }
  const location = headers["location"] ?? "";
  if (!/^https?:\/\//i.test(location)) return null;
  return { location, searchTarget: headers["st"] ?? "" };
}

function sendMsearch(socket: dgram.Socket, searchTarget: string): void {
  const message = Buffer.from(msearchMessage(searchTarget), "utf8");
  socket.send(message, 0, message.length, SSDP_PORT, SSDP_MULTICAST_ADDRESS);
}

function collectResponses(): Promise<SsdpHit[]> {
  return new Promise((resolve) => {
    const hits = new Map<string, string>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      try { socket.close(); } catch { /* already closed */ }
      const out: SsdpHit[] = [];
      for (const [location, searchTarget] of hits) out.push({ location, searchTarget });
      resolve(out);
    };

    socket.on("error", finish);
    socket.on("message", (data) => {
      const hit = parseSsdpPacket(data);
      if (!hit) return;
      /* Multiple announcements share one LOCATION — keep the first */
      if (!hits.has(hit.location)) hits.set(hit.location, hit.searchTarget);
    });

    socket.bind(() => {
      try { socket.setMulticastTTL(4); } catch { /* best-effort */ }
      let delay = 0;
      for (const target of SEARCH_TARGETS) {
        setTimeout(() => {
          if (!finished) sendMsearch(socket, target);
        }, delay);
        delay += MSEARCH_SPACING_MS;
      }
      setTimeout(finish, delay + RESPONSE_WINDOW_MS);
    });
  });
}

/* ── Device description parsing ────────────────────────────── */

/* Direct child elements by tag name (no descent into children) */
function directAll(node: unknown, tag: string): XmlNode[] {
  if (node === null || typeof node !== "object") return [];
  const raw = (node as XmlNode)[tag];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: XmlNode[] = [];
  for (const v of values) {
    if (typeof v === "object" && v !== null) out.push(v as XmlNode);
  }
  return out;
}

/* Depth-first list of every <device> element. The parsed document wraps
   everything in container elements ({ "?xml": ..., root: ... }), so the
   walk descends through ALL child objects instead of assuming a fixed
   document shape. Pre-order traversal pushes outer devices before their
   embedded ones, letting callers prefer the most specific device by
   scanning the list from the back. */
function collectDevices(parent: unknown): XmlNode[] {
  const found: XmlNode[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 15) return;
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as XmlNode)) {
      if (key === "#text" || key.startsWith("?")) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v === null || typeof v !== "object") continue;
        const child = v as XmlNode;
        if (key === "device") found.push(child);
        visit(child, depth + 1);
      }
    }
  };
  visit(parent, 0);
  return found;
}

function servicesOf(device: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  for (const serviceList of directAll(device, "serviceList")) {
    out.push(...directAll(serviceList, "service"));
  }
  return out;
}

function contentDirectoryControlUrl(device: XmlNode, baseUrl: string): string | null {
  for (const service of servicesOf(device)) {
    const serviceType = findText(service, "serviceType");
    if (!/ContentDirectory/i.test(serviceType)) continue;
    const controlUrl = findText(service, "controlURL");
    if (!controlUrl) continue;
    try {
      return new URL(controlUrl, baseUrl).toString();
    } catch { /* malformed URL — try next service */ }
  }
  return null;
}

function hostnameFrom(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return urlStr;
  }
}

/* ── Device icons ──────────────────────────────────────────── */

interface IconCandidate {
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

function iconCandidates(device: XmlNode, baseUrl: string): IconCandidate[] {
  const out: IconCandidate[] = [];
  for (const iconList of directAll(device, "iconList")) {
    for (const icon of directAll(iconList, "icon")) {
      const rawUrl = elementText((icon as XmlNode)["url"]).trim();
      if (!rawUrl) continue;
      try {
        const width = parseInt(elementText((icon as XmlNode)["width"]).trim(), 10);
        const height = parseInt(elementText((icon as XmlNode)["height"]).trim(), 10);
        out.push({
          url: new URL(rawUrl, baseUrl).toString(),
          mimeType: elementText((icon as XmlNode)["mimetype"]).trim().toLowerCase(),
          width: Number.isFinite(width) ? width : 0,
          height: Number.isFinite(height) ? height : 0,
        });
      } catch { /* malformed URL — skip this icon */ }
    }
  }
  return out;
}

/* Prefer raster images, largest first */
function iconRank(candidate: IconCandidate): number {
  const raster = /image\/(png|jpeg|jpg)/.test(candidate.mimeType) ? 1e9 : 0;
  return raster + candidate.width * candidate.height;
}

function sniffImageMimeType(bytes: Buffer, fallback: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "GIF8") {
    return "image/gif";
  }
  return fallback.startsWith("image/") ? fallback : "image/png";
}

async function loadIconDataUrl(candidate: IconCandidate): Promise<string | null> {
  try {
    const res = await httpRequestBuffer(candidate.url, DISCOVERY_TIMEOUT_MS);
    if (res.status !== 200 || res.body.length === 0 || res.body.length > ICON_MAX_BYTES) {
      return null;
    }
    const mimeType = sniffImageMimeType(res.body, candidate.mimeType || res.contentType);
    return `data:${mimeType};base64,${res.body.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadBestIcon(device: XmlNode, baseUrl: string): Promise<string | null> {
  const candidates = iconCandidates(device, baseUrl)
    .sort((a, b) => iconRank(b) - iconRank(a));
  for (const candidate of candidates) {
    const dataUrl = await loadIconDataUrl(candidate);
    if (dataUrl) return dataUrl;
  }
  return null;
}

/* ── Server resolution ─────────────────────────────────────── */

async function describeServer(location: string): Promise<DlnaDiscoveredServer | null> {
  const res = await httpRequestText(
    location,
    "GET",
    { "User-Agent": "MusicPenguin", Accept: "*/*" },
    undefined,
    DISCOVERY_TIMEOUT_MS,
  );
  if (res.status !== 200) return null;

  let root: unknown;
  try {
    root = parser.parse(res.body);
  } catch {
    return null;
  }

  /* Deepest device offering a ContentDirectory service wins: embedded
     device names tend to be more specific than the root device name.
     Icons often sit on an ancestor device, so if the matched one has
     none the ancestors are probed as well (pre-order puts them before
     their children in the list). */
  const devices = collectDevices(root);
  for (let i = devices.length - 1; i >= 0; i--) {
    const device = devices[i]!;
    const controlUrl = contentDirectoryControlUrl(device, location);
    if (!controlUrl) continue;
    const name = findText(device, "friendlyName") || hostnameFrom(location);
    let icon = await loadBestIcon(device, location);
    for (let j = i - 1; j >= 0 && !icon; j--) {
      icon = await loadBestIcon(devices[j]!, location);
    }
    return { name, location, controlUrl, icon };
  }
  return null;
}

/* Search the network once and describe every responding device.
   Unreachable hosts time out independently (allSettled) and simply
   contribute nothing. Results are sorted by name for a stable list. */
export async function discoverDlnaServers(): Promise<DlnaDiscoveredServer[]> {
  const hits = await collectResponses();
  if (hits.length === 0) return [];

  const described = await Promise.allSettled(hits.map((hit) => describeServer(hit.location)));
  const servers = new Map<string, DlnaDiscoveredServer>();
  for (const result of described) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const server = result.value;
    if (!servers.has(server.controlUrl)) servers.set(server.controlUrl, server);
  }

  return [...servers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
