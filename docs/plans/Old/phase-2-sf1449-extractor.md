# Phase 2: SF-1449 Extractor — Implementation Plan

## Status

**Current state:** `extract_sf1449(text)` exists in `extractor.py` (lines 410–563), implemented as part of Phase 1.
Running the current implementation against `70B06C26Q00000080.pdf` shows:

- 13 / 15 extractable fields correct
- 1 field wrong (scope_of_work — wrong source)
- 1 field verbose but correct (period_of_performance — full paragraph vs expected summary)
- 3 fields correctly absent (null in expected output: contact_phone, psc_code, place_of_performance)

**Verdict:** One targeted fix needed. All patterns are correct except scope source priority.

---

## Document Structure — SF-1449

The SF-1449 form (`70B06C26Q00000080.pdf`) has this layout:

```
Page 1: SF-1449 Form Header
  ├── Block 5/6: Solicitation number + issue date (same header row)
  ├── Block 7: Contact name + email (INFORMATION CALL: row)
  ├── Block 8: Offer due date (same row as Block 7)
  ├── Block 9: Issuing office (multi-line org name block)
  ├── Block 10: Set-aside percentage + NAICS (crowded checkbox grid)
  ├── Block 14: Method of solicitation checkbox (RFQ/IFB/RFP)
  └── Item 10: Schedule row (project title)

Page 2: Additional Information
  └── ADDITIONAL INFORMATION: block — requirement description prose (actual scope)

Pages 3–4: Table of Contents
  └── TOC references SECTION I / II / III (not the actual body)

Page 4–5: Section I — Schedules
  ├── I.1 DESCRIPTION — FAR acquisition method boilerplate (NOT scope)
  ├── I.2 MINIMUM GUARANTEE — dollar amount
  ├── I.3 MAXIMUM AMOUNT — ceiling dollar amount (estimated_value)
  ├── I.4 SCHEDULE OF SUPPLIES/SERVICES — reference to Attachment 2
  ├── I.5 PERIOD OF PERFORMANCE — full paragraph description
  └── I.6–I.9 — obligation/ordering/rating clauses

Pages 5+: Section II — Contract Clauses
  └── FAR clause references
```

---

## Field-by-Field Mapping

### Expected output (from `70B06C26Q00000080_expected_output.json`)

| Expected key        | Extractor key           | Source location                        | Status    |
|---------------------|-------------------------|----------------------------------------|-----------|
| solicitation_number | solicitation_number     | Block 5 row                            | ✓ correct |
| title               | project_title           | Item 10 schedule row                   | ✓ correct |
| type                | solicitation_type       | ADDITIONAL INFORMATION prose           | ✓ correct |
| agency              | issuing_agency          | Block 9 (two-line)                     | ✓ correct |
| due_date            | due_date                | Block 8 (same row as contact)          | ✓ correct |
| posting_date        | posting_date            | Block 6 (same row as sol number)       | ✓ correct |
| contact_name        | contact_name            | Block 7a (INFORMATION CALL:)           | ✓ correct |
| contact_email       | contact_email           | Block 7b (INFORMATION CALL:)           | ✓ correct |
| contact_phone       | contact_phone           | Not on form                            | ✓ null    |
| naics_code          | naics_code              | Block 10 (after NAICS: label)          | ✓ correct |
| psc_code            | psc_code                | Not on form                            | ✓ null    |
| set_aside           | set_aside               | Block 10 (SET ASIDE : X % FOR:)       | ✓ correct |
| place_of_performance| place_of_performance    | Not on form                            | ✓ null    |
| period_of_performance| period_of_performance  | I.5 paragraph                          | ~ verbose |
| estimated_value     | estimated_value         | I.3 (not exceed $...)                  | ✓ correct |
| contract_type       | contract_type           | I.1 + I.7 (IDIQ + FFP flags)          | ✓ correct |
| minimum_guarantee   | minimum_guarantee       | I.2 ($X.XX)                            | ✓ correct |
| scope_of_work       | scope_of_work           | ADDITIONAL INFORMATION (page 2)        | ✗ **BUG** |

*Note: expected JSON uses short key names (title, agency, type); extractor uses project_title, issuing_agency, solicitation_type. The validator/generator are the authoritative key consumers — confirm no rename needed.*

---

## Patterns — Verified Against Actual OCR Text

### Block 5 — Solicitation Number

**Sample OCR text:**
```
2. CONTRACT NUMBER 3. AWARD/EFFECTIVE DATE 4.ORDER NUMBER 5.SOLICITATION NUMBER 6.SOLICITATION
ISSUE DATE
70B06C26Q00000080 04/15/2026
```

**Pattern:**
```python
r"5\.SOLICITATION\s+NUMBER\s+6\.SOLICITATION\s*\n\s*ISSUE\s+DATE\s*\n\s*([A-Z0-9]{10,})\s"
```
Fallback: `r"(?:SOLICITATION\s+NUMBER)\s*\n?\s*([A-Z0-9]{10,})\b"` then `r"\b(70B\w+)\b"`

### Block 6 — Posting Date (Issue Date)

**Sample OCR text:** (same row as solicitation number value)
```
70B06C26Q00000080 04/15/2026
```

**Pattern:**
```python
r"ISSUE\s+DATE\s*\n\s*\S+\s+(\d{2}/\d{2}/\d{4})"
```
Logic: `\S+` captures the solicitation number token; the date follows it on the same line.

### Block 7 — Contact Name + Email

**Sample OCR text:**
```
7.FOR SOLICITATION a.NAME b. Email 8. OFFER DUE DATE/
INFORMATION CALL: Crockett, John john.t.crockett@cbp.dhs.gov 05/15/2026 2:00PM ET
```

**Pattern (single regex, both groups):**
```python
contact_m = re.search(
    r"INFORMATION\s+CALL:\s*(.*?)\s+([\w.%+\-]+@[\w.\-]+\.\w{2,})",
    text, re.IGNORECASE
)
# group(1) = "Crockett, John"
# group(2) = "john.t.crockett@cbp.dhs.gov"
```
The lazy `.*?` with trailing `\s+email` anchor captures only the name, not trailing tokens.

Email fallback (if contact block missing): `r"([\w.%+\-]+@[\w.\-]+\.(?:gov|mil|us|com))\b"`

### Block 8 — Due Date

**Sample OCR text:** (continuation of Block 7 row)
```
INFORMATION CALL: Crockett, John john.t.crockett@cbp.dhs.gov 05/15/2026 2:00PM ET
```

**Pattern:**
```python
r"(\d{2}/\d{2}/\d{4}\s+\d{1,2}:\d{2}[AP]M\s+\w+)"
```
Captures `05/15/2026 2:00PM ET` — the first datetime+timezone token in the document.

### Block 9 — Issuing Agency

**Sample OCR text:**
```
9. ISSUED BY CODE 7014 10.THIS ACQUISITION IS UNRESTRICTED OR SET ASIDE : 100 % FOR:
DHS - Customs & Border Protection SMALL BUSINESS WOMEN-OWNED SMALL BUSINESS (WOSB)
...
Mission Support Contracting Division NAICS:
```

**Patterns (two-step):**
```python
# Line 1: org name — appears before checkbox labels
agency_m = re.search(
    r"\n([A-Z][A-Z\s\-&]+(?:Protection|Agency|Command|Service|Office|Bureau))\s+"
    r"(?:SMALL|WOMEN|HUBZONE|ELIGIBLE|UNRESTRICTED)",
    text, re.IGNORECASE
)
# line1 = "DHS - Customs & Border Protection"

# Line 2: division — appears before "NAICS"
div_m = re.search(
    r"([A-Z][a-z].+?(?:Division|Office|Command|Department|Directorate))\s+(?:NAICS|CODE)",
    text, re.IGNORECASE
)
# div = "Mission Support Contracting Division"

issuing_agency = line1 + ", " + div
# => "DHS - Customs & Border Protection, Mission Support Contracting Division"
```

### Block 10 — Set-Aside

**Sample OCR text:** `SET ASIDE : 100 % FOR:`

**Pattern:**
```python
sa_m = re.search(r"SET\s+ASIDE\s*:\s*(\d+)\s*%\s*FOR", text, re.IGNORECASE)
set_aside = f"Small Business Set-Aside {sa_m.group(1)}%"
# => "Small Business Set-Aside 100%"
```

### Block 10 — NAICS Code

**Sample OCR text:**
```
Mission Support Contracting Division NAICS:
HUBZONE SMALL ECONOMICALLY DISADVANTAGED WOMEN-
1300 Pennsylvania Ave, NW BUSINESS OWNED SMALL BUSINESS (EDWOSB) 332994
```

**Pattern (DOTALL, lazy match through checkbox noise):**
```python
r"NAICS:\s*\n.*?(\d{6})"  # flags: re.DOTALL
```
The `.*?` lazy-matches across the checkbox label lines until the first 6-digit token.

### Block 14 — Solicitation Type

**Sample OCR text (ADDITIONAL INFORMATION):**
```
request for proposal (RFP) 70B06C26Q00000080 for Distraction Devices...
```

**Pattern:**
```python
r"request\s+for\s+proposal\s+\(([A-Z]+)\)"
# => "RFP"
```
Fallback chain: RFQ → IFB patterns. Prose match preferred over the checkbox grid.

### Item 10 — Project Title

**Sample OCR text:**
```
19.         20.                                          21.    22.  23.        24.
ITEM NUMBER SCHEDULE OF SUPPLIES/SERVICES QUANTITY UNIT UNIT PRICE AMOUNT
10 Less Lethal Specialty Munitions (LLSM) IDIQ
```

**Pattern:**
```python
r"SCHEDULE\s+OF\s+SUPPLIES/SERVICES\s+QUANTITY[^\n]*\n\s*\d+\s+(.+?)(?:\n|$)"
# => "Less Lethal Specialty Munitions (LLSM) IDIQ"
```

### Section I.2 — Minimum Guarantee

**Sample OCR text:**
```
I.2 MINIMUM GUARANTEE: The minimum guarantee of the contract is $10,000.00
```

**Pattern (applied to `sec_i` slice only):**
```python
r"MINIMUM\s+GUARANTEE[^$]*\$([\d,]+\.?\d*)"
# => stored as "$10,000.00"
```

### Section I.3 — Estimated Value

**Sample OCR text:**
```
I.3 MAXIMUM AMOUNT: The maximum amount of supplies that may be ordered over the life
of the contracts will not exceed a total of $49,900,000.00.
```

**Pattern (DOTALL, applied to `sec_i`):**
```python
r"(?:not\s+exceed[^$]*|MAXIMUM\s+AMOUNT[^\n]*\n.*?not\s+exceed[^$]*)\$([\d,]+\.?\d*)"
# flags: re.IGNORECASE | re.DOTALL
# => stored as "$49,900,000.00"
```

### Section I.5 — Period of Performance

**Sample OCR text:**
```
I.5 PERIOD OF PERFORMANCE: The ordering period of the contract is the date of award
through 60 months from date of award (5 year ordering period). Delivery Orders (DOs) may
require delivery up to 12 months beyond the last day of the contract's ordering period.
A DO may be placed against the anticipated contract on or before the last day of the
contract's ordering period.
```

**Pattern:**
```python
pop_m = re.search(
    r"I\.5\s+PERIOD\s+OF\s+PERFORMANCE[:\s]+(.+?)(?=I\.6)",
    sec_i, re.DOTALL | re.IGNORECASE
)
d["period_of_performance"] = re.sub(r"\s+", " ", pop_m.group(1)).strip()[:500]
```

**Note on expected output:** The expected JSON shows a condensed human-written summary ("5 year ordering period from date of award, delivery orders may require delivery up to 12 months beyond last day of ordering period"). The extractor produces the full paragraph, which is correct behavior — the expected JSON is not a verbatim extraction target here.

### Contract Type — Composite

**Detection (two boolean flags, whole-document search):**
```python
has_idiq = bool(re.search(r"\b(?:IDIQ|ID/IQ|indefinite\s+delivery)", text, re.IGNORECASE))
has_ffp  = bool(re.search(r"\bfirm\s+fixed\s+price\b", text, re.IGNORECASE))

if has_idiq and has_ffp:
    d["contract_type"] = "IDIQ with Firm Fixed Price delivery orders"
elif has_idiq:
    d["contract_type"] = "IDIQ"
```

Source signals: `indefinite delivery/indefinite quantity (ID/IQ)` in I.1; `firm fixed price (FFP) basis` in I.7.

---

## The One Fix Required

### Bug: `scope_of_work` wrong source (priority inversion)

**Current behavior:** The function searches `sec_i` (Section I body) for `I\.1\s+DESCRIPTION` first. This always succeeds for SF-1449 because Section I begins with "I.1 DESCRIPTION: This acquisition is conducted using...". That text is FAR-mandated boilerplate about acquisition method, not the actual requirement.

**Correct source:** The `ADDITIONAL INFORMATION` block on page 2 contains the actual requirement description. For this document that is: *"Distraction Devices, Specialty Impact and Area Saturation Munitions, hand delivered and launched in 40mm launchers, for training and operational use."*

**Fix — swap the search priority:**

```python
# CORRECT ORDER: ADDITIONAL INFORMATION first, I.1 as fallback
scope_m = re.search(
    r"ADDITIONAL\s+INFORMATION[:\s]*\n(.+?)(?=\n32[a-z]\.|Page\s+\d+|\Z)",
    text, re.DOTALL | re.IGNORECASE
)
if not scope_m:
    scope_m = re.search(
        r"I\.1\s+DESCRIPTION[:\s]+(.+?)(?=I\.2|MINIMUM\s+GUARANTEE|\Z)",
        sec_i, re.DOTALL | re.IGNORECASE
    )
raw_scope = scope_m.group(1) if scope_m else (sec_i[:SCOPE_MAX * 2] if sec_i else text[:SCOPE_MAX * 2])
d.update(_scope_block(raw_scope))
```

**Stop marker fix:** The original stop pattern `\n3[12]\.` matches "31." or "32." but the form block labels are "32a.", "32b.", etc. Updated to `\n32[a-z]\.` to correctly stop before the SF-1449 signature blocks.

---

## Implementation Checklist

- [ ] In `extract_sf1449()` (~line 549): swap scope search priority — ADDITIONAL INFORMATION before I.1 DESCRIPTION
- [ ] Fix stop marker for ADDITIONAL INFORMATION block: `\n32[a-z]\.` instead of `\n3[12]\.`
- [ ] Run extraction against `70B06C26Q00000080.pdf` and verify `scope_of_work` matches ADDITIONAL INFORMATION content
- [ ] Run full regression suite (`testdata/run.py`) — zero regressions on sam_export, agency_form, formal_rfq formats

## Acceptance Criteria

Run `python testdata/run.py` after the fix. The `70B06C26Q00000080` extraction must satisfy:

| Field | Expected |
|---|---|
| solicitation_number | `70B06C26Q00000080` |
| project_title | `Less Lethal Specialty Munitions (LLSM) IDIQ` |
| solicitation_type | `RFP` |
| issuing_agency | `DHS - Customs & Border Protection, Mission Support Contracting Division` |
| due_date | `05/15/2026 2:00PM ET` |
| posting_date | `04/15/2026` |
| contact_name | `Crockett, John` |
| contact_email | `john.t.crockett@cbp.dhs.gov` |
| naics_code | `332994` |
| set_aside | `Small Business Set-Aside 100%` |
| minimum_guarantee | `$10,000.00` |
| estimated_value | `$49,900,000.00` |
| contract_type | `IDIQ with Firm Fixed Price delivery orders` |
| scope_of_work | starts with `"The Law Enforcement Safety and Compliance Directorate"` (ADDITIONAL INFORMATION source) |
| period_of_performance | contains `"5 year ordering period"` |
