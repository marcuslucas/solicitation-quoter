# Build Prerequisites

These steps are for the **developer building the installer**, not end users.

## One-time setup

1. **Python 3.9+** — [python.org](https://python.org). Confirm: `python --version`
2. **Node 18+** — [nodejs.org](https://nodejs.org). Confirm: `node --version`
3. **Install npm dependencies** (once per clone): `npm install`
4. **Install Python dependencies**: `pip install flask pdfplumber pypdf python-docx anthropic`

## Build

**Mac** (must be run on a Mac):
```bash
bash scripts/build-mac.sh
```

**Windows** (must be run on Windows):
```
scripts\build-win.bat
```

Output is in `dist/`.

## Distribute

Share the file from `dist/` via Google Drive, Dropbox, or direct transfer.

- Mac: `.dmg` file. See "Mac install instructions" below.
- Windows: `.exe` installer. Standard Next → Install → Finish.

## Mac Install Instructions (for recipient)

1. Open the `.dmg` file
2. Double-click "Install Helper"
3. If macOS asks "Are you sure you want to open this?", click Open
4. Launch SolQuoter from Applications

## Executable bit (first-time Mac setup)

Two scripts require executable bits. Run once on a Mac after cloning:
```bash
chmod +x scripts/build-mac.sh "scripts/Install Helper.command"
git update-index --chmod=+x scripts/build-mac.sh "scripts/Install Helper.command"
git commit -m "chore: set executable bits on build-mac.sh and Install Helper"
```
