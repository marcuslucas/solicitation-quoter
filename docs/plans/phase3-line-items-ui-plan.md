# Phase 3 — Line Items Table UI Overhaul
## Implementation Plan

**Document version:** 1.0  
**Status:** Pre-implementation  
**Scope:** Column legibility, tab order, expand column, inline detail panel  
**Depends on:** Phase 1 (Data Enrichment) deployed — `spec_text`, `source_page`, `source_file`, `_source`, `qty_total`, `quantities_by_period` present in `S.items`  
**Files changed:** `electron/js/modules/step3.js`, `electron/index.html`

---

## Diagnostic Answers

### 1. How is the table currently rendered?

Built entirely via **template literal + `c.innerHTML`** inside `step3()` (step3.js:412). There is no separate `renderLineItems()` function — row generation is inlined in `step3()` as:

```javascript
const rows = window.S.items.map((it, i) => `<tr>...</tr>`).join('')
// ... injected into the large c.innerHTML = `...${rows}...` block
```

Every re-render replaces the entire content div. There is no partial update.

---

### 2. CSS classes on # column, qty, and unit price

| Element | Classes | Current inline style |
|---------|---------|----------------------|
| `#` th | none | `style="width:36px"` |
| `#` td | none | `style="text-align:center;color:var(--color-text-muted)"` |
| Qty input | none | `style="max-width:80px;background:var(--color-surface-raised);border:1px solid var(--color-border)"` |
| Unit price input | none | `style="background:var(--color-surface-raised);border:1px solid var(--color-border)"` |

**No CSS classes on any of these.** All styling is inline. The implementation will add named classes to enable CSS rules and JavaScript selectors.

---

### 3. S.items structure after 70B parse (Phase 1 deployed)

From `step1.js` (the bundle item mapping at line 167–185), each item has:

```javascript
{
  id:               1,
  description:      "Smoke Canister for Training (Reduced Toxicity)",
  size:             "",
  unit:             "EA",
  qty:              5700,           // qty_total from Phase 1
  unit_price:       "",
  // Phase 1 enrichment fields:
  sow_section:      "4.1.1",
  spec_text:        "This hand delivered smoke canister shall be equipped with an M201A1 or equivalent fuze...",
  source_page:      3,              // integer page in SOW PDF
  source_file:      "70B06C26Q00000080Attachment1LLSMSOW.pdf",
  _source:          "SOW+XLSX",
  qty_total:        5700,
  manufacturer_ref: "Defense Technologies",
  part_number:      "1063",
  quantities_by_period: { "1": 1140, "2": 1140, "3": 1140, "4": 1140, "5": 1140 }
}
```

All Phase 1 fields are null-safe (`?? null`) — they are present as `null` when Phase 1 data is absent. The detail panel must guard against null for every field.

---

### 4. Current column count and order

**8 columns** in this order:

| Position | Header | Width (th) | Notes |
|----------|--------|------------|-------|
| 1 | `#` | 36px | Row number, inline-only |
| 2 | Description | flex | Main text input |
| 3 | Size/Type | 85px | |
| 4 | UOM | 60px | |
| 5 | Qty | 75px | |
| 6 | Unit Price | 110px | |
| 7 | Total | 110px | Right-aligned, id="lt{i}" |
| 8 | (empty) | 72px | Dup/Del action buttons |

---

### 5. Event delegation pattern

Three listeners wired after every render:

1. **`wireLineItemDelegation()`** — two listeners on `#li-tbody`:
   - `change` handler: `e.target.closest('input, select')` → update `S.items[i][col]`
   - `click` handler: `e.target.closest('button[data-action]')` → `dup` / `del`

2. **`setupLineItemTabNav()`** — one `keydown` listener on `#li-tbody`:
   - Collects all `input, select, textarea` in tbody DOM order
   - Tab: move to next input; Shift+Tab: move to previous
   - Tab on last input: calls `addRow()` and focuses new row's first input

All listeners are added fresh on every `render(3)`. No listener accumulation because `c.innerHTML = ...` destroys the old tbody.

---

### 6. Toast function

`window.toast(message, type)` — defined in `electron/js/modules/shared/utils.js`.

Types: `'success'`, `'error'`, `'info'`, `'warn'`. Already used throughout step3.js (e.g., line 86: `window.toast('Company info saved', 'success')`).

---

### 7. CSS custom properties for badge colors

From `:root` in `index.html`:

| Role | Variable | Default (specter) value | Notes |
|------|----------|------------------------|-------|
| Success | `--color-success` | `#AAFF00` | Yellow-green |
| Warning | `--color-warning` | `#AAFF00` | **Same as success on default theme** |
| Info | `--color-info` | `#00FF41` | Same as primary on default theme |
| Muted | `--color-text-muted` | `#2a5e2a` | Dark muted green |
| Error | `--color-error` | `#FF4444` | Red |
| Primary | `--color-primary` | `#00FF41` | Bright green |

**Critical caveat:** On the default specter theme, `--color-success` and `--color-warning` are **identical** (`#AAFF00`). Badge classes that rely solely on these variables to differentiate `SOW+XLSX` from `XLSX` will be indistinguishable by color on that theme. The text labels on the badges provide semantic differentiation regardless of color.

**Mitigation:** Use distinct `rgba()` alpha values for badge backgrounds/borders rather than raw variable references. This creates subtle visual difference even when the underlying color is the same. Text always remains the authoritative differentiator.

---

### 8. Re-render behavior for expanded rows

`window.render(3)` calls `step3(c)` which executes `c.innerHTML = `...``—a **full wipe and rebuild**. Any `<tr class="lt-detail-row">` elements inserted by the expand toggle are **destroyed** on every re-render.

**Triggers that cause re-render:** `addRow()`, `dupRow()`, `delRow()`, `clearRows()`, option year toggle, `removeOptionYear()`, `clearVendorFields()`.

**Implication:** Expansion state is ephemeral — there is nothing to "preserve" on re-render. The detail panel open/close state lives only in the DOM. This is explicitly acceptable per the Phase 3 plan.

**No action required** to handle re-render safety — the expand state naturally resets. Document this behavior so it's not treated as a bug.

---

## Column Structure After Changes

**9 columns** (expand column added as first column):

| Position | Header | Width | CSS class on th/td | Purpose |
|----------|--------|-------|---------------------|---------|
| 1 | (empty) | 28px | `lt-col-expand` | Chevron toggle button |
| 2 | `#` | 36px min | `lt-col-num` | Row number, nowrap |
| 3 | Description | flex | — | Main description input |
| 4 | Size/Type | 85px | — | |
| 5 | UOM | 60px | — | |
| 6 | Qty | 80px min | — | Input gets class `lt-input-qty` |
| 7 | Unit Price | 115px min | — | Input gets class `lt-input-price` |
| 8 | Total | 110px | — | Right-aligned, `id="lt${i}"` |
| 9 | (empty) | 72px | — | Dup/Del actions |

Detail row when open spans **all 9 columns** (`colspan="9"`).

Tfoot `colspan` values must be updated from `6` to `7` for the subtotal/total rows (currently `colspan="6"` in each tfoot `<td>` — needs +1 for the new expand column).

---

## Tab Order Intercept Approach

**Current behavior** (`setupLineItemTabNav()`, step3.js:258–276): Tab moves across all inputs in DOM order — description → size → unit → qty → unit_price → next row's description.

**Required behavior:** Tab from unit_price → next row's unit_price (vertical column navigation). All other fields keep default horizontal behavior.

**Implementation:** Modify `setupLineItemTabNav()` to detect when the currently focused input has `data-col="unit_price"`. If so, override the destination:

```javascript
function setupLineItemTabNav() {
  const tbody = document.getElementById('li-tbody')
  if (!tbody) return
  tbody.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return
    const inputs = [...tbody.querySelectorAll('input,select,textarea')]
    const idx = inputs.indexOf(document.activeElement)
    if (idx === -1) return

    // Vertical tab: unit_price → next row's unit_price
    if (document.activeElement.dataset.col === 'unit_price') {
      e.preventDefault()
      const priceInputs = [...tbody.querySelectorAll('input[data-col="unit_price"]')]
      const pIdx = priceInputs.indexOf(document.activeElement)
      if (!e.shiftKey) {
        if (priceInputs[pIdx + 1]) { priceInputs[pIdx + 1].focus(); priceInputs[pIdx + 1].select?.() }
        else { addRow(); requestAnimationFrame(() => { document.querySelector('#li-tbody input[data-col="unit_price"]:last-of-type')?.focus() }) }
      } else {
        if (priceInputs[pIdx - 1]) { priceInputs[pIdx - 1].focus(); priceInputs[pIdx - 1].select?.() }
      }
      return
    }

    // Default: horizontal tab across all inputs
    e.preventDefault()
    const next = e.shiftKey ? inputs[idx - 1] : inputs[idx + 1]
    if (next) { next.focus(); next.select?.() }
    else if (!e.shiftKey) {
      addRow()
      const newInputs = [...document.getElementById('li-tbody').querySelectorAll('input,select,textarea')]
      if (newInputs.length) { newInputs[newInputs.length - 8]?.focus() }
      // Note: offset changes from -5 to -8 because expand button is now col 1
    }
  })
}
```

**Why modify rather than add a second listener:** Both approaches intercept the same `keydown` event on the same tbody. Modifying `setupLineItemTabNav()` directly avoids event ordering ambiguity and keeps all Tab logic in one place.

**The `addRow()` path after new column addition:** Currently `newInputs[newInputs.length - 5]` targets the first input of the new row. After adding the expand button (which is a `button`, not an `input`), the `querySelectorAll('input,select,textarea')` count changes. Recalculate: each row has 5 inputs (description, size, unit, qty, unit_price). Last row's first input = `newInputs.length - 5`. This **does not change** because `querySelectorAll('input,select,textarea')` doesn't include the expand button. Safe.

However for the unit_price vertical tab path after `addRow()`, the `requestAnimationFrame` approach of finding the last `unit_price` input is the safest.

---

## Detail Panel HTML Structure

The detail row is inserted via DOM manipulation (not re-render). On expand click, insert immediately after the item's `<tr>`:

```html
<tr class="lt-detail-row" data-detail-for="${i}">
  <td colspan="9" class="lt-detail-cell">
    <div class="lt-detail-panel">

      <!-- Header: section + source badge -->
      <div class="lt-detail-header">
        <span class="lt-detail-section">Section: ${esc(sow_section) || '—'}</span>
        <span class="lt-badge lt-badge-${badgeClass}">${esc(_source) || 'unknown'}</span>
      </div>

      <!-- Manufacturer / part number (render only if at least one is present) -->
      ${(manufacturer_ref || part_number) ? `
      <div class="lt-detail-refs">
        <span>Manufacturer: ${esc(manufacturer_ref) || '—'}</span>
        <span>Part #: ${esc(part_number) || '—'}</span>
      </div>` : ''}

      <!-- Period quantities (always rendered — shows — when null) -->
      <div class="lt-detail-quantities">
        <span class="lt-qty-label">Estimated Quantities:</span>
        <span>P1: ${qtyByPeriod?.['1'] ?? '—'}</span>
        <span>P2: ${qtyByPeriod?.['2'] ?? '—'}</span>
        <span>P3: ${qtyByPeriod?.['3'] ?? '—'}</span>
        <span>P4: ${qtyByPeriod?.['4'] ?? '—'}</span>
        <span>P5: ${qtyByPeriod?.['5'] ?? '—'}</span>
        <span class="lt-qty-total">Total: ${qty_total ?? '—'}</span>
      </div>

      <!-- Spec text (render only if present) -->
      ${spec_text ? `
      <div class="lt-detail-spec">
        <span class="lt-spec-label">Specification:</span>
        <p class="lt-spec-text">${esc(spec_text)}</p>
      </div>` : ''}

      <!-- Empty state (only when all enrichment fields are null) -->
      ${(!spec_text && !manufacturer_ref && !part_number) ? `
      <p class="lt-detail-empty">No additional detail available</p>` : ''}

      <!-- View source button (only if source_file AND source_page are non-null) -->
      ${(source_file && source_page != null) ? `
      <div class="lt-detail-actions">
        <button class="btn-view-source btn btn-ghost btn-sm"
                data-file="${esc(source_file)}"
                data-page="${source_page}"
                data-search="${esc((spec_text || '').slice(0, 80))}">
          View in Source PDF →
        </button>
      </div>` : ''}

    </div>
  </td>
</tr>
```

**badgeClass mapping:**
```
_source "SOW+XLSX" → "sow-xlsx"
_source "SOW"      → "sow"
_source "XLSX"     → "xlsx"
_source "unknown"  → "unknown"
(null/_source absent) → "unknown"
```

---

## Event Delegation Strategy

Extend the existing `click` handler inside `wireLineItemDelegation()`. Add two new `closest()` checks **before** the existing `data-action` check:

```javascript
tbody.addEventListener('click', e => {
  // 1. Expand toggle
  const expandBtn = e.target.closest('.lt-expand-btn')
  if (expandBtn) {
    const row = expandBtn.closest('tr')
    const rows = [...tbody.querySelectorAll('tr.lt-item-row')]  // only item rows
    const i = rows.indexOf(row)
    if (i !== -1) toggleDetail(tbody, row, i)
    return
  }

  // 2. View source (Phase 3: placeholder; Phase 4: real handler)
  const viewBtn = e.target.closest('.btn-view-source')
  if (viewBtn) {
    console.log('View source:', viewBtn.dataset.file, viewBtn.dataset.page, viewBtn.dataset.search)
    return
  }

  // 3. Existing dup/del
  const btn = e.target.closest('button[data-action]')
  if (!btn) return
  const row = btn.closest('tr')
  const i = [...tbody.querySelectorAll('tr.lt-item-row')].indexOf(row)
  if (i === -1) return
  if (btn.dataset.action === 'dup') dupRow(i)
  if (btn.dataset.action === 'del') delRow(i)
})
```

**Note:** Item rows need class `lt-item-row` on the `<tr>` so the `indexOf` lookup excludes open detail rows from the index count. Without this, `delRow(i)` would calculate the wrong index when a detail panel is open above the clicked row.

**`toggleDetail(tbody, row, i)` helper:**

```javascript
function toggleDetail(tbody, row, i) {
  const existing = tbody.querySelector('.lt-detail-row')
  const btn = row.querySelector('.lt-expand-btn')
  
  // If clicking the already-open row: close it
  if (existing && existing.dataset.detailFor === String(i)) {
    existing.remove()
    btn.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    return
  }
  
  // Close any other open row
  if (existing) {
    const openBtn = tbody.querySelector('.lt-expand-btn.open')
    if (openBtn) { openBtn.classList.remove('open'); openBtn.setAttribute('aria-expanded', 'false') }
    existing.remove()
  }
  
  // Open this row
  btn.classList.add('open')
  btn.setAttribute('aria-expanded', 'true')
  const detailRow = buildDetailRow(i, window.S.items[i])
  row.insertAdjacentElement('afterend', detailRow)
}
```

**`buildDetailRow(i, item)` helper:** Generates the detail `<tr>` element (not innerHTML — use `document.createElement` or assign innerHTML to a wrapper). Since the rest of the table uses template literals, using `innerHTML` on a temp container is consistent:

```javascript
function buildDetailRow(i, it) {
  const tr = document.createElement('tr')
  tr.className = 'lt-detail-row'
  tr.dataset.detailFor = i
  const badgeClass = { 'SOW+XLSX': 'sow-xlsx', 'SOW': 'sow', 'XLSX': 'xlsx' }[it._source] || 'unknown'
  const qbp = it.quantities_by_period || {}
  tr.innerHTML = `<td colspan="9" class="lt-detail-cell">
    <div class="lt-detail-panel">
      ...
    </div>
  </td>`
  return tr
}
```

---

## CSS Additions

All additions go in `electron/index.html` `<style>`, in a new `/* ── LINE ITEM DETAIL PANEL ──` block after the existing `/* Line items table */` block.

```css
/* ── LINE ITEM DETAIL PANEL ──────────────────────────────────────────────── */

/* Column sizing classes */
.lt-col-expand { width: 28px; min-width: 28px; padding: 4px !important; }
.lt-col-num    { min-width: 2.5rem; white-space: nowrap; text-align: center; }
.lt-input-qty  { min-width: 4rem; text-align: right; }
.lt-input-price { min-width: 6.5rem; text-align: right; }

/* Expand button */
.lt-expand-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 4px;
  transition: transform 0.15s ease, color 0.15s;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}
.lt-expand-btn:hover { color: var(--color-text); }
.lt-expand-btn.open  { transform: rotate(90deg); color: var(--color-primary); }

/* Detail row cell */
.lt-detail-row td { padding: 0 !important; border-bottom: 1px solid var(--color-border); }
.lt-detail-panel {
  padding: var(--space-md) var(--space-lg);
  background: var(--color-surface-raised);
  border-top: 1px solid var(--color-border);
}

/* Detail header (section + badge) */
.lt-detail-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
}
.lt-detail-section {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

/* Manufacturer/part number row */
.lt-detail-refs {
  display: flex;
  gap: var(--space-xl);
  font-size: var(--text-sm);
  color: var(--color-text);
  margin-bottom: var(--space-sm);
}

/* Period quantities */
.lt-detail-quantities {
  display: flex;
  gap: var(--space-md);
  align-items: center;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
  flex-wrap: wrap;
  padding: var(--space-xs) 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}
.lt-qty-label { font-weight: 700; color: var(--color-text); text-transform: uppercase; letter-spacing: 0.4px; }
.lt-qty-total { font-weight: 700; color: var(--color-primary); margin-left: var(--space-sm); }

/* Spec text */
.lt-detail-spec { margin-top: var(--space-sm); }
.lt-spec-label {
  font-size: var(--text-sm);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--color-text);
  display: block;
  margin-bottom: 4px;
}
.lt-spec-text {
  font-size: var(--text-sm);
  color: var(--color-text);
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
}

/* Actions row */
.lt-detail-actions {
  margin-top: var(--space-sm);
  display: flex;
  justify-content: flex-end;
}

/* Empty state */
.lt-detail-empty {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  font-style: italic;
}

/* Source provenance badges
   Note: on default specter theme, --color-success and --color-warning both resolve
   to #AAFF00. Visual differentiation via rgba alpha; text labels are always authoritative. */
.lt-badge {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-sm);
  padding: 2px var(--space-sm);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: 1px solid;
  border-radius: 0;
}
.lt-badge-sow-xlsx { background: rgba(0,255,65,0.15);  color: var(--color-success);     border-color: rgba(0,255,65,0.3); }
.lt-badge-sow      { background: rgba(0,200,255,0.10); color: var(--color-info);         border-color: rgba(0,200,255,0.25); }
.lt-badge-xlsx     { background: rgba(170,255,0,0.08); color: var(--color-warning);      border-color: rgba(170,255,0,0.2); }
.lt-badge-unknown  { background: transparent;           color: var(--color-text-muted);  border-color: var(--color-border); }
```

---

## Re-render Safety

| Scenario | Behavior | Safe? |
|----------|----------|-------|
| `addRow()` called while row 3 is expanded | `render(3)` rebuilds entire tbody; detail row gone; expansion reset to none | Yes — by design |
| `delRow(i)` while row i is expanded | Same — full re-render, detail row gone | Yes |
| `dupRow(i)` while row i is expanded | Same | Yes |
| User edits qty/unit_price | Does **not** trigger `render(3)` — only calls `updTotals()`. Detail row stays open. | Safe — no action needed |
| User edits description/size/unit | `change` handler updates `S.items[i]` directly; no re-render. Detail panel shows stale spec_text (acceptable — panel shows parse-time data) | Acceptable |
| `clearRows()` | Re-render, expansion reset | Yes |

**Key insight:** Inputs that trigger `updTotals()` only (`qty`, `unit_price`) do NOT cause re-render. The detail panel will remain open during price entry — which is the correct behavior since the user may be entering prices while reading the spec.

**The only risk:** If `wireLineItemDelegation()` uses `tr` index via `[...tbody.querySelectorAll('tr')]`, it must exclude detail rows from the count. This is why item `<tr>` elements need the class `lt-item-row` — the index computation becomes `[...tbody.querySelectorAll('tr.lt-item-row')].indexOf(row)`.

---

## "View in Source PDF" Button

**Data attributes required:**

| Attribute | Value | Source |
|-----------|-------|--------|
| `data-file` | `it.source_file` | Filename only (e.g. `"...LLSMSOW.pdf"`), not full path. `getSessionFilePath()` resolves to absolute path. |
| `data-page` | `it.source_page` | Integer page number in the PDF |
| `data-search` | `(it.spec_text \|\| '').slice(0, 80)` | First 80 chars of spec text for PDF.js text layer highlight |

**Phase 3 click handler (placeholder):**
```javascript
const viewBtn = e.target.closest('.btn-view-source')
if (viewBtn) {
  console.log('View source:', viewBtn.dataset.file, viewBtn.dataset.page, viewBtn.dataset.search)
  return
}
```

**Phase 4 click handler (full):**
```javascript
const viewBtn = e.target.closest('.btn-view-source')
if (viewBtn) {
  const filename = viewBtn.dataset.file
  const page = parseInt(viewBtn.dataset.page) || 1
  const search = viewBtn.dataset.search || ''
  const filePath = await window.api.getSessionFilePath(filename)
  if (!filePath) { window.toast('Source file not available. Re-parse to restore.', 'warn'); return }
  await window.api.openPdfViewer(filePath, page, search)
  return
}
```

`window.api.openPdfViewer` is wired in `preload.js` (Phase 4). In Phase 3 it does not exist — the `console.log` placeholder is safe.

---

## Implementation Order

Execute changes in this order within a single commit:

1. **Column legibility (CSS + template literals)**
   - Add `lt-col-expand`, `lt-col-num`, `lt-input-qty`, `lt-input-price` CSS classes in `index.html`
   - Add `lt-expand-btn` CSS in `index.html`
   - Add `lt-badge-*` and panel CSS in `index.html`
   - In `step3()` row template: add `lt-col-num` to `#` th and td; add `lt-input-qty` to qty input; add `lt-input-price` to unit price input; remove inline max-width from both inputs

2. **Add expand column to table**
   - Prepend new `<th class="lt-col-expand"></th>` to table header
   - Prepend `<td class="lt-col-expand"><button class="lt-expand-btn" aria-expanded="false">&#9654;</button></td>` to each row
   - Add `class="lt-item-row"` to each data `<tr>`
   - Update tfoot `colspan` from `6` to `7` in both tfoot cells

3. **Implement `toggleDetail()` and `buildDetailRow()`**
   - Add as module-private functions in `step3.js`

4. **Extend `wireLineItemDelegation()` click handler**
   - Add expand button and view-source button cases
   - Update dup/del index lookup to use `tr.lt-item-row`

5. **Modify `setupLineItemTabNav()`**
   - Add unit_price vertical tab intercept

6. **Validate** against Phase 3 acceptance criteria from `docs/line-item-confidence-plan.md`

---

## Acceptance Criteria Mapping

| Check | What to verify |
|-------|----------------|
| Row number "10" | Single line, no wrap. Class `lt-col-num` applied. |
| Unit price input legible | Input width ≥ 6.5rem; `lt-input-price` class present |
| Tab from row 1 unit price | Row 2 unit price receives focus |
| Shift+Tab from row 2 unit price | Row 1 unit price receives focus |
| Expand item with Phase 1 data | Shows manufacturer, part#, period quantities, spec text, badge |
| Expand item again | Panel collapses |
| Expand row 2 while row 1 open | Row 1 collapses, row 2 opens |
| Item with no spec_text/mfr/part# | Shows "No additional detail available" |
| "View in Source PDF" button | Present only when `source_file` and `source_page` both non-null |
| View source click | `console.log` fires (Phase 4 placeholder) |
| `addRow()` while panel open | Panel disappears (re-render resets state) |
| Dup/del index correct with panel open | `tr.lt-item-row` index used — correct row targeted |

---

*End of plan — version 1.0*
