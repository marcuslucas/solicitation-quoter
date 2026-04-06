# Solicitation Quoter

Parse any solicitation document and generate a professional quote in 5 steps.

---

## TO RUN THE APP

### Prerequisites (install once)
- Node.js: https://nodejs.org  (download LTS)
- Python 3.9+: https://python.org

### Step 1 — Install Python packages
Open a terminal in this folder and run:
```
pip install flask pdfplumber pypdf python-docx anthropic
```

### Step 2 — Install Node packages
```
npm install
```

### Step 3 — Launch
```
npm start
```

The app opens as a desktop window. Done.

---

## FOLDER STRUCTURE
```
solicitation-quoter/
├── electron/
│   ├── main.js         ← Electron window manager
│   ├── preload.js      ← IPC bridge
│   ├── index.html      ← Full application UI
│   ├── loading.html    ← Startup screen
│   └── error.html      ← Error screen
├── python/
│   ├── server.py       ← Flask backend (parse + generate)
│   └── requirements.txt
├── package.json
└── electron-builder.json
```

---

## TO BUILD A STANDALONE .EXE (Windows)

```
pip install pyinstaller
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
rename dist dist-backend
npm run build:win
```
Installer appears in `dist/`.
