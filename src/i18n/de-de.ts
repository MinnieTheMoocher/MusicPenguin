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
    "All Files": "Alle Dateien",
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
    "Artist": "Interpret",
    "Album": "Album",
    "Album Artist": "Album-Interpret",
    "Composer": "Komponist",
    "Conductor": "Dirigent",
    "Year": "Jahr",
    "Genre": "Genre",
    "Rating": "Bewertung",
    "Duration": "Dauer",
    "Path": "Pfad",
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
    "Close": "Schließen",
    "Add Music Folder": "Musikordner hinzufügen",
    "RegEx Mode": "RegEx-Modus",
    "Play Playlist": "Wiedergabeliste abspielen",
    "Pause Playlist": "Wiedergabeliste pausieren",
    "Shuffle": "Zufallswiedergabe",
    "Repeat": "Wiederholen",
    "Randomize Playlist": "Wiedergabeliste mischen",
    "Clear Playlist": "Wiedergabeliste leeren",
    "Save Playlist": "Wiedergabeliste speichern",
    "Load Playlist": "Wiedergabeliste laden",
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
    "Play in VLC": "In VLC abspielen",
    "Copy Path": "Pfad kopieren",
    "Rescan Tags": "Tags erneut lesen",
    "Goto Album": "Zum Album",
    "Goto Folder": "Zum Ordner",
    "Sort by:": "Sortieren nach:",
    "Sort ascending": "aufsteigend",
    "Sort descending": "absteigend",
    "Copy": "Kopieren",
    "Cut": "Ausschneiden",
    "Paste": "Einfügen",
    "(unrated)": "(unbewertet)",

    // Settings
    "Dark Mode": "Dunkler Modus",
    "Language": "Sprache",

    // Folders dialog
    "Choose Folders with Audio Files": "Ordner mit Audiodateien auswählen",
    "+ Add Folder": "+ Ordner hinzufügen",
    "No folders added yet.": "Noch keine Ordner hinzugefügt.",
    "No folders configured.": "Keine Ordner konfiguriert.",
    "No folders configured. Open settings to add folders.": "Keine Ordner konfiguriert. Öffnen Sie die Einstellungen, um Ordner hinzuzufügen.",
    "No enabled folders to scan. Check some folders first.": "Keine aktivierten Ordner zum Scannen. Aktivieren Sie zuerst einige Ordner.",
    "Scanning...": "Scannen...",
    "Scan failed: $1": "Scan fehlgeschlagen: $1",

    // Status bar / scanning
    "Loading folders...": "Ordner laden...",
    "Scanning folders...": "Ordner durchsuchen...",
    "Finding files in: $1": "Suche Dateien in: $1",
    "Found $1 $2. Reading tags...": "$1 $2 gefunden. Tags werden gelesen...",
    "No new files. Scanning tags for untagged entries...": "Keine neuen Dateien. Prüfe ungetaggte Dateien auf neue Tags...",
    "Total files: $1. Added: $2.": "Dateien gesamt: $1. Neu: $2.",
    "Total files: $1.": "Dateien gesamt: $1.",
    "Errors: $1.": "Fehler: $1.",
    "Removed $1 missing $2.": "$1 fehlende $2 entfernt.",
    "Loaded $1 $2 from library.": "$1 $2 aus der Bibliothek geladen.",
    "Loaded $1 $2 from library. Tag scanning stopped.": "$1 $2 aus der Bibliothek geladen. Tag-Scan gestoppt.",
    "Loaded $1 $2 from library. Tag scanning complete.": "$1 $2 aus der Bibliothek geladen. Tag-Scan abgeschlossen.",
    "Reading tags $1 $2": "Tags werden gelesen $1 $2",
    "Stopping...": "Wird gestoppt...",
    "file": "Datei",
    "files": "Dateien",

    // Search
    "Search library...": "Bibliothek durchsuchen...",
    "Enter a search term first.": "Bitte zuerst einen Suchbegriff eingeben.",
    "Invalid regular expression.": "Ungültiger regulärer Ausdruck.",
    "Search on $1": "Suche bei $1",

    // Now playing / playback
    "No track selected": "Kein Titel ausgewählt",
    "Cannot play \"$1\"": "\"$1\" kann nicht abgespielt werden",
    "Cannot play \"$1\"\n\nInstall VLC to play this file format.": "\"$1\" kann nicht abgespielt werden.\n\nInstallieren Sie VLC, um dieses Dateiformat abzuspielen.",
    "Unknown file": "Unbekannte Datei",
    "This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.": "Diese Datei enthält offenbar MP3-Daten in einem WAV-Container und kann von MusicPenguin nicht abgespielt werden.",
    "Very sorry, but this file appears to be unplayable by MusicPenguin.": "Diese Datei kann leider nicht von MusicPenguin abgespielt werden.",
    "Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.": "Untersuchen Sie das Format z.B. mit ffprobe oder konvertieren Sie es z.B. mit ffmpeg.",
    "Try to play in VLC instead": "Stattdessen in VLC abspielen",
    "OK": "OK",

    // File operations
    "Failed to move file:\n$1": "Datei konnte nicht verschoben werden:\n$1",

    // Delete dialog
    "Where do you want to delete this file?": "Wo soll diese Datei gelöscht werden?",
    "Where do you want to delete these $1 files?": "Wo sollen diese $1 Dateien gelöscht werden?",
    "From Database": "Aus der Datenbank",
    "In File System": "Im Dateisystem",

    // Problematic files
    "No problematic files found.": "Keine problematischen Dateien gefunden.",
    "$1 problematic $2 written to $3 and opened in editor.": "$1 $2 mit Problemen nach $3 geschrieben und im Editor geöffnet.",
    "Written $1 problematic $2 to:\n$3\n\nNo editor could be automatically launched. Please open the file manually.": "$1 $2 mit Problemen geschrieben nach:\n$3\n\nKein Editor konnte automatisch gestartet werden. Bitte öffnen Sie die Datei manuell.",
    "$1 problematic $2 written to $3.": "$1 $2 mit Problemen nach $3 geschrieben.",

    // About
    "About MusicPenguin": "Über MusicPenguin",
    "Version $1": "Version $1",

    // Main process
    "Error": "Fehler",
    "Could not open text editor. File saved at:\n$1": "Texteditor konnte nicht geöffnet werden. Datei gespeichert unter:\n$1",
    "Could not open file manager.": "Dateimanager konnte nicht geöffnet werden.",
  },
};
