// electron/js/modules/step2.js
// Step 2: Review Extracted Data
// Depends on: window.S (state.js), window.esc/toast/goTo/next (utils.js)

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

  const items = fields.map(([k,lbl,wide]) => `
    <div class="data-item${wide?' s2':''}">
      <div class="data-label">${lbl}</div>
      <input data-field="${k}" value="${esc(String(d[k]||''))}" placeholder="Not found" />
    </div>`).join('')

  const qtys = d.quantities||[]
  const qhtml = qtys.length ? `<div class="card">
    <div class="card-title"><span class="dot"></span>Detected Quantities</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${qtys.map(q=>`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 14px;text-align:center">
        <div style="font-size:10px;color:var(--muted)">${q.size}</div>
        <div style="font-size:20px;font-weight:700;color:var(--gold)">${q.qty}</div>
      </div>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">These will pre-fill your quote line items.</div>
  </div>` : ''

  c.innerHTML = `
  ${badge}
  <div class="card">
    <div class="card-title"><span class="dot"></span>Extracted Fields <span class="text-muted" style="font-weight:400;font-size:12px;margin-left:6px">— click any field to edit</span></div>
    <div class="data-grid">${items}</div>
  </div>
  <div class="card">
    <div class="card-title"><span class="dot"></span>Scope of Work / Description</div>
    <textarea id="scope-ta" rows="6" maxlength="2000">${esc(d.scope_of_work||'')}</textarea>
    <div class="char-count" id="scope-count">${(d.scope_of_work||'').length} / 2,000</div>
  </div>
  ${qhtml}
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
      if (scopeCount) scopeCount.textContent = e.target.value.length + ' / 2,000'
    })
  }

  // Wire action buttons
  document.getElementById('step2-clear-btn')?.addEventListener('click', () => {
    window.clearExtracted?.()
  })
  document.getElementById('step2-back-btn')?.addEventListener('click', () => goTo(1))
  document.getElementById('step2-next-btn')?.addEventListener('click', () => next())
}

function init() {
  // Step2 has no static DOM elements to wire at init time
}

window.step2 = step2
window.initStep2 = init
