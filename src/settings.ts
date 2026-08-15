import { getLanguage, setLanguage, LANGUAGES } from "./i18n/index.js";

type Theme = "light" | "dark";

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
    const data = await window.electronAPI.loadSettings();
    await window.electronAPI.saveSettings({ ...(data || {}), theme });
  } catch { /* ignore */ }
}

async function saveLanguage(lang: string): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    await window.electronAPI.saveSettings({ ...(data || {}), language: lang });
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

  btn.addEventListener("click", () => {
    overlay.classList.remove("hidden");
  });

  function close(): void {
    overlay.classList.add("hidden");
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
}
