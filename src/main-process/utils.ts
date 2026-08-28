import * as path from "path";
import * as fs from "fs";
import * as dns from "dns";
import * as net from "net";
import { execSync, execFileSync } from "child_process";

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

/* ── IP → DNS name resolution ──────────────────────────────── */

const DNS_LOOKUP_TIMEOUT_MS = 2500;

function isIpLiteral(token: string): boolean {
  return net.isIP(token.replace(/^\[/, "").replace(/\]$/, "")) > 0;
}

function normalizeIp(ip: string): string {
  return ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
}

export function ipLiteralOf(hostname: string): string | null {
  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return net.isIP(bare) ? bare : null;
}

/* Forward verification: does `name` resolve back to `ip`? All
   addresses are compared — dual-stack names legitimately map to
   several addresses. */
async function resolvesTo(name: string, ip: string): Promise<boolean> {
  try {
    const resolved = await withTimeout(dns.promises.lookup(name, { all: true }), DNS_LOOKUP_TIMEOUT_MS);
    return resolved.some((entry) => normalizeIp(entry.address) === normalizeIp(ip));
  } catch {
    return false;
  }
}

/* FRITZ!Box special case: AVM routers announce LAN hosts in their DNS
   as "<name>.fritz.box", but the bare "<name>" usually resolves just as
   well (search domain, mDNS). Every name ending in that suffix also
   contributes its stripped variant as a candidate, so the SHORTEST
   verified name — here the bare one — is preferred for stored URLs. */
export function expandFritzBoxCandidates(names: string[]): string[] {
  const out = new Set<string>(names);
  for (const name of names) {
    const bare = name.replace(/\.fritz\.box$/i, "");
    if (bare !== name && bare) out.add(bare);
  }
  return [...out];
}

/* Reverse lookup of `ip` through two independent sources, merged:
   dns.reverse() returns the full PTR record list (a host can announce
   several names), while dns.lookupService() wraps getnameinfo(3) and
   therefore walks the full NSS chain — /etc/hosts, mDNS (.local),
   systemd-resolved, unicast DNS. Every candidate must verify forward
   (resolve back to `ip`) to be accepted; when several do, the SHORTEST
   name wins so stored URLs stay compact and readable. When nothing
   resolves, getnameinfo (without NI_NAMEREQD) yields the literal
   address back instead of failing, so literals are rejected. */
export async function dnsNameForIp(ip: string): Promise<string | null> {
  const [reversed, nss] = await Promise.allSettled([
    withTimeout(dns.promises.reverse(ip), DNS_LOOKUP_TIMEOUT_MS),
    withTimeout(dns.promises.lookupService(ip, 0), DNS_LOOKUP_TIMEOUT_MS).then((r) => [r.hostname]),
  ]);

  const candidates = new Set<string>();
  for (const source of [reversed, nss]) {
    if (source.status !== "fulfilled") continue;
    for (const name of source.value) {
      const clean = String(name ?? "").replace(/\.$/, "");
      if (!clean || isIpLiteral(clean)) continue;
      candidates.add(clean);
    }
  }

  /* Shortest first (FRITZ!Box variants included), ties broken
     alphabetically for determinism; the first candidate that resolves
     back to `ip` is used. */
  const ordered = expandFritzBoxCandidates([...candidates]).sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  for (const name of ordered) {
    if (await resolvesTo(name, ip)) return name;
  }
  return null;
}

/* Swaps the hostname of a URL while keeping scheme, port and path —
   but only when that hostname IS the given IP literal. Relative or
   foreign URLs pass through unchanged. */
export function withAliasedHost(urlStr: string, ip: string, dnsName: string): string {
  try {
    const url = new URL(urlStr);
    if (ipLiteralOf(url.hostname) !== ip) return urlStr;
    url.hostname = dnsName;
    return url.toString();
  } catch {
    return urlStr;
  }
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

/* Checks user-provided command names/paths via `command -v` (shell-safe). */
export function isExecutableCommand(cmd: string): boolean {
  const name = cmd.trim();
  if (!name) return false;
  try {
    execFileSync("sh", ["-c", 'command -v "$1"', "sh", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
