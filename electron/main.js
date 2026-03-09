const { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')

const PORT = 5199
let win = null
let backend = null

// ── WINDOW BOUNDS ─────────────────────────────────────────────────────────────
const boundsPath = path.join(app.getPath('userData'), 'window-bounds.json')

function loadWindowBounds() {
  try { return JSON.parse(fs.readFileSync(boundsPath, 'utf8')) } catch(e) { return {} }
}

function saveWindowBounds() {
  if (!win) return
  try { fs.writeFileSync(boundsPath, JSON.stringify(win.getBounds())) } catch(e) {}
}

let boundsTimer = null
function scheduleSaveBounds() {
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(saveWindowBounds, 500)
}

function isOnScreen(bounds) {
  const { screen } = require('electron')
  return screen.getAllDisplays().some(d => {
    const { x, y, width, height } = d.workArea
    return bounds.x >= x && bounds.y >= y &&
           bounds.x + bounds.width <= x + width &&
           bounds.y + bounds.height <= y + height
  })
}

// ── BACKEND ───────────────────────────────────────────────────────────────────
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
  const saved = loadWindowBounds()
  const defaultWidth = 1280, defaultHeight = 860
  const useSaved = saved.width && saved.height && isOnScreen(saved)

  win = new BrowserWindow({
    width:     useSaved ? saved.width  : defaultWidth,
    height:    useSaved ? saved.height : defaultHeight,
    x:         useSaved ? saved.x      : undefined,
    y:         useSaved ? saved.y      : undefined,
    minWidth: 1000, minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#030C03', show: false,
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation: true, nodeIntegration: false }
  })

  win.on('resize', scheduleSaveBounds)
  win.on('move',   scheduleSaveBounds)
  win.on('close',  saveWindowBounds)

  // ── NATIVE CONTEXT MENU ───────────────────────────────────────────────────
  win.webContents.on('context-menu', (e, params) => {
    const menu = new Menu()
    if (params.isEditable) {
      if (params.selectionText) {
        menu.append(new MenuItem({ role: 'cut',  label: 'Cut'  }))
        menu.append(new MenuItem({ role: 'copy', label: 'Copy' }))
      } else {
        menu.append(new MenuItem({ role: 'copy', label: 'Copy', enabled: false }))
      }
      menu.append(new MenuItem({ role: 'paste',     label: 'Paste'      }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ role: 'selectAll', label: 'Select All' }))
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy', label: 'Copy' }))
    }
    if (menu.items.length) menu.popup({ window: win })
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

// ── IPC HANDLERS ──────────────────────────────────────────────────────────────
ipcMain.handle('get-port', () => PORT)

ipcMain.handle('open-file', () => dialog.showOpenDialog(win, {
  properties: ['openFile'],
  filters: [{ name: 'Documents', extensions: ['pdf','docx','doc','txt'] }]
}))

ipcMain.handle('save-quote', async (_, { bytes, name }) => {
  const outputDir = path.join(app.getPath('documents'), 'SolQuoter Quotes')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(outputDir, name || 'Quote.docx'),
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

ipcMain.handle('generate-pdf', async (_, { html }) => {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false, contextIsolation: true } })
  try {
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const data = await pdfWin.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', marginsType: 1 })
    return Array.from(data)
  } finally {
    pdfWin.destroy()
  }
})

ipcMain.handle('save-pdf', async (_, { bytes, name }) => {
  const outputDir = path.join(app.getPath('documents'), 'SolQuoter Quotes')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(outputDir, name || 'Quote.pdf'),
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  })
  if (!r.canceled && r.filePath) {
    fs.writeFileSync(r.filePath, Buffer.from(bytes))
    shell.openPath(r.filePath)
    return { success: true }
  }
  return { success: false }
})

ipcMain.handle('pick-logo', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png','jpg','jpeg'] }]
  })
  if (r.canceled || !r.filePaths[0]) return { canceled: true }
  const buf = fs.readFileSync(r.filePaths[0])
  const MAX_LOGO = 2 * 1024 * 1024
  if (buf.length > MAX_LOGO) {
    return { canceled: true, error: `Logo is too large (${(buf.length/1048576).toFixed(1)} MB). Maximum size is 2 MB.` }
  }
  return {
    canceled: false,
    b64: buf.toString('base64'),
    ext: path.extname(r.filePaths[0]).replace('.','').toLowerCase(),
    name: path.basename(r.filePaths[0])
  }
})

ipcMain.handle('export-data', async (_, { content, filename, ext }) => {
  const outputDir = path.join(app.getPath('documents'), 'SolQuoter Quotes')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const filterName = ext === 'json' ? 'JSON File' : 'CSV File'
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(outputDir, filename),
    filters: [{ name: filterName, extensions: [ext] }]
  })
  if (!r.canceled && r.filePath) {
    fs.writeFileSync(r.filePath, content, 'utf8')
    return { success: true }
  }
  return { success: false }
})

// ── APP LIFECYCLE ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow)
app.on('window-all-closed', () => { kill(); if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', kill)
process.on('exit', kill)
