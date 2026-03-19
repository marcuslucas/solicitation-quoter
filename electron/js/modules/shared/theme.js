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
      '--color-header':'#071407','--color-header-raised':'#0a1e0a',
      '--color-primary':'#00FF41','--color-secondary':'#33FF66',
      '--color-background':'#030C03','--color-surface':'#040F04','--color-surface-raised':'#071407','--color-panel':'#040F04',
      '--color-border':'#1a3d1a','--color-text':'#00CC33','--color-text-muted':'#2a5e2a',
      '--color-success':'#AAFF00','--color-warning':'#AAFF00','--color-error':'#FF4444','--radius-sm':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.07'
    }
  },
  phantom: {
    label: 'PHANTOM',
    desc: 'Pure black canvas with ice-blue telemetry',
    swatches: ['#000000','#050505','#00D4FF','#C0D8E8'],
    vars: {
      '--color-header':'#000000','--color-header-raised':'#0A0A12',
      '--color-primary':'#00D4FF','--color-secondary':'#20E8FF',
      '--color-background':'#000000','--color-surface':'#050505','--color-surface-raised':'#0A0A0A','--color-panel':'#050505',
      '--color-border':'#111111','--color-text':'#C0D8E8','--color-text-muted':'#404858',
      '--color-success':'#00C896','--color-warning':'#00C896','--color-error':'#FF4444','--radius-sm':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.04'
    }
  },
  sector: {
    label: 'SECTOR',
    desc: 'Olive field black with amber advisory accents',
    swatches: ['#0C0E08','#1A1D10','#C8AB32','#E8DDB0'],
    vars: {
      '--color-header':'#080A06','--color-header-raised':'#181B0E',
      '--color-primary':'#C8AB32','--color-secondary':'#D8C040',
      '--color-background':'#0C0E08','--color-surface':'#1A1D10','--color-surface-raised':'#20231A','--color-panel':'#1A1D10',
      '--color-border':'#2E3020','--color-text':'#E8DDB0','--color-text-muted':'#7A7840',
      '--color-success':'#8AAA30','--color-warning':'#8AAA30','--color-error':'#C83020','--radius-sm':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.06'
    }
  },
  forge: {
    label: 'FORGE',
    desc: 'Dark charcoal with molten orange accents',
    swatches: ['#0F0C0A','#1E1610','#E85A1A','#F5DCC8'],
    vars: {
      '--color-header':'#0A0806','--color-header-raised':'#201408',
      '--color-primary':'#E85A1A','--color-secondary':'#F07030',
      '--color-background':'#0F0C0A','--color-surface':'#1E1610','--color-surface-raised':'#251A12','--color-panel':'#1E1610',
      '--color-border':'#3A2518','--color-text':'#F5DCC8','--color-text-muted':'#8A6040',
      '--color-success':'#8A9840','--color-warning':'#8A9840','--color-error':'#E83020','--radius-sm':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.06'
    }
  },
  wraith: {
    label: 'WRAITH',
    desc: 'Deep naval black with cold steel-blue',
    swatches: ['#07090D','#060810','#5B8AB8','#C8D8E8'],
    vars: {
      '--color-header':'#040608','--color-header-raised':'#0A1020',
      '--color-primary':'#5B8AB8','--color-secondary':'#7AA8D8',
      '--color-background':'#07090D','--color-surface':'#060810','--color-surface-raised':'#0A0D14','--color-panel':'#060810',
      '--color-border':'#1A2535','--color-text':'#C8D8E8','--color-text-muted':'#4A6080',
      '--color-success':'#4A9870','--color-warning':'#4A9870','--color-error':'#D05050','--radius-sm':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0.05'
    }
  },
  iron: {
    label: 'IRON',
    desc: 'Concrete grey with red critical alerts',
    swatches: ['#E8E4DC','#D8D4CC','#C0281E','#1A1814'],
    vars: {
      '--color-header':'#D0CBC0','--color-header-raised':'#C8C2B8',
      '--color-primary':'#C0281E','--color-secondary':'#D03828',
      '--color-background':'#E8E4DC','--color-surface':'#DEDAD2','--color-surface-raised':'#D0CBC0','--color-panel':'#E8E4DC',
      '--color-border':'#CBC2B8','--color-text':'#1A1814','--color-text-muted':'#6B6560',
      '--color-success':'#2E6E30','--color-warning':'#2E6E30','--color-error':'#C0281E','--radius-sm':'2px',
      '--font':"Calibri,'Calibri',sans-serif",'--scanline-opacity':'0'
    }
  },
  voss: {
    label: 'VOSS',
    desc: 'Architectural minimalism — warm vellum, ink, and stone',
    swatches: ['#faf8f4','#f4f1ea','#c8a882','#1a1916'],
    vars: {
      '--color-header':'#e8e4dc','--color-header-raised':'#f4f1ea',
      '--color-primary':'#c8a882','--color-secondary':'#d4b896',
      '--color-background':'#faf8f4','--color-surface':'#f9f7f3','--color-surface-raised':'#f4f1ea','--color-panel':'#f9f7f3',
      '--color-border':'#dedad2','--color-text':'#1a1916','--color-text-muted':'#a09c92',
      '--color-success':'#5a7a5a','--color-warning':'#5a7a5a','--color-error':'#a03830','--radius-sm':'0px',
      '--font':"'Cormorant Garamond',Georgia,serif",'--scanline-opacity':'0'
    }
  },
  prism: {
    label: 'PRISM',
    desc: 'Apple-style system UI — clean surfaces, blue accent',
    swatches: ['#F2F2F7','#FFFFFF','#007AFF','#1C1C1E'],
    vars: {
      '--color-header':'#E5E5EA','--color-header-raised':'#F2F2F7',
      '--color-primary':'#007AFF','--color-secondary':'#3395FF',
      '--color-background':'#F2F2F7','--color-surface':'#FFFFFF','--color-surface-raised':'#F2F2F7','--color-panel':'#FFFFFF',
      '--color-border':'#C6C6C8','--color-text':'#1C1C1E','--color-text-muted':'#8E8E93',
      '--color-success':'#34C759','--color-warning':'#34C759','--color-error':'#FF3B30','--radius-sm':'10px',
      '--font':"Calibri,'Calibri',sans-serif",
      '--scanline-opacity':'0'
    }
  },
  'prism-dark': {
    label: 'PRISM DARK',
    desc: 'iOS dark mode — OLED black, elevated cards, bright blue',
    swatches: ['#000000','#1C1C1E','#0A84FF','#FFFFFF'],
    vars: {
      '--color-header':'#2C2C2E','--color-header-raised':'#1C1C1E',
      '--color-primary':'#0A84FF','--color-secondary':'#409CFF',
      '--color-background':'#000000','--color-surface':'#1C1C1E','--color-surface-raised':'#2C2C2E','--color-panel':'#1C1C1E',
      '--color-border':'#3A3A3C','--color-text':'#FFFFFF','--color-text-muted':'#8E8E93',
      '--color-success':'#30D158','--color-warning':'#30D158','--color-error':'#FF453A','--radius-sm':'10px',
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
  // Set data-theme on <html> (not <body>) so CSS attribute selectors
  // like [data-theme="prism"] work via a single source of truth.
  // Also clear it from <body> in case it was set there previously.
  root.dataset.theme = id
  delete document.body.dataset.theme
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
