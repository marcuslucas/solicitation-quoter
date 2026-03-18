// electron/js/modules/step4.js
// Step 4: Generate & Export
// Depends on: window.S (state.js), window.esc/grandTotal/bumpQuoteSeq/toast/goTo/next (utils.js)

// ── QUOTE PREVIEW HTML BUILDER ───────────────────────────────────────────────
// Colors mirror the DOCX generator exactly so all three outputs look identical
function buildQuoteHTML(forPrint) {
  const d=window.S.extracted, v=window.S.vendor
  const items=window.S.items.filter(i=>i.description||i.qty)
  const grand=window.grandTotal(), fr=parseFloat(v.freight||0), tx=parseFloat(v.tax_rate||0)
  const tax=grand*(tx/100), final=grand+fr+tax
  const hasPrice=items.some(i=>i.unit_price)
  const today=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})
  const validity=v.validity_period||window.S.validity||'30 days'

  // DOCX-matched palette
  const hdrLeft='#EFEFEF', hdrRight='#F5F5F5', labelCol='#F0F0F0'
  const liHdr='#1A1A1A', rowEven='#FFFFFF', rowOdd='#F7F9FC', totRow='#F0F0F0'
  const navy='#000000', dgray='#333333', border='#D0D0D0'

  // Section heading — matches DOCX heading() underline style
  const sec=txt=>`<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:700;color:${navy};border-bottom:1.5px solid #1A1A1A;padding-bottom:3px;margin:18px 0 8px">${txt}</div>`

  const logoHtml = v.logo_b64
    ? `<img src="data:image/${v.logo_ext||'png'};base64,${v.logo_b64}" style="max-height:55px;max-width:160px;object-fit:contain;margin-bottom:6px;display:block" />`
    : ''

  // Solicitation info rows (matches DOCX two-column key-value table)
  const solFields=[
    ['Project / Subject', d.project_title],['Solicitation Number', d.solicitation_number],
    ['Solicitation Type', d.solicitation_type],
    ['Issuing Agency', d.issuing_agency||d.agency||d.contact_agency],
    ['Response Due Date', d.due_date],['NAICS Code', d.naics_code||d.naics],
    ['PSC Code', d.psc_code||d.psc],['Set-Aside', d.set_aside],
    ['Place of Performance', d.place_of_performance],
  ].filter(([,v])=>v)

  // Option years (matches DOCX option years table)
  const oyHtml = (v.option_years_enabled && (v.option_years||[]).length && hasPrice) ? `
    ${sec('OPTION YEAR PRICING SUMMARY')}
    <table style="width:100%;border-collapse:collapse;font-size:9pt;border:1px solid ${border}">
      ${[['Base Year (Year 1)',final],...(v.option_years||[]).map(oy=>
          [oy.label||'Option Year',final*(1+(parseFloat(oy.pct||0)/100))])
        ].concat([['TOTAL — All Periods', final+((v.option_years||[]).reduce((s,oy)=>s+final*(1+(parseFloat(oy.pct||0)/100)),0))]])
        .map(([period,amt],i,arr)=>{
          const isLast=i===arr.length-1, isFirst=i===0
          const bg=(isFirst||isLast)?labelCol:rowEven
          return `<tr style="background:${bg}"><td style="padding:5px 8px;border-bottom:1px solid ${border};font-weight:${isLast?'700':'400'};color:${navy}">${window.esc(period)}</td><td style="padding:5px 8px;border-bottom:1px solid ${border};text-align:right;font-weight:${isLast?'700':'400'};color:${dgray}">$${amt.toFixed(2)}</td></tr>`
        }).join('')}
    </table>` : ''

  const inner = `
    <div style="font-family:Calibri,Arial,sans-serif;font-size:9.5pt;color:${dgray};background:#fff;max-width:780px;margin:0 auto;padding:32px 36px">

      <!-- HEADER: two-cell table matching DOCX layout -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
        <tr>
          <td style="width:50%;background:${hdrLeft};padding:12px 14px;vertical-align:top">
            ${logoHtml}
            <div style="font-size:15pt;font-weight:700;color:${navy}">${window.esc(v.company_name||'Your Company')}</div>
            ${v.address?`<div style="font-size:9pt;color:${dgray};margin-top:2px">${window.esc(v.address)}</div>`:''}
            ${v.city_state_zip?`<div style="font-size:9pt;color:${dgray}">${window.esc(v.city_state_zip)}</div>`:''}
            ${v.phone?`<div style="font-size:9pt;color:${dgray}">${window.esc(v.phone)}</div>`:''}
            ${v.email?`<div style="font-size:9pt;color:${dgray}">${window.esc(v.email)}</div>`:''}
          </td>
          <td style="width:50%;background:${hdrRight};padding:12px 14px;vertical-align:top">
            <div style="font-size:13pt;font-weight:700;color:${navy}">QUOTE / PROPOSAL</div>
            ${[
              ['Quote #', v.quote_number],['Date', today],
              ['Solicitation #', d.solicitation_number],['Valid For', validity],
              v.delivery_days?['Delivery', v.delivery_days+' days ARO']:null,
              v.prepared_by?['Prepared By', v.prepared_by]:null,
            ].filter(Boolean).map(([l,val])=>`
            <div style="font-size:9pt;margin-top:3px"><strong style="color:${navy}">${window.esc(l)}: </strong><span style="color:${dgray}">${window.esc(val||'')}</span></div>`).join('')}
          </td>
        </tr>
      </table>

      <!-- SOLICITATION INFORMATION -->
      ${solFields.length?`${sec('SOLICITATION INFORMATION')}
      <table style="width:100%;border-collapse:collapse;font-size:9pt;border:1px solid ${border}">
        ${solFields.map(([l,val])=>`<tr>
          <td style="width:33%;background:${labelCol};padding:5px 8px;font-weight:700;color:${navy};border-bottom:1px solid ${border}">${window.esc(l)}</td>
          <td style="padding:5px 8px;color:${dgray};border-bottom:1px solid ${border}">${window.esc(String(val||''))}</td>
        </tr>`).join('')}
      </table>`:''}

      <!-- SCOPE OF WORK -->
      ${d.scope_of_work?`${sec('SCOPE OF WORK / REQUIREMENT')}
      <div style="font-size:9.5pt;color:${dgray};line-height:1.6;margin-left:8px">${window.esc(d.scope_of_work)}</div>`:''}

      <!-- QUOTE DETAILS -->
      ${sec('QUOTE DETAILS')}
      <table style="width:100%;border-collapse:collapse;font-size:9pt;border:1px solid ${border}">
        <thead><tr style="background:${liHdr};color:#fff">
          <th style="padding:7px 8px;text-align:center;width:5%">#</th>
          <th style="padding:7px 8px;text-align:left">Description / Item</th>
          <th style="padding:7px 8px;text-align:center;width:10%">Size/Type</th>
          <th style="padding:7px 8px;text-align:center;width:7%">UOM</th>
          <th style="padding:7px 8px;text-align:center;width:8%">Qty</th>
          <th style="padding:7px 8px;text-align:right;width:12%">Unit Price</th>
          <th style="padding:7px 8px;text-align:right;width:14%">Total</th>
        </tr></thead>
        <tbody>${items.length?items.map((it,i)=>{
          const qn=parseFloat(it.qty)||null, un=parseFloat(it.unit_price)||null
          const tot=qn&&un?qn*un:null
          const bg=i%2===0?rowEven:rowOdd
          return `<tr style="background:${bg}">
            <td style="padding:6px 8px;border-bottom:1px solid ${border};text-align:center;color:${dgray}">${i+1}</td>
            <td style="padding:6px 8px;border-bottom:1px solid ${border};color:${dgray}">${window.esc(it.description||'N/A')}</td>
            <td style="padding:6px 8px;border-bottom:1px solid ${border};text-align:center;color:${dgray}">${window.esc(it.size||'N/A')}</td>
            <td style="padding:6px 8px;border-bottom:1px solid ${border};text-align:center;color:${dgray}">${window.esc(it.unit||'EA')}</td>
            <td style="padding:6px 8px;border-bottom:1px solid ${border};text-align:center;color:${dgray}">${qn!=null?(Number.isInteger(qn)?qn:parseFloat(qn.toFixed(4))):'N/A'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid ${border};text-align:right;color:${dgray}">${un!=null?'$'+un.toFixed(2):'N/A'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid ${border};text-align:right;color:${dgray}">${tot!=null?'$'+tot.toFixed(2):'N/A'}</td>
          </tr>`}).join(''):`<tr><td colspan="7" style="padding:10px 8px;text-align:center;color:${dgray}">No line items</td></tr>`}</tbody>
        <tfoot>
          <tr style="background:${totRow}">
            <td colspan="5" style="padding:7px 8px;text-align:right;font-weight:700;color:${navy};border-top:1px solid ${border}">GRAND TOTAL</td>
            <td colspan="2" style="padding:7px 8px;text-align:right;font-weight:700;font-size:10.5pt;color:${navy};border-top:1px solid ${border}">${hasPrice||fr>0?'$'+final.toFixed(2):'N/A'}</td>
          </tr>
        </tfoot>
      </table>

      ${oyHtml}

      <!-- NOTES & TERMS -->
      ${(v.notes||v.terms)?`${sec('NOTES &amp; TERMS')}
      ${v.notes?`<div style="font-size:9.5pt;color:${dgray};margin-left:8px;margin-bottom:6px"><strong style="color:${navy}">Notes: </strong>${window.esc(v.notes)}</div>`:''}
      ${v.terms?`<div style="font-size:9.5pt;color:${dgray};margin-left:8px"><strong style="color:${navy}">Terms: </strong>${window.esc(v.terms)}</div>`:''}
      `:''}

      <!-- AUTHORIZED SIGNATURE -->
      ${sec('AUTHORIZED SIGNATURE')}
      <table style="width:100%;border-collapse:collapse;font-size:9pt;border:1px solid ${border}">
        <tr>
          <td style="width:50%;padding:10px 12px;vertical-align:top;border-right:1px solid ${border}">
            <div style="margin-bottom:14px"><strong style="color:${navy}">Authorized Signature: </strong><span style="border-bottom:1px solid #999;display:inline-block;width:160px">&nbsp;</span></div>
            <div style="margin-bottom:14px"><strong style="color:${navy}">Printed Name: </strong>${window.esc(v.prepared_by||'_'.repeat(24))}</div>
            <div style="margin-bottom:14px"><strong style="color:${navy}">Title: </strong>${window.esc(v.title||'_'.repeat(28))}</div>
            <div><strong style="color:${navy}">Date: </strong>${today}</div>
          </td>
          <td style="width:50%;padding:10px 12px;vertical-align:top">
            <div style="margin-bottom:14px"><strong style="color:${navy}">Company: </strong>${window.esc(v.company_name||'')}</div>
            <div style="margin-bottom:14px"><strong style="color:${navy}">Phone: </strong>${window.esc(v.phone||'_'.repeat(24))}</div>
            <div style="margin-bottom:14px"><strong style="color:${navy}">Email: </strong>${window.esc(v.email||'_'.repeat(24))}</div>
            <div><strong style="color:${navy}">SAM UEI: </strong>${window.esc(v.sam_uei||'_'.repeat(20))}</div>
          </td>
        </tr>
      </table>

      <!-- FOOTER -->
      <div style="text-align:center;font-size:8pt;color:#999;margin-top:20px;font-style:italic">
        Quote valid for ${window.esc(validity)} from ${today}.
      </div>
    </div>`

  if (!forPrint) return inner
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:0;background:#fff}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${inner}</body></html>`
}

// ── STEP 4 RENDER ─────────────────────────────────────────────────────────────

function step4(c) {
  const d=window.S.extracted, v=window.S.vendor
  const items=window.S.items.filter(i=>i.description||i.qty)
  const grand=window.grandTotal(), fr=parseFloat(v.freight||0), tx=parseFloat(v.tax_rate||0)
  const tax=grand*(tx/100), final=grand+fr+tax

  const checks = [
    { label: 'Company name',           ok: !!v.company_name },
    { label: 'Solicitation number',    ok: !!d.solicitation_number },
    { label: 'At least one line item', ok: items.length > 0 },
    { label: 'All unit prices filled', ok: items.length > 0 && items.every(i=>i.unit_price!==''&&i.unit_price!==undefined) },
    { label: 'Prepared by name',       ok: !!v.prepared_by },
  ]
  const allOk = checks.every(ch => ch.ok)
  const warnHtml = `<div class="preflight">
    <div class="preflight-title">${allOk ? 'Pre-flight check — ready to generate' : 'Pre-flight check — review before generating'}</div>
    ${checks.map(ch=>`<div class="preflight-row ${ch.ok?'ok':'warn'}">
      <span class="preflight-icon">${ch.ok?'✓':'✕'}</span>${ch.label}
    </div>`).join('')}
  </div>`

  c.innerHTML = `
  ${warnHtml}
  <div class="card">
    <div class="card-title"><span class="dot"></span>Quote Preview</div>
    <div class="quote-preview-wrap">${buildQuoteHTML(false)}</div>
  </div>
  <div class="card">
    <div class="card-title"><span class="dot"></span>Summary</div>
    <div class="data-grid">
      <div class="data-item"><div class="data-label">Solicitation #</div><div>${window.esc(d.solicitation_number||'—')}</div></div>
      <div class="data-item"><div class="data-label">Project</div><div>${window.esc(d.project_title||'—')}</div></div>
      <div class="data-item"><div class="data-label">Vendor</div><div>${window.esc(v.company_name||'—')}</div></div>
      <div class="data-item"><div class="data-label">Prepared By</div><div>${window.esc(v.prepared_by||'—')}</div></div>
      <div class="data-item"><div class="data-label">Line Items</div><div>${items.length}</div></div>
      <div class="data-item"><div class="data-label">Subtotal</div><div class="text-gold">$${grand.toFixed(2)}</div></div>
      ${fr?`<div class="data-item"><div class="data-label">Freight</div><div>$${fr.toFixed(2)}</div></div>`:''}
      ${tx?`<div class="data-item"><div class="data-label">Tax (${tx}%)</div><div>$${tax.toFixed(2)}</div></div>`:''}
      <div class="data-item" style="border:1px solid var(--gold)"><div class="data-label">TOTAL</div><div class="text-gold" style="font-size:16px;font-weight:700">$${final.toFixed(2)}</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title"><span class="dot"></span>Export</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-lg" id="gen-btn">Generate Quote (.docx)</button>
      <button class="btn btn-ghost btn-lg" id="pdf-btn">Save as PDF</button>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:10px">A Save dialog will open. The document opens automatically after saving.</div>
  </div>
  <div id="gen-prog" class="hidden" style="margin-top:12px">
    <div class="alert alert-info"><div class="spin"></div><span style="margin-left:8px">Generating document...</span></div>
  </div>
  <div id="gen-err" class="hidden"></div>
  <div id="gen-ok" class="hidden">
    <div class="alert alert-success"><strong>Quote saved and opened successfully.</strong></div>
  </div>
  <div class="btn-row" style="margin-top:8px">
    <button class="btn btn-ghost" id="step4-back">← Back</button>
    <button class="btn btn-ghost" id="step4-new">New Quote</button>
  </div>`

  document.getElementById('gen-btn')?.addEventListener('click', doGenerate)
  document.getElementById('pdf-btn')?.addEventListener('click', doGeneratePdf)
  document.getElementById('step4-back')?.addEventListener('click', () => window.goTo(3))
  document.getElementById('step4-new')?.addEventListener('click', startOver)
}

// ── GENERATE DOCX ─────────────────────────────────────────────────────────────

async function doGenerate() {
  const btn=document.getElementById('gen-btn')
  const prog=document.getElementById('gen-prog')
  const err=document.getElementById('gen-err')
  const ok=document.getElementById('gen-ok')
  btn.disabled=true; prog.classList.remove('hidden'); err.classList.add('hidden'); ok.classList.add('hidden')
  try {
    const r = await fetch(`http://127.0.0.1:${window.S.port}/generate_quote`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ solicitation:window.S.extracted, vendor:window.S.vendor, line_items:window.S.items.filter(i=>i.description||i.qty) })
    })
    if(!r.ok){ const e=await r.json(); throw new Error(e.error||'Generation failed') }
    const blob=await r.blob()
    const ab=await blob.arrayBuffer()
    const bytes=Array.from(new Uint8Array(ab))
    const sol=(window.S.extracted.solicitation_number||'Quote').replace(/[^A-Za-z0-9\-_]/g,'_')
    const name=`Quote_${sol}.docx`
    prog.classList.add('hidden')
    if(window.api){
      const res=await window.api.saveQuote({bytes,name})
      if(res.success){ ok.classList.remove('hidden'); window.S.done.add(4); window.toast('Quote saved successfully', 'success') }
      else { window.toast('Save cancelled', 'info', 2000) }
    } else {
      const url=URL.createObjectURL(blob); const a=document.createElement('a')
      a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url)
      ok.classList.remove('hidden'); window.toast('Quote downloaded', 'success')
    }
    window.bumpQuoteSeq()
    const finalTotal = window.S.items.filter(i=>i.description||i.qty)
      .reduce((s,i)=>s+(parseFloat(i.qty)||0)*(parseFloat(i.unit_price)||0),0)
      + (parseFloat(window.S.vendor.freight)||0)
    saveToHistory(window.S.extracted, window.S.vendor, finalTotal)
    try { localStorage.removeItem('session') } catch(e) {}
    btn.disabled=false
  } catch(e) {
    prog.classList.add('hidden'); err.classList.remove('hidden')
    err.innerHTML=`<div class="alert alert-error">${window.esc(e.message)}</div>`
    btn.disabled=false
  }
}

// ── PDF GENERATION ────────────────────────────────────────────────────────────

async function doGeneratePdf() {
  const btn=document.getElementById('pdf-btn')
  const prog=document.getElementById('gen-prog')
  const err=document.getElementById('gen-err')
  btn.disabled=true; prog.classList.remove('hidden'); err.classList.add('hidden')
  try {
    const html=buildQuoteHTML(true)
    const sol=(window.S.extracted.solicitation_number||'Quote').replace(/[^A-Za-z0-9\-_]/g,'_')
    const name=`Quote_${sol}.pdf`
    if(window.api){
      const bytes=await window.api.generatePdf({html})
      prog.classList.add('hidden')
      const res=await window.api.savePdf({bytes,name})
      if(res.success){
        const ok=document.getElementById('gen-ok')
        ok.classList.remove('hidden')
        window.toast('PDF saved successfully', 'success')
      } else { window.toast('Save cancelled', 'info', 2000) }
    } else {
      // Browser fallback: print dialog
      prog.classList.add('hidden')
      const w=window.open('','_blank')
      w.document.write(html); w.document.close()
      w.print()
    }
  } catch(e) {
    prog.classList.add('hidden'); err.classList.remove('hidden')
    err.innerHTML=`<div class="alert alert-error">${window.esc(e.message)}</div>`
  }
  btn.disabled=false
}

// ── START OVER ────────────────────────────────────────────────────────────────

function startOver() {
  if(!confirm('Start a new quote? Current data will be cleared.')) return
  try { localStorage.removeItem('session') } catch(e) {}
  window.S.step=1; window.S.done=new Set(); window.S.file=null; window.S.filePath=null; window.S.extracted={}
  window.S.items=[{id:1,description:'',size:'',unit:'EA',qty:'',unit_price:''}]
  window.S.vendor.quote_number = ''
  delete window.S._pendingSession
  const tf=document.getElementById('tf'); if(tf) tf.textContent=''
  window.goTo(1)
}

// ── HISTORY HELPERS ───────────────────────────────────────────────────────────

function saveToHistory(solicitation, vendor, total) {
  try {
    const h = JSON.parse(localStorage.getItem('quoteHistory')||'[]')
    h.unshift({ts:Date.now(), solicitation_number:solicitation.solicitation_number||'',
      project_title:solicitation.project_title||'', company_name:vendor.company_name||'',
      total, filename:`Quote_${(solicitation.solicitation_number||'Quote').replace(/[^A-Za-z0-9\-_]/g,'_')}.docx`})
    localStorage.setItem('quoteHistory', JSON.stringify(h.slice(0,10)))
  } catch(e) {}
}

// ── MODULE INIT ───────────────────────────────────────────────────────────────

function init() {
  // No static DOM elements to wire at init time for step4
}

window.step4 = step4
window.initStep4 = init
window.buildQuoteHTML = buildQuoteHTML
window.startOver = startOver
