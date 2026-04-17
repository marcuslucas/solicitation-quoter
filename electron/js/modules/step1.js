// electron/js/modules/step1.js
// Step 1: Upload Solicitation
// Depends on: window.S (state.js), window.esc/fmt/toast/goTo/next/render (utils.js)
// window.api (preload contextBridge)

// ── STEP 1 PRIVATE HELPERS ────────────────────────────────────────────────────

function toggleQuickActions() {
  const trigger = document.getElementById('sd-trigger')
  const items = document.getElementById('sd-items')
  if (!trigger || !items) return
  const open = items.classList.toggle('open')
  trigger.classList.toggle('open', open)
  trigger.setAttribute('aria-expanded', open)
}

function onDragOver(e) { e.preventDefault(); document.getElementById('dz').classList.add('over') }
function onDragLeave() { document.getElementById('dz').classList.remove('over') }

// SEC-02/SEC-03: validate dropped file type by extension before accepting.
// Returns true if valid, shows error and returns false if not.
function validateDroppedFile(f) {
  if (!f) return false
  // Folders: File object with size 0 and no usable extension, or webkitRelativePath set
  if (f.webkitRelativePath && f.webkitRelativePath !== '') {
    showFileError('Folders are not supported — please drop a PDF, DOCX, TXT, or XLSX file.')
    return false
  }
  const name = (f.name || '').toLowerCase()
  if (!name.match(/\.(pdf|docx|doc|txt|xlsx|xls)$/)) {
    showFileError('Unsupported file type — only PDF, DOCX, TXT, and XLSX files are accepted.')
    return false
  }
  return true
}

function showFileError(msg) {
  const errEl = document.getElementById('parse-err')
  if (errEl) {
    errEl.classList.remove('hidden')
    errEl.innerHTML = `<div class="alert alert-error">${msg}</div>`
  }
  // Also clear any previously accepted file
  const fi = document.getElementById('file-info')
  if (fi) fi.classList.add('hidden')
  const btn = document.getElementById('parse-btn')
  if (btn) btn.disabled = true
  window.S.file = null; window.S.filePath = null; window.S.files = []
}

function onDrop(e) {
  e.preventDefault()
  document.getElementById('dz').classList.remove('over')
  const dropped = Array.from(e.dataTransfer.files).filter(f => validateDroppedFile(f))
  if (dropped.length) {
    window.S.files = dropped; window.S.file = dropped[0]; window.S.filePath = null
    showFiles(dropped)
  }
}

async function pickFile() {
  const input = document.getElementById('file-input')
  if (input) {
    input.value = ''
    input.click()
  } else if (window.api) {
    const r = await window.api.openFile()
    if (!r.canceled && r.filePaths[0]) {
      window.S.filePath = r.filePaths[0]; window.S.file = null; window.S.files = []
      showFiles([{ name: r.filePaths[0].split(/[/\\]/).pop() }])
    }
  }
}

function showFiles(files) {
  const fi = document.getElementById('file-info'); if (!fi) return
  fi.classList.remove('hidden')
  const list = document.getElementById('file-list')
  if (list) {
    list.innerHTML = files.map(f =>
      `<div><strong>${esc(f.name)}</strong>${f.size ? `<span style="font-size:11px;margin-left:6px;color:var(--color-text-muted)">${fmt(f.size)}</span>` : ''}</div>`
    ).join('')
  }
  document.getElementById('parse-btn').disabled = false
  document.getElementById('tf').textContent = files[0] ? files[0].name : ''
}

function showFile(f) { showFiles([f]) }

function clearFile() {
  window.S.file = null; window.S.filePath = null; window.S.files = []
  document.getElementById('file-info').classList.add('hidden')
  document.getElementById('parse-btn').disabled = true
  document.getElementById('tf').textContent = ''
  const input = document.getElementById('file-input')
  if (input) input.value = ''
}

async function doParse() {
  const prog = document.getElementById('parse-prog')
  const err  = document.getElementById('parse-err')
  const btn  = document.getElementById('parse-btn')
  const msg  = document.getElementById('parse-msg')
  const bar  = document.getElementById('prog')
  prog.classList.remove('hidden'); err.classList.add('hidden'); btn.disabled = true
  const p = (pct, m) => { bar.style.width=pct+'%'; msg.textContent=m }
  const controller = new AbortController()
  const abortTimeout = setTimeout(() => controller.abort(), 30000)
  try {
    // SEC-02/SEC-03: Belt-and-suspenders file type check before upload
    const allFiles = window.S.files && window.S.files.length > 0 ? window.S.files : (window.S.file ? [window.S.file] : [])
    const hasSolicitation = allFiles.length > 0
      ? allFiles.some(f => (f.name || '').match(/\.(pdf|docx|doc|txt)$/i))
      : (window.S.filePath ? window.S.filePath.split(/[/\\]/).pop().match(/\.(pdf|docx|doc|txt)$/i) : false)
    if (!hasSolicitation) {
      throw new Error('Please include a PDF or DOCX solicitation document.')
    }
    try {
      await window.api.clearSession(window.S.port)
    } catch (e) {
      console.warn('[step1] Session clear failed (non-fatal):', e.message)
    }
    p(15, 'Uploading document...')
    const fd = new FormData()
    if (allFiles.length > 0) {
      allFiles.forEach(f => fd.append('file', f))
    } else if (window.S.filePath) {
      const resp2 = await fetch('file:///'+window.S.filePath.replace(/\\/g,'/')).catch(()=>null)
      if (resp2) {
        const blob = await resp2.blob()
        const name = window.S.filePath.split(/[/\\]/).pop()
        fd.append('file', blob, name)
      } else {
        throw new Error('Could not read file. Try drag-and-drop instead.')
      }
    } else throw new Error('No file selected')
    p(40, 'Parsing document...')
    const r = await fetch(`http://127.0.0.1:${window.S.port}/parse`, { method:'POST', body:fd, signal: controller.signal })
    clearTimeout(abortTimeout)
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}))
      throw new Error(errBody.error || `Server error (HTTP ${r.status})`)
    }
    p(75, window.S.apiKey ? 'Running AI extraction...' : 'Extracting data...')
    const data = await r.json()
    if (!data.success) throw new Error(data.error || 'Extraction failed')
    p(100, 'Done!')
    window.S.extracted = data.data
    window.S.sessionFiles = data._session_files || {}
    // Store confidence data for step 2 rendering (Phase 8)
    window.S.confidence = {
      overallConfidence: data.overallConfidence || null,
      fields: data.fields || [],
      flags: data.flags || []
    }
    // Store source file type for PDF viewer visibility check (use primary file)
    const _primaryFile = (window.S.files && window.S.files.length > 0) ? window.S.files[0] : window.S.file
    const _srcName = _primaryFile ? _primaryFile.name : (window.S.filePath ? window.S.filePath.split(/[/\\]/).pop() : '')
    window.S.sourceType = _srcName.toLowerCase().endsWith('.pdf') ? 'pdf'
      : (_srcName.toLowerCase().endsWith('.docx') || _srcName.toLowerCase().endsWith('.doc')) ? 'docx'
      : 'txt'
    // Store source file reference for PDF viewer (Plan 05)
    window.S.sourceFile = _primaryFile || window.S.file
    // Populate line items immediately from parse result
    // Priority: bundle line_items > ai_line_items > quantities
    const bundleItems = Array.isArray(data.data.line_items) ? data.data.line_items.filter(i=>i&&typeof i==='object') : []
    const aiItems = Array.isArray(data.data.ai_line_items) ? data.data.ai_line_items.filter(i=>i&&typeof i==='object') : []
    if (bundleItems.length) {
      window.S.items = bundleItems.map((i,idx) => ({
        id:               idx + 1,
        description:      String(i.description || ''),
        size:             String(i.size || ''),
        unit:             String(i.unit || 'EA'),
        qty:              i.qty ?? '',
        unit_price:       i.unit_price ?? '',
        // Phase 1 enrichment fields — used by detail panel in Step 3
        sow_section:      i.sow_section      ?? null,
        spec_text:        i.spec_text        ?? null,
        source_page:      i.source_page      ?? null,
        source_file:      i.source_file      ?? null,
        _source:          i._source          ?? null,
        qty_total:        i.qty_total        ?? null,
        manufacturer_ref: i.manufacturer_ref ?? null,
        part_number:      i.part_number      ?? null,
        quantities_by_period: i.quantities_by_period ?? null,
      }))
    } else if (aiItems.length) {
      window.S.items = aiItems.map((i,idx) => ({
        id:idx+1, description:String(i.description||''), size:String(i.size||''),
        unit:String(i.unit||'EA'), qty:i.qty??'', unit_price:i.unit_price??''
      }))
    } else if (data.data.quantities?.length) {
      window.S.items = data.data.quantities.map((q,idx) => ({
        id:idx+1, description: data.data.project_title||'', size:q.size||'', unit:'EA', qty:q.qty||'', unit_price:''
      }))
    }
    window.S.done.add(1)
    setTimeout(() => goTo(2), 500)
  } catch(e) {
    clearTimeout(abortTimeout)
    if (e.name === 'AbortError') {
      e.message = 'Parsing timed out. The file may be too large or corrupted — try a smaller document.'
    }
    err.classList.remove('hidden')
    let msg = e.message || 'An unknown error occurred'
    // Per D-02: distinguish specific failure scenarios
    if (e.message && e.message.includes('Failed to fetch')) {
      msg = 'Could not reach the backend server. Make sure the application is fully started and try again.'
    } else if (e.message && e.message.includes('timed out')) {
      msg = 'Extraction timed out — try a smaller file or check your connection.'
    } else if (e.message && e.message.includes('No file selected')) {
      msg = 'No file selected — please upload a PDF, DOCX, or TXT file first.'
    }
    // Per D-03, D-04: display in parse-err using alert-error class; surface backend error verbatim
    err.innerHTML = `<div class="alert alert-error">${esc(msg)}</div>`
    btn.disabled = false; p(0,'')
  }
}

// ── WHOLE-APP DRAG-AND-DROP (page 1 only) ────────────────────────────────────
;(function() {
  let dragDepth = 0
  const overlay = () => document.getElementById('app-drop-overlay')
  document.addEventListener('dragenter', e => {
    if (window.S.step !== 1) return
    dragDepth++
    overlay().classList.add('active')
  })
  document.addEventListener('dragleave', e => {
    if (window.S.step !== 1) return
    dragDepth--
    if (dragDepth <= 0) { dragDepth = 0; overlay().classList.remove('active') }
  })
  document.addEventListener('dragover', e => { if (window.S.step === 1) e.preventDefault() })
  document.addEventListener('drop', e => {
    if (window.S.step !== 1) return
    e.preventDefault()
    dragDepth = 0
    overlay().classList.remove('active')
    document.getElementById('dz')?.classList.remove('over')
    const dropped = Array.from(e.dataTransfer.files).filter(f => validateDroppedFile(f))
    if (dropped.length) {
      window.S.files = dropped; window.S.file = dropped[0]; window.S.filePath = null
      showFiles(dropped)
    }
  })
})()

// ── STEP 1 RENDER ─────────────────────────────────────────────────────────────

function step1(c) {
  const resumeBanner = window.S._pendingSession ? `
    <div class="alert alert-info" style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <strong>Resume in-progress quote</strong>
        <div style="font-size:11px;margin-top:2px">${esc(window.S._pendingSession.extracted?.solicitation_number||'')} ${esc(window.S._pendingSession.extracted?.project_title||'')}</div>
      </div>
      <button class="btn btn-primary btn-sm" id="resume-session-btn">Resume</button>
      <button class="btn btn-ghost btn-sm" id="dismiss-session-btn">Dismiss</button>
    </div>` : ''

  c.innerHTML = `
  ${resumeBanner}
  <div class="card">
    <div class="card-title"><span class="dot"></span>Select Solicitation Document</div>
    <input type="file" id="file-input" multiple accept=".pdf,.docx,.doc,.txt,.xlsx,.xls" style="display:none">
    <div class="dropzone" id="dz" tabindex="0">
      <div class="dz-title">Drop your solicitation files here</div>
      <div class="dz-sub">or click to browse — select up to 3 files</div>
      <div class="dz-types"><span class="pill">PDF</span><span class="pill">DOCX</span><span class="pill">TXT</span><span class="pill">XLSX</span></div>
    </div>
    <div id="file-info" class="hidden" style="margin-top:14px">
      <div class="alert alert-success" style="align-items:flex-start">
        <div id="file-list" style="flex:1"></div>
        <button class="btn btn-ghost btn-sm ml-auto" id="clear-file-btn">&#x2715;</button>
      </div>
    </div>
  </div>
  <div class="speed-dial">
    <button class="sd-trigger" id="sd-trigger" aria-label="Quick actions" aria-expanded="false" title="Quick actions"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5.5" y1="0" x2="5.5" y2="11"/><line x1="0" y1="5.5" x2="11" y2="5.5"/></svg></button>
    <div class="sd-items" id="sd-items">
      <button class="btn btn-ghost btn-sm sd-item" id="qa-ai-btn">AI Extraction${window.S.apiKey ? ' <span style="color:var(--color-success);font-size:10px">&#9679; active</span>' : ''}</button>
      <button class="btn btn-ghost btn-sm sd-item" id="qa-sam-btn">SAM.gov Lookup</button>
      <button class="btn btn-ghost btn-sm sd-item" id="qa-demo-btn">Load Demo Data</button>
    </div>
  </div>
  <div class="btn-row">
    <button class="btn btn-primary btn-lg" id="parse-btn" disabled>Extract Solicitation Data</button>
  </div>
  <div id="parse-prog" class="hidden" style="margin-top:12px">
    <div class="alert alert-info"><div class="spin"></div><span id="parse-msg" style="margin-left:8px">Uploading...</span></div>
    <div class="progress"><div class="progress-fill" id="prog" style="width:0%"></div></div>
  </div>
  <div id="parse-err" class="hidden"></div>`

  // Wire file input change event
  const fileInput = document.getElementById('file-input')
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const selected = Array.from(fileInput.files).filter(f => validateDroppedFile(f))
      if (selected.length) {
        window.S.files = selected; window.S.file = selected[0]; window.S.filePath = null
        showFiles(selected)
      }
    })
  }

  // Wire dropzone
  const dz = document.getElementById('dz')
  if (dz) {
    dz.addEventListener('click', pickFile)
    dz.addEventListener('drop', onDrop)
    dz.addEventListener('dragover', onDragOver)
    dz.addEventListener('dragleave', onDragLeave)
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile() } })
  }

  // Wire buttons
  document.getElementById('parse-btn')?.addEventListener('click', doParse)
  document.getElementById('clear-file-btn')?.addEventListener('click', clearFile)
  document.getElementById('sd-trigger')?.addEventListener('click', toggleQuickActions)

  // Wire quick action items (functions still live in index.html script block)
  document.getElementById('qa-ai-btn')?.addEventListener('click', () => window.openAiModal?.())
  document.getElementById('qa-sam-btn')?.addEventListener('click', () => window.openSamModal?.())
  document.getElementById('qa-demo-btn')?.addEventListener('click', () => window.loadDemoData?.())

  // Wire resume/dismiss session buttons if present
  document.getElementById('resume-session-btn')?.addEventListener('click', () => window.resumeSession?.())
  document.getElementById('dismiss-session-btn')?.addEventListener('click', () => window.dismissSession?.())

  // Restore visual state if file(s) already selected
  if (window.S.files && window.S.files.length > 0) showFiles(window.S.files)
  else if (window.S.file) showFiles([window.S.file])
  else if (window.S.filePath) showFiles([{ name: window.S.filePath.split(/[/\\]/).pop() }])
}

function init() {
  // Step1 has no static DOM elements that need init-time wiring
  // (all elements are created by step1(c) which wires them after render)
}

window.step1 = step1
window.initStep1 = init
