const GROUPS_MIN = 200;
const GROUPS_MAX = 600;
const LIST_MIN = 100;
const PLAYLIST_MIN = 256;
const PLAYLIST_MAX = 500;

const app = document.getElementById("app")!;
const dividerV = document.querySelector(".divider-v") as HTMLElement;
const dividerV2 = document.querySelector(".playlist-divider") as HTMLElement;
const dividerH = document.querySelector(".divider-h") as HTMLElement;
const handle = document.getElementById("handle")!;
const handleRight = document.getElementById("handle-right")!;

/* ── Groups ──────────────────────────────────────────────── */
function readCssVar(name: string): number {
  return parseFloat(getComputedStyle(app).getPropertyValue(name));
}

function getGroupsWidth(): number {
  return readCssVar("--groups-w");
}

function setGroupsWidth(px: number): void {
  app.style.setProperty("--groups-w", Math.max(GROUPS_MIN, Math.min(GROUPS_MAX, px)) + "px");
}

/* ── List height ───────────────────────────────────────── */
function getListHeight(): number {
  return readCssVar("--list-h");
}

function setListHeight(px: number): void {
  const maxH = Math.round(window.innerHeight * 0.8);
  app.style.setProperty("--list-h", Math.max(LIST_MIN, Math.min(maxH, px)) + "px");
}

/* ── Playlist width ────────────────────────────────────── */
function getPlaylistWidth(): number {
  return readCssVar("--playlist-w");
}

function setPlaylistWidth(px: number): void {
  app.style.setProperty("--playlist-w", Math.max(PLAYLIST_MIN, Math.min(PLAYLIST_MAX, px)) + "px");
}

/* ── Persistence ────────────────────────────────────────── */
async function saveSplitterState(): Promise<void> {
  try {
    await window.electronAPI.saveSettings({
      "groups-width": getGroupsWidth(),
      "list-height": getListHeight(),
      "playlist-width": getPlaylistWidth(),
    });
  } catch { /* best-effort */ }
}

export async function loadSplitterState(): Promise<void> {
  try {
    const data = await window.electronAPI.loadSettings();
    if (data?.["groups-width"]) setGroupsWidth(data["groups-width"]);
    if (data?.["list-height"]) setListHeight(data["list-height"]);
    if (data?.["playlist-width"]) setPlaylistWidth(data["playlist-width"]);
  } catch { /* best-effort */ }
}

/* ── Drag machinery ────────────────────────────────────── */
function startDrag(
  element: HTMLElement,
  cursor: string,
  onMove: (e: MouseEvent) => void
): void {
  function onUp(): void {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    element.classList.remove("active");
    document.body.classList.remove("dragging", cursor);
    saveSplitterState();
  }

  element.classList.add("active");
  document.body.classList.add("dragging", cursor);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ── Groups divider ────────────────────────────────────── */
dividerV.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = getGroupsWidth();
  startDrag(dividerV, "col-resize", (me) => {
    setGroupsWidth(startW + me.clientX - startX);
  });
});

/* ── Playlist divider ──────────────────────────────────── */
dividerV2.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = getPlaylistWidth();
  startDrag(dividerV2, "col-resize", (me) => {
    setPlaylistWidth(startW - (me.clientX - startX));
  });
});

/* ── List height divider ───────────────────────────────── */
dividerH.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const startY = e.clientY;
  const startH = getListHeight();
  startDrag(dividerH, "row-resize", (me) => {
    setListHeight(startH + me.clientY - startY);
  });
});

/* ── Cross handle (left) ────────────────────────────────── */
handle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = getGroupsWidth();
  const startH = getListHeight();
  startDrag(handle, "move", (me) => {
    setGroupsWidth(startW + me.clientX - startX);
    setListHeight(startH + me.clientY - startY);
  });
});

/* ── Cross handle (right) ───────────────────────────────── */
handleRight.addEventListener("mousedown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = getPlaylistWidth();
  const startH = getListHeight();
  startDrag(handleRight, "move", (me) => {
    setPlaylistWidth(startW - (me.clientX - startX));
    setListHeight(startH + me.clientY - startY);
  });
});
