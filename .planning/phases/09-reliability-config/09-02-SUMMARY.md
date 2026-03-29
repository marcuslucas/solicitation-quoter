---
phase: 09-reliability-config
plan: 02
subsystem: backend-reliability
tags: [zombie-process, timeout, psutil, abort-controller, electron-python-ipc]
dependency_graph:
  requires: []
  provides: [REL-02, REL-03]
  affects: [python/server.py, electron/main.js, electron/js/modules/step1.js]
tech_stack:
  added: [psutil (Python), concurrent.futures, threading, AbortController (browser API)]
  patterns: [daemon-thread-ppid-polling, threadpool-timeout, fetch-abort-signal]
key_files:
  created: []
  modified:
    - python/server.py
    - electron/main.js
    - electron/js/modules/step1.js
    - CLAUDE.md
decisions:
  - "psutil imported lazily inside _watch_parent function body to avoid import-time overhead and allow graceful fallback if psutil is somehow absent"
  - "AbortController clearTimeout placed in both success path and catch block to prevent spurious abort after a successful (but slow) response"
  - "No detached:true added to spawn() per plan research (Pitfall 5) — detached would prevent SIGTERM propagation on macOS"
  - "ThreadPoolExecutor(max_workers=1) wraps both parse_document and extract_data as a single unit — avoids partial-result race condition if timeout fires between the two calls"
metrics:
  duration: "~6 min"
  completed_date: "2026-03-29"
  tasks_completed: 2
  files_modified: 4
---

# Phase 09 Plan 02: Backend Zombie-Process Fix and Parse Timeout Summary

**One-liner:** Python self-terminates via psutil ppid polling when Electron exits; parse requests 408-timeout after 30s; renderer aborts fetch on matching AbortController timer.

## What Was Built

### REL-02 — Zombie process prevention (ppid watcher)

`python/server.py` now starts a daemon thread (`_watch_parent`) in the `__main__` block when a `PARENT_PID` environment variable is set. The thread polls `psutil.pid_exists(ppid)` every 3 seconds; if the parent PID is gone, it calls `os._exit(0)` to terminate the Python process immediately. `electron/main.js` injects `PARENT_PID: String(process.pid)` into the backend spawn env so the thread activates for every session.

### REL-03 — Parse timeout (backend + renderer)

**Backend:** The `parse_document` + `extract_data` call in `parse_route()` is wrapped in a `concurrent.futures.ThreadPoolExecutor` with `fut.result(timeout=30)`. On timeout, the route returns `{"error": "Parsing timed out after 30 seconds. The file may be too large or corrupted."}` with HTTP 408. The worker thread is allowed to finish naturally (Pitfall 4 per research).

**Renderer:** `doParse()` in `step1.js` now creates an `AbortController` and arms a `setTimeout(() => controller.abort(), 30000)` before the fetch. The signal is passed to `fetch(...)`. On `AbortError` the catch block rewrites the message to `"Parsing timed out. The file may be too large or corrupted — try a smaller document."` — a user-actionable message. `clearTimeout` runs in both the success path and the catch block to prevent stale aborts.

### CLAUDE.md documentation

`psutil` added to pip install line. Both Windows and macOS PyInstaller commands updated with `--hidden-import psutil` so the daemon thread survives packaging.

## Commits

| Hash | Description |
|------|-------------|
| b5c72bd | feat(09-02): ppid watcher thread, parse timeout, PARENT_PID injection |
| 0e5dc8f | feat(09-02): add AbortController 30s timeout to renderer /parse fetch |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both REL-02 and REL-03 are fully wired end-to-end.

## Self-Check: PASSED

- python/server.py `_watch_parent`: present (line 88)
- python/server.py `threading.Thread(target=_watch_parent`: present (line 325)
- python/server.py `fut.result(timeout=30)`: present (line 149)
- python/server.py `TimeoutError` handler: present (line 150)
- electron/main.js `PARENT_PID: String(process.pid)`: present (line 60)
- electron/js/modules/step1.js `AbortController`: present (line 92)
- electron/js/modules/step1.js `AbortError`: present (line 155)
- Commits b5c72bd and 0e5dc8f: verified in git log
