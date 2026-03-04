const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')

const PORT = 5199
let win = null
let backend = null

function startBackend() {
  const isPackaged = app.isPackaged
  let cmd, args

  if (isPackaged) {
    const bin = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'solicitationquoter-backend.exe')
      : path.join(process.resourcesPath, 'solicitationquoter-backend')
    cmd = bin; args = []
  } else {
    cmd = process.platform === 'win32' ? 'python' : 'python3'
    args = [path.join(__dirname, '..', 'python', 'server.py')]
  }

  backend = spawn(cmd, args, {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore','pipe','pipe'],
    windowsHide: true
  })
  backend.stdout.on('data', d => console.log('[backend]', d.toString().trim()))
  backend.stderr.on('data', d => console.log('[backend]', d.toString().trim()))
  backend.on('error', e => console.error('[backend error]', e.message))
}

function waitForBackend(tries = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    let n = 0
    const check = () => {
      n++
      const req = http.get(`http://127.0.0.1:${PORT}/ping`, res => {
        res.statusCode === 200 ? resolve() : retry()
      })
      req.on('error', retry)
      req.setTimeout(400, () => { req.destroy(); retry() })
    }
    const retry = () => n >= tries ? reject(new Error('Backend did not start')) : setTimeout(check, delay)
    check()
  })
}

function kill() {
  if (!backend) return
  try { process.platform === 'win32'
    ? spawn('taskkill',['/pid',String(backend.pid),'/f','/t'])
    : backend.kill('SIGTERM')
  } catch(e) {}
  backend = null
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 1000, minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0D1117', show: false,
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  win.loadFile(path.join(__dirname, 'loading.html'))
  win.once('ready-to-show', () => win.show())
  try {
    startBackend()
    await waitForBackend()
    win.loadFile(path.join(__dirname, 'index.html'))
  } catch(e) {
    win.loadFile(path.join(__dirname, 'error.html'))
  }
}

ipcMain.handle('get-port', () => PORT)
ipcMain.handle('open-file', () => dialog.showOpenDialog(win, {
  properties: ['openFile'],
  filters: [{ name: 'Documents', extensions: ['pdf','docx','doc','txt'] }]
}))
ipcMain.handle('save-quote', async (_, { bytes, name }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: name || 'Quote.docx',
    filters: [{ name: 'Word Document', extensions: ['docx'] }]
  })
  if (!r.canceled && r.filePath) {
    fs.writeFileSync(r.filePath, Buffer.from(bytes))
    shell.openPath(r.filePath)
    return { success: true }
  }
  return { success: false }
})
ipcMain.handle('open-url', (_, url) => shell.openExternal(url))
ipcMain.handle('pick-logo', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png','jpg','jpeg'] }]
  })
  if (r.canceled || !r.filePaths[0]) return { canceled: true }
  const buf = fs.readFileSync(r.filePaths[0])
  return {
    canceled: false,
    b64: buf.toString('base64'),
    ext: path.extname(r.filePaths[0]).replace('.','').toLowerCase(),
    name: path.basename(r.filePaths[0])
  }
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { kill(); if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', kill)
process.on('exit', kill)
