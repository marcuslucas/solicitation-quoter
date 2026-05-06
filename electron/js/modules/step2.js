// electron/js/modules/step2.js
// Step 2: Review Extracted Data
// Depends on: window.S (state.js), window.esc/toast/goTo/next (utils.js)

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const SCOPE_MAX_DISPLAY = '3,000'

window.scrollPdfToBoundingBox = async function(bbox) {
  // bbox is the parsed boundingBox object from data-bbox:
  // { page: 1, x0: 72.0, y0: 400.0, x1: 540.0, y1: 420.0 }
  if (!bbox) return

  const filename = window.S.file && window.S.file.name
  if (!filename) return

  const filePath = await window.api.getSessionFilePath(filename)
  if (!filePath) {
    if (typeof window.toast === 'function') {
      window.toast(
        'Source file not in session. Re-parse the solicitation to restore it.',
        'error'
      )
    }
    return
  }

  await window.api.openPdfViewer(filePath, bbox.page || 1, '', bbox)
}

// ── AI PANEL ──────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  solicitation_number:   'Solicitation #',
  project_title:         'Project Title',
  solicitation_type:     'Type',
  issuing_agency:        'Issuing Agency',
  due_date:              'Response Due Date',
  posting_date:          'Posting Date',
  contact_name:          'Contact Name',
  contact_email:         'Contact Email',
  contact_phone:         'Contact Phone',
  naics_code:            'NAICS Code',
  psc_code:              'PSC Code',
  set_aside:             'Set-Aside',
  place_of_performance:  'Place of Performance',
  period_of_performance: 'Period of Performance',
  estimated_value:       'Est. Value',
}

function updateAiUsageDisplay() {
  const el = document.getElementById('ai-usage-display')
  if (!el || !window.S.aiUsage.calls) return
  const { calls, tokens } = window.S.aiUsage
  el.textContent =
    `${calls} call${calls !== 1 ? 's' : ''} · ` +
    `${tokens.toLocaleString()} token${tokens !== 1 ? 's' : ''}`
}

function mergeAiResult(current, aiResult) {
  // current = window.S.extracted, aiResult = /extract-ai response result
  const merged  = { ...current }
  const changes = []
  for (const [key, value] of Object.entries(aiResult)) {
    if (value === null || value === undefined) continue
    const currentStr = (current[key] === null || current[key] === undefined)
      ? '' : String(current[key]).trim()
    const newStr = String(value).trim()
    if (newStr !== '' && newStr !== currentStr) {
      changes.push({ field: key, before: current[key], after: value })
      merged[key] = value
    }
  }
  return { merged, changes }
}

function showAiDiff(aiResult) {
  const { changes } = mergeAiResult(window.S.extracted, aiResult)
  window.S._pendingAiChanges = changes

  const diffEl = document.getElementById('ai-diff')
  if (!diffEl) return
  diffEl.classList.remove('hidden')

  if (!changes.length) {
    diffEl.innerHTML =
      '<p style="font-size:12px;color:var(--color-text-muted);margin:0">' +
      'AI found no improvements to the current extraction.</p>'
    return
  }

  const rows = changes.map((ch, i) => {
    const label  = FIELD_LABELS[ch.field] || ch.field
    const before = ch.before == null ? '<em>empty</em>' :
      `<span class="diff-before">${esc(String(ch.before))}</span>`
    const after  = `<span class="diff-after">${esc(String(ch.after))}</span>`
    return `<tr>
      <td style="padding:4px 8px">
        <input type="checkbox" checked data-change-idx="${i}" />
      </td>
      <td style="padding:4px 8px;font-size:12px">${label}</td>
      <td style="padding:4px 8px;font-size:12px">${before}</td>
      <td style="padding:4px 8px;font-size:12px">${after}</td>
    </tr>`
  }).join('')

  diffEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="padding:4px 8px;text-align:left;font-size:11px;
              color:var(--color-text-muted);border-bottom:1px solid
              var(--color-border)">Apply</th>
          <th style="padding:4px 8px;text-align:left;font-size:11px;
              color:var(--color-text-muted);border-bottom:1px solid
              var(--color-border)">Field</th>
          <th style="padding:4px 8px;text-align:left;font-size:11px;
              color:var(--color-text-muted);border-bottom:1px solid
              var(--color-border)">Current</th>
          <th style="padding:4px 8px;text-align:left;font-size:11px;
              color:var(--color-text-muted);border-bottom:1px solid
              var(--color-border)">AI Suggestion</th>
        </tr>
      </thead>
      <tbody id="ai-diff-tbody">${rows}</tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn btn-primary btn-sm" id="ai-accept-btn">
        Accept Selected
      </button>
      <button class="btn btn-ghost btn-sm" id="ai-discard-btn">
        Discard All
      </button>
    </div>`

  // Wire accept / discard
  document.getElementById('ai-accept-btn').addEventListener('click', () => {
    const checked = diffEl.querySelectorAll(
      '#ai-diff-tbody input[type="checkbox"]:checked')
    checked.forEach(cb => {
      const idx    = parseInt(cb.dataset.changeIdx)
      const change = (window.S._pendingAiChanges || [])[idx]
      if (!change) return
      // Write to state
      window.S.extracted[change.field] = change.after
      // Update DOM input directly — avoids re-render flash
      const input = document.querySelector(
        `input[data-field="${change.field}"]`)
      if (input) input.value = String(change.after)
    })
    diffEl.classList.add('hidden')
    diffEl.innerHTML = ''
    window.S._pendingAiChanges = null
    // Re-enable buttons
    const hBtn = document.getElementById('ai-extract-headers-btn')
    const iBtn = document.getElementById('ai-extract-items-btn')
    if (hBtn) { hBtn.disabled = false; hBtn.textContent = 'Extract Headers with AI' }
    if (iBtn) { iBtn.disabled = false; iBtn.textContent = 'Extract Line Items with AI' }
    updateAiUsageDisplay()
  })

  document.getElementById('ai-discard-btn').addEventListener('click', () => {
    diffEl.classList.add('hidden')
    diffEl.innerHTML = ''
    window.S._pendingAiChanges = null
    const hBtn = document.getElementById('ai-extract-headers-btn')
    const iBtn = document.getElementById('ai-extract-items-btn')
    if (hBtn) { hBtn.disabled = false; hBtn.textContent = 'Extract Headers with AI' }
    if (iBtn) { iBtn.disabled = false; iBtn.textContent = 'Extract Line Items with AI' }
  })
}

async function doAiExtract(target) {
  const hBtn = document.getElementById('ai-extract-headers-btn')
  const iBtn = document.getElementById('ai-extract-items-btn')
  const btn  = target === 'headers' ? hBtn : iBtn
  if (!btn) return
  if (hBtn) hBtn.disabled = true
  if (iBtn) iBtn.disabled = true
  btn.textContent = 'Extracting…'

  // Clear any previous error
  const errEl = document.getElementById('ai-error-msg')
  if (errEl) errEl.classList.add('hidden')

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (window.S.apiKey) headers['X-Api-Key'] = window.S.apiKey
    const resp = await fetch(
      `http://127.0.0.1:${window.S.port}/api/sol-quoter/extract-ai`,
      { method: 'POST', headers, body: JSON.stringify({ target }) }
    )
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      const msg = err.error || 'AI extraction failed'
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden') }
      return
    }
    const data = await resp.json()
    window.S.aiUsage.calls  += 1
    window.S.aiUsage.tokens += (data.tokens_used || 0)
    showAiDiff(data.result)
  } catch (e) {
    if (errEl) {
      errEl.textContent = 'AI extraction failed: ' + e.message
      errEl.classList.remove('hidden')
    }
  } finally {
    if (hBtn && target !== 'headers') hBtn.disabled = false
    if (iBtn && target !== 'line_items') iBtn.disabled = false
    if (btn) btn.textContent = target === 'headers'
      ? 'Extract Headers with AI' : 'Extract Line Items with AI'
    updateAiUsageDisplay()
  }
}

function renderAiPanel() {
  const container = document.getElementById('ai-panel-container')
  if (!container) return
  if (!window.S.aiAvailable) { container.innerHTML = ''; return }

  const remaining  = window.S.aiCallsRemaining ?? 10
  const autoExpand = window.S.parseConfidence &&
                     window.S.parseConfidence.overall < 0.6
  const bodyHidden = autoExpand ? '' : ' hidden'

  container.innerHTML = `
    <div class="card ai-panel" id="ai-panel" style="margin-bottom:12px">
      <div class="ai-panel-header" id="ai-panel-toggle"
        style="display:flex;align-items:center;justify-content:space-between;
               cursor:pointer;user-select:none">
        <div class="card-title" style="margin:0">
          <span class="dot"></span>AI-Assisted Extraction
        </div>
        <span style="font-size:12px;color:var(--color-text-muted)">
          ${remaining} call${remaining !== 1 ? 's' : ''} remaining
        </span>
      </div>
      <div id="ai-panel-body"${bodyHidden ? ' class="hidden"' : ''}
        style="padding:12px;display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;align-items:center;gap:8px;
                      font-size:13px;cursor:pointer">
          <input type="checkbox" id="ai-toggle-cb"
            style="width:auto;margin:0" />
          <span>Enable AI extraction for this session</span>
        </label>
        <div id="ai-disclosure" class="hidden"
          style="font-size:12px;color:var(--color-text-muted);
                 line-height:1.5;padding:8px 10px;
                 background:var(--color-surface);border-radius:4px">
          Your document text will be sent to Anthropic's API to improve
          extraction accuracy. For header fields, only the first 4,000
          characters are sent. For line items, the Statement of Work text
          is sent in segments. No data is stored by Anthropic after
          processing.
        </div>
        <div id="ai-buttons" class="hidden"
          style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="ai-extract-headers-btn">
            Extract Headers with AI
          </button>
          <button class="btn btn-ghost btn-sm" id="ai-extract-items-btn">
            Extract Line Items with AI
          </button>
          <span id="ai-usage-display"
            style="font-size:11px;color:var(--color-text-muted);
                   margin-left:auto"></span>
        </div>
        <div id="ai-error-msg" class="hidden alert alert-error"
          style="font-size:12px;margin-bottom:0"></div>
        <div id="ai-diff" class="hidden"></div>
      </div>
    </div>`

  updateAiUsageDisplay()

  // Wire collapse toggle
  document.getElementById('ai-panel-toggle')
    ?.addEventListener('click', () => {
      const body = document.getElementById('ai-panel-body')
      if (body) body.classList.toggle('hidden')
    })

  // Wire enable toggle
  document.getElementById('ai-toggle-cb')
    ?.addEventListener('change', e => {
      const disc = document.getElementById('ai-disclosure')
      const btns = document.getElementById('ai-buttons')
      const err  = document.getElementById('ai-error-msg')
      if (e.target.checked) {
        disc?.classList.remove('hidden')
        btns?.classList.remove('hidden')
      } else {
        disc?.classList.add('hidden')
        btns?.classList.add('hidden')
        err?.classList.add('hidden')
      }
    })

  // Wire extraction buttons
  document.getElementById('ai-extract-headers-btn')
    ?.addEventListener('click', () => doAiExtract('headers'))
  document.getElementById('ai-extract-items-btn')
    ?.addEventListener('click', () => doAiExtract('line_items'))
}

async function checkAiStatus() {
  try {
    const headers = {}
    if (window.S.apiKey) headers['X-Api-Key'] = window.S.apiKey
    const r = await fetch(
      `http://127.0.0.1:${window.S.port}/api/sol-quoter/ai-status`,
      { headers }
    )
    if (!r.ok) throw new Error('status check failed')
    const data = await r.json()
    window.S.aiAvailable      = data.available
    window.S.aiCallsRemaining = data.calls_remaining
  } catch {
    window.S.aiAvailable      = false
    window.S.aiCallsRemaining = 0
  }
  renderAiPanel()
}

// ── STEP 2 RENDER ─────────────────────────────────────────────────────────────

function step2(c) {
  const d = window.S.extracted
  const m = d._method||'rules'
  const badge = m === 'demo'
    ? '<span class="mbadge rules">Demo Data — edit any field below</span>'
    : m.includes('ai')
      ? '<span class="mbadge ai">AI + Rule-Based Extraction</span>'
      : m === 'sam_gov'
        ? '<span class="mbadge ai">SAM.gov Lookup</span>'
        : '<span class="mbadge rules">Rule-Based Extraction</span>'

  // Confidence badge — field-level validator confidence (existing, used for flagged-field inline badges)
  const conf = window.S.confidence || {}

  // Phase 7: parse-quality confidence banner
  const pc = window.S.parseConfidence
  let confBannerHtml = ''

  if (pc && typeof pc.overall === 'number') {
    const pct = (pc.overall * 100).toFixed(0)
    const warns = pc.warnings || []

    const warningTextMap = {
      'missing_field':  w => `Field not found: ${w.field}`,
      'unknown_format': _  => 'Document format not recognized',
      'no_line_items':  _  => 'No line items extracted — single placeholder row used',
    }

    const warningListHtml = warns.length
      ? `<ul class="confidence-warnings">
           ${warns.map(w => {
             const fn = warningTextMap[w.code]
             return fn ? `<li>${fn(w)}</li>` : ''
           }).join('')}
         </ul>`
      : ''

    const reasons = pc.reasons || []
    const reasonsListHtml = reasons.length
      ? `<ul class="confidence-warnings">
           ${reasons.map(r => `<li>${esc(r)}</li>`).join('')}
         </ul>`
      : ''

    if (pc.overall >= 0.8) {
      confBannerHtml = `
        <div class="confidence-bar confidence-bar--green">
          <span class="confidence-label">Extraction confidence: high</span>
          <span class="confidence-score">${pct}%</span>
        </div>`
    } else if (pc.overall >= 0.5) {
      confBannerHtml = `
        <div class="confidence-bar confidence-bar--amber">
          <span class="confidence-label">Extraction confidence: moderate — review fields below</span>
          <span class="confidence-score">${pct}%</span>
          ${warningListHtml}
          ${reasonsListHtml}
        </div>`
    } else {
      confBannerHtml = `
        <div class="confidence-bar confidence-bar--red">
          <span class="confidence-label">Extraction confidence: low — review all fields carefully</span>
          <span class="confidence-score">${pct}%</span>
          ${warningListHtml}
          ${reasonsListHtml}
          <div class="confidence-hint">
            AI-assisted extraction will be available in a future update.
          </div>
        </div>`
    }
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

  // PDF viewer — single button that opens the source file in the system PDF viewer
  const isPdf = window.S.sourceType === 'pdf'
  const pdfPanelHtml = isPdf ? `
    <div class="card">
      <button class="btn btn-sm" id="pdf-view-btn" style="text-transform:uppercase;letter-spacing:0.6px;font-weight:600;font-size:var(--text-base)">View PDF</button>
    </div>` : ''

  // Scope truncation banner — button toggles textarea between truncated/full text in-place
  const scopeTruncated = d.scope_truncated === true
  const scopeBanner = scopeTruncated
    ? `<div class="alert alert-warn" id="scope-trunc-banner">Scope truncated at ${SCOPE_MAX_DISPLAY} characters <button class="btn btn-sm" id="scope-expand-btn" data-expanded="false" style="margin-left:var(--space-sm)">Show more</button></div>`
    : ''

  c.innerHTML = `
  ${badge}
  ${confBannerHtml}
  <div id="ai-panel-container"></div>
  <div class="card">
    <div class="card-title"><span class="dot"></span>Extracted Fields <span class="text-muted" style="font-weight:400;font-size:12px;margin-left:6px">&mdash; click any field to edit</span></div>
    <div class="data-grid">${items}</div>
  </div>
  <div class="card">
    <div class="card-title"><span class="dot"></span>Scope of Work / Description</div>
    ${scopeBanner}
    <textarea id="scope-ta" rows="6">${esc(d.scope_of_work||'')}</textarea>
    <div class="char-count" id="scope-count">${(d.scope_of_work||'').length} / ${SCOPE_MAX_DISPLAY}</div>
  </div>
  ${qhtml}
  ${pdfPanelHtml}
  <div class="btn-row">
    <button class="btn btn-ghost" style="margin-right:auto" id="step2-clear-btn">Clear Fields</button>
    <button class="btn btn-ghost btn-sm" id="btn-clear-reparse">&#x21BA; Clear &amp; Reparse</button>
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

  // Scope expand/collapse — swap textarea content in-place between truncated and full text
  const expandBtn = document.getElementById('scope-expand-btn')
  if (expandBtn && scopeTa) {
    expandBtn.addEventListener('click', () => {
      const isExpanded = expandBtn.dataset.expanded === 'true'
      if (isExpanded) {
        scopeTa.value = d.scope_of_work || ''
        window.S.extracted.scope_of_work = scopeTa.value
        if (scopeCount) scopeCount.textContent = scopeTa.value.length + ' / ' + SCOPE_MAX_DISPLAY
        expandBtn.textContent = 'Show more'
        expandBtn.dataset.expanded = 'false'
      } else {
        scopeTa.value = d.scope_full || d.scope_of_work || ''
        window.S.extracted.scope_of_work = scopeTa.value
        if (scopeCount) scopeCount.textContent = scopeTa.value.length + ' / ' + SCOPE_MAX_DISPLAY
        expandBtn.textContent = 'Show less'
        expandBtn.dataset.expanded = 'true'
      }
    })
  }

  // PDF viewer — open source file in system default PDF viewer
  const pdfViewBtn = document.getElementById('pdf-view-btn')
  if (pdfViewBtn) {
    pdfViewBtn.addEventListener('click', () => {
      const pdfPath = window.S.filePath || (window.S.file && window.S.file.path) || ''
      if (pdfPath) window.api.openPath(pdfPath)
    })
  }

  // Wire action buttons
  document.getElementById('step2-clear-btn')?.addEventListener('click', () => {
    window.clearExtracted?.()
  })
  document.getElementById('btn-clear-reparse')?.addEventListener('click', async () => {
    try { await window.api.clearSession(window.S.port) } catch(e) {}
    window.S.sessionFiles = {}
    goTo(1)
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

  // Phase 8: check AI availability and render panel asynchronously
  checkAiStatus()
}

function init() {
  // Step2 has no static DOM elements to wire at init time
}

window.step2 = step2
window.initStep2 = init
