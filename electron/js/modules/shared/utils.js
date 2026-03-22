// electron/js/modules/shared/utils.js
// Shared utility functions exposed as window globals.
// Depends on: window.S (set by state.js, loaded before this file)

// ── HTML ESCAPE ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

// ── FILE SIZE FORMAT ──────────────────────────────────────────────────────────
function fmt(b) {
  if (b < 1024) return b+'B'
  if (b < 1048576) return (b/1024).toFixed(1)+'KB'
  return (b/1048576).toFixed(1)+'MB'
}

// ── LINE ITEM CALCULATIONS ────────────────────────────────────────────────────
function lineTotal(it) {
  const q=parseFloat(it.qty), p=parseFloat(it.unit_price)
  const t = (isNaN(q)||isNaN(p)) ? 0 : q*p
  return t>0?'$'+t.toFixed(2):'–'
}

function grandTotal() {
  return S.items.reduce((s,it)=>{
    const q=parseFloat(it.qty), p=parseFloat(it.unit_price)
    return s + ((isNaN(q)||isNaN(p)) ? 0 : q*p)
  }, 0)
}

function updTotals() {
  S.items.forEach((it,i)=>{ const e=document.getElementById('lt'+i); if(e)e.textContent=lineTotal(it) })
  const g=grandTotal(),fr=parseFloat(S.vendor.freight||0),tx=parseFloat(S.vendor.tax_rate||0)
  const tax=g*(tx/100),fin=g+fr+tax
  const ge=document.getElementById('gt'),fe=document.getElementById('ft')
  if(ge)ge.textContent='$'+g.toFixed(2); if(fe)fe.textContent='$'+fin.toFixed(2)
}

// ── QUOTE NUMBER ──────────────────────────────────────────────────────────────
function nextQuoteNum() {
  try {
    const seq = parseInt(localStorage.getItem('quoteSeq')||'0') + 1
    return `Q-${new Date().getFullYear()}-${String(seq).padStart(4,'0')}`
  } catch(e) { return '' }
}

function bumpQuoteSeq() {
  try { localStorage.setItem('quoteSeq', String(parseInt(localStorage.getItem('quoteSeq')||'0')+1)) } catch(e) {}
}

// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────────────
function toast(msg, type='info', duration=3500) {
  const container = document.getElementById('toast-container')
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.innerHTML = `<span>${esc(msg)}</span><span class="toast-x" onclick="this.parentElement.remove()">✕</span>`
  container.appendChild(el)
  const dismiss = () => {
    el.classList.add('dying')
    el.addEventListener('animationend', () => el.remove(), { once: true })
  }
  const timer = setTimeout(dismiss, duration)
  el.querySelector('.toast-x').addEventListener('click', () => { clearTimeout(timer); el.remove() }, { once: true })
}

// ── UNDO / REDO ───────────────────────────────────────────────────────────────
const UNDO_STACK = []
const REDO_STACK = []
const MAX_UNDO   = 30

function snapState() {
  return JSON.parse(JSON.stringify({ items: S.items, vendor: S.vendor, extracted: S.extracted }))
}

function pushUndo() {
  UNDO_STACK.push(snapState())
  if (UNDO_STACK.length > MAX_UNDO) UNDO_STACK.shift()
  REDO_STACK.length = 0
}

function doUndo() {
  if (!UNDO_STACK.length) { toast('Nothing to undo', 'info', 2000); return }
  REDO_STACK.push(snapState())
  const prev = UNDO_STACK.pop()
  S.items = prev.items; S.vendor = prev.vendor; S.extracted = prev.extracted
  render(S.step)
  toast('Undone', 'info', 1800)
}

function doRedo() {
  if (!REDO_STACK.length) { toast('Nothing to redo', 'info', 2000); return }
  UNDO_STACK.push(snapState())
  const next = REDO_STACK.pop()
  S.items = next.items; S.vendor = next.vendor; S.extracted = next.extracted
  render(S.step)
  toast('Redone', 'info', 1800)
}

// ── START OVER ────────────────────────────────────────────────────────────────
function startOver() {
  if(!confirm('Start a new quote? Current data will be cleared.')) return
  try { localStorage.removeItem('session') } catch(e) {}
  S.step=1; S.done=new Set(); S.file=null; S.filePath=null; S.extracted={}
  S.items=[{id:1,description:'',size:'',unit:'EA',qty:'',unit_price:''}]
  S.vendor.quote_number = ''
  delete S._pendingSession
  const tf=document.getElementById('tf'); if(tf) tf.textContent=''
  goTo(1)
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function goTo(n) {
  try {
    const sess = {step:n, done:[...S.done], extracted:S.extracted, vendor:S.vendor, items:S.items}
    localStorage.setItem('session', JSON.stringify(sess))
  } catch(e) {}
  S.step = n
  render(n)
  document.querySelectorAll('.nav-item[data-step]').forEach(el => {
    const s = +el.dataset.step
    el.classList.toggle('active', s === n)
    el.classList.toggle('done', S.done.has(s) && s !== n)
    const sn = document.getElementById('sn'+s)
    if (S.done.has(s) && s !== n) {
      sn.innerHTML = '<svg width="11" height="9" viewBox="0 0 11 9" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 4.5L4 7.5L10 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    } else {
      sn.textContent = s
    }
  })
  document.getElementById('tt').textContent = TITLES[n]
}

function next() {
  // Per D-12: validate before advancing. Per D-17: step 2 has no validation.
  // Each step can register a window.validateStepN function. If it returns false, block.
  const validator = window['validateStep' + S.step]
  if (typeof validator === 'function' && !validator()) return
  S.done.add(S.step)
  goTo(S.step + 1)
}

// ── RENDER ────────────────────────────────────────────────────────────────────
// Looks up step functions via window to avoid circular dependency with step modules.
function render(n) {
  const c = document.getElementById('content')
  if (!c) return
  c.innerHTML = ''
  const fns = [null, window.step1, window.step2, window.step3, window.step4]
  if (fns[n]) fns[n](c)
}

// ── EXPOSE ON WINDOW ──────────────────────────────────────────────────────────
window.esc = esc; window.fmt = fmt; window.lineTotal = lineTotal;
window.grandTotal = grandTotal; window.updTotals = updTotals;
window.nextQuoteNum = nextQuoteNum; window.bumpQuoteSeq = bumpQuoteSeq;
window.toast = toast; window.UNDO_STACK = UNDO_STACK; window.REDO_STACK = REDO_STACK;
window.snapState = snapState; window.pushUndo = pushUndo;
window.doUndo = doUndo; window.doRedo = doRedo;
window.startOver = startOver; window.goTo = goTo; window.next = next;
window.render = render;
