import { TreeNode } from "./types.js";
import { t } from "../common/i18n/index.js";

const FIXED_GROUP_LABELS = new Set([
  "grp-allfiles",
  "grp-search",
  "grp-most-played",
]);

function fixedGroupLabel(node: TreeNode): string {
  switch (node.id) {
    case "grp-allfiles":
      return t("All Tracks");
    case "grp-search":
      return t("Search Result");
    case "grp-most-played":
      return t("Most Played");
    default:
      return node.label;
  }
}

let contextMenuEl: HTMLElement | null = null;
function closeContextMenu(): void {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

export function renderGroups(
  container: HTMLElement,
  nodes: TreeNode[],
  onSelect: (node: TreeNode) => void,
  onDblClick?: (node: TreeNode) => void,
  selectedId?: string | null,
  getTracksForGroup?: (groupId: string) => Array<{ path: string; title: string; artist: string; duration: string }>,
  onShowInFolder?: (folderPath: string) => void,
  onRemove?: (node: TreeNode) => void,
): void {
  container.innerHTML = "";
  container.tabIndex = 0;

  container.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Delete" && onRemove) {
      const sel = container.querySelector("li.selected") as HTMLElement | null;
      if (!sel) return;
      const id = sel.dataset.id;
      if (!id || FIXED_GROUP_LABELS.has(id) || id.endsWith("-heading")) return;
      const node = nodes.find((n) => n.id === id);
      if (node) onRemove(node);
    }
  };

  for (const node of nodes) {
    const li = document.createElement("li");
    li.dataset.id = node.id;

    if (node.thumbnail) {
      const img = document.createElement("img");
      img.className = "group-cover";
      img.src = node.thumbnail;
      img.alt = "";
      li.appendChild(img);
    }

    const label = document.createElement("span");
    label.textContent = fixedGroupLabel(node);
    li.appendChild(label);

    if (node.id.endsWith("-heading")) {
      li.classList.add("group-heading");
    }

    if (node.id === selectedId) {
      li.classList.add("selected");
    }

    // Drag to playlist
    if (!node.id.endsWith("-heading") && getTracksForGroup) {
      li.draggable = true;
      li.addEventListener("dragstart", (e: DragEvent) => {
        const tracks = getTracksForGroup(node.id);
        if (tracks.length > 0) {
          e.dataTransfer!.setData("application/x-musicpenguin-track", JSON.stringify(tracks));
          e.dataTransfer!.effectAllowed = "copyMove";
        } else {
          e.preventDefault();
        }
      });
    }

    li.addEventListener("click", () => {
      if (node.id.endsWith("-heading")) return;
      container.focus();
      container.querySelectorAll(".selected").forEach((c) => c.classList.remove("selected"));
      li.classList.add("selected");
      onSelect(node);
    });

    li.addEventListener("dblclick", () => {
      if (node.id.endsWith("-heading")) return;
      onDblClick?.(node);
    });

    /* Folder groups derived from DLNA rows are URL prefixes with no
       physical directory to reveal — skip the menu entirely. */
    const folderPath = node.id.startsWith("grp-folder:")
      ? decodeURIComponent(node.id.slice("grp-folder:".length))
      : null;
    if (onShowInFolder && folderPath && !/^https?:\/\//i.test(folderPath)) {
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        const menu = document.createElement("div");
        menu.className = "context-menu";
        menu.style.left = e.clientX + "px";
        menu.style.top = e.clientY + "px";

        const showItem = document.createElement("div");
        showItem.className = "context-menu-item";
        showItem.textContent = t("Show in Folder");
        showItem.addEventListener("click", () => {
          closeContextMenu();
          onShowInFolder(folderPath);
        });
        menu.appendChild(showItem);

        menu.addEventListener("contextmenu", (ce) => ce.preventDefault());
        document.body.appendChild(menu);
        contextMenuEl = menu;

        const close = (ce: Event) => {
          if (contextMenuEl && !contextMenuEl.contains(ce.target as Node)) closeContextMenu();
        };
        setTimeout(() => {
          document.addEventListener("click", close);
          document.addEventListener("contextmenu", close);
        }, 0);
      });
    }

    container.appendChild(li);
  }
}
