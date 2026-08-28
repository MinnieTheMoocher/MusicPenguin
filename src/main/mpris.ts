// @ts-nocheck
const dbus = require("dbus-native");
const { defineInterface } = dbus;

const BUS_NAME = "org.mpris.MediaPlayer2.MusicPenguin";
const OBJ_PATH = "/org/mpris/MediaPlayer2";

const MprisRoot = defineInterface({
  name: "org.mpris.MediaPlayer2",
  properties: {
    Identity: { type: "s", access: "read", value: "MusicPenguin" },
    DesktopEntry: { type: "s", access: "read", value: "musicpenguin" },
    SupportedUriSchemes: { type: "as", access: "read", value: ["file"] },
    SupportedMimeTypes: {
      type: "as", access: "read",
      value: ["audio/mpeg", "audio/flac", "audio/ogg", "audio/x-wav", "audio/mp4", "audio/aac"],
    },
    CanRaise: { type: "b", access: "read", value: true },
    CanQuit: { type: "b", access: "read", value: true },
  },
  methods: {
    Raise: { handler() {} },
    Quit: { handler() {} },
  },
});

const MprisPlayer = defineInterface({
  name: "org.mpris.MediaPlayer2.Player",
  properties: {
    PlaybackStatus: { type: "s", access: "read", value: "Stopped" },
    Metadata: { type: "a{sv}", access: "read", value: {} },
    Position: { type: "x", access: "read", value: 0 },
    Volume: { type: "d", access: "readwrite", value: 1.0 },
    Rate: { type: "d", access: "read", value: 1.0 },
    Shuffle: { type: "b", access: "read", value: false },
    LoopStatus: { type: "s", access: "read", value: "None" },
    CanPlay: { type: "b", access: "read", value: true },
    CanPause: { type: "b", access: "read", value: true },
    CanSeek: { type: "b", access: "read", value: true },
    CanGoNext: { type: "b", access: "read", value: true },
    CanGoPrevious: { type: "b", access: "read", value: true },
    MinimumRate: { type: "d", access: "read", value: 1.0 },
    MaximumRate: { type: "d", access: "read", value: 1.0 },
  },
  methods: {
    Play: { handler() {} },
    Pause: { handler() {} },
    PlayPause: { handler() {} },
    Stop: { handler() {} },
    Next: { handler() {} },
    Previous: { handler() {} },
    Seek: { in: { Position: "x" }, handler() {} },
    SetPosition: { in: { TrackId: "o", Position: "x" }, handler() {} },
    OpenUri: { in: { Uri: "s" }, handler() {} },
  },
});

let bus = null;
let playerImpl = null;
let playerEmit = null;

function parseDuration(str) {
  if (!str) return 0;
  const parts = str.split(":").map(Number);
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000000);
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000000);
  return 0;
}

function toMetadata(track) {
  if (!track) return {};
  const meta = {};
  meta["mpris:trackid"] = new dbus.Variant("o", OBJ_PATH + "/TrackId");
  if (track.title) meta["xesam:title"] = new dbus.Variant("s", track.title);
  if (track.artist) meta["xesam:artist"] = new dbus.Variant("as", [track.artist]);
  if (track.album) meta["xesam:album"] = new dbus.Variant("s", track.album);
  if (track.path) {
    const url = /^https?:\/\//i.test(track.path) ? track.path : "file://" + track.path;
    meta["xesam:url"] = new dbus.Variant("s", url);
  }
  const dur = parseDuration(track.duration);
  if (dur > 0) meta["mpris:length"] = new dbus.Variant("x", dur);
  return meta;
}

export function initMpris(onAction: (action: string) => void): void {
  bus = dbus.sessionBus();

  bus.requestName(BUS_NAME, 0, (err) => {
    if (err) return;

    playerImpl = MprisPlayer.impl;
    playerEmit = MprisPlayer.emit;

    /* ── DE-specific media key handling ────────────────────────────
       See implementation.md for full details. In short:

       KDE: kglobalaccel intercepts media keys and fires D-Bus signals
       (globalShortcutPressed) on org.kde.kglobalaccel.Component. Plasma-shell
       forwards Next/Previous to MPRIS but silently drops PlayPause (and
       sometimes Next/Prev). We subscribe to the signal directly and handle
       all keys ourselves. MPRIS method handlers are set to no-op to prevent
       double-fire from plasma-shell's incomplete forwarding.

       GNOME / other: media keys are routed directly as MPRIS method calls
       to the active player. No kglobalaccel signals exist. We override the
       MPRIS method handlers to fire onAction. */
    const isKde = (process.env.XDG_CURRENT_DESKTOP || "").toLowerCase().includes("kde");

    if (isKde) {
      bus.addMatch(
        "type=signal,interface=org.kde.kglobalaccel.Component,member=globalShortcutPressed",
      );
      const SIGNAL_MAP: Record<string, string> = {
        playpausemedia: "play-pause",
        nextmedia: "next",
        previousmedia: "previous",
        playmedia: "play",
        pausemedia: "pause",
        stopmedia: "stop",
      };
      bus.connection.on("message", (msg) => {
        if (msg.interface === "org.kde.kglobalaccel.Component" && msg.member === "globalShortcutPressed") {
          const action = msg.body && msg.body[1];
          const mapped = SIGNAL_MAP[action as string];
          if (mapped) onAction(mapped);
        }
      });
      const noop = () => {};
      for (const method of ["Play", "Pause", "PlayPause", "Stop", "Next", "Previous"]) {
        playerImpl[method] = noop;
      }
    } else {
      const actionMap: Record<string, () => void> = {
        Play:       () => onAction("play"),
        Pause:      () => onAction("pause"),
        PlayPause:  () => onAction("play-pause"),
        Stop:       () => onAction("stop"),
        Next:       () => onAction("next"),
        Previous:   () => onAction("previous"),
      };
      for (const [method, fn] of Object.entries(actionMap)) {
        playerImpl[method] = fn;
      }
    }

    playerImpl.Seek = () => {};
    playerImpl.SetPosition = () => {};
    playerImpl.OpenUri = () => {};

    bus.export(OBJ_PATH, MprisRoot);
    bus.export(OBJ_PATH, MprisPlayer);
  });
}

export function updateMprisState(state: {
  status?: string;
  track?: { title?: string; artist?: string; album?: string; path?: string; duration?: string } | null;
  position?: number;
  volume?: number;
  canNext?: boolean;
  canPrev?: boolean;
}): void {
  if (!playerImpl || !playerEmit) return;

  try {
    const changed: Record<string, any> = {};

    if (state.status !== undefined) {
      playerImpl.PlaybackStatus = state.status;
      changed.PlaybackStatus = state.status;
    }
    if (state.track !== undefined) {
      playerImpl.Metadata = toMetadata(state.track);
      changed.Metadata = toMetadata(state.track);
    }
    if (state.position !== undefined) {
      playerImpl.Position = Math.round(state.position * 1000000);
      changed.Position = Math.round(state.position * 1000000);
    }
    if (state.volume !== undefined) {
      playerImpl.Volume = state.volume;
      changed.Volume = state.volume;
    }
    if (state.canNext !== undefined) {
      playerImpl.CanGoNext = state.canNext;
      changed.CanGoNext = state.canNext;
    }
    if (state.canPrev !== undefined) {
      playerImpl.CanGoPrevious = state.canPrev;
      changed.CanGoPrevious = state.canPrev;
    }

    /* Emit PropertiesChanged so KDE/GNOME know our state.
       Without this, KDE's media controller ignores our player
       and routes keys to other MPRIS clients (e.g. Firefox). */
    if (Object.keys(changed).length > 0) {
      bus.emitPropertiesChanged(OBJ_PATH, "org.mpris.MediaPlayer2.Player", changed);
    }
  } catch (err) {
    console.error("[MPRIS] updateMprisState failed:", err);
  }
}
