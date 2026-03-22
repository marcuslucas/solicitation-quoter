// electron/js/modules/step3.js
// Step 3: Company Info + Line Items
// Depends on: window.S (state.js), window.esc/toast/goTo/next/render (utils.js)
// Private helpers: addRow, dupRow, delRow, addRows, clearRows, clearVendorFields,
//   saveVendor, lineTotal, grandTotal, updTotals, setupLineItemTabNav,
//   addOptionYear, removeOptionYear, openCsvModal, closeCsvModal, csvPickFile,
//   parseCsvLine, doImportCsv

// ── TOTALS ────────────────────────────────────────────────────────────────────

function lineTotal(it) {
  const q = parseFloat(it.qty), p = parseFloat(it.unit_price)
  const t = (isNaN(q) || isNaN(p)) ? 0 : q * p
  return t > 0 ? '$' + t.toFixed(2) : '–'
}

function grandTotal() {
  return window.S.items.reduce((s, it) => {
    const q = parseFloat(it.qty), p = parseFloat(it.unit_price)
    return s + ((isNaN(q) || isNaN(p)) ? 0 : q * p)
  }, 0)
}

function updTotals() {
  window.S.items.forEach((it, i) => {
    const e = document.getElementById('lt' + i)
    if (e) e.textContent = lineTotal(it)
  })
  const g = grandTotal()
  const fr = parseFloat(window.S.vendor.freight || 0)
  const tx = parseFloat(window.S.vendor.tax_rate || 0)
  const tax = g * (tx / 100), fin = g + fr + tax
  const ge = document.getElementById('gt'), fe = document.getElementById('ft')
  if (ge) ge.textContent = '$' + g.toFixed(2)
  if (fe) fe.textContent = '$' + fin.toFixed(2)
}

// ── LINE ITEM ROW OPS ─────────────────────────────────────────────────────────

function addRow() {
  window.pushUndo()
  window.S.items.push({ id: window.S.items.length + 1, description: '', size: '', unit: 'EA', qty: '', unit_price: '' })
  window.render(3)
}

function addRows() {
  const raw = prompt('How many rows?', '5')
  if (raw === null) return
  const n = parseInt(raw)
  if (!isNaN(n) && n > 0 && n <= 100) {
    window.pushUndo()
    for (let i = 0; i < n; i++) {
      window.S.items.push({ id: window.S.items.length + 1, description: '', size: '', unit: 'EA', qty: '', unit_price: '' })
    }
    window.render(3)
  }
}

function dupRow(i) {
  window.pushUndo()
  window.S.items.splice(i + 1, 0, { ...window.S.items[i] })
  window.render(3)
}

function delRow(i) {
  if (window.S.items.length > 1) {
    window.pushUndo()
    window.S.items.splice(i, 1)
    window.render(3)
  }
}

function clearRows() {
  if (confirm('Clear all line items?')) {
    window.pushUndo()
    window.S.items = [{ id: 1, description: '', size: '', unit: 'EA', qty: '', unit_price: '' }]
    window.render(3)
  }
}

// ── VENDOR HELPERS ────────────────────────────────────────────────────────────

function saveVendor() {
  try { localStorage.setItem('vendor', JSON.stringify(window.S.vendor)) } catch (e) {}
  window.toast('Company info saved', 'success')
}

function clearVendorFields() {
  if (confirm('Clear all company info and line items?')) {
    const logo = {
      logo_b64: window.S.vendor.logo_b64,
      logo_ext: window.S.vendor.logo_ext,
      logo_name: window.S.vendor.logo_name
    }
    window.S.vendor = { ...logo }
    window.S.items = [{ id: 1, description: '', size: '', unit: 'EA', qty: '', unit_price: '' }]
    window.render(3)
  }
}

// ── OPTION YEARS ──────────────────────────────────────────────────────────────

function addOptionYear() {
  if (!window.S.vendor.option_years) window.S.vendor.option_years = []
  window.S.vendor.option_years.push({ label: `Option Year ${window.S.vendor.option_years.length + 1}`, pct: 0 })
  window.render(3)
}

function removeOptionYear(i) {
  window.S.vendor.option_years.splice(i, 1)
  window.render(3)
}

// ── CSV IMPORT ────────────────────────────────────────────────────────────────

function openCsvModal() {
  document.getElementById('csv-paste').value = ''
  document.getElementById('csv-file-name').textContent = ''
  document.getElementById('csv-err').classList.add('hidden')
  document.getElementById('csv-modal-overlay').classList.remove('hidden')
}

function closeCsvModal() {
  document.getElementById('csv-modal-overlay').classList.add('hidden')
}

function csvPickFile() {
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = '.csv,.txt'
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return
    document.getElementById('csv-file-name').textContent = file.name
    const reader = new FileReader()
    reader.onload = ev => { document.getElementById('csv-paste').value = ev.target.result }
    reader.readAsText(file)
  }
  inp.click()
}

function parseCsvLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      fields.push(cur.trim()); cur = ''
    } else { cur += ch }
  }
  fields.push(cur.trim())
  return fields
}

function doImportCsv() {
  const raw = document.getElementById('csv-paste').value.trim()
  const errEl = document.getElementById('csv-err')
  if (!raw) {
    errEl.innerHTML = '<div class="alert alert-error">Paste CSV text or pick a file first.</div>'
    errEl.classList.remove('hidden')
    return
  }

  const lines = raw.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) {
    errEl.innerHTML = '<div class="alert alert-error">No data found.</div>'
    errEl.classList.remove('hidden')
    return
  }

  const firstCols = parseCsvLine(lines[0]).map(c => c.toLowerCase())
  const hasHeader = firstCols.some(c => ['description', 'desc', 'item', 'name', 'product'].includes(c))
  const dataLines = hasHeader ? lines.slice(1) : lines

  const imported = []
  for (const line of dataLines) {
    if (!line.trim()) continue
    const cols = parseCsvLine(line)
    const description = cols[0] || ''
    const size = cols[1] || ''
    const unitRaw = (cols[2] || '').trim().toUpperCase()
    const unit = unitRaw || 'EA'
    const qtyRaw = parseFloat(cols[3])
    const upRaw = parseFloat(cols[4])
    const qty = isNaN(qtyRaw) ? '' : qtyRaw
    const unit_price = isNaN(upRaw) ? '' : upRaw
    if (!description && qty === '') continue
    imported.push({ id: imported.length + 1, description, size, unit, qty, unit_price })
  }

  if (!imported.length) {
    errEl.innerHTML = '<div class="alert alert-error">No valid rows found. Check column order: Description, Size/Type, UOM, Qty, Unit Price.</div>'
    errEl.classList.remove('hidden')
    return
  }

  window.pushUndo()
  if (window.S.items.length === 1 && !window.S.items[0].description && !window.S.items[0].qty) {
    window.S.items = imported
  } else {
    window.S.items = [...window.S.items, ...imported]
  }
  closeCsvModal()
  window.toast(`Imported ${imported.length} item${imported.length !== 1 ? 's' : ''}`, 'success')
  window.render(3)
}

// ── TAB NAV ───────────────────────────────────────────────────────────────────

function setupLineItemTabNav() {
  const tbody = document.getElementById('li-tbody')
  if (!tbody) return
  tbody.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return
    const inputs = [...tbody.querySelectorAll('input,select,textarea')]
    const idx = inputs.indexOf(document.activeElement)
    if (idx === -1) return
    e.preventDefault()
    const next = e.shiftKey ? inputs[idx - 1] : inputs[idx + 1]
    if (next) {
      next.focus(); next.select && next.select()
    } else if (!e.shiftKey) {
      addRow()
      const newInputs = [...document.getElementById('li-tbody').querySelectorAll('input,select,textarea')]
      if (newInputs.length) { newInputs[newInputs.length - 5]?.focus() }
    }
  })
}

// ── EVENT DELEGATION: LINE ITEMS ──────────────────────────────────────────────

function wireLineItemDelegation() {
  const tbody = document.getElementById('li-tbody')
  if (!tbody) return
  tbody.addEventListener('change', e => {
    const input = e.target.closest('input, select')
    if (!input || !input.dataset.col) return
    const row = input.closest('tr')
    const rows = [...tbody.querySelectorAll('tr')]
    const i = rows.indexOf(row)
    if (i === -1) return
    window.S.items[i][input.dataset.col] = input.value
    if (input.dataset.col === 'qty' || input.dataset.col === 'unit_price') {
      updTotals()
    }
    if (input.classList.contains('invalid')) {
      input.classList.remove('invalid', 'field-shake')
      const errMsg = input.parentElement?.querySelector('.field-error-msg')
      if (errMsg) errMsg.remove()
    }
  })
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]')
    if (!btn) return
    const row = btn.closest('tr')
    const i = [...tbody.querySelectorAll('tr')].indexOf(row)
    if (i === -1) return
    if (btn.dataset.action === 'dup') dupRow(i)
    if (btn.dataset.action === 'del') delRow(i)
  })
}

// ── EVENT DELEGATION: OPTION YEARS ───────────────────────────────────────────

function wireOptionYearsDelegation() {
  const container = document.getElementById('option-years-list')
  if (!container) return
  container.addEventListener('input', e => {
    const idx = parseInt(e.target.dataset.oyIndex, 10)
    const field = e.target.dataset.oyField
    if (!isNaN(idx) && field && window.S.vendor.option_years[idx]) {
      window.S.vendor.option_years[idx][field] = e.target.value
    }
  })
  container.addEventListener('change', e => {
    const idx = parseInt(e.target.dataset.oyIndex, 10)
    const field = e.target.dataset.oyField
    if (!isNaN(idx) && field && window.S.vendor.option_years[idx]) {
      if (e.target.type === 'number') {
        window.S.vendor.option_years[idx][field] = parseFloat(e.target.value) || 0
      } else {
        window.S.vendor.option_years[idx][field] = e.target.value
      }
    }
  })
  container.addEventListener('click', e => {
    const btn = e.target.closest('button[data-oy-action]')
    if (!btn) return
    const idx = parseInt(btn.dataset.oyIndex, 10)
    if (!isNaN(idx)) removeOptionYear(idx)
  })
}

// ── STEP 3 VALIDATION (ERR-05) ────────────────────────────────────────────────

function clearFieldErrors() {
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid', 'field-shake'))
  document.querySelectorAll('.field-error-msg').forEach(el => el.remove())
}

function markFieldError(input, message) {
  input.classList.add('invalid', 'field-shake')
  input.addEventListener('animationend', () => input.classList.remove('field-shake'), { once: true })
  // Per D-14: small error message directly below the input
  const msg = document.createElement('span')
  msg.className = 'field-error-msg'
  msg.textContent = message
  // Insert after the input (inside its parent .field div)
  input.parentElement.appendChild(msg)
}

function validateStep3() {
  clearFieldErrors()
  let valid = true

  // Per D-15: Company Name is required
  const companyInput = document.querySelector('input[data-vendor-field="company_name"]')
  if (companyInput && !companyInput.value.trim()) {
    markFieldError(companyInput, 'Company name is required')
    valid = false
  }

  // Per D-16: At least one line item with description populated
  const hasLineItem = window.S.items.some(it => it.description && it.description.trim())
  if (!hasLineItem) {
    const descInput = document.querySelector('#li-tbody input[data-col="description"]')
    if (descInput) {
      markFieldError(descInput, 'At least one line item with a description is required')
    }
    valid = false
  }

  // Focus the first invalid field
  if (!valid) {
    const firstInvalid = document.querySelector('.invalid')
    if (firstInvalid) {
      firstInvalid.focus()
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  return valid
}

// ── STEP 3 RENDER ─────────────────────────────────────────────────────────────

function step3(c) {
  const v = window.S.vendor
  if (!v.quote_number) v.quote_number = window.nextQuoteNum ? window.nextQuoteNum() : ''
  if (window.S.items.length === 0 && window.S.extracted.quantities) {
    window.S.items = window.S.extracted.quantities.map((q, i) => ({
      id: i + 1,
      description: window.S.extracted.project_title || '',
      size: q.size,
      unit: 'EA',
      qty: q.qty,
      unit_price: ''
    }))
  }
  if (window.S.items.length === 0) {
    window.S.items = [{ id: 1, description: '', size: '', unit: 'EA', qty: '', unit_price: '' }]
  }

  const rows = window.S.items.map((it, i) => `
    <tr>
      <td style="text-align:center;color:var(--color-text-muted)">${i + 1}</td>
      <td><input data-col="description" value="${window.esc(it.description || '')}" placeholder="Item description" /></td>
      <td><input data-col="size" value="${window.esc(String(it.size || ''))}" style="max-width:80px" /></td>
      <td><input data-col="unit" value="${window.esc(String(it.unit || 'EA'))}" style="max-width:55px" placeholder="EA" /></td>
      <td><input type="number" data-col="qty" value="${window.esc(String(it.qty || ''))}" min="0" style="max-width:80px;background:var(--color-surface-raised);border:1px solid var(--color-border)" /></td>
      <td><input type="number" data-col="unit_price" value="${window.esc(String(it.unit_price || ''))}" min="0" step="0.01" style="background:var(--color-surface-raised);border:1px solid var(--color-border)" /></td>
      <td style="text-align:right;color:var(--color-primary)" id="lt${i}">${lineTotal(it)}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-action="dup">Dup</button>
        <button class="btn btn-danger btn-sm" data-action="del">✕</button>
      </div></td>
    </tr>`).join('')

  const grand = grandTotal()
  const fr = parseFloat(v.freight || 0), tx = parseFloat(v.tax_rate || 0)
  const tax = grand * (tx / 100), final = grand + fr + tax

  const optionYearsHtml = v.option_years_enabled ? `
    <div id="option-years-list">
      ${(v.option_years || []).map((oy, i) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input data-oy-index="${i}" data-oy-field="label" value="${window.esc(oy.label || '')}"
                 placeholder="Option Year ${i + 1}" style="flex:1" />
          <input type="number" data-oy-index="${i}" data-oy-field="pct"
                 value="${window.esc(String(oy.pct || 0))}"
                 style="width:80px" min="-100" max="100" />
          <span style="color:var(--color-text-muted);font-size:12px;white-space:nowrap">% adj.</span>
          <button class="btn btn-danger btn-sm" data-oy-action="remove" data-oy-index="${i}">✕</button>
        </div>`).join('')}
      ${(v.option_years || []).length < 5 ? `<button class="btn btn-ghost btn-sm" id="add-option-year-btn">+ Add Option Year</button>` : ''}
    </div>` : ''

  const logoHtml = v.logo_b64 ? `
    <div style="display:flex;align-items:center;gap:12px">
      <img src="data:image/${window.esc(v.logo_ext || 'png')};base64,${v.logo_b64}"
           style="max-height:60px;max-width:160px;object-fit:contain;border-radius:4px;background:#fff;padding:4px" />
      <div>
        <div style="font-size:12px;color:var(--color-text);margin-bottom:6px">${window.esc(v.logo_name || 'Logo')}</div>
        <button class="btn btn-danger btn-sm" id="logo-remove-btn">Remove</button>
      </div>
    </div>` : `
    <button class="btn btn-ghost" id="logo-pick-btn">Upload Logo (PNG / JPG)</button>
    <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">Appears top-left of the quote document.</div>`

  c.innerHTML = `
  <div id="vendor-form">

    <div class="card">
      <div class="card-title"><span class="dot"></span>Company Information<button class="btn btn-ghost btn-sm ml-auto" id="open-profiles-btn" style="-webkit-app-region:no-drag">Profiles</button></div>
      <div class="grid">
        <div class="field s2"><label>Company / Business Name *</label><input data-vendor-field="company_name" value="${window.esc(v.company_name || '')}" placeholder="Acme Defense Solutions LLC" /></div>
        <div class="field"><label>Street Address</label><input data-vendor-field="address" value="${window.esc(v.address || '')}" placeholder="123 Main Street" /></div>
        <div class="field"><label>City, State ZIP</label><input data-vendor-field="city_state_zip" value="${window.esc(v.city_state_zip || '')}" placeholder="Springfield, VA 22150" /></div>
        <div class="field"><label>Phone</label><input data-vendor-field="phone" value="${window.esc(v.phone || '')}" placeholder="(555) 555-0100" /></div>
        <div class="field"><label>Email</label><input data-vendor-field="email" value="${window.esc(v.email || '')}" placeholder="quotes@yourcompany.com" /></div>
        <div class="field"><label>Website</label><input data-vendor-field="website" value="${window.esc(v.website || '')}" placeholder="www.yourcompany.com" /></div>
        <div class="field"><label>SAM.gov UEI</label><input data-vendor-field="sam_uei" value="${window.esc(v.sam_uei || '')}" placeholder="ABCDEF123456" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span class="dot"></span>Quote Details</div>
      <div class="grid">
        <div class="field"><label>Prepared By</label><input data-vendor-field="prepared_by" value="${window.esc(v.prepared_by || '')}" placeholder="John Smith" /></div>
        <div class="field"><label>Title</label><input data-vendor-field="title" value="${window.esc(v.title || '')}" placeholder="Contracts Manager" /></div>
        <div class="field"><label>Quote Number</label><input data-vendor-field="quote_number" value="${window.esc(v.quote_number || '')}" placeholder="Q-2026-0001" /></div>
        <div class="field"><label>Quote Valid For</label><input data-vendor-field="validity_period" value="${window.esc(v.validity_period || '')}" placeholder="30 days" /></div>
        <div class="field"><label>Delivery (days ARO)</label><input type="number" data-vendor-field="delivery_days" value="${window.esc(String(v.delivery_days || ''))}" placeholder="30" min="0" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span class="dot"></span>Company Logo (Optional)</div>
      ${logoHtml}
    </div>

    <div class="card">
      <div class="card-title"><span class="dot"></span>Line Items</div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr>
            <th style="width:36px">#</th><th>Description</th><th style="width:85px">Size/Type</th>
            <th style="width:60px">UOM</th><th style="width:75px">Qty</th>
            <th style="width:110px">Unit Price</th>
            <th style="width:110px;text-align:right">Total</th><th style="width:72px"></th>
          </tr></thead>
          <tbody id="li-tbody">${rows}</tbody>
          <tfoot>
            <tr class="tfoot"><td colspan="6" style="text-align:right;padding-right:16px">Subtotal</td><td style="text-align:right" id="gt">$${grand.toFixed(2)}</td><td></td></tr>
            ${fr ? `<tr class="tfoot"><td colspan="6" style="text-align:right;padding-right:16px">Freight</td><td style="text-align:right">$${fr.toFixed(2)}</td><td></td></tr>` : ''}
            ${tx ? `<tr class="tfoot"><td colspan="6" style="text-align:right;padding-right:16px">Tax (${tx}%)</td><td style="text-align:right">$${tax.toFixed(2)}</td><td></td></tr>` : ''}
            <tr class="tfoot" style="font-size:14px"><td colspan="6" style="text-align:right;padding-right:16px">GRAND TOTAL</td><td style="text-align:right;font-size:15px" id="ft">$${final.toFixed(2)}</td><td></td></tr>
          </tfoot>
        </table>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="add-row-btn">+ Add Row</button>
        <button class="btn btn-ghost btn-sm" id="add-rows-btn">+ Add Multiple</button>
        <button class="btn btn-ghost btn-sm" id="csv-import-btn">Import CSV</button>
        <button class="btn btn-ghost btn-sm" id="clear-rows-btn" style="color:var(--color-error)">Clear All</button>
        <span class="ml-auto text-muted" style="align-self:center">${window.S.items.length} item${window.S.items.length !== 1 ? 's' : ''}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span class="dot"></span>Pricing Extras</div>
      <div class="grid c3">
        <div class="field"><label>Freight / Shipping ($)</label><input type="number" data-vendor-field="freight" value="${window.esc(String(v.freight || ''))}" placeholder="0.00" min="0" /></div>
        <div class="field"><label>Tax Rate (%)</label><input type="number" data-vendor-field="tax_rate" value="${window.esc(String(v.tax_rate || ''))}" placeholder="0" min="0" max="100" /></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span class="dot"></span>Notes &amp; Terms</div>
      <div class="grid c1">
        <div class="field"><label>Notes</label><textarea data-vendor-field="notes" placeholder="Optional notes...">${window.esc(v.notes || '')}</textarea></div>
        <div class="field"><label>Terms &amp; Conditions</label><textarea data-vendor-field="terms">${window.esc(v.terms || '')}</textarea></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span class="dot"></span>Option Years</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <input type="checkbox" id="oy-on" ${v.option_years_enabled ? 'checked' : ''} style="width:auto;margin:0" />
        <label for="oy-on" style="text-transform:none;font-size:13px;color:var(--color-text);font-weight:400">Include option year pricing summary in quote</label>
      </div>
      ${optionYearsHtml}
    </div>

  </div>
  <div class="btn-row">
    <button class="btn btn-ghost" style="margin-right:auto" id="clear-vendor-btn">Clear Fields</button>
    <button class="btn btn-ghost" id="step3-back">← Back</button>
    <button class="btn btn-primary" id="step3-next">Preview &amp; Generate →</button>
  </div>`

  // Wire vendor field delegation on #vendor-form container
  const vendorForm = document.getElementById('vendor-form')
  if (vendorForm) {
    vendorForm.addEventListener('input', e => {
      const field = e.target.dataset.vendorField
      if (!field) return
      window.S.vendor[field] = e.target.value
      // Update totals immediately when freight or tax changes
      if (field === 'freight' || field === 'tax_rate') updTotals()
      // Clear validation error on this field when user types
      if (e.target.classList.contains('invalid')) {
        e.target.classList.remove('invalid', 'field-shake')
        const errMsg = e.target.parentElement?.querySelector('.field-error-msg')
        if (errMsg) errMsg.remove()
      }
    })
    vendorForm.addEventListener('change', e => {
      const field = e.target.dataset.vendorField
      if (!field) return
      window.S.vendor[field] = e.target.value
      if (field === 'freight' || field === 'tax_rate') updTotals()
    })
  }

  // Wire option years toggle
  document.getElementById('oy-on')?.addEventListener('change', e => {
    window.S.vendor.option_years_enabled = e.target.checked
    window.render(3)
  })

  // Wire line items event delegation
  wireLineItemDelegation()

  // Wire option years event delegation
  wireOptionYearsDelegation()

  // Wire tab navigation for line items table
  setupLineItemTabNav()

  // Wire action buttons
  document.getElementById('add-row-btn')?.addEventListener('click', addRow)
  document.getElementById('add-rows-btn')?.addEventListener('click', addRows)
  document.getElementById('csv-import-btn')?.addEventListener('click', openCsvModal)
  document.getElementById('clear-rows-btn')?.addEventListener('click', clearRows)
  document.getElementById('add-option-year-btn')?.addEventListener('click', addOptionYear)
  document.getElementById('open-profiles-btn')?.addEventListener('click', () => window.openProfiles?.())
  document.getElementById('clear-vendor-btn')?.addEventListener('click', clearVendorFields)
  document.getElementById('step3-back')?.addEventListener('click', () => window.goTo(2))
  document.getElementById('step3-next')?.addEventListener('click', window.next)

  // Wire logo buttons (conditionally rendered — check which one exists)
  document.getElementById('logo-pick-btn')?.addEventListener('click', () => window.pickLogo?.())
  document.getElementById('logo-remove-btn')?.addEventListener('click', () => window.removeLogo?.())

  // Wire CSV modal buttons if they exist in the DOM
  document.getElementById('csv-pick-file-btn')?.addEventListener('click', csvPickFile)
  document.getElementById('csv-import-confirm-btn')?.addEventListener('click', doImportCsv)
  document.getElementById('csv-close-btn')?.addEventListener('click', closeCsvModal)

  // Initial totals display
  updTotals()
}

// ── MODULE INIT ───────────────────────────────────────────────────────────────

function init() {
  // No static DOM elements to wire at init time for step3
}

window.step3 = step3
window.initStep3 = init
// Expose updTotals globally so step4 can call it when returning to step3
window.updTotals = updTotals
window.validateStep3 = validateStep3
