import { t } from "../common/i18n/index.js";

const SEARCH_TAG_IDS = ["search-tag-title", "search-tag-artist", "search-tag-album", "search-tag-album-artist", "search-tag-composer", "search-tag-conductor", "search-tag-year", "search-tag-genre", "search-tag-comment", "search-tag-path"];

let searchQuery = "";
let regexMode = false;

async function persistState(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      "search-query": searchQuery,
      "search-regex": regexMode,
      "search-tag-columns": Object.fromEntries(SEARCH_TAG_IDS.map((id) => [id, (document.getElementById(id) as HTMLInputElement)?.checked ?? true])),
    });
  } catch { /* ignore */ }
}

export async function initSearchPanel(
  onSearch?: (query: string, regex: boolean) => void,
): Promise<void> {
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
  const regexBtn = document.getElementById("regex-btn") as HTMLButtonElement;
  if (!searchInput || !searchBtn || !regexBtn) return;

  try {
    const data = await window.electronAPI.loadSettings();
    if (typeof data?.["search-query"] === "string") searchQuery = data["search-query"];
    searchInput.value = searchQuery;
    if (typeof data?.["search-regex"] === "boolean") regexMode = data["search-regex"];
    if (regexMode) regexBtn.classList.add("active");
    const tagStates = data?.["search-tag-columns"] as Record<string, boolean> | undefined;
    if (tagStates) {
      for (const id of SEARCH_TAG_IDS) {
        const cb = document.getElementById(id) as HTMLInputElement | null;
        if (cb && typeof tagStates[id] === "boolean") cb.checked = tagStates[id]!;
      }
    }
  } catch { /* ignore */ }

  validateRegex();
  updateSearchBtn();

  function updateSearchBtn(): void {
    searchBtn.disabled = !searchInput.value.trim();
  }

  for (const tagId of SEARCH_TAG_IDS) {
    const cb = document.getElementById(tagId) as HTMLInputElement | null;
    cb?.addEventListener("change", () => persistState());
  }

  function validateRegex(): void {
    if (regexMode && searchInput.value.trim()) {
      try {
        new RegExp(searchInput.value.trim(), "i");
        searchInput.classList.remove("regex-invalid");
      } catch {
        searchInput.classList.add("regex-invalid");
      }
    } else {
      searchInput.classList.remove("regex-invalid");
    }
  }

  regexBtn.addEventListener("click", () => {
    regexMode = !regexMode;
    regexBtn.classList.toggle("active", regexMode);
    validateRegex();
    persistState();
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener("focus", () => {
    searchInput.select();
  });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    validateRegex();
    updateSearchBtn();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => persistState(), 500);
  });

  function runSearch(): void {
    if (!searchInput.value.trim()) return;
    if (searchInput.classList.contains("regex-invalid")) {
      alert(t("Invalid regular expression."));
      return;
    }
    const q = searchInput.value.trim();
    searchQuery = q;
    onSearch?.(q, regexMode);
    persistState();
  }

  searchBtn.addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
}
