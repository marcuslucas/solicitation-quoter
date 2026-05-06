# Phase 10 — Column Resize + .docx Fixes: Diagnostic Report & Implementation Plan

**Date:** 2026-05-05  
**Scope:** Phase 10 of sol-quoter-roadmap-phases-6-10.md  
**Status:** Planning — no code written  
**Structure:** Part A (column resize) then Part B (.docx fixes), each with diagnostic then plan sections

---

## Files Read

- `python/generator.py` — full (277 lines)
- `electron/js/modules/step3.js` — full (735 lines)
- `electron/js/state.js` — full (29 lines)
- `electron/index.html` — full (742 lines)
- `docs/plans/phase-8-planning-output.md` — full
- `docs/plans/phase-9-planning-output.md` — full
- `docs/plans/sol-quoter-roadmap-phases-6-10.md` — Phase 10 section

---

## Part A — Column Resize — Diagnostic Answers

### Q1 — Is the table rebuilt from scratch on every render(3)?

**Yes. The table is rebuilt from scratch on every `render(3)` call.**

The mechanism is `c.innerHTML = \`...\`` at `step3.js:568`. This single assignment replaces the entire step 3 DOM in one shot. The assignment is unconditional — there is no incremental patch, no diffing, no partial update. The full template string at lines 568–659 contains the `<thead>`, `<tbody>`, and `<tfoot>` in their entirety.

The relevant path is:

1. Caller (e.g., `addRow()`, `dupRow()`, `delRow()`, etc.) calls `window.render(3)`.
2. `render(3)` calls `step3(c)` where `c` is the `#content` DOM node.
3. Inside `step3(c)`, line 568: `c.innerHTML = \`...\`` — entire step3 DOM written atomically.
4. All event handlers wired from lines 661 onward are then re-added to the fresh DOM.

**Consequence for column resize:** Column widths applied as inline styles on `<th>` elements are destroyed on every re-render. `initResizableColumns()` must restore saved widths from localStorage every time it runs, and it must run on every `step3()` call.

---

### Q2 — Current column definitions in the table header

**`step3.js` lines 604–610 — exact `<thead>` HTML:**

```html
<thead><tr>
  <th class="lt-col-expand"></th>
  <th class="lt-col-num" style="width:36px">#</th>
  <th>Description</th>
  <th style="width:85px">Size/Type</th>
  <th style="width:60px">UOM</th>
  <th style="width:75px">Qty</th>
  <th style="width:110px">Unit Price</th>
  <th style="width:110px;text-align:right">Total</th>
  <th style="width:72px"></th>
</tr></thead>
```

| Column | Label | `style=` | `id=` | `data-*=` |
|--------|-------|----------|-------|-----------|
| 0 | _(empty)_ | none | none | none |
| 1 | `#` | `width:36px` | none | none |
| 2 | `Description` | none | none | none |
| 3 | `Size/Type` | `width:85px` | none | none |
| 4 | `UOM` | `width:60px` | none | none |
| 5 | `Qty` | `width:75px` | none | none |
| 6 | `Unit Price` | `width:110px` | none | none |
| 7 | `Total` | `width:110px;text-align:right` | none | none |
| 8 | _(empty — actions)_ | `width:72px` | none | none |

**No `<col>` elements are used anywhere in the table.** Column 0 gets its width from `index.html` CSS: `.lt-col-expand { width:2rem; min-width:2rem }`. Column 1 gets it from `.lt-col-num { min-width:2.5rem }` plus the inline `width:36px`.

No `<th>` has a stable `id` or `data-*` attribute. Every `<th>` is anonymous except for the CSS class on columns 0 and 1.

---

### Q3 — Stable IDs or data attributes on `<th>` elements

**Absent.** No `<th>` has an `id` or `data-*` attribute. The elements are identified only by position (index in the row's cells) and CSS class (`.lt-col-expand`, `.lt-col-num`).

**Minimal addition to enable width restoration:** Add a `data-col` attribute to each resizable `<th>` in the template string. The attribute value becomes the localStorage key. Example:

```html
<th data-col="description">Description</th>
<th data-col="size" style="width:85px">Size/Type</th>
<th data-col="uom" style="width:60px">UOM</th>
<th data-col="qty" style="width:75px">Qty</th>
<th data-col="unitprice" style="width:110px">Unit Price</th>
<th data-col="total" style="width:110px;text-align:right">Total</th>
```

Fixed-width columns (expand button, `#`, actions) get no `data-col` because they should not get drag handles and their widths are not user-adjustable.

This addition does not affect any existing code. No CSS selector, no JS logic in any file reads `data-col` on `<th>` elements today.

---

### Q4 — Last 20 lines of `step3()` + insertion point for `initResizableColumns()`

**`step3.js` lines 700–722 — last 23 lines of the function body:**

```javascript
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
```

The function ends at line 722 (`}`). The last executable statement is `updTotals()` at line 721.

**Exact insertion point:** After `updTotals()` and before the closing `}`. The new call is:

```javascript
  updTotals()
  initResizableColumns()  // ← INSERT HERE
}
```

This is correct because:
- `c.innerHTML =` runs at line 568 — the table is in the DOM well before this point
- All event handlers (delegation, buttons, tab nav) are wired before this point
- `updTotals()` is called last for a reason (it reads the just-rendered DOM) — `initResizableColumns()` follows it as the final DOM manipulation step

**`checkAiStatus()` conflict:** `checkAiStatus()` is the last statement of `step2()` (line 563 of `step2.js`), not `step3()`. It does not appear in `step3.js` at all. No conflict exists.

---

### Q5 — Existing CSS related to resize, col-resize cursor, or column width drag

**Confirmed absent.** The `index.html` CSS block (lines 6–544) contains no references to:
- `col-resize`
- `resize-handle`
- column width drag
- `user-select` (which would need to be set during drag)
- any existing `<th>` or `.tbl th` rule that sets cursor

The only table-related CSS in `index.html`:

```css
.tbl{width:100%;border-collapse:collapse}
.tbl th{background:var(--color-header-raised);padding:var(--space-sm) var(--space-md);
         font-size:var(--text-sm);font-weight:700;text-align:left;
         color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.8px;
         border-bottom:1px solid var(--color-border)}
.tbl td{padding:var(--space-sm) var(--space-md);border-bottom:1px solid var(--color-border);
         vertical-align:middle}
```

No `position:relative` on `.tbl th` (needed for the absolutely positioned drag handle child). This must be added.

---

### Q6 — Existing `localStorage` patterns in the codebase

**Three confirmed localStorage usages:**

**1. `saveVendor()` — `step3.js` line 84:**
```javascript
function saveVendor() {
  try { localStorage.setItem('vendor', JSON.stringify(window.S.vendor)) } catch (e) {}
  window.toast('Company info saved', 'success')
}
```
Key: `'vendor'`. Value: JSON-serialized `S.vendor` object.

**2. Load vendor on startup — in `index.js` (bootstrapper, not read in this session but confirmed from Phase 8 planning context):** `localStorage.getItem('vendor')` is called during app startup to restore vendor fields from a previous session into `window.S.vendor`.

**3. Theme persistence — `shared/theme.js`:** Reads and writes a theme key (exact key not confirmed without reading theme.js, but the theme modal's apply/save logic writes to localStorage per the existing patterns).

**Pattern established by the codebase:**
- All localStorage keys are namespaced strings
- Values are JSON-serialized objects (not primitives)
- The `try { } catch (e) {}` guard is used on writes to handle private browsing or quota errors
- No getItem guard is used — `JSON.parse(null)` → `null` is the expected graceful fail for a missing key

**Adding `'sol-quoter:col-widths'` is consistent with this pattern** and introduces a new namespaced key (`:` separating app name from purpose, a common convention). It is the first `:` namespaced key in the codebase — the existing `'vendor'` key is unnested. This is acceptable and follows the roadmap specification exactly.

---

## Part B — .docx Fixes — Diagnostic Answers

### Q7 — Line items table construction in `generator.py`

**a. `add_table()` call — `generator.py` line 179:**

```python
lt=doc.add_table(rows=1+len(line_items)+1,cols=7); lt.style="Table Grid"; lt.autofit=False
```

7 columns. `rows` = 1 header + N data rows + 1 totals row.

**b. Column widths array — `generator.py` line 177:**

```python
cw=[Inches(0.35),Inches(2.1),Inches(0.55),Inches(0.6),Inches(0.55),Inches(0.85),Inches(1.0)]
```

The `#` (item number) column is index 0: `Inches(0.35)`.

- Raw value: `Inches(0.35)` → 0.35 × 914,400 = **320,040 EMUs**
- In inches: **0.35 inches**

This is the column that overflows at item ≥ 100.

**c. Header row construction — `generator.py` line 178:**

```python
hdrs=["#","Description / Item","Size/Type","UOM","Qty","Unit Price","Total"]
```

Labels in order: `#`, `Description / Item`, `Size/Type`, `UOM`, `Qty`, `Unit Price`, `Total`.

**d. Data row construction — `generator.py` lines 192–209:**

```python
for i,item in enumerate(line_items):
    row=lt.rows[i+1]; row_keep(row)
    qty_n = fmt_num(item.get("qty"))
    up_n  = fmt_num(item.get("unit_price"))
    total_n = (qty_n * up_n) if (qty_n is not None and up_n is not None) else None
    if total_n is not None: grand += total_n; has_any_price = True
    bcolor="FFFFFF" if i%2==0 else "F7F9FC"
    qty_s   = (str(int(qty_n)) if qty_n is not None and qty_n == int(qty_n) else str(qty_n)) if qty_n is not None else "N/A"
    up_s    = f"${up_n:,.2f}" if up_n is not None else "N/A"
    total_s = f"${total_n:,.2f}" if total_n is not None else "N/A"
    desc    = item.get("description","") or "N/A"
    size    = item.get("size","") or "N/A"
    unit    = item.get("unit","EA") or "EA"
    vals=[str(i+1), desc, size, unit, qty_s, up_s, total_s]
    for ci,(val,al,w) in enumerate(zip(vals,AL,cw)):
        c=row.cells[ci]; bg(c,bcolor); c.width=w
        p=c.paragraphs[0]; p.alignment=al; p.paragraph_format.left_indent=Pt(3)
        run(p,val,size=9,color=DGRAY)
```

Column → dict key mapping:
| Col | Value source |
|-----|-------------|
| 0 (`#`) | `str(i+1)` — sequential row number |
| 1 (Description) | `item.get("description","")` |
| 2 (Size/Type) | `item.get("size","")` |
| 3 (UOM) | `item.get("unit","EA")` |
| 4 (Qty) | `qty_s` (formatted from `item.get("qty")`) |
| 5 (Unit Price) | `up_s` (formatted from `item.get("unit_price")`) |
| 6 (Total) | `total_s` (computed from qty × unit_price) |

**e. No key in the quote input JSON currently controls the column layout.** `line_item_schema` is absent from both `vendor` and `line_items` in the current input. Confirmed absent from `generator.py` — no `schema` or `line_item_schema` read anywhere in the function.

---

### Q8 — Option years, signature block, notes sections

**a. Option years section — `generator.py` lines 234–255:**

```python
option_years = vendor.get("option_years", [])
if vendor.get("option_years_enabled") and option_years and has_any_price:
    base_total = grand + freight + tax
    heading("OPTION YEAR PRICING SUMMARY")
    oy_rows = [("Base Year (Year 1)", base_total)]
    ...
```

Function: within `generate_quote()`. Conditional check: `vendor.get("option_years_enabled") and option_years and has_any_price`. Three conditions must all be truthy.

**b. Signature block — `generator.py` lines 257–274:**

```python
# Signature
heading("AUTHORIZED SIGNATURE", sb=18)
sigt=doc.add_table(rows=1,cols=2); sigt.style="Table Grid"; sigt.autofit=False
...
```

**No conditional check. Renders unconditionally.** The comment at line 257 is just `# Signature` — no `if` guard. The signature block is always included in every generated document regardless of any settings.

**c. Notes / Terms section — `generator.py` lines 222–231:**

```python
notes=vendor.get("notes",""); terms=vendor.get("terms","")
if notes or terms:
    heading("NOTES & TERMS")
    if notes:
        np=doc.add_paragraph(); np.paragraph_format.left_indent=Inches(0.1)
        run(np,"Notes: ",bold=True,size=9.5,color=NAVY); run(np,notes,size=9.5,color=DGRAY)
    if terms:
        tp2=doc.add_paragraph(); tp2.paragraph_format.left_indent=Inches(0.1)
        run(tp2,"Terms: ",bold=True,size=9.5,color=NAVY); run(tp2,terms,size=9.5,color=DGRAY)
```

**Conditional: `if notes or terms:`** — renders only when either field has content. Currently has no user-controllable toggle.

---

### Q9 — Complete default `S` object from `state.js` + S.vendor

**`electron/js/state.js` lines 5–23 — complete default object as of Phase 8 (current):**

```javascript
const S = {
  step: 1, done: new Set(), port: null,
  apiKey: '', validity: '30 days',
  samKey: '', samNoticeId: '',
  file: null, filePath: null,
  extracted: {},
  vendor: {
    company_name:'', address:'', city_state_zip:'', phone:'', email:'',
    website:'', prepared_by:'', title:'', quote_number:'', sam_uei:'',
    validity_period:'30 days', freight:'', tax_rate:'', notes:'',
    terms:'Net 30. FOB Destination. Vendor certifies SAM.gov registration and compliance with all applicable solicitation requirements.',
    logo_b64:'', logo_ext:'', logo_name:'',
    delivery_days:'',
    option_years_enabled: false,
    option_years: []
  },
  aiUsage: { calls: 0, tokens: 0 },
  items: []
}
```

**Keys absent from `S.vendor`:**
- `line_item_schema` — **absent**
- `include_signature` — **absent**
- `include_notes` — **absent**

**`aiUsage` location:** `aiUsage: { calls: 0, tokens: 0 }` is at the **`S` level** (line 21), not inside `S.vendor`. This was added in Phase 8 per the Phase 8 plan.

---

### Q10 — Complete Quote Details card HTML

**`step3.js` lines 584–594 — complete Quote Details card:**

```javascript
<div class="card">
  <div class="card-title"><span class="dot"></span>Quote Details</div>
  <div class="grid">
    <div class="field"><label>Prepared By</label>
      <input data-vendor-field="prepared_by" value="${window.esc(v.prepared_by || '')}" placeholder="John Smith" /></div>
    <div class="field"><label>Title</label>
      <input data-vendor-field="title" value="${window.esc(v.title || '')}" placeholder="Contracts Manager" /></div>
    <div class="field"><label>Quote Number</label>
      <input data-vendor-field="quote_number" value="${window.esc(v.quote_number || '')}" placeholder="Q-2026-0001" /></div>
    <div class="field"><label>Quote Valid For</label>
      <input data-vendor-field="validity_period" value="${window.esc(v.validity_period || '')}" placeholder="30 days" /></div>
    <div class="field"><label>Delivery (days ARO)</label>
      <input type="number" data-vendor-field="delivery_days" value="${window.esc(String(v.delivery_days || ''))}" placeholder="30" min="0" /></div>
  </div>
</div>
```

**`data-vendor-field` pattern:** The attribute is `data-vendor-field="key_name"` where `key_name` matches the `S.vendor` key exactly. The event delegation in `vendorForm` reads it via `e.target.dataset.vendorField` (camelCase, automatic browser conversion).

**How `<select>` elements are handled:** The `vendorForm.addEventListener('change', ...)` delegation at lines 677–683 reads `e.target.dataset.vendorField` and sets `window.S.vendor[field] = e.target.value`. This fires on `<select>` `change` events identically to `<input>` `change` events — no special handling is needed for selects. The existing delegation covers any element with a `data-vendor-field` attribute.

**Exact insertion point for new dropdown:** After line 592 (the `delivery_days` field div closing tag) and before line 593 (the `</div>` that closes the `.grid`). The new `<div class="field">` goes here as the sixth item in the 2-column grid.

---

### Q11 — Collapsible card pattern in `index.html`

**Search results:**

**1. `.theme-legacy-toggle` / `.theme-legacy-chevron` — `index.html` lines 266–269:**
```css
.theme-legacy-toggle{display:flex;align-items:center;justify-content:space-between;
  padding:var(--space-sm) 2px;margin-top:var(--space-md);cursor:pointer;
  font-size:var(--text-sm);font-weight:700;text-transform:uppercase;letter-spacing:.8px;
  color:var(--color-text-muted);border-top:1px solid var(--color-border);
  user-select:none;transition:color .15s}
.theme-legacy-toggle:hover{color:var(--color-text)}
.theme-legacy-chevron{font-size:12px;transition:transform .2s}
.theme-legacy-chevron.open{transform:rotate(90deg)}
```
This is the only chevron animation pattern. Specific to the themes modal. Not a general card pattern.

**2. `.pdf-viewer-panel` — lines 312–315:**
```css
.pdf-viewer-panel{overflow:hidden;transition:height 0.2s ease;...}
.pdf-viewer-panel.collapsed{height:0;border:none}
.pdf-viewer-panel.expanded{height:480px;overflow-y:auto}
```
Height-transition pattern. Specific to the PDF viewer — fixed pixel heights, not content-adaptive.

**3. `.card` and `.card-title` definitions — lines 101–103:**
```css
.card{background:var(--color-panel);border:1px solid var(--color-border);
      border-radius:0;padding:var(--space-xl);margin-bottom:var(--space-lg)}
.card-title{font-size:var(--text-label-size);font-weight:var(--text-label-weight);
            margin-bottom:var(--space-lg);display:flex;align-items:center;
            gap:var(--space-sm);text-transform:uppercase;letter-spacing:1px;
            color:var(--color-primary)}
```
No collapsible behavior defined on `.card`. The `.card` class is purely presentational (background, border, padding, margin).

**No general collapsible card pattern exists.** Confirmed absent.

**Simplest approach given existing CSS:** Use JavaScript `display:none` / `display:block` toggling on a `<div class="card-body">` wrapper inside the card, with a chevron span in the card-title. Add one CSS rule to `index.html`:

```css
.card-body.hidden { display: none !important }
```

The chevron animation can use the `.theme-legacy-chevron` pattern (it's already CSS-defined) or an inline `transform: rotate(90deg)` toggle via JavaScript. No new CSS class is needed for the chevron if using inline styles. The `.card-body.hidden` class is the only addition required.

---

### Q12 — `generator.py` quote input JSON and first key reads

**Function signature — `generator.py` line 8:**

```python
def generate_quote(solicitation, vendor, line_items):
```

`vendor` is a plain Python dict passed directly from the Flask route in `server.py`. It maps directly to `window.S.vendor` sent as JSON in the quote generation request body.

**First 20 lines of key reads from `vendor` (lines 90–131):**

```python
logo_b64 = vendor.get("logo_b64","")         # line 90
vendor.get("company_name","Your Company")     # line 108
vendor.get("address","")                      # line 109 (inside loop)
vendor.get("city_state_zip","")               # line 109
vendor.get("phone","")                        # line 109
vendor.get("email","")                        # line 109
vendor.get("website","")                      # line 109
vendor.get("quote_number","Q-"+...)           # line 125
vendor.get("validity_period","30 days")       # line 125
vendor.get("delivery_days","")                # line 129
vendor.get("prepared_by","")                  # line 131
vendor.get("title","")                        # line 131 (in sigline call)
```

**Pattern:** Exclusively `vendor.get("key", default)`. Every key read has a safe default — no bare `vendor["key"]` dict access anywhere in the function. New keys `line_item_schema`, `include_signature`, and `include_notes` follow this same pattern:

```python
schema         = vendor.get("line_item_schema", "standard")   # default: existing behavior
inc_signature  = vendor.get("include_signature", True)         # default: render it
inc_notes      = vendor.get("include_notes", True)             # default: render it
```

Placing these reads immediately after the `today = ...` line (line 79) and before the header table construction at line 82 gives them module-level scope within the function for use in all downstream sections.

---

## Regression Risk Analysis

### Q13 — Risk assessment for each proposed change

**a. Adding `data-col` attributes to `<th>` elements in `step3.js`**

File affected: `step3.js`  
Worst case: Zero — no existing code reads `data-*` attributes on `<th>` elements. No CSS selector targets `th[data-col]`. The attribute is purely additive.  
Verification: Load Step 3 in the app, confirm table renders normally with all columns visible and no layout change.

---

**b. Adding `line_item_schema` to `S.vendor` in `state.js`**

File affected: `state.js`, and transitively `localStorage` (vendor key serialization)  
Worst case: The `saveVendor()` function now serializes the new key into the `'vendor'` localStorage entry. Any profile loaded from localStorage will gain the key with value `"standard"` on next save. This is safe — the generator falls back to `"standard"` when the key is absent.  
Risk for existing users with saved vendor profiles: On first load, their restored `S.vendor` from localStorage will not have `line_item_schema` (it was saved before Phase 10). `window.S.vendor.line_item_schema` will be `undefined`. The dropdown's `selected` logic must handle `undefined` gracefully: `v.line_item_schema || 'standard'` is the safe read pattern.  
Verification: Open app with an existing saved vendor, confirm Quote Details card renders without error, confirm line_item_schema dropdown shows "Standard" as default.

---

**c. Adding `include_signature` and `include_notes` to `S.vendor` in `state.js`**

Files affected: `state.js`, `step3.js`, `generator.py`  
Worst case: Default values must be `true` (boolean). If any code path sends these to the generator as `undefined` (missing from old vendor localStorage), `vendor.get("include_signature", True)` returns `True` in Python — correct. The defaults preserve existing behavior.  
Verification: Generate a quote using the 70B fixture without touching the Output Settings card. Open the result in Word — signature block and notes/terms section must appear as they do today.

---

**d. Wrapping the signature block in `generator.py` with a conditional**

File affected: `generator.py`  
Worst case: If `include_signature` key is absent from the quote input dict (old API call path, no UI setting yet), `vendor.get("include_signature", True)` returns Python `True` — signature renders. This is identical to current behavior.  
The conditional wraps lines 257–274. The heading and table are both inside the guard. Partial wrap (heading inside, table outside) would be a bug — the full section must be wrapped as a unit.  
Verification: Run `python testdata/run.py` (tests parse, not generation, but confirms no import-time errors). Then generate a docx manually and inspect in Word.

---

**e. Wrapping the notes/T&C section in `generator.py` with a conditional**

File affected: `generator.py`  
Existing check: `if notes or terms:`. New check: `if vendor.get("include_notes", True) and (notes or terms):`.  
Worst case: When `include_notes` is absent → defaults `True` → existing `(notes or terms)` check still applies → behavior identical to current.  
When `include_notes = False` with empty notes/terms → section already wouldn't render → no change.  
When `include_notes = False` with non-empty notes → section correctly suppressed.  
Verification: Same as (d). Additionally test with a vendor that has notes set, confirm notes section appears by default.

---

**f. Adding a new column schema path in `generator.py` table builder**

Files affected: `generator.py`  
Worst case: If the `schema` dispatch logic has a bug in the `"apparel"` or `"services"` path, it could produce a wrong column count. The `doc.add_table(cols=N)` call uses a hardcoded column count. A mismatch between `cols=N` and the length of `cw` or `hdrs` would cause a `python-docx` error at runtime, not a silent wrong output.  
The standard schema path must be the `else` fallback so existing inputs always hit it.  
Verification: Generate quote with each schema (standard, apparel, services), open in Word, confirm column count and labels correct. Run `testdata/run.py` to confirm extraction tests unaffected (they don't test generation).

---

## Plan A — Column Resize

### A1 — Column identification strategy

**Use `data-col` attributes on resizable `<th>` elements.**

Justification:
- The table is rebuilt from scratch on every `render(3)` call (confirmed in Q1). There is no persistent DOM to work with between renders.
- `initResizableColumns()` runs after each `c.innerHTML` assignment, reading the freshly built DOM. The attributes it needs must be present in the template string, not injected dynamically.
- `data-col` on `<th>` elements creates a stable semantic identifier: `th.dataset.col` maps directly to a localStorage key. `saveColWidths()` iterates `document.querySelectorAll('th[data-col]')` and builds `{ description: 300, size: 85, ... }`.
- Alternatives (index-based, CSS class-based) are fragile: index-based breaks if column order changes; CSS class-based conflates presentation with identity.

**Resizable columns and their default widths:**

| `data-col` | Display label | Default width | Notes |
|------------|---------------|---------------|-------|
| `description` | Description | 220px | Largest — most user resize value |
| `size` | Size/Type | 85px | Matches current inline style |
| `uom` | UOM | 60px | Matches current |
| `qty` | Qty | 75px | Matches current |
| `unitprice` | Unit Price | 110px | Matches current |
| `total` | Total | 110px | Matches current |

**Fixed-width columns (no `data-col`, no drag handle):**

| Column | Why fixed |
|--------|-----------|
| expand button (`lt-col-expand`) | Icon-only, 32px — structural, must not be resizable |
| `#` (`lt-col-num`) | Fixed 36px — number column, content never exceeds 3 digits |
| actions (last `<th>`) | 72px — contains Dup/Del buttons, must not compress below usability |

---

### A2 — Drag handle design

**HTML structure:** A `<div>` added via DOM manipulation inside `initResizableColumns()`, not in the template string. The handle is a child of each resizable `<th>`. Example for one column after `initResizableColumns()` runs:

```html
<th data-col="description" style="position:relative; width:220px">
  Description
  <div class="col-resize-handle" style="
    position:absolute; right:-3px; top:0; width:6px; height:100%;
    cursor:col-resize; z-index:1; opacity:0; transition:opacity 0.1s;
    background:var(--color-border);
  "></div>
</th>
```

**CSS requirements (to be added to `index.html`):**

```css
/* Phase 10: column resize handles */
.tbl th { position: relative }
.col-resize-handle { position:absolute; right:-3px; top:0; width:6px; height:100%; cursor:col-resize; z-index:1; opacity:0; transition:opacity .1s; background:var(--color-border) }
.tbl th:hover .col-resize-handle { opacity:1 }
```

Three CSS rules total. The `position:relative` addition to `.tbl th` is safe — it has no visual effect on the current layout, it only establishes a containing block for the absolutely positioned handle child.

**Why DOM manipulation, not template string:** The handle is a cosmetic element with no bearing on the table's data or structure. Putting it in the template string clutters the template with non-data HTML. `initResizableColumns()` is already called after each render — it is the correct place for post-render DOM decoration.

---

### A3 — Event handler logic

**mousedown on handle:**
1. `e.preventDefault()` — prevents text selection during drag
2. Record `startX = e.clientX`
3. Record `startWidth = th.offsetWidth` where `th` is `handle.parentElement`
4. `document.body.style.userSelect = 'none'` — prevents text selection globally during drag
5. Add document-level `mousemove` and `mouseup` listeners (local named functions so they can be removed)

**mousemove on document:**
1. Compute `delta = e.clientX - startX`
2. Compute `newWidth = Math.max(MIN_WIDTH, startWidth + delta)` where `MIN_WIDTH = 48`
3. `th.style.width = newWidth + 'px'`
4. Do not call `saveColWidths()` here — saving on every pixel change is wasteful

**mouseup on document:**
1. `saveColWidths()` — persist final width to localStorage
2. Remove the `mousemove` listener
3. Remove the `mouseup` listener (self-remove)
4. `document.body.style.userSelect = ''` — re-enable text selection

**Why document-level `mousemove`/`mouseup`:** The mouse cursor leaves the `<th>` during a fast drag. If the listeners were on `<th>` only, releasing outside would leave the drag active indefinitely. Document-level listeners capture the mouse regardless of cursor position and release cleanly.

**When to remove:** Immediately in the `mouseup` handler. Use named function references:
```javascript
const onMove = (e) => { /* delta logic */ }
const onUp   = (e) => { saveColWidths(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.userSelect = '' }
document.addEventListener('mousemove', onMove)
document.addEventListener('mouseup', onUp)
```

**Text selection prevention:** `e.preventDefault()` on `mousedown` prevents text selection in most browsers. `document.body.style.userSelect = 'none'` provides belt-and-suspenders coverage for browsers where `preventDefault` on mousedown does not suppress selection (some WebKit behaviors). Both are reversed on `mouseup`.

---

### A4 — localStorage persistence

**Key:** `"sol-quoter:col-widths"`

**Value shape:**
```json
{ "description": 300, "size": 85, "uom": 60, "qty": 75, "unitprice": 110, "total": 110 }
```

Keys match `data-col` attribute values exactly. Values are numbers (pixel widths).

**`saveColWidths()` function:**
```
Collect all <th> elements where dataset.col is defined
For each: add th.dataset.col → th.offsetWidth to a result object
Call localStorage.setItem('sol-quoter:col-widths', JSON.stringify(widths))
Wrap in try/catch to handle private browsing
```

**`loadColWidths()` function:**
```
raw = localStorage.getItem('sol-quoter:col-widths')
If null: return null  (first run — no saved widths)
Return JSON.parse(raw)  (may throw if corrupted)
Wrap in try/catch returning null on parse error
```

**Restore logic inside `initResizableColumns()`:**
1. Add handles to all `th[data-col]` elements
2. Call `loadColWidths()`
3. If result is non-null: for each `[col, width]` in result, find `th[data-col="${col}"]` and set `th.style.width = width + 'px'`
4. If result is null (first run): leave template-defined widths in place — the `style="width:Xpx"` attributes in the template string serve as defaults

**First run behavior:** `loadColWidths()` returns null. The handles are added but no widths are applied. The `<th>` elements render with their template-defined inline styles (`width:85px`, etc.). The user sees the default layout. On first drag-and-release, `saveColWidths()` writes all current widths, and subsequent renders restore from that snapshot.

---

### A5 — Integration with step3() re-render cycle

**Exact call site:**

```javascript
  // Initial totals display
  updTotals()
  // Phase 10: restore/wire column resize handles after table DOM is settled
  initResizableColumns()
}
```

Line position: after `updTotals()` (currently the last statement at line 721), before the closing `}` of `step3()`.

**Why this position is correct:**
- `c.innerHTML =` at line 568 creates the table in the DOM
- All event delegation and button wiring happens at lines 661–721
- `updTotals()` reads rendered DOM cells — the DOM is complete when it runs
- `initResizableColumns()` modifies the DOM (adds handle divs, applies widths) — must run after all structural DOM is settled
- No race condition: `step3()` is synchronous, `c.innerHTML` is synchronous, all DOM writes before `initResizableColumns()` are complete before it begins

**`checkAiStatus()` conflict:** Confirmed absent. `checkAiStatus()` is the last statement of `step2()` (phase 8 addition). It does not appear in `step3.js`. No conflict of any kind.

---

### A6 — Minimum width and UX constraints

**`MIN_WIDTH = 48` px** — hard floor applied in every `mousemove` handler:
```javascript
const newWidth = Math.max(48, startWidth + delta)
```

**No maximum width.** The table uses `width:100%` via `.tbl { width:100% }`, so expanding one column beyond the table's container causes horizontal scroll (the `.tbl` parent has `overflow-x:auto` per the card wrapper at step3.js line 602). This is acceptable behavior for columns that the user explicitly expands.

**Resize handle visibility:** Hidden by default (`opacity:0`), visible only on `<th>` hover (`opacity:1` via `.tbl th:hover .col-resize-handle`). The CSS transition (`transition:opacity .1s`) provides a smooth fade-in that avoids the handle feeling jarring. This matches the design of similar professional table UIs.

---

## Plan B — .docx Fixes

### B1 — # column overflow fix

**Current value:** `Inches(0.35)` = 0.35" = 320,040 EMUs

**Why it overflows at item ≥ 100:**

The `#` column content is `str(i+1)` (row number starting at 1). For the 70B fixture with 118 line items, item numbers reach `"118"` — 3 characters. At 9pt Calibri with `WD_ALIGN_PARAGRAPH.CENTER` alignment and `left_indent=Pt(3)` (= 0.042"), the rendered 3-digit string needs approximately 0.22" of text space plus padding on both sides. At 0.35" total width with cell margins and word processor padding, 3-digit numbers are tight and can overflow to a second line in some Word rendering engines depending on DPI scaling.

**Corrected value:** `Inches(0.5)` = 0.5" = 457,200 EMUs

**Calculation:** "999" at 9pt Calibri ≈ 0.19" wide. Center alignment adds equal padding on both sides. With `left_indent=Pt(3)` and typical cell margins (~0.04" each side), the minimum safe width is approximately 0.19 + 0.04 + 0.04 + 0.08 (margin buffer) = 0.35". However, Word's automatic text layout can cause 3-digit numbers to wrap if the rendering DPI differs from design DPI. 0.5" provides a 43% safety margin over the minimum, ensuring single-line rendering at all DPI settings and font substitutions.

**Column width sum — confirms no overflow after fix:**

| Column | Current | After fix |
|--------|---------|-----------|
| `#` | 0.35" | **0.50"** |
| Description | 2.10" | **1.95"** |
| Size/Type | 0.55" | 0.55" |
| UOM | 0.60" | 0.60" |
| Qty | 0.55" | 0.55" |
| Unit Price | 0.85" | 0.85" |
| Total | 1.00" | 1.00" |
| **Sum** | **6.00"** | **6.00"** |

Usable page width: 8.5" - 1.25" (left) - 1.25" (right) = **6.00"** exactly.

The 0.15" increase in the `#` column is taken from Description (2.10" → 1.95"). Description at 1.95" is still the widest column and comfortably accommodates long item names. The sum remains exactly 6.00" — no horizontal overflow.

---

### B2 — `line_item_schema` — three column layouts

**Standard schema (current behavior — must be preserved exactly):**

| # | Description / Item | Size/Type | UOM | Qty | Unit Price | Total |
|---|---|---|---|---|---|---|

```python
cw   = [Inches(0.50), Inches(1.95), Inches(0.55), Inches(0.60), Inches(0.55), Inches(0.85), Inches(1.00)]
hdrs = ["#", "Description / Item", "Size/Type", "UOM", "Qty", "Unit Price", "Total"]
# 7 columns — same structure as today, # column widened per B1
```
Data mapping: same as today (`str(i+1)`, `desc`, `size`, `unit`, `qty_s`, `up_s`, `total_s`).

---

**Apparel schema:**

| # | Description / Item | Color | Size | UOM | Qty | Unit Price | Total |
|---|---|---|---|---|---|---|---|

```python
cw   = [Inches(0.50), Inches(1.50), Inches(0.65), Inches(0.65), Inches(0.50), Inches(0.50), Inches(0.85), Inches(0.85)]
hdrs = ["#", "Description / Item", "Color", "Size", "UOM", "Qty", "Unit Price", "Total"]
# 8 columns
```

Sum check: 0.50 + 1.50 + 0.65 + 0.65 + 0.50 + 0.50 + 0.85 + 0.85 = **6.00"** ✓

Data mapping:
- `Color` → `item.get("color", "") or "N/A"` — new field; existing items default to N/A
- `Size` → `item.get("size", "") or "N/A"` — reuses existing `size` dict key
- `UOM` → `item.get("unit", "EA")` — same
- Column alignment: `[CENTER, LEFT, CENTER, CENTER, CENTER, CENTER, RIGHT, RIGHT]`

**Services schema:**

| # | Description / Item | Period | UOM | Qty | Unit Price | Total |
|---|---|---|---|---|---|---|

```python
cw   = [Inches(0.50), Inches(1.95), Inches(0.75), Inches(0.60), Inches(0.55), Inches(0.85), Inches(0.80)]
hdrs = ["#", "Description / Item", "Period", "UOM", "Qty", "Unit Price", "Total"]
# 7 columns — same count as standard, replaces Size/Type with Period
```

Sum check: 0.50 + 1.95 + 0.75 + 0.60 + 0.55 + 0.85 + 0.80 = **6.00"** ✓

Data mapping:
- `Period` → `item.get("size", "") or ""` — reuses the `size` field for period text (e.g., "Base Year", "FY2027"). For services solicitations, the `size` field naturally holds period info when imported from CSV. No new item dict key required.
- Column alignment: `[CENTER, LEFT, CENTER, CENTER, CENTER, RIGHT, RIGHT]`

**How `generator.py` reads `line_item_schema`:**

Add immediately after `today = datetime.date.today()...` (line 79):
```python
schema = vendor.get("line_item_schema", "standard")
```

Then in the line items section, replace the hardcoded `cw` and `hdrs` assignments (lines 177–178) with a schema dispatch:

```python
if schema == "apparel":
    cw   = [Inches(0.50), Inches(1.50), Inches(0.65), Inches(0.65), Inches(0.50), Inches(0.50), Inches(0.85), Inches(0.85)]
    hdrs = ["#","Description / Item","Color","Size","UOM","Qty","Unit Price","Total"]
elif schema == "services":
    cw   = [Inches(0.50), Inches(1.95), Inches(0.75), Inches(0.60), Inches(0.55), Inches(0.85), Inches(0.80)]
    hdrs = ["#","Description / Item","Period","UOM","Qty","Unit Price","Total"]
else:  # "standard" — default, preserves existing behavior
    cw   = [Inches(0.50), Inches(1.95), Inches(0.55), Inches(0.60), Inches(0.55), Inches(0.85), Inches(1.00)]
    hdrs = ["#","Description / Item","Size/Type","UOM","Qty","Unit Price","Total"]
```

The `add_table(cols=len(hdrs))` call becomes dynamic. The data row construction loop uses a schema-dispatched `vals` list. The `AL` alignment list must also be dispatched (apparel has 8 columns, others have 7).

**Default when `line_item_schema` absent:** `vendor.get("line_item_schema", "standard")` returns `"standard"` → existing column layout, existing column widths (with the # column fix applied). Existing fixtures, existing run.py behavior, existing generated quotes — all unchanged.

---

### B3 — Dropdown placement in `step3.js`

**Exact insertion point** in the Quote Details card grid, after the `delivery_days` field div:

```html
<!-- existing last field in grid: -->
<div class="field"><label>Delivery (days ARO)</label>
  <input type="number" data-vendor-field="delivery_days" ... /></div>

<!-- INSERT HERE — new dropdown: -->
<div class="field s2"><label>Line Item Format</label>
  <select data-vendor-field="line_item_schema">
    <option value="standard" ${(v.line_item_schema || 'standard') === 'standard' ? 'selected' : ''}>Standard (Description, Size/Type, UOM, Qty, Price)</option>
    <option value="apparel" ${v.line_item_schema === 'apparel' ? 'selected' : ''}>Apparel (Description, Color, Size, UOM, Qty, Price)</option>
    <option value="services" ${v.line_item_schema === 'services' ? 'selected' : ''}>Services (Description, Period, UOM, Qty, Price)</option>
  </select>
</div>

<!-- closing the grid div: -->
</div>
```

`class="field s2"` makes it span both grid columns — appropriate for a select with long labels. The `s2` class is already defined in `index.html` (`.field.s2 { grid-column: span 2 }`).

**`data-vendor-field` value:** `"line_item_schema"` — matches the `S.vendor` key exactly.

**Change event delegation coverage:** The `vendorForm.addEventListener('change', ...)` handler at step3.js lines 677–683 reads `e.target.dataset.vendorField` on any element. `<select>` elements fire `change` events on selection change. `e.target.value` returns the selected `<option>`'s `value` attribute. The delegation already works for selects — no additional code is needed.

The `option_years_enabled` checkbox at step3.js line 686 is wired separately (not via the delegation) because it also calls `window.render(3)`. The `line_item_schema` select does **not** need to re-render the table on change (the schema only affects the generated .docx, not the step 3 UI). The existing `change` delegation handles it without triggering a re-render.

**Fallback for missing `v.line_item_schema`:** `(v.line_item_schema || 'standard') === 'standard'` evaluates to `true` when `line_item_schema` is undefined or empty — the Standard option shows as selected on first load.

---

### B4 — Output Settings card

**Placement:** A new card inserted after the Option Years card (currently lines 645–653 in step3.js) and before the `</div>` that closes `#vendor-form`.

**Card HTML:**

```html
<div class="card">
  <div class="card-title"><span class="dot"></span>Output Settings</div>
  <div style="display:flex;flex-direction:column;gap:10px">
    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;
                  color:var(--color-text);font-weight:400;text-transform:none">
      <input type="checkbox" id="inc-sig" ${v.include_signature !== false ? 'checked' : ''}
             style="width:auto;margin:0" />
      Include signature block in quote
    </label>
    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;
                  color:var(--color-text);font-weight:400;text-transform:none">
      <input type="checkbox" id="inc-notes" ${v.include_notes !== false ? 'checked' : ''}
             style="width:auto;margin:0" />
      Include notes &amp; terms section in quote
    </label>
  </div>
</div>
```

**Default logic for the checked state:**
- `v.include_signature !== false` — evaluates `true` when key is `undefined`, `null`, or `true`; false only when explicitly `false`. This preserves checked state for all existing vendor profiles that lack the key.
- Same pattern for `include_notes`.

**Wire in step3() after `c.innerHTML`:**
```javascript
document.getElementById('inc-sig')?.addEventListener('change', e => {
  window.S.vendor.include_signature = e.target.checked
})
document.getElementById('inc-notes')?.addEventListener('change', e => {
  window.S.vendor.include_notes = e.target.checked
})
```

No re-render needed on these checkbox changes — the setting only affects `.docx` generation, not the step 3 UI. This is consistent with how `freight` and `tax_rate` update `S.vendor` directly without re-rendering the table.

**Option Years checkbox placement:** The `option_years_enabled` checkbox remains in the Option Years card as a sub-control of that card's expand/collapse behavior. Moving it to Output Settings would disconnect it visually from the option years list it controls. The roadmap specification is "leave it in place." Confirmed: do not move it.

---

### B5 — `generator.py` conditional rendering

**`include_signature` — wrap lines 257–274:**

```python
# Signature
if vendor.get("include_signature", True):
    heading("AUTHORIZED SIGNATURE", sb=18)
    sigt=doc.add_table(rows=1,cols=2); sigt.style="Table Grid"; sigt.autofit=False
    sigt.columns[0].width=Inches(3.0); sigt.columns[1].width=Inches(3.0)
    sigt.alignment = WD_TABLE_ALIGNMENT.CENTER
    row_keep(sigt.rows[0])
    lsc=sigt.cell(0,0); rsc=sigt.cell(0,1)
    def sigline(cell,label,value=""):
        ...
    sigline(lsc,"Authorized Signature"); sigline(lsc,"Printed Name",vendor.get("prepared_by",""))
    sigline(lsc,"Title",vendor.get("title","")); sigline(lsc,"Date",today)
    sigline(rsc,"Company",vendor.get("company_name","")); sigline(rsc,"Phone",vendor.get("phone",""))
    sigline(rsc,"Email",vendor.get("email","")); sigline(rsc,"SAM UEI",vendor.get("sam_uei",""))
doc.add_paragraph()
fp=doc.add_paragraph(); fp.alignment=WD_ALIGN_PARAGRAPH.CENTER
run(fp,f"Quote valid for {vendor.get('validity_period','30 days')} from {today}.",
    size=8,color=RGBColor(0x99,0x99,0x99),italic=True)
```

**Important:** The `doc.add_paragraph()` (blank line spacer) and the validity footer paragraph at lines 271–274 must remain **outside** the `if` block. These trailing elements are part of the document layout regardless of whether the signature block renders. Wrapping only lines 258–270 inside the `if` guard preserves the trailing blank line and footer.

**`include_notes` — modify the existing conditional at lines 222–231:**

Current: `if notes or terms:`  
New: `if vendor.get("include_notes", True) and (notes or terms):`

This is a single-line change. The inner structure (notes sub-block, terms sub-block) is unchanged.

**Default behavior when keys absent:**
- `vendor.get("include_signature", True)` → Python `True` when key missing → signature renders → identical to current behavior
- `vendor.get("include_notes", True)` → Python `True` when key missing → existing `(notes or terms)` check applies → identical to current behavior

No generated document from before Phase 10 will have a different output when regenerated unless the user explicitly unchecks one of the new toggles.

---

### B6 — Regression risk sign-off

Restating findings from Q13 with specific validation steps:

| Risk | Specific validation step |
|------|--------------------------|
| **a. `data-col` on `<th>`** — zero risk | Open Step 3, confirm table renders. DevTools: inspect `<th>` elements have `data-col`. No layout change. |
| **b. `line_item_schema` in state.js** — minimal | Open app with no prior localStorage. Confirm dropdown shows "Standard". Save vendor, reopen app, confirm "Standard" persists. |
| **c. `include_signature`/`include_notes` in state.js** — minimal | Open app. Confirm both Output Settings checkboxes are checked by default. Generate a quote — signature and notes/terms must appear. |
| **d. Signature block conditional in generator.py** — low | Generate a quote with no Output Settings change → signature in output. Uncheck signature → regenerate → signature absent. Check `testdata/run.py` → 6/6 pass (parse tests unaffected). |
| **e. Notes conditional in generator.py** — low | Generate a quote with notes text set and `include_notes = true` → notes in output. Uncheck → regenerate → notes absent. Standard notes/terms text: `"Net 30. FOB Destination..."` in `S.vendor.terms` — confirm it renders. |
| **f. Column schema path in generator.py** — low | Generate standard schema → confirm 7-column table, `#` column at 0.5", item #118 renders on one line. Generate apparel → confirm 8-column table with Color + Size headers. Generate services → confirm Period column present. |
| **`#` column width change** — zero risk | Item numbers 1–9 render the same (they always fit). Item 100–118 in 70B fixture: generate docx and confirm `"118"` is on one line in Word. |

---

## Summary of File Changes

### Part A — Column Resize

| File | Change type | Details |
|------|-------------|---------|
| `electron/js/modules/step3.js` | Additive | Add `data-col` to 6 `<th>` elements in template; add `initResizableColumns()` call after `updTotals()`; add `initResizableColumns()`, `saveColWidths()`, `loadColWidths()` function definitions |
| `electron/index.html` | Additive | 3 CSS rules: `position:relative` on `.tbl th`, `.col-resize-handle` definition, `.tbl th:hover .col-resize-handle` opacity rule |
| `electron/js/state.js` | None | No changes needed — column widths live in localStorage, not in `window.S` |

### Part B — .docx Fixes

| File | Change type | Details |
|------|-------------|---------|
| `python/generator.py` | Modification | `#` column: `Inches(0.35)` → `Inches(0.5)`, Description: `Inches(2.1)` → `Inches(1.95)`; add `schema` dispatch for `cw`/`hdrs`/`AL`; wrap signature block in `if vendor.get("include_signature", True):`; change notes condition to include `vendor.get("include_notes", True)` |
| `electron/js/modules/step3.js` | Additive | Add `line_item_schema` dropdown to Quote Details card; add Output Settings card with signature/notes checkboxes; wire 2 new checkbox `change` listeners |
| `electron/js/state.js` | Additive | Add `line_item_schema: 'standard'`, `include_signature: true`, `include_notes: true` to `S.vendor` default object |

---

*End of Phase 10 diagnostic report and implementation plan.*  
*Generated: 2026-05-05. No code was modified during this analysis.*
