import type { ITranslate } from "./ITranslate.js";

// cspell:locale en, fr

/**
 * French (France). Keys are the English source strings; values carry the
 * French wording. `$1`, `$2`, ... placeholders are substituted by `t()`.
 * Unicode character "…" shall NOT be used.
 */
export const frFR: ITranslate = {
  key: "fr-fr",
  label: "Français (French)",
  messages: {
    // Groups / main headings
    "All Tracks": "Toutes les pistes",
    "Search Result": "Résultat de la recherche",
    "Most Played": "Les plus écoutés",
    "Groups": "Groupes",
    "Files": "Fichiers",
    "Details": "Détails",
    "Search": "Rechercher",
    "Playlist": "Liste de lecture",
    "Settings": "Paramètres",
    "Folder": "Dossier",

    // Table / form columns
    "Play Count": "Nombre de lectures",
    "Title": "Titre",
    "Artist": "Artiste",
    "Album": "Album",
    "Album Artist": "Artiste de l'album",
    "Composer": "Compositeur",
    "Conductor": "Chef d'orchestre",
    "Year": "Année",
    "Genre": "Genre",
    "Rating": "Évaluation",
    "Duration": "Durée",
    "Path": "Chemin",
    "BPM": "BPM",
    "Disc No": "Nᵒ de disque", // make sure to use lowercase "o" superscript here, NO degrees sign
    "Track No": "Nᵒ de piste", // make sure to use lowercase "o" superscript here, NO degrees sign
    "Comment": "Commentaire",

    // Tooltips
    "Previous Track": "Piste précédente",
    "Next Track": "Piste suivante",
    "Play": "Lire",
    "Pause": "Pause",
    "Mute": "Couper le son",
    "Unmute": "Réactiver le son",
    "Re-Scan Files": "Réanalyser les fichiers",
    "Show Problematic Files": "Afficher les fichiers problématiques",
    "Cancel Tag Scanning": "Annuler l'analyse des tags",
    "Cancel": "Annuler",
    "Empty MusicPenguin Library": "Vider la bibliothèque MusicPenguin",
    "Danger Zone": "Zone de danger",
    "Yes, empty it": "Oui, vider",
    "Are you sure to empty the MusicPenguin library? This will mean you have to scan your folders or audio servers again for audio files, and you will lose all your ratings and play counts. Your selected audio folders and servers will be preserved, though, as they are not part of the library but your user settings. You can scan them again to re-fill your database.": "Voulez-vous vraiment vider la bibliothèque MusicPenguin ? Cela signifie que vous devrez à nouveau analyser vos dossiers ou serveurs audio pour retrouver vos fichiers audio, et que vous perdrez toutes vos évaluations et vos compteurs de lecture. Toutefois, vos dossiers et serveurs audio sélectionnés seront conservés, car ils ne font pas partie de la bibliothèque mais de vos paramètres utilisateur. Vous pouvez les analyser à nouveau pour remplir votre base de données.",
    "Close": "Fermer",
    "Add Audio Folder": "Ajouter un dossier audio",
    "RegEx Mode": "Mode RegEx",
    "Play Playlist": "Lire la liste de lecture",
    "Pause Playlist": "Pause la liste de lecture",
    "Shuffle": "Aléatoire",
    "Repeat": "Répéter",
    "Randomize Playlist": "Mélanger la liste de lecture",
    "Clear Playlist": "Vider la liste de lecture",
    "Save Playlist": "Enregistrer la liste de lecture",
    "Load Playlist": "Charger la liste de lecture",
    "Playlist: Drop tracks here": "Liste de lecture: Déposez ici des pistes",
    "Total time: $1": "Durée totale : $1",
    "Repeat All": "Tout répéter",
    "Repeat 1": "Répéter la piste",
    "Repeat Off": "Répétition désactivée",
    "Enable Shuffle": "Activer la lecture aléatoire",
    "Disable Shuffle": "Désactiver la lecture aléatoire",
    "Expand folder": "Développer le dossier",
    "Collapse folder": "Réduire le dossier",
    "Disc Number - Track Number": "Numéro de disque - Numéro de piste",
    "Beats Per Minute": "Battements par minute",
    "File Extension": "Extension de fichier",
    "Cover": "Pochette",
    "(click for theater mode)": "(cliquez pour le mode théâtre)",

    // Now playing widget tooltips
    "Elapsed time of current track": "Temps écoulé de la piste actuelle",
    "Progress": "Progression",
    "Track length": "Durée de la piste",
    "Volume": "Volume",
    "Currently playing": "Lecture en cours",

    // Context menus
    "Show in Folder": "Afficher dans le dossier",
    "Open with Default Application": "Ouvrir avec l'application par défaut",
    "Could not open external player:\n$1": "Impossible d'ouvrir le lecteur externe :\n$1",
    "Play in $1": "Lire avec $1",
    "Copy Path": "Copier le chemin",
    "Rescan Tags": "Analyser à nouveau les tags",
    "Goto Album": "Aller à l'album",
    "Goto Folder": "Aller au dossier",
    "Goto Artist": "Aller à l'artiste",
    "Goto Composer": "Aller au compositeur",
    "Sort by:": "Trier par :",
    "Artist, Album, TrackNo": "Artiste, Album, Nᵒ de piste",
    "Sort ascending": "croissant",
    "Sort descending": "décroissant",
    "Copy": "Copier",
    "Cut": "Couper",
    "Paste": "Coller",
    "(unrated)": "(non évalué)",

    // Settings
    "Design": "Design",
    "Dark Gray": "Gris foncé",
    "White": "Blanc",
    "Blue": "Bleu",
    "Built-In": "Intégrés",
    "Custom": "Personnalisés",
    "Language": "Langue",
    "Debug Log": "Journal de débogage",
    "External Player": "Lecteur externe",
    "Minimum rating required when playing automatically": "Évaluation minimale requise pour la lecture automatique",
    "No limit": "Aucune limite",
    "$1 star": "$1 étoile",
    "$1 stars": "$1 étoiles",
    "Place main playback bar": "Placer la barre de lecture principale",
    "Top": "Haut",
    "Bottom": "Bas",

    // Folders dialog
    "Choose Folders with Audio Files": "Choisir des dossiers contenant des fichiers audio",
    "Folders on this computer that are scanned for audio files": "Dossiers de cet ordinateur analysés à la recherche de fichiers audio",
    "+ Add Folder": "+ Ajouter un dossier",
    "No folders added yet.": "Aucun dossier ajouté pour l'instant.",
    "No folders configured.": "Aucun dossier configuré.",
    "No folders configured. Open settings to add folders.": "Aucun dossier configuré. Ouvrez les paramètres pour ajouter des dossiers.",

    "Scanning...": "Analyse...",
    "Scan failed: $1": "Échec de l'analyse : $1",

    // DLNA audio servers, shown to users as plain "audio servers"
    "Audio Server(s) in your network (read-only)": "Serveur(s) audio dans votre réseau (lecture seule)",
    "File-System Folders": "Dossiers du système de fichiers",
    "Audio servers found on this network": "Serveurs audio trouvés sur ce réseau",
    "Enabled": "Activé",
    "Scanning audio server $1: $2 $3": "Analyse du serveur audio $1: $2 $3",
    "Audio server scan complete.": "Analyse des serveurs audio terminée.",
    "Total tracks: $1.": "Titres au total : $1.",
    "Audio server scan failed: $1": "Échec du scan des serveurs audio : $1",

    // Status bar / scanning
    "Loading folders...": "Chargement des dossiers...",
    "Scanning folders...": "Analyse des dossiers à la recherche de fichiers audio...",
    "Finding files in: $1": "Recherche de fichiers dans : $1",
    "Found $1 $2. Reading tags...": "$1 $2 trouvé(s). Lecture des tags...",
    "No new files. Scanning tags for untagged entries...": "Aucun nouveau fichier. Analyse des tags des entrées sans tags...",
    "Total files: $1.": "Fichiers au total : $1.",
    "Added: $1.": "Ajoutés : $1.",
    "Errors: $1.": "Erreurs : $1.",
    "Removed: $1.": "Supprimé(s): $1.",
    "$1 $2 in MusicPenguin library.": "$1 $2 dans la bibliothèque MusicPenguin.",
    "Tag scanning stopped.": "Analyse des tags arrêtée.",
    "Tag scanning complete.": "Analyse des tags terminée.",
    "Reading tags $1 $2": "Lecture des tags $1 $2",
    "Stopping...": "Arrêt...",
    "file": "fichier",
    "files": "fichiers",

    // Search
    "Search...": "Rechercher...",
    "Invalid regular expression.": "Expression régulière invalide.",
    "Search on $1": "Rechercher sur $1",

    // Now playing / playback
    "Cannot play \"$1\"": "\"$1\" ne peut pas être lu",
    "Cannot play \"$1\"\n\nInstall an external player like VLC to play this file format.": "\"$1\" ne peut pas être lu.\n\nInstallez un lecteur externe comme VLC pour lire ce format de fichier.",
    "Unknown file": "Fichier inconnu",
    "This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.": "Ce fichier semble contenir des données MP3 dans un conteneur WAV, illisible par MusicPenguin.",
    "Very sorry, but this file appears to be unplayable by MusicPenguin.": "Désolé, mais ce fichier semble illisible par MusicPenguin.",
    "Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.": "Essayez d'analyser son format avec, par exemple, ffprobe, ou de le convertir avec, par exemple, ffmpeg.",
    "Try to play in $1 instead": "Essayez plutôt de le lire avec $1",
    "OK": "OK",

    // File operations
    "Failed to move file:\n$1": "Échec du déplacement du fichier :\n$1",

    // Detail panel
    "Attributes of remote DLNA tracks cannot be edited. Only tracks stored on the local file system can.": "Les attributs des pistes DLNA distantes ne peuvent pas être modifiés. Seules les pistes stockées sur le système de fichiers local peuvent l'être.",

    // Delete dialog
    "Where do you want to delete this file?": "Où voulez-vous supprimer ce fichier ?",
    "Where do you want to delete these $1 files?": "Où voulez-vous supprimer ces $1 fichiers ?",
    "From Library": "De la bibliothèque",
    "In File System": "Du système de fichiers",

    // Problematic files
    "No problematic files found.": "Aucun fichier problématique trouvé.",
    "1 problematic file, see $1": "1 fichier problématique, voir $1",
    "$1 problematic files, see $2": "$1 fichiers problématiques, voir $2",

    // About
    "About MusicPenguin": "À propos de MusicPenguin",
    "Version $1": "Version $1",
    "Icons License: $1": "Licence des icônes : $1",

    // Main process
    "Error": "Erreur",
    "Could not open text editor. File saved at:\n$1": "Impossible d'ouvrir l'éditeur de texte. Fichier enregistré dans :\n$1",
    "Could not open file manager.": "Impossible d'ouvrir le gestionnaire de fichiers.",
  },
};
