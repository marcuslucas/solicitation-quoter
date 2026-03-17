# Coding Conventions

**Analysis Date:** 2026-03-17

## Naming Patterns

**Files:**
- JavaScript/HTML: `camelCase.js` (e.g., `main.js`, `preload.js`, `index.html`)
- Python: `snake_case.py` (e.g., `server.py`, `run.py`)
- JSON configuration: `lowercase-with-hyphens.json` (e.g., `electron-builder.json`)

**Functions:**
- JavaScript: `camelCase` for all functions (e.g., `applyTheme()`, `toggleQuickActions()`, `pickFile()`)
- Python: `snake_case` for all functions (e.g., `parse_pdf()`, `extract_data()`, `generate_quote()`)
- Arrow functions and anonymous functions used for event handlers and callbacks

**Variables:**
- JavaScript: `camelCase` for all variables, constants use `UPPERCASE` for truly immutable (e.g., `S` for state object, `THEMES`, `TITLES`, `FEATURED_THEMES`)
- Python: `snake_case` for all variables (e.g., `api_key`, `tmp_path`, `text`)

**Types/Classes:**
- JavaScript: No explicit type declarations; uses plain objects and sets
- Python: Dictionary-based data structures; type hints not used
- State management: Centralized `S` object in JavaScript holding all application state

## Code Style

**Formatting:**
- No linter/formatter configured (not detected in `.eslintrc`, `.prettierrc`, or similar)
- JavaScript: 2-space indentation (observed in `main.js`, `index.html`, `preload.js`)
- Python: 4-space indentation (standard Python convention, observed in `server.py`)
- Line length: No strict limit observed; lines vary from 80-120+ characters
- Semicolons: Used in JavaScript throughout all files
- Quotes: Double quotes for strings in both JavaScript and Python

**Linting:**
- Not detected: No ESLint, Prettier, Biome, or similar tools configured
- Code style enforcement relies on manual review

## Import Organization

**JavaScript:**
- Single block of `require()` statements at top
- Order: Node.js core modules first, then Electron, then local modules
- Example from `electron/main.js`:
  ```javascript
  const { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, safeStorage } = require('electron')
  const path = require('path')
  const { spawn } = require('child_process')
  const http = require('http')
  const fs = require('fs')
  ```
- No path aliases used; relative paths with `..` and `__dirname`

**Python:**
- Standard library imports first, then third-party packages
- Example from `server.py`:
  ```python
  import os, sys, json, re, tempfile, traceback, io
  from pathlib import Path
  from flask import Flask, request, jsonify, send_file
  ```
- Lazy imports inside functions when needed (e.g., `import anthropic` inside `ai_extract()`)

## Error Handling

**Patterns:**
- JavaScript: Try-catch blocks with fallback logic; silent failures with empty catch blocks common
  - Example: `try { ... } catch(e) {}` — deliberately ignoring errors
  - IPC handlers wrap operations in try-catch and return error objects: `{ error: "message" }`
  - Window bounds loading: `try { return JSON.parse(...) } catch(e) { return {} }`

- Python: Try-except blocks with graceful degradation
  - Multiple parser fallbacks: PDF parsing falls back to `pdfplumber`, then `pypdf`
  - AI extraction wrapped in try-except; falls back to rule-based extraction on failure
  - Route handlers return JSON error objects: `{"error": "message"}` with appropriate HTTP status codes (400, 404, 500, etc.)

## Logging

**Framework:** `console` in JavaScript; `print()` in Python

**Patterns:**
- JavaScript: `console.log()` for stdout, `console.error()` for errors
  - Backend logging tagged with `[backend]` prefix: `console.log('[backend]', data)`
  - Errors tagged similarly: `console.error('[backend error]', e.message)`

- Python: Direct `print()` for user-facing messages
  - Error messages: `print(f"...")`
  - Failed parser attempts logged: `print(f"pdfplumber failed: {e}")`
  - Exceptions logged with `traceback.print_exc()`

## Comments

**When to Comment:**
- Section dividers: `// ── SECTION NAME ─────────────────────────` (used extensively in both main.js and server.py)
- Above function groups and major code sections
- Complex regex patterns explained before definition
- Edge cases and special handling (e.g., macOS quarantine xattr removal)

**JSDoc/TSDoc:**
- Not used: No @param, @returns, or type annotations observed
- Single-line docstrings used in Python functions:
  ```python
  def extract_line_items(solicitation, text):
      """
      Derive line items from extracted solicitation data and raw text.
      Returns list of dicts: {description, size, unit, qty, unit_price}.
      Any field that cannot be determined is set to the string "N/A".
      """
  ```

## Function Design

**Size:**
- Functions vary widely: 5-100+ lines
- Larger functions typically handle specific business logic (e.g., `generate_quote()` in Python is ~270 lines)
- UI rendering functions split by step (e.g., `step1()`, `step2()`, etc.)

**Parameters:**
- JavaScript: Few parameters; heavy reliance on global `S` state object for data
  - Functions like `goTo(n)`, `render(n)`, `applyTheme(id)` — mostly single parameters
  - No destructuring observed

- Python: Explicit parameters; dictionary parameters for complex data
  - `generate_quote(solicitation, vendor, line_items)`
  - `extract_data(text, api_key="")`

**Return Values:**
- JavaScript: Often modifies DOM directly; functions may return nothing (void)
  - Fetch-based functions return Promises
  - Some functions return objects: `{ canceled, error }`, `{ success, data }`

- Python: All functions return values
  - Data functions return dictionaries or lists
  - HTTP route handlers return JSON via `jsonify()` or `send_file()`

## Module Design

**Exports:**
- JavaScript: No explicit exports; Electron IPC handlers registered via `ipcMain.handle()`
  - Preload script uses `contextBridge.exposeInMainWorld()` to expose API methods
  - No ES6 modules; CommonJS `require()` throughout

- Python: Flask app-level registration
  - Routes registered with `@app.route()` decorator
  - Functions imported directly in test harness (`from server import ...`)

**Barrel Files:**
- Not used: No index.js or __init__.py files observed
- Single entry point per domain: `electron/main.js`, `electron/preload.js`, `electron/index.html`, `python/server.py`

## Conditional Logic

**Patterns:**
- Ternary operators used frequently for DOM state toggling
- Single expression: `el.classList.toggle('active', s === n)`
- Fallback values: `vendor.get("name") or "Default"`
- Python: Guard clauses for early returns: `if not field: continue`

## State Management

**Global State:**
- Centralized `S` object in JavaScript containing:
  - `step`: current step number
  - `done`: Set of completed steps
  - `file`: File object from upload
  - `extracted`: Parsed solicitation data
  - `vendor`: Vendor info
  - `items`: Line items array
  - Various localStorage-backed fields

**Persistence:**
- localStorage for session resumption, vendor data, API keys, theme preference
- Backend state: None (stateless Flask routes)

## String Handling

**Escaping:**
- JavaScript: `esc()` function for HTML escaping (pattern observed in templates)
- Python: f-strings for formatting; no explicit escaping in JSON responses (Flask handles it)

---

*Convention analysis: 2026-03-17*
