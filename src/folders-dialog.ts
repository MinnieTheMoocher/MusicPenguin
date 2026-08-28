import { FolderNode, fileCountLabel, saveDlnaServers, loadDlnaServers, loadFolders, runFullScan, subscribeDlnaProgress, subscribeDlnaServerChanges } from "./scanner.js";
import { DLNA_SERVER } from "./icons.js";
import { t } from "./i18n/index.js";
import { debugLog } from "./debug-log.js";

let folders: FolderNode[] = [];

async function saveFolders(nodes: FolderNode[]): Promise<void> {
  try {
    await window.electronAPI.saveSettings({ folders: nodes });
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
  const dlnaList = document.getElementById("dlna-server-list") as HTMLUListElement;
  const dlnaSection = document.getElementById("dlna-section") as HTMLElement;
  const scanResult = document.getElementById("status-text")!;

  folders = await loadFolders();
  let dlnaServers: DlnaServerEntry[] = await loadDlnaServers();
  let foldersChanged = false;

  /* Live progress while a DLNA server is being enumerated (the dialog
     is usually closed already by then, so this feeds the status bar).
     Only tracks DISCOVERED SO FAR are shown — the total is unknowable
     while enumerating, so it is never implied. */
  subscribeDlnaProgress((found, name) => {
    scanResult.textContent = t("Scanning audio server $1: $2 $3", name ?? "", found, fileCountLabel(found));
  });

  async function runDialogScan(): Promise<void> {
    scanResult.textContent = t("Scanning...");

    const result = await runFullScan({
      folders,
      dlnaServers,
      onProgress: (msg) => { scanResult.textContent = msg; },
    });

    try {
      await onScanComplete(0);
    } catch (err) {
      debugLog("[scan] onScanComplete failed:", err instanceof Error ? err.message : String(err));
    }

    const parts: string[] = [];
    parts.push(t("$1 tracks in library.", result.total));
    if (result.removed > 0) parts.push(t("$1 removed.", result.removed));
    if (result.errors > 0) parts.push(t("$1 errors.", result.errors));
    scanResult.textContent = parts.join(" ");
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

  // ----------------------------------------------------------------
  // DLNA servers (SSDP discovery + per-server enable checkboxes)
  // ----------------------------------------------------------------

  function hostFromUrl(urlStr: string): string {
    try {
      return new URL(urlStr).host;
    } catch {
      return "";
    }
  }

  function buildDlnaItem(entry: DlnaServerEntry): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "dlna-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "folder-check";
    cb.checked = entry.enabled;
    cb.title = t("Enabled");
    cb.addEventListener("change", () => {
      entry.enabled = cb.checked;
      void saveDlnaServers(dlnaServers);
      foldersChanged = true;
    });

    const iconSpan = document.createElement("span");
    iconSpan.className = "dlna-icon";
    const img = document.createElement("img");
    /* Icon persisted with the entry (captured during discovery), so it
       renders immediately even before the next search finishes. */
    img.src = entry["icon-url"] || DLNA_SERVER;
    img.alt = "";
    img.draggable = false;
    iconSpan.appendChild(img);

    /* Friendly server name only — no IP/port in the UI. Falls back to
       the URL-derived host only when the server announced no name. */
    const nameSpan = document.createElement("span");
    nameSpan.className = "dlna-name";
    nameSpan.textContent = entry.name || hostFromUrl(entry["control-url"]) || entry["control-url"];
    nameSpan.title = entry.name;

    li.appendChild(cb);
    li.appendChild(iconSpan);
    li.appendChild(nameSpan);
    return li;
  }

  function renderDlnaList(): void {
    /* The whole DLNA section stays hidden until at least one server is
       known — discovered by the background search or persisted from an
       earlier session — so users without such servers are never
       bothered by it. */
    dlnaSection.classList.toggle("hidden", dlnaServers.length === 0);
    const fragment = document.createDocumentFragment();
    for (const entry of dlnaServers) {
      fragment.appendChild(buildDlnaItem(entry));
    }
    dlnaList.replaceChildren(fragment);
  }

  /* Discovery lives in the main process: it searches in the background
     at app start, persists what it found and pushes here. The dialog
     only renders the persisted list and follows those updates while
     open — it never searches itself. */
  subscribeDlnaServerChanges(() => {
    void loadDlnaServers().then((servers) => {
      dlnaServers = servers;
      renderDlnaList();
    });
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
  renderDlnaList();

  btn.addEventListener("click", () => {
    foldersChanged = false;
    overlay.classList.remove("hidden");
    window.electronAPI.stopTagRead();
    renderDlnaList();
  });

  async function close(): Promise<void> {
    overlay.classList.add("hidden");
    if (foldersChanged) {
      runDialogScan();
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
