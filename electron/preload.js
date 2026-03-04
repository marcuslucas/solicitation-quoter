const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  getPort:    ()      => ipcRenderer.invoke('get-port'),
  openFile:   ()      => ipcRenderer.invoke('open-file'),
  saveQuote:  (opts)  => ipcRenderer.invoke('save-quote', opts),
  openUrl:    (url)   => ipcRenderer.invoke('open-url', url),
  pickLogo:   ()      => ipcRenderer.invoke('pick-logo'),
})
