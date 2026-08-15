export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  coverArt?: string;
}

export interface PlaylistEntry {
  path: string;
  title: string;
  artist: string;
  duration: string;
  album: string;
  trackNo: string;
  albumArtist: string;
  genre: string;
  year: string;
  composer: string;
  conductor: string;
  comment: string;
  rating: number;
  bpm: number;
  playcount: number;
  filename: string;
  ext: string;
  trackPath: string;
  id: string;
  _playing?: boolean;
}

export interface ListItem {
  id: string;
  path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  trackNo: string;
  albumArtist: string;
  genre: string;
  year: string;
  ext: string;
  discNo: string;
  rawTrackNo: string;
  trackPath: string;
  composer: string;
  conductor: string;
  comment: string;
  rating: number;
  bpm: number;
  duration: string;
  playcount: number;
}
