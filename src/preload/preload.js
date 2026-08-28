const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  showMessageBox: (opts) => ipcRenderer.invoke("dialog:showMessageBox", opts),
  scanFolder: (dirPath) => ipcRenderer.invoke("fs:scanFolder", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  listSubdirs: (dirPath) => ipcRenderer.invoke("fs:listSubdirs", dirPath),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  storeFiles: (files) => ipcRenderer.invoke("db:storeFiles", files),
  loadFiles: () => ipcRenderer.invoke("db:loadFiles"),
  clearDatabase: () => ipcRenderer.invoke("db:clearDatabase"),
  getProblematicFiles: () => ipcRenderer.invoke("db:getProblematicFiles"),
  getProblematicFileCount: () => ipcRenderer.invoke("db:getProblematicFileCount"),
  runIncrementalScan: (files, allowedPaths) => ipcRenderer.invoke("db:runIncrementalScan", files, allowedPaths),
  scanSpecificFiles: (files) => ipcRenderer.invoke("db:scanSpecificFiles", files),
  scanDlna: (servers) => ipcRenderer.invoke("dlna:scan", servers),
  getCoverArt: (filePath, maxSize) => ipcRenderer.invoke("db:getCoverArt", filePath, maxSize),
  getCoverArtGroups: (filePath) => ipcRenderer.invoke("db:getCoverArtGroups", filePath),
  stopTagRead: () => ipcRenderer.invoke("db:stopTagRead"),
  startTagRead: () => ipcRenderer.invoke("db:startTagRead"),
  searchFiles: (query) => ipcRenderer.invoke("db:searchFiles", query),
  lookupPaths: (paths) => ipcRenderer.invoke("db:lookupPaths", paths),
  prioritizeFiles: (orderedPaths) => ipcRenderer.invoke("db:prioritizeFiles", orderedPaths),
  rescanFiles: (paths, opts) => ipcRenderer.invoke("db:rescanFiles", paths, opts),
  deleteFiles: (paths) => ipcRenderer.invoke("db:deleteFiles", paths),
  deleteFilesFromDisk: (paths) => ipcRenderer.invoke("db:deleteFilesFromDisk", paths),
  setRating: (filePath, rating) => ipcRenderer.invoke("db:setRating", filePath, rating),
  fillTrackDuration: (filePath, seconds) => ipcRenderer.invoke("db:fillDuration", filePath, seconds),
  moveFile: (oldPath, newPath) => ipcRenderer.invoke("db:moveFile", oldPath, newPath),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPlayableExtensions: () => ipcRenderer.invoke("app:getPlayableExtensions"),
  showInExternalFileExplorer: (filePath, isFolder) => ipcRenderer.invoke("shell:showInExternalFileExplorer", filePath, isFolder),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  openInExternalPlayer: (filePaths, player) => ipcRenderer.invoke("shell:openInExternalPlayer", filePaths, player),
  isExternalPlayerAvailable: (player) => ipcRenderer.invoke("shell:isExternalPlayerAvailable", player),
  checkCommand: (command) => ipcRenderer.invoke("shell:checkCommand", command),
  incrementPlaycount: (filePath) => ipcRenderer.invoke("db:incrementPlaycount", filePath),
  savePlaylist: (paths) => ipcRenderer.invoke("playlist:save", paths),
  loadPlaylist: () => ipcRenderer.invoke("playlist:load"),
  savePlaylistStateFile: (paths) => ipcRenderer.invoke("playlist:saveStateFile", paths),
  loadPlaylistStateFile: () => ipcRenderer.invoke("playlist:loadStateFile"),
  onTagUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("tags:updated", handler);
    return () => ipcRenderer.removeListener("tags:updated", handler);
  },
  saveNowPlayingSync: (data) => ipcRenderer.sendSync("now-playing:save", data),
  saveSettingsSync: (settings) => ipcRenderer.sendSync("settings:saveSync", settings),
  onTagScanning: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("tags:scanning", handler);
    return () => ipcRenderer.removeListener("tags:scanning", handler);
  },
  onDlnaProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("dlna:progress", handler);
    return () => ipcRenderer.removeListener("dlna:progress", handler);
  },
  onDlnaServersChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("dlna:servers-changed", handler);
    return () => ipcRenderer.removeListener("dlna:servers-changed", handler);
  },
  onLibraryChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("library:changed", handler);
    return () => ipcRenderer.removeListener("library:changed", handler);
  },
  onDurationsFixed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("library:durations-fixed", handler);
    return () => ipcRenderer.removeListener("library:durations-fixed", handler);
  },
  onMediaKey: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("media-key", handler);
    return () => ipcRenderer.removeListener("media-key", handler);
  },
  updateMprisState: (state) => ipcRenderer.send("mpris:updateState", state),
  debugLog: (line) => ipcRenderer.invoke("debug:log", line),
});
