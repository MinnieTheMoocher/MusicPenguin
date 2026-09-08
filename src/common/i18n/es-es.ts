import type { ITranslate } from "./ITranslate.js";

// cspell:locale en, es

// cspell:words aleatorizar reanalizar editables

/**
 * Spanish (Spain). Keys are the English source strings; values carry the
 * Spanish wording. `$1`, `$2`, ... placeholders are substituted by `t()`.
 * Unicode character "…" shall NOT be used.
 */
export const esES: ITranslate = {
  key: "es-es",
  label: "Español (Spanish)",
  messages: {
    // Groups / main headings
    "All Tracks": "Todas las pistas",
    "Search Result": "Resultado de la búsqueda",
    "Most Played": "Más reproducidas",
    "Groups": "Grupos",
    "Files": "Archivos",
    "Details": "Detalles",
    "Search": "Buscar",
    "Playlist": "Lista de reproducción",
    "Settings": "Ajustes",
    "Folder": "Carpeta",

    // Table / form columns
    "Play Count": "Reproducciones",
    "Title": "Título",
    "Artist": "Artista",
    "Album": "Álbum",
    "Album Artist": "Artista del álbum",
    "Composer": "Compositor",
    "Conductor": "Director",
    "Year": "Año",
    "Genre": "Género",
    "Rating": "Valoración",
    "Duration": "Duración",
    "Path": "Ruta",
    "BPM": "BPM",
    "Disc No": "N.º de disco",
    "Track No": "N.º de pista",
    "Comment": "Comentario",

    // Tooltips
    "Previous Track": "Pista anterior",
    "Next Track": "Pista siguiente",
    "Play": "Reproducir",
    "Pause": "Pausar",
    "Mute": "Silenciar",
    "Unmute": "Activar sonido",
    "Re-Scan Files": "Reanalizar archivos",
    "Show Problematic Files": "Mostrar archivos problemáticos",
    "Cancel Tag Scanning": "Cancelar análisis de etiquetas",
    "Cancel": "Cancelar",
    "Empty MusicPenguin Library": "Vaciar la biblioteca de MusicPenguin",
    "Danger Zone": "Zona de peligro",
    "Yes, empty it": "Sí, vaciarla",
    "Are you sure to empty the MusicPenguin library? This will mean you have to scan your folders or audio servers again for audio files, and you will lose all your ratings and play counts. Your selected audio folders and servers will be preserved, though, as they are not part of the library but your user settings. You can scan them again to re-fill your database.": "¿Está seguro de que desea vaciar la biblioteca de MusicPenguin? Esto significará que tendrá que volver a escanear sus carpetas o servidores de audio para buscar archivos de audio, y que perderá todas sus valoraciones y contadores de reproducción. Sin embargo, sus carpetas y servidores de audio seleccionados se conservarán, ya que no forman parte de la biblioteca sino de su configuración de usuario. Puede escanearlos de nuevo para volver a rellenar su base de datos.",
    "Close": "Cerrar",
    "Add Audio Folder": "Añadir carpeta de audio",
    "RegEx Mode": "Modo RegEx",
    "Play Playlist": "Reproducir lista de reproducción",
    "Pause Playlist": "Pausar lista de reproducción",
    "Shuffle": "Aleatorio",
    "Repeat": "Repetir",
    "Randomize Playlist": "Aleatorizar lista de reproducción",
    "Clear Playlist": "Vaciar lista de reproducción",
    "Save Playlist": "Guardar lista de reproducción",
    "Load Playlist": "Cargar lista de reproducción",
    "Playlist: Drop tracks here": "Lista de reproducción: Arrastre pistas aquí",
    "Total time: $1": "Duración total: $1",
    "Repeat All": "Repetir todo",
    "Repeat 1": "Repetir una pista",
    "Repeat Off": "Repetición desactivada",
    "Enable Shuffle": "Activar aleatorio",
    "Disable Shuffle": "Desactivar aleatorio",
    "Expand folder": "Expandir carpeta",
    "Collapse folder": "Contraer carpeta",
    "Disc Number - Track Number": "Número de disco - Número de pista",
    "Beats Per Minute": "Pulsaciones por minuto",
    "File Extension": "Extensión de archivo",
    "#": "#",
    "Ext": "Ext.",
    "Cover": "Portada",
    "(click for theater mode)": "(clic para el modo teatro)",

    // Now playing widget tooltips
    "Elapsed time of current track": "Tiempo transcurrido de la pista actual",
    "Progress": "Progreso",
    "Track length": "Duración de la pista",
    "Volume": "Volumen",
    "Currently playing": "Reproduciendo",

    // Context menus
    "Show in Folder": "Mostrar en la carpeta",
    "Open with Default Application": "Abrir con la aplicación predeterminada",
    "Could not open external player:\n$1": "No se pudo abrir el reproductor externo:\n$1",
    "Play in $1": "Reproducir con $1",
    "Copy Path": "Copiar ruta",
    "Rescan Tags": "Volver a leer etiquetas",
    "Goto Album": "Ir al álbum",
    "Goto Folder": "Ir a la carpeta",
    "Goto Artist": "Ir al artista",
    "Goto Composer": "Ir al compositor",
    "Sort by:": "Ordenar por:",
    "Sort ascending": "Ascendente",
    "Sort descending": "Descendente",
    "Copy": "Copiar",
    "Cut": "Cortar",
    "Paste": "Pegar",
    "(unrated)": "(sin valoración)",

    // Settings
    "Design": "Diseño",
    "System (automatic)": "Sistema (automático)",
    "Follow the operating system color scheme": "Seguir el esquema de color del sistema operativo",
    "Built-In": "Integrados",
    "Custom": "Personalizados",
    "Language": "Idioma",
    "Debug Log": "Registro de depuración",
    "External Player": "Reproductor externo",
    "Minimum rating required when playing automatically": "Valoración mínima necesaria durante la reproducción automática",
    "No limit": "Sin límite",
    "$1 star": "$1 estrella",
    "$1 stars": "$1 estrellas",
    "Place main playback bar": "Colocar la barra de reproducción principal",
    "Top": "Arriba",
    "Bottom": "Abajo",

    // Folders dialog
    "Choose Folders with Audio Files": "Elegir carpetas con archivos de audio",
    "Folders on this computer that are scanned for audio files": "Carpetas de este equipo en las que se buscan archivos de audio",
    "+ Add Folder": "+ Añadir carpeta",
    "No folders added yet.": "Aún no se ha añadido ninguna carpeta.",

    "Scanning...": "Analizando...",

    // DLNA audio servers, shown to users as plain "audio servers"
    "Audio Server(s) in your network (read-only)": "Servidor(es) de audio en su red (solo lectura)",
    "File-System Folders": "Carpetas del sistema de archivos",
    "Audio servers found on this network": "Servidores de audio encontrados en esta red",
    "Enabled": "Habilitado",
    "Scanning audio server $1: $2 $3": "Analizando el servidor de audio $1: $2 $3",

    // Status bar / scanning
    "Loading folders...": "Cargando carpetas...",
    "Finding files in: $1": "Buscando archivos en: $1",
    "$1 errors.": "$1 errores.",
    "$1 removed.": "$1 eliminados.",
    "$1 tracks in library.": "$1 pistas en la biblioteca.",
    "$1 $2 in MusicPenguin library.": "$1 $2 en la biblioteca de MusicPenguin.",
    "Tag scanning stopped.": "Análisis de etiquetas detenido.",
    "Tag scanning complete.": "Análisis de etiquetas completado.",
    "Reading tags $1 $2": "Leyendo etiquetas $1 $2",
    "Stopping...": "Deteniendo...",
    "file": "archivo",
    "files": "archivos",

    // Search
    "Search...": "Buscar...",
    "Invalid regular expression.": "Expresión regular no válida.",
    "Search on $1": "Buscar en $1",

    // Now playing / playback
    "Cannot play \"$1\"": "No se puede reproducir \"$1\"",
    "Cannot play \"$1\"\n\nInstall an external player like VLC to play this file format.": "No se puede reproducir \"$1\".\n\nInstale un reproductor externo como VLC para reproducir este formato de archivo.",
    "Unknown file": "Archivo desconocido",
    "This file appears to be mp3 data embedded in a wav container, unplayable by MusicPenguin.": "Este archivo parece contener datos MP3 dentro de un contenedor WAV y MusicPenguin no puede reproducirlo.",
    "This file is MPEG Layer II audio, which the built-in player cannot decode.": "Este archivo es audio MPEG Layer II, que el reproductor integrado no puede decodificar.",
    "Very sorry, but this file appears to be unplayable by MusicPenguin.": "Lo sentimos, pero parece que MusicPenguin no puede reproducir este archivo.",
    "Try to investigate its format with e.g. ffprobe or convert it with e.g. ffmpeg.": "Intente analizar su formato con, por ejemplo, ffprobe, o convertirlo con, por ejemplo, ffmpeg.",
    "Try to play in $1 instead": "Intente reproducirlo con $1 en su lugar",
    "OK": "Aceptar",

    // File operations
    "Failed to move file:\n$1": "No se pudo mover el archivo:\n$1",

    // Detail panel
    "Attributes of remote DLNA tracks cannot be edited. Only tracks stored on the local file system can.": "Los atributos de las pistas DLNA remotas no se pueden editar. Solo las pistas almacenadas en el sistema de archivos local son editables.",

    // Delete dialog
    "Where do you want to delete this file?": "¿Dónde desea eliminar este archivo?",
    "Where do you want to delete these $1 files?": "¿Dónde desea eliminar estos $1 archivos?",
    "From Library": "De la biblioteca",
    "In File System": "Del sistema de archivos",

    // Problematic files
    "No problematic files found.": "No se encontraron archivos problemáticos.",
    "1 problematic file, see $1": "1 archivo problemático, consulte $1",
    "$1 problematic files, see $2": "$1 archivos problemáticos, consulte $2",

    // About
    "About MusicPenguin": "Acerca de MusicPenguin",
    "Version $1": "Versión $1",
    "Icons License: $1": "Licencia de iconos: $1",

    // Main process
    "Error": "Error",
    "Could not open text editor. File saved at:\n$1": "No se pudo abrir el editor de texto. Archivo guardado en:\n$1",
    "Could not open file manager.": "No se pudo abrir el gestor de archivos.",
  },
};
