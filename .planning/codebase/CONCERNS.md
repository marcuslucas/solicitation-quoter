# Codebase Concerns

**Analysis Date:** 2026-03-17

## Tech Debt

**Silent API Key Storage Fallback:**
- Issue: When Electron's safeStorage encryption is unavailable, API keys fall back to plain text storage in `.plain` file
- Files: `electron/main.js` (lines 242-259)
- Impact: API keys stored unencrypted on Windows systems without proper crypto context, or during development. User sees no warning about this degradation
- Fix approach: Either block key storage when encryption unavailable, or show prominent warning to user. Alternatively, force keys to be re-entered on each session if encryption fails

**Hardcoded CORS Policy:**
- Issue: Flask server accepts requests only from `http://127.0.0.1:5199` hardcoded in decorator
- Files: `python/server.py` (line 10)
- Impact: Port is hardcoded in multiple places (Electron, Python, HTML). If port binding fails, entire app breaks. No flexibility for testing on different ports
- Fix approach: Use environment variable for port throughout stack. Make CORS validation dynamic

**Regex-Heavy Data Extraction:**
- Issue: Rule-based extraction relies on complex regex patterns that may not handle document variations
- Files: `python/server.py` (lines 61-132)
- Impact: Quality degradation when solicitation formats differ from expected patterns. Low matching confidence for NAICS codes, PSC codes, and free-form address fields
- Fix approach: Add extraction confidence scores. Validate extracted data against known formats (e.g., NAICS should be 5-6 digits). Fall back to prompting user if confidence below threshold

**API Key Passed in Form Data (Not Secure):**
- Issue: Anthropic API key transmitted in multipart form data to `/parse` endpoint
- Files: `python/server.py` (line 524), `electron/index.html` (line 1003)
- Impact: Key visible in browser DevTools, potentially logged by Flask middleware, passed in plain HTTP POST to localhost
- Fix approach: Store key server-side only, never transmit from frontend. Frontend generates upload request, backend fetches stored key and uses it

**Temp File Cleanup Gap:**
- Issue: Uploaded files written to temp directory and deleted in finally block, but if process crashes before finally executes, files may persist
- Files: `python/server.py` (lines 520-541)
- Impact: Sensitive PDFs with personal info could remain on disk if backend crashes. No cleanup on app shutdown
- Fix approach: Use context manager or ensure finally always runs. Add periodic cleanup of old temp files on startup

**Unvalidated File Upload:**
- Issue: File upload route accepts any file type matching extensions, no validation of actual file content
- Files: `python/server.py` (lines 517-541)
- Impact: User could upload executable or malformed file that crashes pdfplumber/pypdf. No size limit enforced on uploads
- Fix approach: Validate MIME type and file magic bytes. Enforce max file size (e.g., 50MB). Wrap parsing in timeout

**Logo Size Limits Not Enforced Server-Side:**
- Issue: 2MB limit enforced only in renderer, not in backend
- Files: `electron/main.js` (line 202), `electron/index.html` (no backend validation)
- Impact: Malicious user could modify DevTools and bypass limit, sending huge base64 image to backend and crashing document generation
- Fix approach: Validate image size and dimensions server-side before embedding in DOCX

## Known Bugs

**Backend Process Zombie on Windows:**
- Symptoms: On Windows, if Electron crashes before kill() executes, Python backend continues running on port 5199, blocking future app launches
- Files: `electron/main.js` (lines 85-92, 268-271)
- Trigger: Force-quit Electron or machine crash during operation
- Workaround: Manually kill Python process via Task Manager. Adding `taskkill` call on app exit helps but race condition may still occur
- Fix approach: Add process.on('uncaughtException') handler that guarantees kill() call. Consider using process groups on Windows

**SAM.gov Lookup Field Mapping Inconsistency:**
- Symptoms: SAM.gov API field names don't match extraction field names perfectly (e.g., `responseDeadLine` vs `due_date`)
- Files: `python/server.py` (lines 584-615)
- Trigger: User lookups via SAM.gov return fields mapped inconsistently; user sees "null" in some fields that exist in SAM response
- Workaround: Manual entry of missing fields
- Fix approach: Add explicit mapping test case and review all SAM.gov field transformations

**Scope of Work Truncation:**
- Symptoms: Scope text truncated silently at 3000 chars during extraction, then again at 2000 in Python, then capped again during document generation
- Files: `python/server.py` (lines 120, 594), `electron/index.html` (line 1079)
- Trigger: Upload solicitation with >2000 char description
- Workaround: User must manually re-enter truncated text
- Fix approach: Show warning when truncation occurs. Allow multi-page scope sections in generated quote

**Line Item CSV Import Lacks Validation:**
- Symptoms: No error handling if CSV is malformed. Headers don't need to match. Extra columns silently dropped
- Files: `electron/index.html` (likely in CSV import function around line 1182)
- Trigger: Upload CSV with mismatched column names or wrong data types
- Workaround: User must inspect generated quote and manually fix line items
- Fix approach: Add CSV column validation and type checking before import

## Security Considerations

**Plaintext API Keys at Rest:**
- Risk: Anthropic and SAM.gov API keys stored unencrypted on filesystem when safeStorage unavailable
- Files: `electron/main.js` (lines 242-259), keyPath stored in `app.getPath('userData')`
- Current mitigation: Uses Electron safeStorage which leverages OS credential store when available (Windows DPAPI, macOS Keychain)
- Recommendations: Force encryption check before allowing key storage. Prompt user to re-enter if encryption unavailable. Add periodic key rotation reminder

**AI Extraction Model Exposure:**
- Risk: Claude API key exposed in network request if user inspects traffic or enables logging
- Files: `python/server.py` (lines 136-154), passed from renderer at line 1003
- Current mitigation: localhost-only communication, no logging of API keys in normal operation
- Recommendations: Move key to server-side only, never from client. Use backend session token instead. Implement rate limiting per document to prevent abuse

**CORS Allows Same-Origin Only But Hardcoded:**
- Risk: If port changes or app runs on different interface, legitimate requests rejected. No auth required to hit `/parse`
- Files: `python/server.py` (lines 8-13)
- Current mitigation: Runs on localhost only, not network-exposed
- Recommendations: Verify app is never bundled with network-facing Flask. Add authentication token for API routes. Document security model

**Unencrypted Temp Files:**
- Risk: Extracted text and PDFs written to temp directory in plaintext
- Files: `python/server.py` (lines 526-541)
- Current mitigation: Files deleted after request completes; desktop environment typically restricts /tmp access
- Recommendations: Encrypt temp files or use in-memory processing. Implement periodic secure deletion (overwrite before unlink)

**User Data Export/Import Without Integrity:**
- Risk: Profiles and quote history exported as JSON with no signature or checksum; malicious JSON could be injected
- Files: `electron/index.html` (export/import profile functions)
- Current mitigation: None
- Recommendations: Add HMAC or digital signature to exported profiles. Validate structure on import

## Performance Bottlenecks

**Text Extraction from Large PDFs:**
- Problem: pdfplumber and pypdf both load entire PDF into memory before text extraction
- Files: `python/server.py` (lines 21-38)
- Cause: No streaming or chunked processing. Large 100+ page PDFs with images cause memory spike
- Improvement path: Process PDF page-by-page, combine text in streaming fashion. Set memory limits and fail gracefully. Add progress reporting

**AI Extraction on Long Documents:**
- Problem: Claude API receives full document text (truncated to 14,000 chars); slow for large requests, wastes tokens
- Files: `python/server.py` (lines 139-154)
- Cause: No smart chunking or key content extraction before AI call
- Improvement path: Extract key sections (dates, numbers, contact info) before sending to Claude. Use prompt caching if available. Run extraction in background with progress updates

**No Caching of Extraction Results:**
- Problem: Same document uploaded twice triggers full extraction twice
- Files: `python/server.py` (no deduplication)
- Cause: No content hash or memoization
- Improvement path: Cache extractions by file hash for 24 hours. Allow user to reuse previous extraction

**Synchronous File Operations on Main Thread:**
- Problem: All file I/O (reading uploads, writing quotes) blocks the Flask thread
- Files: `python/server.py` (multiple fs operations)
- Cause: No async I/O or worker pools
- Improvement path: Use async Flask or offload large operations to Celery workers

**Quote Generation DOM Rendering Before PDF Print:**
- Problem: Document generation creates full DOM, renders, then prints to PDF synchronously
- Files: `electron/main.js` (lines 169-178)
- Cause: Large quotes with 100+ line items can slow down render
- Improvement path: Generate DOCX on backend instead of HTML->PDF conversion. This is already being done but PDF export path still uses printToPDF

## Fragile Areas

**Solicitation Data Structure Mismatch:**
- Files: `python/server.py` (lines 61-174), `electron/index.html` (lines 1042-1051)
- Why fragile: Extraction returns optional fields; UI expects specific field names. If extraction adds/removes fields, UI must be updated. No schema validation
- Safe modification: Use TypeScript interfaces or Pydantic models to define solicitation schema. Add runtime validation. Generate UI from schema
- Test coverage: No unit tests for extraction output schema. No validation tests

**Line Item Transformation Pipeline:**
- Files: `python/server.py` (lines 177-240)
- Why fragile: Complex fallback logic (AI items → quantities → CLIN → fallback) with multiple format assumptions. Hard to debug which fallback fires
- Safe modification: Add logging to each fallback path. Document assumptions about CLIN format. Write tests for each fallback
- Test coverage: No tests for line item extraction from different document formats

**Window Bounds Persistence:**
- Files: `electron/main.js` (lines 11-37)
- Why fragile: Bounds JSON stored in userData directory. If corrupted or malformed, app may fail to open. No validation of bounds
- Safe modification: Always wrap bounds read in try/catch. Validate bounds are within screen area before using. Reset to defaults on validation failure
- Test coverage: No tests for corrupted bounds file

**Theme System:**
- Files: `electron/index.html` (lines 611-700+, THEMES object)
- Why fragile: Theme CSS variables applied dynamically to root element. CSS references variables that may not exist. Theme JSON hardcoded, not loaded from config
- Safe modification: Extract theme definitions to separate JSON file. Validate all required variables present in theme object. Add CSS variable fallbacks
- Test coverage: No tests that all themes render correctly with all UI components

**Settings and Profiles Persistence:**
- Files: `electron/index.html` (settings/profiles functions)
- Why fragile: All data stored as JSON strings in localStorage. No versioning, no migration path. If schema changes, old data breaks
- Safe modification: Add version field to stored objects. Implement migration functions. Store schema alongside data
- Test coverage: No tests for loading old profile formats or migrating settings

## Scaling Limits

**Flask Single-Threaded Mode:**
- Current capacity: 1 request at a time (default Flask development mode)
- Limit: If user tries to parse two documents simultaneously (unlikely but possible via rapid clicks), second request blocks
- Scaling path: Move to Gunicorn with worker pool, implement request queuing, or add backend socket.io for concurrent uploads

**Memory for Large Extracted Text:**
- Current capacity: Full text of solicitation held in memory for rule + AI extraction (limited to 14,000 chars in AI path, unlimited in rules)
- Limit: 100MB+ PDFs can consume significant memory; multiple concurrent operations multiply this
- Scaling path: Stream text extraction, process incrementally, implement memory limits per request, add timeout on long-running extractions

**Quote Document Generation:**
- Current capacity: python-docx builds entire document in memory before writing
- Limit: Quotes with 500+ line items or large scope text may slow significantly
- Scaling path: Stream DOCX generation using generator, batch line item table creation, lazy-load images

**Sam.gov Rate Limiting:**
- Current capacity: No rate limiting on `/sam_lookup` endpoint; user could script 1000s of requests
- Limit: SAM.gov API likely has rate limits; once hit, all lookups fail
- Scaling path: Add per-session rate limiting, implement exponential backoff for SAM requests, cache results

## Dependencies at Risk

**pdfplumber Maintenance:**
- Risk: pdfplumber is community-maintained and may not handle all PDF variants. Fallback to pypdf exists but has known text extraction quality issues
- Impact: If pdfplumber stops being maintained, text extraction quality degrades significantly
- Migration plan: Evaluate PyPDF2 or pdfminer as primary, keep pdfplumber as backup. Consider commercial PDF lib if critical

**anthropic Python Package:**
- Risk: Major version changes could break API (though Anthropic maintains good backwards compatibility)
- Impact: If API changes, app's AI extraction feature breaks until updated
- Migration plan: Pin version to minor, implement wrapper class around API calls to isolate changes, monitor releases

**Electron Security Updates:**
- Risk: Electron regularly releases security patches; app must update to stay secure
- Impact: Outdated Electron versions may have known vulnerabilities. Package depends on inherited Electron deps
- Migration plan: Set up dependabot or similar to track Electron updates. Test each update before shipping

**flask Package:**
- Risk: Flask is stable but single-threaded development server not intended for production
- Impact: No explicit risk, but production deployment would need uWSGI/Gunicorn wrapper
- Migration plan: Document production deployment requirements, move to async framework if scaling needed

## Missing Critical Features

**Audit Log for Quote Generation:**
- Problem: No record of which documents were parsed, which quotes were generated, when. User privacy OK but operational tracking missing
- Blocks: Users can't track which quotes were sent to which solicitations over time

**Extraction Confidence Scoring:**
- Problem: No indication of confidence in extracted fields. User doesn't know if "John Smith" was definitely extracted or guessed
- Blocks: Users may trust bad extractions and generate incorrect quotes

**Batch Processing:**
- Problem: One document at a time. User must upload, review, generate quote for each solicitation
- Blocks: Users handling multiple solicitations per session spend lots of time in wizard

**Progress Reporting for Long Extractions:**
- Problem: Large PDF parsing and AI extraction can take 10-30s but user sees no progress
- Blocks: User may think app hung and force-quit

**Signature Capture in Generated Quote:**
- Problem: Quote has blank signature lines but no way to capture signature before saving
- Blocks: Users must print, sign, scan, and email rather than delivering final quote

## Test Coverage Gaps

**No Unit Tests for Extraction:**
- What's not tested: Rule-based regex patterns, AI extraction merging logic, line item fallback pipeline
- Files: `python/server.py` (all extraction functions)
- Risk: Extraction bugs only caught by user complaints. Refactoring extraction risks silent breakage
- Priority: High — extraction is core functionality

**No Tests for File Format Handling:**
- What's not tested: DOCX parsing, PDF text extraction with various PDF structures, TXT file encoding edge cases
- Files: `python/server.py` (lines 21-57)
- Risk: User uploads malformed PDF and parser crashes with opaque error
- Priority: High — affects stability

**No Tests for Document Generation:**
- What's not tested: Quote DOCX generation with edge cases (very long descriptions, 100+ line items, special characters, logos with different formats)
- Files: `python/server.py` (lines 244-513)
- Risk: Generated quote has formatting errors or fails to open in Word
- Priority: Medium — affects user experience

**No Tests for Settings Persistence:**
- What's not tested: Saving/loading API keys, profiles, themes. Schema versioning. Corrupted settings recovery
- Files: `electron/index.html` (settings/profiles functions)
- Risk: User settings lost on upgrade or browser storage clear
- Priority: Medium — affects user satisfaction

**No Integration Tests for End-to-End Workflow:**
- What's not tested: Upload document → Extract → Review → Generate → Download flow with real PDFs
- Files: All layers
- Risk: Regression in any layer breaks entire workflow
- Priority: High — catches real-world issues

**No Electron IPC Tests:**
- What's not tested: Main process handlers (openFile, saveQuote, pickLogo, etc.) and preload bridge
- Files: `electron/main.js`, `electron/preload.js`
- Risk: IPC communication failures only caught by manual testing
- Priority: Medium — affects reliability

---

*Concerns audit: 2026-03-17*
