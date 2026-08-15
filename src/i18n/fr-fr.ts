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
    "All Files": "Tous les fichiers",
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
    "Close": "Fermer",
    "Add Music Folder": "Ajouter un dossier musical",
    "RegEx Mode": "Mode RegEx",
    "Play Playlist": "Lire la liste de lecture",
    "Pause Playlist": "Mettre en pause la liste de lecture",
    "Shuffle": "Aléatoire",
    "Repeat": "Répéter",
    "Randomize Playlist": "Mélanger la liste de lecture",
    "Clear Playlist": "Vider la liste de lecture",
    "Save Playlist": "Enregistrer la liste de lecture",
    "Load Playlist": "Charger la liste de lecture",
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
    "Play in VLC": "Lire avec VLC",
    "Copy Path": "Copier le chemin",
    "Rescan Tags": "Analyser à nouveau les tags",
    "Goto Album": "Aller à l'album",
    "Goto Folder": "Aller au dossier",
    "Sort by:": "Trier par :",
    "Sort ascending": "croissant",
    "Sort descending": "décroissant",
    "Copy": "Copier",
    "Cut": "Couper",
    "Paste": "Coller",
    "(unrated)": "(non évalué)",

    // Settings
    "Dark Mode": "Mode sombre",
    "Language": "Langue",

    // Folders dialog
    "Choose Folders with Audio Files": "Choisir des dossiers contenant des fichiers audio",
    "+ Add Folder": "+ Ajouter un dossier",
    "No folders added yet.": "Aucun dossier ajouté pour l'instant.",
    "No folders configured.": "Aucun dossier configuré.",
    "No folders configured. Open settings to add folders.": "Aucun dossier configuré. Ouvrez les paramètres pour ajouter des dossiers.",
    "No enabled folders to scan. Check some folders first.": "Aucun dossier activé à analyser. Activez d'abord certains dossiers.",
    "Scanning...": "Analyse...",
    "Scan failed: $1": "Échec de l'analyse : $1",

    // Status bar / scanning
    "Loading folders...": "Chargement des dossiers...",
    "Scanning folders...": "Analyse des dossiers à la recherche de fichiers audio...",
    "Finding files in: $1": "Recherche de fichiers dans : $1",
    "Found $1 $2. Reading tags...": "$1 $2 trouvé(s). Lecture des tags...",
    "No new files. Scanning tags for untagged entries...": "Aucun nouveau fichier. Analyse des tags des entrées sans tags...",
    "Total files: $1. Added: $2.": "Fichiers au total : $1. Ajoutés : $2.",
    "Total files: $1.": "Fichiers au total : $1.",
    "Errors: $1.": "Erreurs : $1.",
    "Removed $1 missing $2.": "$1 $2 manquant(s) supprimé(s).",
    "Loaded $1 $2 from library.": "$1 $2 chargé(s) depuis la bibliothèque.",
    "Loaded $1 $2 from library. Tag scanning stopped.": "$1 $2 chargé(s) depuis la bibliothèque. Analyse des tags arrêtée.",
    "Loaded $1 $2 from library. Tag scanning complete.": "$1 $2 chargé(s) depuis la bibliothèque. Analyse des tags terminée.",
    "Reading tags $1 $2": "Lecture des tags $1 $2",
    "Stopping...": "Arrêt...",
    "file": "fichier",
    "files": "fichiers",

    // Search
    "Search library...": "Rechercher dans la bibliothèque...",
    "Enter a search term first.": "Saisissez d'abord un terme de recherche.",
    "Invalid regular expression.": "Expression régulière invalide.",
    "Search on $1": "Rechercher sur $1",

    // Now playing / playback
    "No track selected": "Aucune piste sélectionnée",
    "Cannot play \"$1\"": "\"$1\" ne peut pas être lu",
    "Cannot play \"$1\"\n\nInstall VLC to play this file format.": "\"$1\" ne peut pas être lu.\n\nInstallez VLC pour lire ce format de fichier.",
    "Unknown file": "Fichier inconnu",
    "This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.": "Ce fichier semble contenir des données MP3 dans un conteneur WAV, illisible par MusicPenguin.",
    "Very sorry, but this file appears to be unplayable by MusicPenguin.": "Désolé, mais ce fichier semble illisible par MusicPenguin.",
    "Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.": "Essayez d'analyser son format avec, par exemple, ffprobe, ou de le convertir avec, par exemple, ffmpeg.",
    "Try to play in VLC instead": "Essayez plutôt de le lire avec VLC",
    "OK": "OK",

    // File operations
    "Failed to move file:\n$1": "Échec du déplacement du fichier :\n$1",

    // Delete dialog
    "Where do you want to delete this file?": "Où voulez-vous supprimer ce fichier ?",
    "Where do you want to delete these $1 files?": "Où voulez-vous supprimer ces $1 fichiers ?",
    "From Database": "De la base de données",
    "In File System": "Du système de fichiers",

    // Problematic files
    "No problematic files found.": "Aucun fichier problématique trouvé.",
    "$1 problematic $2 written to $3 and opened in editor.": "$1 $2 problématique(s) écrit(s) dans $3 et ouverts dans l'éditeur.",
    "Written $1 problematic $2 to:\n$3\n\nNo editor could be automatically launched. Please open the file manually.": "$1 $2 problématique(s) écrit(s) dans :\n$3\n\nAucun éditeur n'a pu être lancé automatiquement. Veuillez ouvrir le fichier manuellement.",
    "$1 problematic $2 written to $3.": "$1 $2 problématique(s) écrit(s) dans $3.",

    // About
    "About MusicPenguin": "À propos de MusicPenguin",
    "Version $1": "Version $1",

    // Main process
    "Error": "Erreur",
    "Could not open text editor. File saved at:\n$1": "Impossible d'ouvrir l'éditeur de texte. Fichier enregistré dans :\n$1",
    "Could not open file manager.": "Impossible d'ouvrir le gestionnaire de fichiers.",
  },
};
