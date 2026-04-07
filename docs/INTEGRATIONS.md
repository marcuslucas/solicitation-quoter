# External Integrations

**Analysis Date:** 2026-03-17

## APIs & External Services

**Anthropic Claude AI:**
- Service: Claude Sonnet 4 AI model (`claude-sonnet-4-6`)
- What it's used for: Optional AI-powered extraction of solicitation fields and line items from uploaded documents
- Implementation: `python/server.py` function `ai_extract()` (lines 136-154)
- SDK/Client: `anthropic` Python package
- Auth: API key (user-provided, stored encrypted by Electron)
- Model: claude-sonnet-4-6
- Max tokens: 2000 per request
- Fallback: If AI extraction fails, app reverts to rule-based extraction (always works)
- Input limits: Document text truncated to 14,000 characters (7000 from start + 7000 from end) to stay within token budget

**SAM.gov Opportunities API:**
- Service: Federal opportunity search and lookup
- What it's used for: Fetch solicitation data directly from SAM.gov by Notice ID instead of uploading document
- Implementation: `python/server.py` function `sam_lookup()` (lines 556-632) and route `POST /sam_lookup`
- SDK/Client: Python built-in `urllib.request` and `urllib.parse`
- Auth: SAM.gov API key (user-provided, stored in localStorage)
- Endpoint: `https://api.sam.gov/opportunities/v2/search`
- Query parameters: api_key, noticeid, postedFrom, postedTo (last 365 days), limit=1
- Timeout: 15 seconds
- Response format: JSON with opportunitiesData array
- Data extracted: solicitation_number, title, type, agency, deadline, posting date, NAICS code, PSC code, set-aside info, place of performance, contact info
- Error handling: Specific handling for 403 (invalid key), HTTP errors, timeouts, network errors
- Rate limiting: Not specified; assumed reasonable per SAM.gov terms

**Google Fonts:**
- Service: Hosted font delivery
- What it's used for: Cormorant Garamond font for UI styling
- Implementation: `electron/index.html` line 7
- Endpoint: `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=swap`
- No auth required

## Data Storage

**Databases:**
- None. Application is stateless for documents.

**File Storage:**
- Local filesystem only
- Generated quotes saved to: `{userDocumentsDir}/SolQuoter Quotes/` (created on first save)
- Quote data (JSON) persisted in same directory
- Files: `.docx` (Word documents), `.json` (quote exports), `.pdf` (preview exports)

**Caching:**
- None. Each parse request processes document from scratch.
- API responses from SAM.gov not cached.

## Authentication & Identity

**Auth Provider:**
- Custom implementation (no third-party auth)

**Implementation:**
- Anthropic API Key: User enters `sk-ant-*` key in settings modal
  - Stored encrypted via Electron `safeStorage.encryptString()` in `userData/apikey.bin`
  - Fallback: Plain text in `userData/apikey.bin.plain` if encryption unavailable
  - Legacy migration: Reads from localStorage if local key file doesn't exist
  - Retrieved via `window.api.loadApiKey()` on app load
  - Can be cleared via settings

- SAM.gov API Key: User enters API key from SAM.gov account settings
  - Stored in browser localStorage (not encrypted)
  - Retrieved from `localStorage.getItem('samKey')`
  - Can be cleared via settings

**No third-party identity providers** (OAuth, SAML, etc.). Each key is independent.

## Monitoring & Observability

**Error Tracking:**
- None detected. Errors logged to console/stdout only.

**Logs:**
- Console output in development
- Backend logs printed to Electron console via stdout/stderr redirection (lines 64-65 in `electron/main.js`)
- No persistent log files
- No external logging service

## CI/CD & Deployment

**Hosting:**
- Desktop application only (not server-hosted)
- Distributed via:
  - **Windows**: NSIS installer (`.exe`)
  - **macOS**: DMG image with Install Helper script
- Build output: `dist/` directory after `npm run build:win` or `npm run build:mac`
- Backend binary: `dist-backend/` (created by PyInstaller before build)

**CI Pipeline:**
- None detected. Manual build process:
  1. `pip install pyinstaller` and Python dependencies
  2. `pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py`
  3. Move `dist/solicitationquoter-backend*` to `dist-backend/`
  4. `npm run build:win` or `npm run build:mac`

## Environment Configuration

**Required env vars:**
- PORT (optional, default: 5199) - Backend port
- PYTHONUNBUFFERED=1 (set automatically by Electron) - Disables stdout buffering

**API Keys (required at runtime, not build time):**
- Anthropic API key (optional for AI extraction, starts with `sk-ant-`)
- SAM.gov API key (optional for SAM lookup)

**Secrets location:**
- Anthropic key: Electron `safeStorage` encrypted file or localStorage fallback
- SAM.gov key: localStorage

## Webhooks & Callbacks

**Incoming:**
- None. Application is frontend-only; no webhook endpoints.

**Outgoing:**
- None detected. Only HTTP POST requests to:
  - Anthropic API (claude messages)
  - SAM.gov API (opportunities search)
  - No callbacks to external services

## Network Security

**CORS:**
- Flask backend CORS headers set to allow only `http://127.0.0.1:5199`
- Prevents requests from other origins
- Implementation: `electron/main.js` route handler (lines 8-13)

**TLS/HTTPS:**
- Local communication only (http://127.0.0.1) - No HTTPS needed
- External API calls to Anthropic and SAM.gov use HTTPS (handled by respective clients/libraries)

**Data In Transit:**
- Local IPC: Electron context bridge (safe, same-process)
- Local HTTP: Port 5199 (localhost only, no network exposure)
- External: HTTPS to Anthropic and SAM.gov APIs

---

*Integration audit: 2026-03-17*
