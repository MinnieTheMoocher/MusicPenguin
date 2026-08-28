import { getLanguage, setLanguage, t, LANGUAGES } from "./i18n/index.js";
import { initDebugLog } from "./debug-log.js";
import { getExternalPlayer, checkExternalPlayerCommand, saveExternalPlayer } from "./external-player.js";
import { getMinAutoplayRating, initMinAutoplayRating, saveMinAutoplayRating } from "./min-autoplay-rating.js";
import { resetNowPlayingWidget } from "./now-playing.js";
import { showDetails } from "./detail-panel.js";

type Theme = "light" | "dark";

let onDbClearedCb: (() => void) | null = null;
export function setOnDatabaseCleared(cb: () => void): void {
  onDbClearedCb = cb;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme =
    theme === "light" ? "light" : "";
}

async function loadTheme(): Promise<Theme> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data) {
      return data.theme as Theme;
    }
  } catch { /* ignore */ }
  return "dark";
}

async function saveTheme(theme: Theme): Promise<void> {
  try {
    await window.electronAPI.saveSettings({ theme });
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
  const toggle = document.getElementById("dark-toggle") as HTMLInputElement;
  const langSelect = document.getElementById("language-select") as HTMLSelectElement;

  const savedTheme = await loadTheme();
  applyTheme(savedTheme);
  toggle.checked = savedTheme !== "light";

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
    warning.textContent = "⚠️";

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
    cancelBtn.className = "delete-dialog-btn";
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
    document.getElementById("status-text")!.textContent = "";
  }

  closeBtn.addEventListener("click", close);
  document.getElementById("dialog-ok")!.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });

  toggle.addEventListener("change", () => {
    const theme: Theme = toggle.checked ? "dark" : "light";
    applyTheme(theme);
    saveTheme(theme);
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
