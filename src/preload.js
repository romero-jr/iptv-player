const { contextBridge, ipcRenderer } = require('electron');
const { platform } = require('process');

contextBridge.exposeInMainWorld('electronAPI', {
  platform,
  fetchM3U: (url) => ipcRenderer.invoke('fetch-m3u', url),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveData: (key, value) => ipcRenderer.invoke('save-data', key, value),
  loadData: (key) => ipcRenderer.invoke('load-data', key),
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_, path) => callback(path)),
});
