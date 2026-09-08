/* ── Configurable external player ────────────────────────────── */

export const DEFAULT_EXTERNAL_PLAYER = "vlc";

let externalPlayer = DEFAULT_EXTERNAL_PLAYER;

export function getExternalPlayer(): string {
  return externalPlayer;
}

/* Short name for UI labels: last path segment without file extension,
 * e.g. "/i/like/my/vlc" → "vlc", "/opt/tools/play.sh" → "play". */
export function getExternalPlayerDisplayName(): string {
  const segment = externalPlayer.split("/").filter((part) => part.length > 0).pop();
  return (segment ?? externalPlayer).replace(/\.[^.\/]+$/, "");
}

export async function initExternalPlayer(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    const name = typeof data?.["external-player"] === "string" ? data["external-player"].trim() : "";
    if (name) externalPlayer = name;
  } catch { /* ignore */ }
}

export async function checkExternalPlayerCommand(name: string): Promise<boolean> {
  try {
    return await window.electronAPI.isExternalPlayerAvailable(name);
  } catch { return false; }
}

/* Persists the player name (assumed already validated by the caller). */
export async function saveExternalPlayer(name: string): Promise<void> {
  externalPlayer = name;
  try {
    await window.electronAPI.saveSettings({ "external-player": name });
  } catch { /* ignore */ }
}
