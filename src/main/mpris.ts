import { defineInterface, sessionBus, Variant as DbusVariant } from "dbus-native";
import type { DbusBus, InterfaceDefinition } from "dbus-native";

const BUS_NAME = "org.mpris.MediaPlayer2.MusicPenguin";
const OBJ_PATH = "/org/mpris/MediaPlayer2";

const MprisRoot: InterfaceDefinition = defineInterface({
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

const MprisPlayer: InterfaceDefinition = defineInterface({
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

let bus: DbusBus | null = null;
let playerImpl: Record<string, unknown> | null = null;
let playerEmit: InterfaceDefinition["emit"] | null = null;

function parseDuration(str: string): number {
  if (!str) return 0;
  const parts = str.split(":").map(Number);
  if (parts.length === 2) {
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    return Math.round((a * 60 + b) * 1000000);
  }
  if (parts.length === 3) {
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    const s = parts[2] ?? 0;
    return Math.round((h * 3600 + m * 60 + s) * 1000000);
  }
  return 0;
}

interface MprisTrack {
  title?: string;
  artist?: string;
  album?: string;
  path?: string;
  duration?: string;
}

function toMetadata(track: MprisTrack | null | undefined): Record<string, DbusVariant> {
  if (!track) return {};
  const meta: Record<string, DbusVariant> = {};
  meta["mpris:trackid"] = new DbusVariant("o", OBJ_PATH + "/TrackId");
  if (track.title) meta["xesam:title"] = new DbusVariant("s", track.title);
  if (track.artist) meta["xesam:artist"] = new DbusVariant("as", [track.artist]);
  if (track.album) meta["xesam:album"] = new DbusVariant("s", track.album);
  if (track.path) {
    const url = /^https?:\/\//i.test(track.path) ? track.path : "file://" + track.path;
    meta["xesam:url"] = new DbusVariant("s", url);
  }
  const dur = parseDuration(track.duration ?? "");
  if (dur > 0) meta["mpris:length"] = new DbusVariant("x", dur);
  return meta;
}

export function initMpris(onAction: (action: string) => void): void {
  const currentBus = sessionBus();
  bus = currentBus;

  currentBus.requestName(BUS_NAME, 0, (err: unknown) => {
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
      currentBus.addMatch(
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
      currentBus.connection.on("message", (msg) => {
        if (msg.interface === "org.kde.kglobalaccel.Component" && msg.member === "globalShortcutPressed") {
          const action = msg.body?.[1];
          if (typeof action === "string" && action in SIGNAL_MAP) {
            onAction(SIGNAL_MAP[action] as string);
          }
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

    currentBus.export(OBJ_PATH, MprisRoot);
    currentBus.export(OBJ_PATH, MprisPlayer);
  });
}

export function updateMprisState(state: {
  status?: string;
  track?: MprisTrack | null;
  position?: number;
  volume?: number;
  canNext?: boolean;
  canPrev?: boolean;
}): void {
  if (!playerImpl || !playerEmit || !bus) return;

  try {
    const changed: Record<string, unknown> = {};

    if (state.status !== undefined) {
      playerImpl.PlaybackStatus = state.status;
      changed.PlaybackStatus = state.status;
    }
    if (state.track !== undefined) {
      const metadata = toMetadata(state.track);
      playerImpl.Metadata = metadata;
      changed.Metadata = metadata;
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
