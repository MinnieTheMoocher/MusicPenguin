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
  runIncrementalScan: (files) => ipcRenderer.invoke("db:runIncrementalScan", files),
  getCoverArt: (filePath) => ipcRenderer.invoke("db:getCoverArt", filePath),
  stopTagRead: () => ipcRenderer.invoke("db:stopTagRead"),
  startTagRead: () => ipcRenderer.invoke("db:startTagRead"),
  searchFiles: (query) => ipcRenderer.invoke("db:searchFiles", query),
  lookupPaths: (paths) => ipcRenderer.invoke("db:lookupPaths", paths),
  prioritizeFiles: (orderedPaths) => ipcRenderer.invoke("db:prioritizeFiles", orderedPaths),
  rescanFiles: (paths) => ipcRenderer.invoke("db:rescanFiles", paths),
  deleteFiles: (paths) => ipcRenderer.invoke("db:deleteFiles", paths),
  deleteFilesFromDisk: (paths) => ipcRenderer.invoke("db:deleteFilesFromDisk", paths),
  setRating: (filePath, rating) => ipcRenderer.invoke("db:setRating", filePath, rating),
  moveFile: (oldPath, newPath) => ipcRenderer.invoke("db:moveFile", oldPath, newPath),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPlayableExtensions: () => ipcRenderer.invoke("app:getPlayableExtensions"),
  showInExternalFileExplorer: (filePath, isFolder) => ipcRenderer.invoke("shell:showInExternalFileExplorer", filePath, isFolder),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  openInVlc: (filePath) => ipcRenderer.invoke("shell:openInVlc", filePath),
  isVlcAvailable: () => ipcRenderer.invoke("shell:isVlcAvailable"),
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
});
