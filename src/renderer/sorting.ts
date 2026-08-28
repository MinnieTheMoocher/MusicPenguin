import type { PlaylistEntry } from "./types.js";

/* ── Standard sorting modes ───────────────────────────────────
   Named, reusable library sorts that the context menus can apply.
   "Artist, Album, TrackNo" is the canonical one used by the Go-to
   actions and offered at the top of the sort menus. */
export interface SortingMode {
  id: string;
  name: string;
  sort: (arr: Track[]) => void;
}

export const ARTIST_ALBUM_TRACKNO = "artist-album-trackno";
export const TRACKNO = "trackno";
export const FILENAME = "filename";

export const SORTING_MODES: SortingMode[] = [
  {
    id: ARTIST_ALBUM_TRACKNO,
    name: "Artist, Album, TrackNo",
    sort: (arr) =>
      arr.sort((a, b) => {
        const artistCmp = (a.artist || "").toLowerCase().localeCompare((b.artist || "").toLowerCase());
        if (artistCmp !== 0) return artistCmp;
        const albumCmp = (a.album || "").toLowerCase().localeCompare((b.album || "").toLowerCase());
        if (albumCmp !== 0) return albumCmp;
        const aDisc = parseInt(a.disc_no, 10) || 0;
        const bDisc = parseInt(b.disc_no, 10) || 0;
        if (aDisc !== bDisc) return aDisc - bDisc;
        const aTrack = parseInt(a.track_no, 10) || 0;
        const bTrack = parseInt(b.track_no, 10) || 0;
        return aTrack - bTrack;
      }),
  },
  {
    id: TRACKNO,
    name: "TrackNo",
    sort: (arr) =>
      arr.sort((a, b) => {
        const aTrack = parseInt(a.track_no, 10) || 0;
        const bTrack = parseInt(b.track_no, 10) || 0;
        return aTrack - bTrack;
      }),
  },
  {
    id: FILENAME,
    name: "Filename",
    sort: (arr) => arr.sort((a, b) => a.filename.localeCompare(b.filename)),
  },
];

export function applySortingMode(id: string, arr: Track[]): boolean {
  const mode = SORTING_MODES.find((m) => m.id === id);
  if (!mode) return false;
  mode.sort(arr);
  return true;
}

/* Playlist variant of the canonical mode. Playlist entries carry no
   disc number, so it sorts by artist, then album, then track number. */
export function sortPlaylistByArtistAlbumTrackNo(arr: PlaylistEntry[]): void {
  arr.sort((a, b) => {
    const artistCmp = (a.artist || "").toLowerCase().localeCompare((b.artist || "").toLowerCase());
    if (artistCmp !== 0) return artistCmp;
    const albumCmp = (a.album || "").toLowerCase().localeCompare((b.album || "").toLowerCase());
    if (albumCmp !== 0) return albumCmp;
    const aTrack = parseInt(a.trackNo, 10) || 0;
    const bTrack = parseInt(b.trackNo, 10) || 0;
    return aTrack - bTrack;
  });
}
