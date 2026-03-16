const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  getPort:     ()      => ipcRenderer.invoke('get-port'),
  openFile:    ()      => ipcRenderer.invoke('open-file'),
  saveQuote:   (opts)  => ipcRenderer.invoke('save-quote', opts),
  openUrl:     (url)   => ipcRenderer.invoke('open-url', url),
  pickLogo:    ()      => ipcRenderer.invoke('pick-logo'),
  generatePdf: (opts)  => ipcRenderer.invoke('generate-pdf', opts),
  savePdf:     (opts)  => ipcRenderer.invoke('save-pdf', opts),
  exportData:  (opts)  => ipcRenderer.invoke('export-data', opts),
  openJsonFile: () => ipcRenderer.invoke('open-json-file'),
  storeApiKey: (key) => ipcRenderer.invoke('store-api-key', key),
  loadApiKey:  ()    => ipcRenderer.invoke('load-api-key'),
  clearApiKey: ()    => ipcRenderer.invoke('clear-api-key'),
})
