import { FolderNode, scanFolders, flattenEnabled, fileCountLabel } from "./scanner.js";
import { t } from "./i18n/index.js";

let folders: FolderNode[] = [];

async function loadFolders(): Promise<FolderNode[]> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data) {
      return data.folders ?? [];
    }
  } catch { /* ignore */ }
  return [];
}

async function saveFolders(nodes: FolderNode[]): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    await window.electronAPI.saveSettings({ ...(data || {}), folders: nodes });
  } catch { /* ignore */ }
}

export function getFolders(): FolderNode[] {
  return folders;
}

export async function initFoldersDialog(
  onScanComplete: (count: number) => void,
): Promise<void> {
  const btn = document.getElementById("folders-btn")!;
  const overlay = document.getElementById("folders-overlay")!;
  const closeBtn = document.getElementById("folders-dialog-close")!;
  const addBtn = document.getElementById("folder-add-btn")!;
  const folderList = document.getElementById("folder-list")!;
  const scanResult = document.getElementById("status-text")!;

  folders = await loadFolders();
  let foldersChanged = false;

  async function runFullScan(): Promise<void> {
    const flat = flattenEnabled(folders);
    if (flat.length === 0) {
      scanResult.textContent = t("No enabled folders to scan. Check some folders first.");
      return;
    }

    scanResult.textContent = t("Scanning...");

    try {
      const { files } = await scanFolders(folders, (msg) => {
        scanResult.textContent = msg;
      });

      scanResult.textContent = t("Found $1 $2. Reading tags...", files.length, fileCountLabel(files.length));

      const result = await window.electronAPI.runIncrementalScan(files);

      onScanComplete(files.length);

      const parts = [
        t("Total files: $1.", result.total),
        result.errors > 0 ? " " + t("Errors: $1.", result.errors) : "",
        result.removed > 0 ? " " + t("Removed $1 missing $2.", result.removed, fileCountLabel(result.removed)) : "",
      ];
      scanResult.textContent = parts.filter(Boolean).join(" ");
    } catch (err) {
      scanResult.textContent = t("Scan failed: $1", err instanceof Error ? err.message : "unknown error");
    }
  }

  function persist(): void {
    saveFolders(folders);
  }

  // ----------------------------------------------------------------
  // Tree rendering
  // ----------------------------------------------------------------

  function setNodeEnabled(node: FolderNode, enabled: boolean): void {
    node.enabled = enabled;
    if (node.children) {
      for (const child of node.children) {
        setNodeEnabled(child, enabled);
      }
    }
  }

  function removeNodeFromTree(path: string, nodes: FolderNode[]): boolean {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.path === path) {
        nodes.splice(i, 1);
        return true;
      }
      if (nodes[i]!.children && removeNodeFromTree(path, nodes[i]!.children!)) {
        if (nodes[i]!.children!.length === 0) nodes[i]!.children = undefined;
        return true;
      }
    }
    return false;
  }

  function buildFolderItem(
    node: FolderNode,
    depth: number,
  ): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "folder-item";
    li.dataset.depth = String(depth);
    li.dataset.folderPath = node.path;
    li.tabIndex = 0;
    li.style.paddingLeft = `${8 + depth * 20}px`;

    li.addEventListener("click", () => {
      folderList.querySelectorAll(".folder-item").forEach((el) => el.classList.remove("selected"));
      li.classList.add("selected");
      li.focus();
    });

    const expandBtn = document.createElement("button");
    expandBtn.className = "btn-expand";
    expandBtn.title = t("Expand folder");
    const wasExpanded = !!(node.children && node.children.length > 0);
    if (wasExpanded) expandBtn.classList.add("expanded");
    expandBtn.textContent = wasExpanded ? "📂" : "📁";

    expandBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (expandBtn.classList.contains("expanded")) {
        expandBtn.classList.remove("expanded");
        expandBtn.textContent = "📁";
        expandBtn.title = t("Expand folder");
        removeChildren(li);
      } else {
        expandBtn.classList.add("expanded");
        expandBtn.textContent = "📂";
        expandBtn.title = t("Collapse folder");
        const subdirs = await window.electronAPI.listSubdirs(node.path);
        if (subdirs.length === 0) {
          expandBtn.classList.remove("expanded");
          expandBtn.textContent = "📁";
          expandBtn.title = t("Expand folder");
          node.children = [];
          return;
        }
        const oldChildren = new Map<string, FolderNode>();
        if (node.children) {
          for (const c of node.children) {
            oldChildren.set(c.path, c);
          }
        }
        node.children = subdirs.map((p) => {
          const existing = oldChildren.get(p);
          return existing ?? { path: p, enabled: true };
        });
        persist();
        foldersChanged = true;
        const childFragment = document.createDocumentFragment();
        for (const child of node.children) {
          childFragment.appendChild(buildFolderItem(child, depth + 1));
        }
        li.parentNode!.insertBefore(childFragment, li.nextSibling);
      }
    });

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "folder-check";
    cb.checked = node.enabled;
    cb.addEventListener("change", () => {
      setNodeEnabled(node, cb.checked);
      const parentDepth = Number(li.dataset.depth ?? 0);
      let next = li.nextElementSibling;
      while (
        next &&
        next.classList.contains("folder-item") &&
        Number((next as HTMLElement).dataset.depth ?? 0) > parentDepth
      ) {
        const childCheck = (next as HTMLElement).querySelector(".folder-check") as HTMLInputElement | null;
        if (childCheck) childCheck.checked = cb.checked;
        next = next.nextElementSibling;
      }
      persist();
      foldersChanged = true;
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "folder-name";
    nameSpan.textContent = folderCaption(node.path);

    li.appendChild(expandBtn);
    li.appendChild(cb);
    li.appendChild(nameSpan);
    return li;
  }

  function removeChildren(li: HTMLLIElement): void {
    const parentDepth = Number(li.dataset.depth ?? 0);
    let next = li.nextElementSibling;
    while (next && next.classList.contains("folder-item") && Number((next as HTMLElement).dataset.depth ?? 0) > parentDepth) {
      const toRemove = next;
      next = toRemove.nextElementSibling;
      toRemove.remove();
    }
  }

  function renderFolderTree(nodes: FolderNode[], depth: number, fragment: DocumentFragment): void {
    for (const n of nodes) {
      const li = buildFolderItem(n, depth);
      fragment.appendChild(li);
      if (n.children && n.children.length > 0) {
        renderFolderTree(n.children, depth + 1, fragment);
      }
    }
  }

  function renderFolderList(): void {
    folderList.innerHTML = "";
    if (folders.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = t("No folders added yet.");
      empty.style.color = "var(--text-secondary)";
      empty.style.fontSize = "0.82rem";
      empty.style.padding = "6px 8px";
      folderList.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    renderFolderTree(folders, 0, fragment);
    folderList.appendChild(fragment);
  }

  addBtn.addEventListener("click", async () => {
    const entry = await pickFolder();
    if (!entry) return;
    if (folders.some((f) => f.path === entry.path)) return;
    const newNode: FolderNode = { path: entry.path, enabled: true };
    try {
      const subdirs = await window.electronAPI.listSubdirs(entry.path);
      if (subdirs.length > 0) {
        newNode.children = subdirs.map((p) => ({
          path: p,
          enabled: true,
        }));
      }
    } catch { /* ignore — leave collapsed */ }
    folders.push(newNode);
    renderFolderList();
    persist();
    foldersChanged = true;
  });

  folderList.addEventListener("keydown", (e) => {
    if (e.key !== "Delete") return;
    const sel = folderList.querySelector(".folder-item.selected") as HTMLLIElement | null;
    if (!sel) return;
    const path = sel.dataset.folderPath;
    if (!path) return;
    if (removeNodeFromTree(path, folders)) {
      renderFolderList();
      persist();
      foldersChanged = true;
    }
    e.preventDefault();
  });

  renderFolderList();

  btn.addEventListener("click", () => {
    foldersChanged = false;
    overlay.classList.remove("hidden");
    window.electronAPI.stopTagRead();
  });

  function close(): void {
    overlay.classList.add("hidden");
    if (foldersChanged) {
      runFullScan();
    } else {
      window.electronAPI.startTagRead();
    }
  }

  closeBtn.addEventListener("click", close);
  document.getElementById("folders-dialog-ok")!.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });
}

export async function startupInit(onScanComplete: (count: number) => void): Promise<void> {
  const scanResult = document.getElementById("status-text")!;
  if (folders.length === 0) {
    scanResult.textContent = t("No folders configured.");
    return;
  }
  const existing = await window.electronAPI.loadFiles();
  if (existing && existing.length > 0) {
    onScanComplete(existing.length);
    await window.electronAPI.startTagRead();
  }
}

function folderCaption(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || "/";
}

async function pickFolder(): Promise<{ path: string } | null> {
  try {
    return await window.electronAPI.pickFolder();
  } catch {
    return null;
  }
}
