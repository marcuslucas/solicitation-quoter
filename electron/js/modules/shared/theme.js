// electron/js/modules/shared/theme.js
// Theme subsystem exposed as window globals.
// Depends on: window.S (set by state.js, loaded before this file)

// ── THEMES ───────────────────────────────────────────────────────────────────
const THEMES = {
  specter: {
    label: 'SPECTER',
    desc: 'Night-vision green on terminal black',
    swatches: ['#030C03','#040F04','#00FF41','#AAFF00'],
    vars: {
      '--navy':'#071407','--navy2':'#0a1e0a',
      '--gold':'#00FF41','--gold2':'#33FF66',
      '--bg':'#030C03','--bg2':'#040F04','--bg3':'#071407','--panel':'#040F04',
      '--border':'#1a3d1a','--text':'#00CC33','--muted':'#2a5e2a',
      '--green':'#AAFF00','--red':'#FF4444','--r':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.07'
    }
  },
  phantom: {
    label: 'PHANTOM',
    desc: 'Pure black canvas with ice-blue telemetry',
    swatches: ['#000000','#050505','#00D4FF','#C0D8E8'],
    vars: {
      '--navy':'#000000','--navy2':'#0A0A12',
      '--gold':'#00D4FF','--gold2':'#20E8FF',
      '--bg':'#000000','--bg2':'#050505','--bg3':'#0A0A0A','--panel':'#050505',
      '--border':'#111111','--text':'#C0D8E8','--muted':'#404858',
      '--green':'#00C896','--red':'#FF4444','--r':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.04'
    }
  },
  sector: {
    label: 'SECTOR',
    desc: 'Olive field black with amber advisory accents',
    swatches: ['#0C0E08','#1A1D10','#C8AB32','#E8DDB0'],
    vars: {
      '--navy':'#080A06','--navy2':'#181B0E',
      '--gold':'#C8AB32','--gold2':'#D8C040',
      '--bg':'#0C0E08','--bg2':'#1A1D10','--bg3':'#20231A','--panel':'#1A1D10',
      '--border':'#2E3020','--text':'#E8DDB0','--muted':'#7A7840',
      '--green':'#8AAA30','--red':'#C83020','--r':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.06'
    }
  },
  forge: {
    label: 'FORGE',
    desc: 'Dark charcoal with molten orange accents',
    swatches: ['#0F0C0A','#1E1610','#E85A1A','#F5DCC8'],
    vars: {
      '--navy':'#0A0806','--navy2':'#201408',
      '--gold':'#E85A1A','--gold2':'#F07030',
      '--bg':'#0F0C0A','--bg2':'#1E1610','--bg3':'#251A12','--panel':'#1E1610',
      '--border':'#3A2518','--text':'#F5DCC8','--muted':'#8A6040',
      '--green':'#8A9840','--red':'#E83020','--r':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.06'
    }
  },
  wraith: {
    label: 'WRAITH',
    desc: 'Deep naval black with cold steel-blue',
    swatches: ['#07090D','#060810','#5B8AB8','#C8D8E8'],
    vars: {
      '--navy':'#040608','--navy2':'#0A1020',
      '--gold':'#5B8AB8','--gold2':'#7AA8D8',
      '--bg':'#07090D','--bg2':'#060810','--bg3':'#0A0D14','--panel':'#060810',
      '--border':'#1A2535','--text':'#C8D8E8','--muted':'#4A6080',
      '--green':'#4A9870','--red':'#D05050','--r':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.05'
    }
  },
  iron: {
    label: 'IRON',
    desc: 'Concrete grey with red critical alerts',
    swatches: ['#E8E4DC','#D8D4CC','#C0281E','#1A1814'],
    vars: {
      '--navy':'#D0CBC0','--navy2':'#C8C2B8',
      '--gold':'#C0281E','--gold2':'#D03828',
      '--bg':'#E8E4DC','--bg2':'#DEDAD2','--bg3':'#D0CBC0','--panel':'#E8E4DC',
      '--border':'#CBC2B8','--text':'#1A1814','--muted':'#6B6560',
      '--green':'#2E6E30','--red':'#C0281E','--r':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0'
    }
  },
  voss: {
    label: 'VOSS',
    desc: 'Architectural minimalism — warm vellum, ink, and stone',
    swatches: ['#faf8f4','#f4f1ea','#c8a882','#1a1916'],
    vars: {
      '--navy':'#e8e4dc','--navy2':'#f4f1ea',
      '--gold':'#c8a882','--gold2':'#d4b896',
      '--bg':'#faf8f4','--bg2':'#f9f7f3','--bg3':'#f4f1ea','--panel':'#f9f7f3',
      '--border':'#dedad2','--text':'#1a1916','--muted':'#a09c92',
      '--green':'#5a7a5a','--red':'#a03830','--r':'0px',
      '--font':"'Cormorant Garamond',Georgia,serif",'--scanline-opacity':'0'
    }
  },
  prism: {
    label: 'PRISM',
    desc: 'Apple-style system UI — clean surfaces, blue accent',
    swatches: ['#F2F2F7','#FFFFFF','#007AFF','#1C1C1E'],
    vars: {
      '--navy':'#E5E5EA','--navy2':'#F2F2F7',
      '--gold':'#007AFF','--gold2':'#3395FF',
      '--bg':'#F2F2F7','--bg2':'#FFFFFF','--bg3':'#F2F2F7','--panel':'#FFFFFF',
      '--border':'#C6C6C8','--text':'#1C1C1E','--muted':'#8E8E93',
      '--green':'#34C759','--red':'#FF3B30','--r':'10px',
      '--font':"Calibri,'Calibri',sans-serif",
      '--scanline-opacity':'0'
    }
  },
  'prism-dark': {
    label: 'PRISM DARK',
    desc: 'iOS dark mode — OLED black, elevated cards, bright blue',
    swatches: ['#000000','#1C1C1E','#0A84FF','#FFFFFF'],
    vars: {
      '--navy':'#2C2C2E','--navy2':'#1C1C1E',
      '--gold':'#0A84FF','--gold2':'#409CFF',
      '--bg':'#000000','--bg2':'#1C1C1E','--bg3':'#2C2C2E','--panel':'#1C1C1E',
      '--border':'#3A3A3C','--text':'#FFFFFF','--muted':'#8E8E93',
      '--green':'#30D158','--red':'#FF453A','--r':'10px',
      '--font':"Calibri,'Calibri',sans-serif",
      '--scanline-opacity':'0'
    }
  }
}

const FEATURED_THEMES = ['prism', 'prism-dark']

// ── THEME FUNCTIONS ───────────────────────────────────────────────────────────
function applyTheme(id) {
  const theme = THEMES[id]
  if (!theme) return
  const root = document.documentElement
  Object.entries(theme.vars).forEach(([k,v]) => root.style.setProperty(k, v))
  document.body.dataset.theme = id
  localStorage.setItem('sq-theme', id)
  document.querySelectorAll('.theme-card').forEach(c =>
    c.classList.toggle('active', c.dataset.theme === id))
}

function renderThemeCard(id, current) {
  const t = THEMES[id]
  return `<div class="theme-card${id===current?' active':''}" data-theme="${id}" onclick="applyTheme('${id}')">
    <div class="theme-swatches">${t.swatches.map(c=>`<div class="theme-swatch" style="background:${c}"></div>`).join('')}</div>
    <div class="theme-name">${t.label}</div>
    <div class="theme-desc">${t.desc}</div>
  </div>`
}

function openThemes() {
  const grid = document.getElementById('theme-grid')
  const current = localStorage.getItem('sq-theme') || 'prism'
  const legacy = Object.keys(THEMES).filter(id => !FEATURED_THEMES.includes(id))
  const legacyHasActive = legacy.includes(current)
  grid.innerHTML = `
    <div class="theme-featured">${FEATURED_THEMES.map(id => renderThemeCard(id, current)).join('')}</div>
    <div class="theme-legacy-toggle" onclick="toggleLegacy()" id="legacy-toggle">
      <span>Legacy / Fun Themes</span>
      <span class="theme-legacy-chevron${legacyHasActive?' open':''}" id="legacy-chevron">&#9656;</span>
    </div>
    <div class="theme-legacy${legacyHasActive?'':' hidden'}" id="legacy-section">
      ${legacy.map(id => renderThemeCard(id, current)).join('')}
    </div>`
  document.getElementById('themes-overlay').classList.remove('hidden')
}

function toggleLegacy() {
  const sec = document.getElementById('legacy-section')
  const chev = document.getElementById('legacy-chevron')
  sec.classList.toggle('hidden')
  chev.classList.toggle('open', !sec.classList.contains('hidden'))
}

function closeThemes() {
  document.getElementById('themes-overlay').classList.add('hidden')
}

function initTheme() {
  const id = localStorage.getItem('sq-theme') || 'prism'
  applyTheme(id)
}

// ── EXPOSE ON WINDOW ──────────────────────────────────────────────────────────
window.THEMES = THEMES; window.FEATURED_THEMES = FEATURED_THEMES;
window.applyTheme = applyTheme; window.renderThemeCard = renderThemeCard;
window.openThemes = openThemes; window.closeThemes = closeThemes;
window.initTheme = initTheme; window.toggleLegacy = toggleLegacy;
