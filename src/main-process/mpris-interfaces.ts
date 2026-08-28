import { defineInterface } from "dbus-native";

const MPRIS_NAME = "org.mpris.MediaPlayer2";
const MPRIS_PLAYER = "org.mpris.MediaPlayer2.Player";

export const MediaPlayer2 = defineInterface({
  name: MPRIS_NAME,
  properties: {
    Identity: { type: "s", access: "read", value: "MusicPenguin" },
    DesktopEntry: { type: "s", access: "read", value: "musicpenguin" },
    SupportedUriSchemes: { type: "as", access: "read", value: ["file"] },
    SupportedMimeTypes: { type: "as", access: "read", value: ["audio/mpeg", "audio/flac", "audio/ogg", "audio/x-wav"] },
    CanRaise: { type: "b", access: "read", value: true },
    CanQuit: { type: "b", access: "read", value: true },
  },
  methods: {
    Raise: {
      handler: () => { /* handled externally */ },
    },
    Quit: {
      handler: () => { /* handled externally */ },
    },
  },
});

export const MediaPlayer2Player = defineInterface({
  name: MPRIS_PLAYER,
  properties: {
    PlaybackStatus: { type: "s", access: "read" },
    Metadata: { type: "a{sv}", access: "read" },
    Position: { type: "x", access: "read" },
    Volume: { type: "d", access: "readwrite" },
    Rate: { type: "d", access: "read", value: 1.0 },
    Shuffle: { type: "b", access: "read" },
    LoopStatus: { type: "s", access: "read" },
    CanPlay: { type: "b", access: "read", value: true },
    CanPause: { type: "b", access: "read", value: true },
    CanSeek: { type: "b", access: "read", value: true },
    CanGoNext: { type: "b", access: "read", value: true },
    CanGoPrevious: { type: "b", access: "read", value: true },
    MinimumRate: { type: "d", access: "read", value: 1.0 },
    MaximumRate: { type: "d", access: "read", value: 1.0 },
  },
  methods: {
    Play: { handler: () => {} },
    Pause: { handler: () => {} },
    PlayPause: { handler: () => {} },
    Stop: { handler: () => {} },
    Next: { handler: () => {} },
    Previous: { handler: () => {} },
    Seek: {
      in: { Position: "x" },
      handler: () => {},
    },
    SetPosition: {
      in: { TrackId: "o", Position: "x" },
      handler: () => {},
    },
    OpenUri: {
      in: { Uri: "s" },
      handler: () => {},
    },
  },
});
