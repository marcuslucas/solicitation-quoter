# Solicitation Field Mapping

This document defines the target fields, known solicitation formats, and extraction patterns for each.
Read this before modifying `python/extractor.py`.

## Target Fields

Every solicitation, regardless of format, should extract to this schema:

| Field | Key | Format | Example | Required |
|-------|-----|--------|---------|----------|
| Solicitation Number | solicitation_number | Alphanumeric, often prefixed | 36C24225Q0696, W911S225U1431 | Yes |
| Project Title | title | Free text | Law Enforcement ballistic vests | Yes |
| Type | type | Enum-like | RFQ, Combined Synopsis | No |
| Issuing Agency | agency | Free text | Department of Veterans Affairs | Yes |
| Response Due Date | due_date | Date + time + timezone | 07-18-2025 12:00 EST | Yes |
| Posting Date | posting_date | Date | 2025/08/06 | No |
| Contact Name | contact_name | Person name | Nathan Northrup | No |
| Contact Email | contact_email | Email address | nathan.northrup@va.gov | No |
| Contact Phone | contact_phone | Phone number | 2534776356 | No |
| NAICS Code | naics_code | 5-6 digits | 811310 | Yes |
| PSC Code | psc_code | Alphanumeric, 4 chars | J061, 8470 | No |
| Set-Aside | set_aside | Free text | Total Small Business Set-Aside | No |
| Place of Performance | place_of_performance | Address/location | Buffalo VA Medical Center | No |
| Period of Performance | period_of_performance | Date range or duration | Base year + 2 option years | No |
| Estimated Value | estimated_value | Dollar amount | $12.5 Million | No |
| Scope of Work | scope_of_work | Long text (may be multi-page) | (full SOW text) | No |

## Known Formats

### Format 1: SAM-Export Structured (WORKING)

**Fingerprint**: Page 1 contains "Notice ID:" near top of text.
**Examples**: W911S225U1431, N5005426Q0114
**Structure**: Clean labeled pages with key-value pairs.

```
Page 1: "Combined Synopsis/Solicitation Details"
  Notice ID: {solicitation_number}
  Subject: {title}
  Description: {scope_of_work}

Page 2: "Contact Information"
  Primary Contact Name: {contact_name}
  Primary Contact Email: {contact_email}
  Primary Contact Phone Number: {contact_phone}

Page 3: "Notice Details"
  Solicitation Type: {type}
  Response Date: {due_date}
  Set Aside Code {set_aside}
  Posting Date {posting_date}
  Product or Service Code {psc_code}: description
  NAICS {naics_code}: description
  Place of Performance Address ...
```

**Extraction approach**: Direct regex on labeled fields. High reliability.

### Format 2: Agency Combined Synopsis Form (BROKEN — needs fix)

**Fingerprint**: Page 1 contains "SOLICITATION NUMBER*" (with asterisk) or field labels in ALL CAPS with asterisks.
**Examples**: 36C24225Q0696 (VA)
**Structure**: Structured form header on page 1, flowing solicitation prose on pages 3+.

```
Page 1: Form fields (ALL CAPS labels with *)
  SUBJECT* {title}
  SOLICITATION NUMBER* {solicitation_number}
  RESPONSE DATE/TIME/ZONE {due_date}
  SET-ASIDE {set_aside}
  PRODUCT SERVICE CODE* {psc_code}
  NAICS CODE* {naics_code}
  CONTRACTING OFFICE ADDRESS {agency - derive from this}
  POINT OF CONTACT* {contact_name} (name on next line)
    {contact_email}
  PLACE OF PERFORMANCE ADDRESS {place_of_performance}
  AGENCY CONTACT'S EMAIL ADDRESS {contact_email}

Pages 3+: Flowing prose with embedded data
  "NAICS code for this procurement is {naics_code}"
  "FSC/PSC is {psc_code}"
  "firm fixed-price service contract for {scope_of_work}"
```

**Current failures** (from 36C24225Q0696):
- Solicitation number → parsed as "tice" (grabbed fragment from wrong location)
- Title → "Not found" (parser doesn't recognize SUBJECT* label)
- Agency → grabbed "CONTACT'S EMAIL ADDRESS nathan.northrup@va.gov" (wrong field)
- NAICS → "Not found" despite being on page 1 as "NAICS CODE* 811310"
- PSC → "Not found" despite "PRODUCT SERVICE CODE* J061"
- Contact name → "Not found" despite "POINT OF CONTACT*" section

**Fix approach**: Add format detection for ALL-CAPS-with-asterisk form style. Extract from page 1 structured header first, then scan prose as fallback.

### Format 3: Formal RFQ Document (NOT TESTED)

**Fingerprint**: Contains "SECTION A", "SECTION B", etc. OR cover page with labeled fields (Issuing Office:, Solicitation Number:, Title:).
**Examples**: 69056725Q000044 (FHWA)
**Structure**: Cover page with key metadata, then lettered sections with SOW in Section C.

```
Page 1: Cover page
  Issuing Office: {agency}
  Agency Contact: {contact_name}, {contact_phone}, {contact_email}
  Solicitation Number: {solicitation_number}
  Title: {title}
  Solicitation Release Date: {posting_date}
  Quotation Due Date: {due_date}

Section A: RFQ Information
  "NAICS code is {naics_code} with an industry size standard of..."
  "Product Service Code (PSC) is {psc_code}"
  "TOTAL SMALL BUSINESS SET-ASIDE" → {set_aside}

Section B: Schedule of Services
  CLIN table with line items

Section C: Statement of Work
  {scope_of_work} (full section)

Section D: Solicitation Provisions
Section E: Contract Clauses
```

**Extraction approach**: Detect cover page pattern, extract labeled fields. Then scan Section A/B/C for NAICS, PSC, line items, SOW.

## Format Detection Logic

```
def detect_format(text):
    if "Notice ID:" in first_500_chars:
        return "sam_export"
    if re.search(r"SOLICITATION NUMBER\*", first_1000_chars):
        return "agency_form"
    if re.search(r"SECTION [A-E]", text) or "Issuing Office:" in first_1000_chars:
        return "formal_rfq"
    return "unknown"  # fall through to generic extraction
```

## Generic Fallback Patterns

For any format, these patterns should be tried as last resort:

| Field | Generic Pattern |
|-------|----------------|
| solicitation_number | r"(?:solicitation\s*(?:number\|#\|no\.?))\s*[:\s]*([A-Z0-9][-A-Z0-9]{6,})" (case-insensitive) |
| naics_code | r"NAICS[^0-9]{0,20}(\d{5,6})" |
| psc_code | r"(?:PSC\|Product\s+Service\s+Code)[^A-Z0-9]{0,20}([A-Z]?\d{3,4}[A-Z]?)" |
| contact_email | r"[\w.-]+@[\w.-]+\.\w{2,}" (first match near "contact" or "point of contact") |
| due_date | r"(?:response\|due\|deadline\|closing)[^0-9]{0,30}(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})" |
| set_aside | r"(?:set.?aside|small\s+business)" context extraction |

## Confidence Scoring Notes

- Format-specific extraction: +20 confidence bonus (patterns are reliable for known format)
- Generic fallback extraction: base confidence only
- Field found in multiple locations with same value: +10 bonus
- Field found in multiple locations with conflicting values: -15 penalty, flag for review
