const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listWallpapers: () => ipcRenderer.invoke('wallpapers:list'),
  // main.js expects { index, targetPath } as a single object - this was
  // previously just forwarding `index` alone, silently dropping targetPath
  // and causing every apply to fail with "Invalid parameters".
  selectWallpaper: (index, targetPath) =>
    ipcRenderer.invoke('wallpapers:select', { index, targetPath }),
  getFolder: () => ipcRenderer.invoke('folder:get'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  // These three were missing entirely - renderer.js's delete/show-in-folder/
  // drag-and-drop-import features were calling functions that didn't exist.
  deleteWallpaper: (filePath) => ipcRenderer.invoke('wallpapers:delete', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('wallpapers:show-in-folder', filePath),
  addWallpapers: (filePaths) => ipcRenderer.invoke('wallpapers:add', filePaths),
});
