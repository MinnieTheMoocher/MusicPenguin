import type { ITranslate } from "./ITranslate.js";

// cspell:locale en, de

// cspell:words unbewertet ungetaggte

/**
 * German (Germany). Keys are the English source strings; values carry the
 * German wording. `$1`, `$2`, ... placeholders are substituted by `t()`.
 * Unicode character "…" shall NOT be used.
 */
export const deDE: ITranslate = {
  key: "de-de",
  label: "Deutsch (German)",
  messages: {
    // Groups / main headings
    "All Tracks": "Alle Titel",
    "Search Result": "Suchergebnis",
    "Most Played": "Meistgespielt",
    "Groups": "Gruppen",
    "Files": "Dateien",
    "Details": "Details",
    "Search": "Suchen",
    "Playlist": "Wiedergabeliste",
    "Settings": "Einstellungen",
    "Folder": "Ordner",

    // Table / form columns
    "Play Count": "Anzahl Wiedergaben",
    "Title": "Titel",
    "Artist": "Künstler",
    "Album": "Album",
    "Album Artist": "Album-Künstler",
    "Composer": "Komponist",
    "Conductor": "Dirigent",
    "Year": "Jahr",
    "Genre": "Genre",
    "Rating": "Bewertung",
    "Duration": "Dauer",
    "Path": "Pfad",
    "BPM": "BPM",
    "Disc No": "Disc-Nr.",
    "Track No": "Track-Nr.",
    "Comment": "Kommentar",

    // Tooltips
    "Previous Track": "Vorheriger Titel",
    "Next Track": "Nächster Titel",
    "Play": "Abspielen",
    "Pause": "Pause",
    "Mute": "Stumm",
    "Unmute": "Ton an",
    "Re-Scan Files": "Tags neu einlesen",
    "Show Problematic Files": "Problemfälle anzeigen",
    "Cancel Tag Scanning": "Tag-Scan abbrechen",
    "Cancel": "Abbrechen",
    "Empty MusicPenguin Library": "MusicPenguin-Bibliothek leeren",
    "Danger Zone": "Gefahrenzone",
    "Yes, empty it": "Ja, leeren",
    "Are you sure to empty the MusicPenguin library? This will mean you have to scan your folders or audio servers again for audio files, and you will lose all your ratings and play counts. Your selected audio folders and servers will be preserved, though, as they are not part of the library but your user settings. You can scan them again to re-fill your database.": "Sind Sie sicher, dass Sie die MusicPenguin-Bibliothek leeren möchten? Dann müssen Sie Ihre Ordner oder Audio-Server erneut nach Audiodateien durchsuchen, und Sie verlieren alle Ihre Bewertungen und Wiedergabezähler. Ihre ausgewählten Audioordner und -server bleiben jedoch erhalten, da sie nicht Teil der Bibliothek, sondern Ihrer Benutzereinstellungen sind. Sie können sie erneut scannen, um Ihre Datenbank wieder zu füllen.",
    "Close": "Schließen",
    "Add Audio Folder": "Audioordner hinzufügen",
    "RegEx Mode": "RegEx-Modus",
    "Play Playlist": "Wiedergabeliste abspielen",
    "Pause Playlist": "Wiedergabeliste pausieren",
    "Shuffle": "Zufallswiedergabe",
    "Repeat": "Wiederholen",
    "Randomize Playlist": "Wiedergabeliste mischen",
    "Clear Playlist": "Wiedergabeliste leeren",
    "Save Playlist": "Wiedergabeliste speichern",
    "Load Playlist": "Wiedergabeliste laden",
    "Playlist: Drop tracks here": "Wiedergabeliste: Titel hierher ziehen",
    "Total time: $1": "Gesamtzeit: $1",
    "Repeat All": "Alle wiederholen",
    "Repeat 1": "Einzeltitel wiederholen",
    "Repeat Off": "Wiederholung aus",
    "Enable Shuffle": "Zufallswiedergabe ein",
    "Disable Shuffle": "Zufallswiedergabe aus",
    "Expand folder": "Ordner aufklappen",
    "Collapse folder": "Ordner zuklappen",
    "Disc Number - Track Number": "Disc-Nummer - Titel-Nummer",
    "Beats Per Minute": "Beats pro Minute",
    "File Extension": "Dateierweiterung",
    "Cover": "Cover",
    "(click for theater mode)": "(klicken für Theatermodus)",

    // Now playing widget tooltips
    "Elapsed time of current track": "Verstrichene Zeit des aktuellen Titels",
    "Progress": "Fortschritt",
    "Track length": "Titellänge",
    "Volume": "Lautstärke",
    "Currently playing": "Wird gerade abgespielt",

    // Context menus
    "Show in Folder": "Im Ordner anzeigen",
    "Open with Default Application": "Mit Standardanwendung öffnen",
    "Could not open external player:\n$1": "Externer Player konnte nicht geöffnet werden:\n$1",
    "Play in $1": "In $1 abspielen",
    "Copy Path": "Pfad kopieren",
    "Rescan Tags": "Tags erneut lesen",
    "Goto Album": "Zum Album",
    "Goto Folder": "Zum Ordner",
    "Goto Artist": "Zum Künstler",
    "Goto Composer": "Zum Komponist",
    "Sort by:": "Sortieren nach:",
    "Artist, Album, TrackNo": "Künstler, Album, Track-Nr.",
    "Sort ascending": "aufsteigend",
    "Sort descending": "absteigend",
    "Copy": "Kopieren",
    "Cut": "Ausschneiden",
    "Paste": "Einfügen",
    "(unrated)": "(unbewertet)",

    // Settings
    "Design": "Design",
    "Dark Gray": "Dunkelgrau",
    "White": "Weiß",
    "Blue": "Blau",
    "Built-In": "Eingebaut",
    "Custom": "Eigene",
    "Language": "Sprache",
    "Debug Log": "Debug-Log",
    "External Player": "Externer Player",
    "Minimum rating required when playing automatically": "Nötige Mindestbewertung bei automatischer Wiedergabe",
    "No limit": "Kein Limit",
    "$1 star": "$1 Stern",
    "$1 stars": "$1 Sterne",
    "Place main playback bar": "Haupt-Wiedergabeleiste platzieren",
    "Top": "Oben",
    "Bottom": "Unten",

    // Folders dialog
    "Choose Folders with Audio Files": "Ordner mit Audiodateien auswählen",
    "Folders on this computer that are scanned for audio files": "Ordner auf diesem Computer, die nach Audiodateien durchsucht werden",
    "+ Add Folder": "+ Ordner hinzufügen",
    "No folders added yet.": "Noch keine Ordner hinzugefügt.",
    "No folders configured.": "Keine Ordner konfiguriert.",
    "No folders configured. Open settings to add folders.": "Keine Ordner konfiguriert. Öffnen Sie die Einstellungen, um Ordner hinzuzufügen.",

    "Scanning...": "Scannen...",
    "Scan failed: $1": "Scan fehlgeschlagen: $1",

    // DLNA audio servers, shown to users as plain "audio servers"
    "Audio Server(s) in your network (read-only)": "Audio-Server in Ihrem Netzwerk (nur-Lesen)",
    "File-System Folders": "Dateisystem-Ordner",
    "Audio servers found on this network": "gefundene Audio-Server",
    "Enabled": "Aktiviert",
    "Scanning audio server $1: $2 $3": "Durchsuche Audio-Server $1: $2 $3",
    "Audio server scan complete.": "Scan des Audio-Servers abgeschlossen.",
    "Total tracks: $1.": "Titel gesamt: $1.",
    "Audio server scan failed: $1": "Scan des Audio-Servers fehlgeschlagen: $1",

    // Status bar / scanning
    "Loading folders...": "Ordner laden...",
    "Scanning folders...": "Ordner durchsuchen...",
    "Finding files in: $1": "Suche Dateien in: $1",
    "Found $1 $2. Reading tags...": "$1 $2 gefunden. Tags werden gelesen...",
    "No new files. Scanning tags for untagged entries...": "Keine neuen Dateien. Prüfe ungetaggte Dateien auf neue Tags...",
    "Total files: $1.": "Dateien gesamt: $1.",
    "Added: $1.": "Neu: $1",
    "Errors: $1.": "Fehler: $1.",
    "Removed: $1.": "Entfernt: $1.",
    "$1 $2 in MusicPenguin library.": "$1 $2 in der MusicPenguin-Bibliothek.",
    "Tag scanning stopped.": "Tag-Scan gestoppt.",
    "Tag scanning complete.": "Tag-Scan abgeschlossen.",
    "Reading tags $1 $2": "Tags werden gelesen $1 $2",
    "Stopping...": "Wird gestoppt...",
    "file": "Datei",
    "files": "Dateien",

    // Search
    "Search...": "Suchen...",
    "Invalid regular expression.": "Ungültiger regulärer Ausdruck.",
    "Search on $1": "Suche bei $1",

    // Now playing / playback
    "Cannot play \"$1\"": "\"$1\" kann nicht abgespielt werden",
    "Cannot play \"$1\"\n\nInstall an external player like VLC to play this file format.": "\"$1\" kann nicht abgespielt werden.\n\nInstallieren Sie einen externen Player wie VLC, um dieses Dateiformat abzuspielen.",
    "Unknown file": "Unbekannte Datei",
    "This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.": "Diese Datei enthält offenbar MP3-Daten in einem WAV-Container und kann von MusicPenguin nicht abgespielt werden.",
    "Very sorry, but this file appears to be unplayable by MusicPenguin.": "Diese Datei kann leider nicht von MusicPenguin abgespielt werden.",
    "Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.": "Untersuchen Sie das Format z.B. mit ffprobe oder konvertieren Sie es z.B. mit ffmpeg.",
    "Try to play in $1 instead": "Stattdessen in $1 abspielen",
    "OK": "OK",

    // File operations
    "Failed to move file:\n$1": "Datei konnte nicht verschoben werden:\n$1",

    // Detail panel
    "Attributes of remote DLNA tracks cannot be edited. Only tracks stored on the local file system can.": "Attribute von DLNA-Titeln können nicht bearbeitet werden. Dies ist nur bei im lokalen Dateisystem gespeicherten Titeln möglich.",

    // Delete dialog
    "Where do you want to delete this file?": "Wo soll diese Datei gelöscht werden?",
    "Where do you want to delete these $1 files?": "Wo sollen diese $1 Dateien gelöscht werden?",
    "From Library": "Aus der Bibliothek",
    "In File System": "Im Dateisystem",

    // Problematic files
    "No problematic files found.": "Keine problematischen Dateien gefunden.",
    "1 problematic file, see $1": "1 problematische Datei, siehe $1",
    "$1 problematic files, see $2": "$1 problematische Dateien, siehe $2",

    // About
    "About MusicPenguin": "Über MusicPenguin",
    "Version $1": "Version $1",
    "Icons License: $1": "Icons-Lizenz: $1",

    // Main process
    "Error": "Fehler",
    "Could not open text editor. File saved at:\n$1": "Texteditor konnte nicht geöffnet werden. Datei gespeichert unter:\n$1",
    "Could not open file manager.": "Dateimanager konnte nicht geöffnet werden.",
  },
};
