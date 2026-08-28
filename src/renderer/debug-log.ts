let enabled = false;

export async function initDebugLog(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    enabled = data?.["debug-log"] === true;
  } catch { /* ignore */ }
}

export function isDebugLogEnabled(): boolean {
  return enabled;
}

export function debugLog(...args: unknown[]): void {
  if (!enabled) return;
  const ts = new Date().toISOString();
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  window.electronAPI.debugLog(`${ts} ${msg}`).catch(() => {});
}
