// electron/js/modules/step2.js
// Step 2: Review Extracted Data
// Depends on: window.S (state.js), window.esc/toast/goTo/next (utils.js)

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const SCOPE_MAX_DISPLAY = '3,000'

// ── PDF VIEWER STATE ──────────────────────────────────────────────────────────
let _pdfDoc = null

async function loadPdfViewer() {
  try {
    // PDF.js initialized by js/init-pdfjs.js module script at page load
    const pdfjsLib = window.pdfjsLib
    if (!pdfjsLib) throw new Error('PDF.js not loaded')

    // Get the source file as ArrayBuffer
    const file = window.S.sourceFile
    if (!file) {
      const panel = document.getElementById('pdf-viewer-panel')
      if (panel) panel.innerHTML = '<div style="padding:var(--space-md);color:var(--color-text-muted)">PDF preview requires re-uploading the document in this session.</div>'
      return
    }
    const arrayBuffer = await file.arrayBuffer()

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    _pdfDoc = await loadingTask.promise

    // Render first page
    await renderPdfPage(1)
  } catch (err) {
    console.error('PDF viewer load error:', err)
    const panel = document.getElementById('pdf-viewer-panel')
    if (panel) panel.innerHTML = '<div style="padding:var(--space-md);color:var(--color-text-muted)">Could not load PDF preview.</div>'
  }
}

async function renderPdfPage(pageNum) {
  if (!_pdfDoc) return
  const page = await _pdfDoc.getPage(pageNum)
  const canvas = document.getElementById('pdf-canvas')
  if (!canvas) return
  // Wait for CSS transition/layout to complete before measuring width
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const ctx = canvas.getContext('2d')
  // Scale to fit panel width — fall back to main content area width if panel not yet laid out
  const panelWidth = (canvas.parentElement?.offsetWidth || 0) > 50
    ? canvas.parentElement.offsetWidth
    : (document.querySelector('.content')?.offsetWidth || document.querySelector('.card')?.offsetWidth || 600)
  const unscaledViewport = page.getViewport({ scale: 1 })
  const scale = panelWidth / unscaledViewport.width
  const viewport = page.getViewport({ scale })
  canvas.height = viewport.height
  canvas.width = viewport.width
  await page.render({ canvasContext: ctx, viewport }).promise
}

window.scrollPdfToBoundingBox = async function(bbox) {
  // bbox: { page, x0, y0, x1, y1 }
  if (!bbox || !bbox.page) return

  const pdfPanel = document.getElementById('pdf-viewer-panel')
  const pdfToggle = document.getElementById('pdf-toggle-btn')

  // Expand panel if collapsed (D-25)
  if (pdfPanel && pdfPanel.classList.contains('collapsed')) {
    pdfPanel.classList.remove('collapsed')
    pdfPanel.classList.add('expanded')
    if (pdfToggle) pdfToggle.textContent = 'Hide PDF'
    if (!_pdfDoc) await loadPdfViewer()
  }

  if (!_pdfDoc) return

  // Navigate to the correct page
  await renderPdfPage(bbox.page)

  // Scroll canvas container to approximate y position
  // pdfplumber coordinates: y0 is distance from top of page in points (72 dpi)
  const canvas = document.getElementById('pdf-canvas')
  if (!canvas) return
  const page = await _pdfDoc.getPage(bbox.page)
  const unscaledViewport = page.getViewport({ scale: 1 })
  const panelWidth = canvas.parentElement?.offsetWidth || 600
  const scale = panelWidth / unscaledViewport.width
  // pdfplumber y0 is from top; PDF.js viewport also measures from top
  const scrollY = bbox.y0 * scale - 50 // 50px offset to show context above
  if (pdfPanel) {
    pdfPanel.scrollTop = Math.max(0, scrollY)
  }
}

// ── STEP 2 RENDER ─────────────────────────────────────────────────────────────

function step2(c) {
  _pdfDoc = null  // Reset PDF doc reference on re-render
  const d = window.S.extracted
  const m = d._method||'rules'
  const badge = m === 'demo'
    ? '<span class="mbadge rules">Demo Data — edit any field below</span>'
    : m.includes('ai')
      ? '<span class="mbadge ai">AI + Rule-Based Extraction</span>'
      : m === 'sam_gov'
        ? '<span class="mbadge ai">SAM.gov Lookup</span>'
        : '<span class="mbadge rules">Rule-Based Extraction</span>'

  // Confidence badge per D-19, D-23
  const conf = window.S.confidence || {}
  const oc = conf.overallConfidence
  let confBadgeHtml = ''
  if (oc !== null && oc !== undefined) {
    let badgeClass, badgeLabel
    if (oc >= 95) {
      badgeClass = 'mbadge ai'
      badgeLabel = `${oc}% Confidence`
    } else if (oc >= 70) {
      badgeClass = 'mbadge rules'
      badgeLabel = `${oc}% Confidence &mdash; review flagged fields`
    } else {
      badgeClass = 'mbadge'
      badgeLabel = `${oc}% Confidence &mdash; low accuracy, review all fields`
    }
    confBadgeHtml = `<div class="confidence-badge"><span class="${badgeClass}"${oc < 70 ? ' style="background:var(--color-error);color:var(--color-contrast-dark)"' : ''}>${badgeLabel}</span></div>`
  }

  const fields = [
    ['solicitation_number','Solicitation #',false],['project_title','Project Title',true],
    ['solicitation_type','Type',false],['issuing_agency','Issuing Agency',false],
    ['due_date','Response Due Date',false],['posting_date','Posting Date',false],
    ['contact_name','Contact Name',false],['contact_email','Contact Email',false],
    ['contact_phone','Contact Phone',false],['naics_code','NAICS Code',false],
    ['psc_code','PSC Code',false],['set_aside','Set-Aside',false],
    ['place_of_performance','Place of Performance',true],
    ['period_of_performance','Period of Performance',false],['estimated_value','Est. Value',false],
  ]

  // Build flagged field lookup from confidence data
  const flaggedFields = {}
  if (conf.fields) {
    conf.fields.forEach(f => {
      if (f.status === 'flagged') {
        flaggedFields[f.name] = f
      }
    })
  }

  const items = fields.map(([k, lbl, wide]) => {
    const flagged = flaggedFields[k]
    const invalidClass = flagged ? ' invalid' : ''
    const flagHtml = flagged
      ? `<div class="field-confidence"><span class="conf-pct">${flagged.confidence}% confidence</span><span class="conf-issue"> &mdash; ${esc(flagged.issue || '')}</span></div>`
      : ''
    return `
      <div class="data-item${wide ? ' s2' : ''}">
        <div class="data-label">${lbl}</div>
        <input data-field="${k}" class="${invalidClass}" value="${esc(String(d[k] || ''))}" placeholder="Not found"${flagged && flagged.boundingBox ? ` data-bbox='${JSON.stringify(flagged.boundingBox)}'` : ''} />
        ${flagHtml}
      </div>`
  }).join('')

  const qtys = d.quantities||[]
  const qhtml = qtys.length ? `<div class="card">
    <div class="card-title"><span class="dot"></span>Detected Quantities</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${qtys.map(q=>`<div style="background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:6px;padding:8px 14px;text-align:center">
        <div style="font-size:10px;color:var(--color-text-muted)">${q.size}</div>
        <div style="font-size:20px;font-weight:700;color:var(--color-primary)">${q.qty}</div>
      </div>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--color-text-muted);margin-top:8px">These will pre-fill your quote line items.</div>
  </div>` : ''

  // PDF viewer panel per D-24, D-27 — only for PDF sources
  const isPdf = window.S.sourceType === 'pdf'
  const pdfPanelHtml = isPdf ? `
    <div class="card">
      <button class="btn btn-sm" id="pdf-toggle-btn" style="text-transform:uppercase;letter-spacing:0.6px;font-weight:600;font-size:var(--text-base)">View PDF Source</button>
      <div id="pdf-viewer-panel" class="pdf-viewer-panel collapsed">
        <canvas id="pdf-canvas"></canvas>
      </div>
    </div>` : ''

  // Scope truncation banner per D-01, D-02, D-03
  const scopeTruncated = d.scope_truncated === true
  const scopeBanner = scopeTruncated
    ? `<div class="alert alert-warn" id="scope-trunc-banner">Scope truncated at ${SCOPE_MAX_DISPLAY} characters <button class="btn btn-sm" id="scope-expand-btn" style="margin-left:var(--space-sm)">View full text</button></div>`
    : ''
  const scopeFullBlock = scopeTruncated
    ? `<div id="scope-full-block" class="scope-full-text hidden">${esc(d.scope_full || d.scope_of_work || '')}</div>`
    : ''

  c.innerHTML = `
  ${badge}
  ${confBadgeHtml}
  <div class="card">
    <div class="card-title"><span class="dot"></span>Extracted Fields <span class="text-muted" style="font-weight:400;font-size:12px;margin-left:6px">&mdash; click any field to edit</span></div>
    <div class="data-grid">${items}</div>
  </div>
  <div class="card">
    <div class="card-title"><span class="dot"></span>Scope of Work / Description</div>
    ${scopeBanner}
    <textarea id="scope-ta" rows="6">${esc(d.scope_of_work||'')}</textarea>
    <div class="char-count" id="scope-count">${(d.scope_of_work||'').length} / ${SCOPE_MAX_DISPLAY}</div>
    ${scopeFullBlock}
  </div>
  ${qhtml}
  ${pdfPanelHtml}
  <div class="btn-row">
    <button class="btn btn-ghost" style="margin-right:auto" id="step2-clear-btn">Clear Fields</button>
    <button class="btn btn-ghost" id="step2-back-btn">&#x2190; Back</button>
    <button class="btn btn-primary" id="step2-next-btn">Company Info &amp; Lines &#x2192;</button>
  </div>`

  // Wire all data-field inputs (text fields)
  c.querySelectorAll('input[data-field]').forEach(el => {
    el.addEventListener('input', e => {
      window.S.extracted[e.target.dataset.field] = e.target.value
    })
    el.addEventListener('change', e => {
      window.S.extracted[e.target.dataset.field] = e.target.value
    })
  })

  // Wire scope of work textarea
  const scopeTa = document.getElementById('scope-ta')
  const scopeCount = document.getElementById('scope-count')
  if (scopeTa) {
    scopeTa.addEventListener('input', e => {
      window.S.extracted.scope_of_work = e.target.value
      if (scopeCount) scopeCount.textContent = e.target.value.length + ' / ' + SCOPE_MAX_DISPLAY
    })
  }

  // Scope expand/collapse toggle per D-02, D-03
  const expandBtn = document.getElementById('scope-expand-btn')
  const fullBlock = document.getElementById('scope-full-block')
  if (expandBtn && fullBlock) {
    expandBtn.addEventListener('click', () => {
      const isHidden = fullBlock.classList.contains('hidden')
      fullBlock.classList.toggle('hidden')
      expandBtn.textContent = isHidden ? 'Collapse full text' : 'View full text'
    })
  }

  // PDF viewer toggle per D-24
  const pdfToggle = document.getElementById('pdf-toggle-btn')
  const pdfPanel = document.getElementById('pdf-viewer-panel')
  if (pdfToggle && pdfPanel) {
    let pdfLoaded = false
    pdfToggle.addEventListener('click', async () => {
      const isCollapsed = pdfPanel.classList.contains('collapsed')
      if (isCollapsed) {
        pdfPanel.classList.remove('collapsed')
        pdfPanel.classList.add('expanded')
        pdfToggle.textContent = 'Hide PDF'
        if (!pdfLoaded) {
          await loadPdfViewer()
          pdfLoaded = true
        }
      } else {
        pdfPanel.classList.remove('expanded')
        pdfPanel.classList.add('collapsed')
        pdfToggle.textContent = 'View PDF Source'
      }
    })
  }

  // Wire action buttons
  document.getElementById('step2-clear-btn')?.addEventListener('click', () => {
    window.clearExtracted?.()
  })
  document.getElementById('step2-back-btn')?.addEventListener('click', () => goTo(1))
  document.getElementById('step2-next-btn')?.addEventListener('click', () => next())

  // NAICS/PSC format validation on blur per D-29, D-30, D-31
  const naicsInput = c.querySelector('input[data-field="naics_code"]')
  const pscInput = c.querySelector('input[data-field="psc_code"]')

  function addBlurValidation(input, pattern, errorMsg) {
    if (!input) return
    input.addEventListener('blur', () => {
      // Strip description after colon (e.g. "339113: Surgical Appliance..." → "339113")
      const val = input.value.trim().split(':')[0].trim()
      // Remove previous error
      const prev = input.parentElement.querySelector('.field-error-msg')
      if (prev) prev.remove()
      input.classList.remove('invalid')
      // Validate only if non-empty (empty = not entered, not a format error)
      if (val && !pattern.test(val)) {
        input.classList.add('invalid')
        const errSpan = document.createElement('span')
        errSpan.className = 'field-error-msg'
        errSpan.textContent = errorMsg
        input.parentElement.appendChild(errSpan)
      }
    })
  }

  addBlurValidation(naicsInput, /^\d{5,6}$/, 'NAICS code must be 5 or 6 digits (e.g. 336992)')
  addBlurValidation(pscInput, /^[A-Z0-9]{4}$/i, 'PSC code must be 4 alphanumeric characters (e.g. 1234 or AA1B)')

  // Wire flagged field click → PDF viewer scroll (Plan 05 wires the actual viewer)
  c.querySelectorAll('input[data-bbox]').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => {
      const bbox = JSON.parse(el.dataset.bbox)
      // scrollPdfToBoundingBox is defined in Plan 05; graceful no-op if not yet available
      if (typeof window.scrollPdfToBoundingBox === 'function') {
        window.scrollPdfToBoundingBox(bbox)
      }
    })
  })
}

function init() {
  // Step2 has no static DOM elements to wire at init time
}

window.step2 = step2
window.initStep2 = init
