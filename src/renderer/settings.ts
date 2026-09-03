import { getLanguage, setLanguage, t, LANGUAGES } from "../common/i18n/index.js";
import { initDebugLog } from "./debug-log.js";
import { getExternalPlayer, checkExternalPlayerCommand, saveExternalPlayer } from "./external-player.js";
import { getMinAutoplayRating, initMinAutoplayRating, saveMinAutoplayRating } from "./min-autoplay-rating.js";
import { resetNowPlayingWidget } from "./now-playing.js";
import { showDetails } from "./detail-panel.js";
import { ICON_WARNING } from "./icons.js";

interface DesignEntry {
  id: string;
  path: string;
  href: string;
}

interface DesignList {
  builtin: DesignEntry[];
  custom: DesignEntry[];
}

const designHrefs = new Map<string, string>();

/** Folder name → UI label: underscores → spaces, each word capitalized. */
function designDisplayName(id: string): string {
  const words = id.split("_").filter(Boolean);
  return words.length === 0
    ? id
    : words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
}

function applyDesign(id: string, animate = false): void {
  const el = document.getElementById("design-css");
  if (!el) return;
  const href = designHrefs.get(id);
  if (!href) return;
  const swap = (): void => el.setAttribute("href", href);
  if (animate && "startViewTransition" in document) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
}

let onDbClearedCb: (() => void) | null = null;
export function setOnDatabaseCleared(cb: () => void): void {
  onDbClearedCb = cb;
}

async function loadSavedDesignId(): Promise<string> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data && typeof data.design === "string") {
      return data.design;
    }
  } catch { /* ignore */ }
  return "dark_gray";
}

async function saveDesign(id: string): Promise<void> {
  try {
    await window.electronAPI.saveSettings({ design: id });
  } catch { /* ignore */ }
}

async function saveLanguage(lang: string): Promise<void> {
  try {
    await window.electronAPI.saveSettings({ language: lang });
  } catch { /* ignore */ }
}

export async function initSettings(): Promise<void> {
  const btn = document.getElementById("settings-btn")!;
  const overlay = document.getElementById("settings-overlay")!;
  const closeBtn = document.getElementById("dialog-close")!;
  const designSelect = document.getElementById("design-select") as HTMLSelectElement;
  const langSelect = document.getElementById("language-select") as HTMLSelectElement;

  /* ── Design: runtime discovery (built-in + custom folders) ──
     Re-queried every time the settings dialog is opened, so the dropdown
     always reflects the real folder contents (incl. added/removed symlinks). */
  let designLists: DesignList = { builtin: [], custom: [] };

  function fillDesignOptions(): void {
    const current = designSelect.value;
    designSelect.replaceChildren();
    for (const [label, entries] of [
      [t("Built-In"), designLists.builtin],
      [t("Custom"), designLists.custom],
    ] as Array<[string, DesignEntry[]]>) {
      if (entries.length === 0) continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const entry of entries) {
        const opt = document.createElement("option");
        opt.value = entry.id;
        opt.textContent = designDisplayName(entry.id);
        opt.title = entry.path;
        group.appendChild(opt);
      }
      designSelect.appendChild(group);
    }
    designSelect.value = designHrefs.has(current) && current !== "" ? current : defaultDesignId();
  }

  async function refreshDesigns(): Promise<void> {
    try {
      designLists = await window.electronAPI.listDesigns();
    } catch { /* ignore */ }
    designHrefs.clear();
    for (const d of [...designLists.builtin, ...designLists.custom]) {
      designHrefs.set(d.id, d.href);
    }
    fillDesignOptions();
  }

  function defaultDesignId(): string {
    if (designHrefs.has(savedDesign)) return savedDesign;
    const href = decodeStartupDesignHref();
    if (href) {
      for (const d of [...designLists.builtin, ...designLists.custom]) {
        if (d.href === href) return d.id;
      }
    }
    return designHrefs.has("dark_gray") ? "dark_gray" : (designHrefs.keys().next().value ?? "");
  }

  /** The startup `?design=` value is a base64-encoded stylesheet href
      (see src/main/index.ts) — decode it back to compare against discovery. */
  function decodeStartupDesignHref(): string | null {
    const q = new URLSearchParams(location.search).get("design");
    if (!q) return null;
    try {
      const bin = atob(q);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  const savedDesign = await loadSavedDesignId();
  await refreshDesigns();
  if (designHrefs.has(savedDesign)) {
    applyDesign(savedDesign);
  }
  document.addEventListener("language-changed", fillDesignOptions);

  for (const lang of Object.values(LANGUAGES).sort((a, b) => a.label.localeCompare(b.label))) {
    const opt = document.createElement("option");
    opt.value = lang.key;
    opt.textContent = lang.label;
    langSelect.appendChild(opt);
  }
  langSelect.value = getLanguage();
  langSelect.addEventListener("change", () => {
    const lang = langSelect.value;
    setLanguage(lang);
    saveLanguage(lang);
  });

  /* ── Minimum autoplay rating ───────────────────────────────── */
  const minRatingSelect = document.getElementById("min-autoplay-rating-select") as HTMLSelectElement;
  /* "0.5 stars" / "1 star" / "2 stars" — singular and plural,
     always with a "." as decimal separator. */
  function starCountLabel(v: number): string {
    return t(v === 1 ? "$1 star" : "$1 stars", String(v));
  }

  function fillMinRatingOptions(): void {
    const selected = minRatingSelect.value;
    minRatingSelect.replaceChildren();
    const noLimit = document.createElement("option");
    noLimit.value = "";
    noLimit.textContent = t("No limit");
    minRatingSelect.appendChild(noLimit);
    for (let v = 0.5; v <= 5.001; v += 0.5) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = starCountLabel(v);
      minRatingSelect.appendChild(opt);
    }
    minRatingSelect.value = selected;
  }

  await initMinAutoplayRating();
  fillMinRatingOptions();
  minRatingSelect.value = getMinAutoplayRating() === null ? "" : String(getMinAutoplayRating());
  document.addEventListener("language-changed", fillMinRatingOptions);
  minRatingSelect.addEventListener("change", () => {
    const raw = minRatingSelect.value;
    const v = raw === "" ? null : parseFloat(raw);
    if (raw !== "" && (isNaN(v!) || v! < 0.5 || v! > 5)) return;
    void saveMinAutoplayRating(v);
  });

  /* ── Playback bar position (top | bottom) ─────────────────── */
  const barPosSelect = document.getElementById("playback-bar-position-select") as HTMLSelectElement;

  function applyPlaybackBarPosition(pos: string): void {
    document.getElementById("app")!.classList.toggle("np-bottom", pos === "bottom");
  }

  async function savePlaybackBarPosition(pos: string): Promise<void> {
    try {
      await window.electronAPI.saveSettings({ "playback-bar-position": pos });
    } catch { /* ignore */ }
  }

  let barPos = "top";
  try {
    const data = await window.electronAPI.loadSettings();
    if (data?.["playback-bar-position"] === "bottom") barPos = "bottom";
  } catch { /* ignore */ }
  barPosSelect.value = barPos;
  applyPlaybackBarPosition(barPos);
  barPosSelect.addEventListener("change", () => {
    barPos = barPosSelect.value === "bottom" ? "bottom" : "top";
    applyPlaybackBarPosition(barPos);
    void savePlaybackBarPosition(barPos);
  });

  btn.addEventListener("click", () => {
    overlay.classList.remove("hidden");
    btn.classList.add("active");
    void refreshDesigns();
  });

  /* ── Empty Database ───────────────────────────────────────── */
  document.getElementById("empty-db-btn")!.addEventListener("click", () => showEmptyDatabaseDialog(close));

  function showEmptyDatabaseDialog(closeSettings: () => void): void {
    const existing = document.querySelector(".delete-dialog-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "delete-dialog-overlay";

    const box = document.createElement("div");
    box.className = "delete-dialog-box";

    const warning = document.createElement("div");
    warning.className = "delete-dialog-warning";
    warning.innerHTML = ICON_WARNING;

    const question = document.createElement("div");
    question.className = "delete-dialog-question";
    question.textContent = t("Are you sure to empty the MusicPenguin library? This will mean you have to scan your folders or audio servers again for audio files, and you will lose all your ratings and play counts. Your selected audio folders and servers will be preserved, though, as they are not part of the library but your user settings. You can scan them again to re-fill your database.");

    const btnRow = document.createElement("div");
    btnRow.className = "delete-dialog-buttons";

    const yesBtn = document.createElement("button");
    yesBtn.className = "delete-dialog-btn delete-dialog-btn-danger";
    yesBtn.textContent = t("Yes, empty it");
    yesBtn.addEventListener("click", async () => {
      close();
      await window.electronAPI.clearDatabase();
      resetNowPlayingWidget();
      showDetails(null);
      onDbClearedCb?.();
      closeSettings();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-primary";
    cancelBtn.textContent = t("Cancel");
    cancelBtn.addEventListener("click", () => close());

    btnRow.appendChild(yesBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(warning);
    box.appendChild(question);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && overlay.parentElement) close();
    };
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onEsc);
    }
    document.addEventListener("keydown", onEsc);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  function close(): void {
    overlay.classList.add("hidden");
    btn.classList.remove("active");
    document.getElementById("status-text")!.textContent = "";
  }

  closeBtn.addEventListener("click", close);
  document.getElementById("dialog-ok")!.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden") && !document.querySelector(".delete-dialog-overlay")) close();
  });

  designSelect.addEventListener("change", () => {
    const id = designSelect.value;
    if (!id) return;
    applyDesign(id, true);
    saveDesign(id);
  });

  /* ── External player ───────────────────────────────────────── */
  const playerInput = document.getElementById("external-player-input") as HTMLInputElement;
  playerInput.value = getExternalPlayer();

  const markPlayerValidity = async (): Promise<void> => {
    const name = playerInput.value.trim();
    const ok = name.length > 0 && await checkExternalPlayerCommand(name);
    playerInput.classList.toggle("invalid-command", !ok);
  };
  void markPlayerValidity();

  // validate on every edit; persist once the value is a valid command
  let playerSaveTimer: ReturnType<typeof setTimeout> | null = null;
  playerInput.addEventListener("input", () => {
    void markPlayerValidity();
    if (playerSaveTimer !== null) clearTimeout(playerSaveTimer);
    playerSaveTimer = setTimeout(async () => {
      const name = playerInput.value.trim();
      if (name.length > 0 && await checkExternalPlayerCommand(name)) {
        await saveExternalPlayer(name);
      }
    }, 400);
  });

  /* ── Debug log toggle ─────────────────────────────────────── */
  await initDebugLog();
  const debugToggle = document.getElementById("debug-log-toggle") as HTMLInputElement;
  const savedDebug = await window.electronAPI.loadSettings();
  debugToggle.checked = savedDebug?.["debug-log"] === true;

  debugToggle.addEventListener("change", async () => {
    await window.electronAPI.saveSettings({ "debug-log": debugToggle.checked });
    await initDebugLog();
    if (debugToggle.checked) {
      const ts = new Date().toISOString();
      window.electronAPI.debugLog(`${ts} [diag] Debug log enabled by user`).catch(() => {});
    }
  });
}
