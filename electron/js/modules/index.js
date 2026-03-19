// electron/js/modules/index.js
// Bootstrap — loaded last. Wires static DOM, calls all step inits, starts app.
// All modules (state.js, utils.js, theme.js, step1-4.js) already loaded.

// ── SETTINGS MODAL FUNCTIONS ──────────────────────────────────────────────────

function openSettings() {
  document.getElementById('s-apikey').value = window.S.apiKey
  document.getElementById('s-validity').value = window.S.validity
  document.getElementById('s-samkey').value = window.S.samKey || ''
  renderHistory()
  document.getElementById('settings-overlay').classList.remove('hidden')
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden')
}

async function saveSettings() {
  const newKey = document.getElementById('s-apikey').value.trim()
  const apiKeyChanged = newKey !== window.S.apiKey
  window.S.apiKey = newKey
  window.S.validity = document.getElementById('s-validity').value.trim()
  window.S.samKey = document.getElementById('s-samkey').value.trim()
  window.S.vendor.validity_period = window.S.validity
  try {
    if (window.api && apiKeyChanged) {
      const result = await window.api.storeApiKey(window.S.apiKey)
      if (result && result.blocked) {
        showEncryptionWarning()
        localStorage.setItem('validity', window.S.validity)
        localStorage.setItem('samKey', window.S.samKey)
        closeSettings()
        openAiModal()
        return
      }
      if (typeof window.toast === 'function') {
        window.toast('Restarting backend with new API key...', 'info')
      }
      if (window.api && window.api.restartBackend) {
        await window.api.restartBackend()
      }
    }
    localStorage.setItem('validity', window.S.validity)
    localStorage.setItem('samKey', window.S.samKey)
  } catch(e) {}
  closeSettings()
  window.toast('Settings saved', 'success')
}

function renderHistory() {
  const el = document.getElementById('history-list')
  if (!el) return
  try {
    const h = JSON.parse(localStorage.getItem('quoteHistory') || '[]')
    el.innerHTML = h.length ? h.map(e => `
      <div style="padding:5px 0;border-bottom:1px solid var(--color-border)">
        <div style="color:var(--color-text)">${window.esc(e.solicitation_number||'—')} · ${window.esc(e.project_title||'—')}</div>
        <div style="color:var(--color-text-muted);font-size:11px">${new Date(e.ts).toLocaleDateString()} · ${window.esc(e.company_name||'—')} · $${parseFloat(e.total||0).toFixed(2)}</div>
      </div>`).join('') : '<div style="color:var(--color-text-muted)">No quotes generated yet.</div>'
  } catch(e) { el.innerHTML = '<div style="color:var(--color-text-muted)">No history.</div>' }
}

function clearHistory() {
  if (!confirm('Clear quote history?')) return
  try { localStorage.removeItem('quoteHistory') } catch(e) {}
  renderHistory()
}

// ── ENCRYPTION WARNING HELPER ─────────────────────────────────────────────────

function showEncryptionWarning() {
  const warningId = 'encryption-warning-banner'
  let banner = document.getElementById(warningId)
  if (!banner) {
    banner = document.createElement('div')
    banner.id = warningId
    banner.style.cssText = 'background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:4px;padding:10px 14px;margin:8px 0;font-size:13px;line-height:1.4;'
    banner.textContent = 'Secure storage is unavailable on this system. Your API key cannot be saved — you will need to re-enter it each session.'
    const keyInput = document.getElementById('m-apikey')
    if (keyInput && keyInput.parentElement) {
      keyInput.parentElement.insertBefore(banner, keyInput)
    }
  }
  banner.style.display = 'block'
}

// ── EXPORT DATA ───────────────────────────────────────────────────────────────

async function exportData(format) {
  try {
    const history = JSON.parse(localStorage.getItem('quoteHistory') || '[]')
    if (format === 'csv') {
      const rows = [['Date','Solicitation #','Project Title','Company','Total ($)']]
      history.forEach(h => rows.push([
        new Date(h.ts).toLocaleDateString(),
        h.solicitation_number || '',
        h.project_title || '',
        h.company_name || '',
        parseFloat(h.total || 0).toFixed(2)
      ]))
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
      if (window.api?.exportData) {
        const res = await window.api.exportData({ content: csv, filename: 'SolQuoter_History.csv', ext: 'csv' })
        if (res?.success) window.toast('History exported as CSV', 'success')
        else window.toast('Export cancelled', 'info', 2000)
      }
    } else {
      const data = {
        exported: new Date().toISOString(),
        version: 1,
        history,
        currentSession: { extracted: window.S.extracted, vendor: window.S.vendor, items: window.S.items }
      }
      const json = JSON.stringify(data, null, 2)
      if (window.api?.exportData) {
        const res = await window.api.exportData({ content: json, filename: 'SolQuoter_Backup.json', ext: 'json' })
        if (res?.success) window.toast('Backup exported as JSON', 'success')
        else window.toast('Export cancelled', 'info', 2000)
      }
    }
  } catch(err) {
    window.toast('Export failed: ' + err.message, 'error')
  }
}

// ── AI MODAL ──────────────────────────────────────────────────────────────────

function openAiModal() {
  document.getElementById('m-apikey').value = window.S.apiKey
  document.getElementById('ai-modal-overlay').classList.remove('hidden')
}

function closeAiModal() {
  document.getElementById('ai-modal-overlay').classList.add('hidden')
}

async function saveAiKey() {
  window.S.apiKey = document.getElementById('m-apikey').value.trim()
  if (window.api) {
    const result = await window.api.storeApiKey(window.S.apiKey)
    if (result && result.blocked) {
      showEncryptionWarning()
      closeAiModal()
      return
    }
    if (typeof window.toast === 'function') {
      window.toast('Restarting backend with new API key...', 'info')
    }
    if (window.api && window.api.restartBackend) {
      await window.api.restartBackend()
    }
  }
  closeAiModal()
  if (window.S.step === 1) window.render(1)
}

// ── SAM MODAL ─────────────────────────────────────────────────────────────────

function openSamModal() {
  document.getElementById('sam-noticeid').value = window.S.samNoticeId || ''
  document.getElementById('sam-key').value = window.S.samKey || ''
  document.getElementById('sam-prog').classList.add('hidden')
  document.getElementById('sam-err').classList.add('hidden')
  document.getElementById('sam-ok').classList.add('hidden')
  document.getElementById('sam-btn').disabled = false
  document.getElementById('sam-modal-overlay').classList.remove('hidden')
}

function closeSamModal() {
  document.getElementById('sam-modal-overlay').classList.add('hidden')
}

// ── VENDOR PROFILES ───────────────────────────────────────────────────────────

function getProfiles() {
  try { return JSON.parse(localStorage.getItem('vendorProfiles') || '[]') } catch { return [] }
}

function setProfiles(arr) {
  try { localStorage.setItem('vendorProfiles', JSON.stringify(arr)) } catch(e) {}
}

function openProfiles() {
  document.getElementById('profile-name-input').value = ''
  document.getElementById('import-conflicts').classList.add('hidden')
  _importBatch = null
  renderProfilesList()
  document.getElementById('profiles-overlay').classList.remove('hidden')
}

function closeProfiles() {
  document.getElementById('profiles-overlay').classList.add('hidden')
}

function renderProfilesList() {
  const profiles = getProfiles()
  const list = document.getElementById('profiles-list')
  if (!profiles.length) {
    list.innerHTML = '<div style="color:var(--color-text-muted);font-size:12px;padding:8px 0">No saved profiles.</div>'
    return
  }
  list.innerHTML = profiles.map((p, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--color-border)">
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600">${window.esc(p.name)}</div>
        <div style="font-size:10px;color:var(--color-text-muted)">${new Date(p.createdAt).toLocaleDateString()}</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-profile-action="load" data-profile-index="${i}">Load</button>
      <button class="btn btn-danger btn-sm" data-profile-action="delete" data-profile-index="${i}">✕</button>
    </div>`).join('')

  list.querySelectorAll('button[data-profile-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.profileIndex, 10)
      if (btn.dataset.profileAction === 'load') loadProfile(idx)
      else if (btn.dataset.profileAction === 'delete') deleteProfile(idx)
    })
  })
}

function saveCurrentProfile() {
  const name = document.getElementById('profile-name-input').value.trim()
  if (!name) { window.toast('Enter a profile name', 'error'); return }
  const profiles = getProfiles()
  const existing = profiles.findIndex(p => p.name === name)
  if (existing >= 0) {
    if (!confirm(`A profile named "${name}" already exists. Overwrite it?`)) return
    profiles[existing].vendor = { ...window.S.vendor }
    profiles[existing].createdAt = new Date().toISOString()
  } else {
    profiles.push({ id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), vendor: { ...window.S.vendor } })
  }
  setProfiles(profiles)
  document.getElementById('profile-name-input').value = ''
  renderProfilesList()
  window.toast('Profile saved', 'success')
}

function loadProfile(i) {
  const profiles = getProfiles()
  const p = profiles[i]
  if (!p) return
  Object.assign(window.S.vendor, p.vendor)
  closeProfiles()
  window.render(window.S.step)
  window.toast(`Loaded: ${p.name}`, 'success')
}

function deleteProfile(i) {
  const profiles = getProfiles()
  const p = profiles[i]
  if (!p) return
  if (!confirm(`Delete profile "${p.name}"?`)) return
  profiles.splice(i, 1)
  setProfiles(profiles)
  renderProfilesList()
  window.toast('Profile deleted', 'success')
}

async function exportProfiles() {
  const profiles = getProfiles()
  if (!profiles.length) { window.toast('No profiles to export', 'warn'); return }
  if (window.api) {
    await window.api.exportData({ content: JSON.stringify(profiles, null, 2), filename: 'solquoter-profiles', ext: 'json' })
  }
}

let _importBatch = null

async function importProfiles() {
  if (!window.api) return
  const text = await window.api.openJsonFile()
  if (!text) return
  let imported
  try { imported = JSON.parse(text) } catch { window.toast('Invalid JSON file', 'error'); return }
  if (!Array.isArray(imported)) { window.toast('Invalid profile file format', 'error'); return }

  const existing = getProfiles()
  const existingNames = new Set(existing.map(p => p.name))
  const conflicts = imported.filter(p => existingNames.has(p.name))
  const clean = imported.filter(p => !existingNames.has(p.name))

  if (!conflicts.length) {
    setProfiles([...existing, ...clean])
    renderProfilesList()
    window.toast(`Imported ${clean.length} profile${clean.length !== 1 ? 's' : ''}`, 'success')
    return
  }

  _importBatch = { clean, conflicts, resolutions: {} }
  renderImportConflicts()
}

function renderImportConflicts() {
  const { conflicts, resolutions } = _importBatch
  const container = document.getElementById('import-conflicts')
  container.classList.remove('hidden')
  container.innerHTML = `
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-text-muted);margin-bottom:8px">Resolve Conflicts</div>
    ${conflicts.map((p, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--color-border)">
        <div style="flex:1;font-size:12px">${window.esc(p.name)} — already exists</div>
        <button class="btn btn-sm ${resolutions[i]==='overwrite'?'btn-primary':'btn-ghost'}" data-conflict-index="${i}" data-conflict-choice="overwrite">Overwrite</button>
        <button class="btn btn-sm ${resolutions[i]==='skip'||resolutions[i]==null?'btn-primary':'btn-ghost'}" data-conflict-index="${i}" data-conflict-choice="skip">Skip</button>
      </div>`).join('')}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary btn-sm" id="apply-import-btn">Apply Import</button>
      <button class="btn btn-ghost btn-sm" id="cancel-import-btn">Cancel All</button>
    </div>`

  container.querySelectorAll('button[data-conflict-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      resolveConflict(parseInt(btn.dataset.conflictIndex, 10), btn.dataset.conflictChoice)
    })
  })
  container.querySelector('#apply-import-btn')?.addEventListener('click', applyImport)
  container.querySelector('#cancel-import-btn')?.addEventListener('click', cancelImport)
}

function resolveConflict(i, choice) {
  _importBatch.resolutions[i] = choice
  renderImportConflicts()
}

function applyImport() {
  const { clean, conflicts, resolutions } = _importBatch
  const existing = getProfiles()
  let overwritten = 0
  conflicts.forEach((p, i) => {
    if (resolutions[i] === 'overwrite') {
      const idx = existing.findIndex(e => e.name === p.name)
      if (idx >= 0) { existing[idx] = p; overwritten++ }
    }
  })
  setProfiles([...existing, ...clean])
  _importBatch = null
  document.getElementById('import-conflicts').classList.add('hidden')
  renderProfilesList()
  window.toast(`Import complete: ${clean.length} added, ${overwritten} overwritten`, 'success')
}

function cancelImport() {
  _importBatch = null
  document.getElementById('import-conflicts').classList.add('hidden')
  window.toast('Import cancelled', 'warn')
}

// ── WIRE STATIC HTML HANDLERS ─────────────────────────────────────────────────

function wireStaticHandlers() {
  // Nav items — use data-step attribute
  document.querySelectorAll('.nav-item[data-step]').forEach(el => {
    el.addEventListener('click', () => window.goTo(+el.dataset.step))
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') window.goTo(+el.dataset.step)
    })
  })

  // Sidebar buttons — distinguished by data-action attribute
  function toggleLightMode() {
    const html = document.documentElement
    if (html.getAttribute('data-theme') === 'light') {
      // Restore the previously saved named theme — re-apply fully so inline
      // CSS vars are set and data-theme is on <html> (not body).
      const prev = localStorage.getItem('sq-theme') || 'specter'
      window.applyTheme(prev)
    } else {
      // Switching to light mode: clear all inline CSS var overrides that
      // applyTheme() set on <html> so the :root[data-theme="light"] stylesheet
      // block can take effect, then set the attribute.
      html.removeAttribute('style')
      delete document.body.dataset.theme
      html.setAttribute('data-theme', 'light')
    }
  }
  document.querySelector('.settings-btn[data-action="toggle-light"]')
    ?.addEventListener('click', toggleLightMode)
  document.querySelector('.settings-btn[data-action="toggle-light"]')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') toggleLightMode()
    })
  document.querySelector('.settings-btn[data-action="themes"]')
    ?.addEventListener('click', window.openThemes)
  document.querySelector('.settings-btn[data-action="themes"]')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') window.openThemes() })
  document.querySelector('.settings-btn[data-action="settings"]')
    ?.addEventListener('click', openSettings)
  document.querySelector('.settings-btn[data-action="settings"]')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') openSettings() })

  // Modal overlays — close on backdrop click
  const overlays = [
    { id: 'csv-modal-overlay',  close: () => window.closeCsvModal?.() },
    { id: 'ai-modal-overlay',   close: () => closeAiModal() },
    { id: 'sam-modal-overlay',  close: () => closeSamModal() },
    { id: 'settings-overlay',   close: () => closeSettings() },
    { id: 'profiles-overlay',   close: () => closeProfiles() },
    { id: 'themes-overlay',     close: () => window.closeThemes?.() },
  ]
  overlays.forEach(({ id, close }) => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === e.currentTarget) close()
    })
  })

  // AI modal buttons
  document.getElementById('ai-modal-cancel-btn')?.addEventListener('click', closeAiModal)
  document.getElementById('ai-modal-save-btn')?.addEventListener('click', saveAiKey)

  // SAM modal buttons
  document.getElementById('sam-modal-cancel-btn')?.addEventListener('click', closeSamModal)
  document.getElementById('sam-btn')?.addEventListener('click', window.doSamLookup)

  // Settings modal buttons
  document.getElementById('settings-cancel-btn')?.addEventListener('click', closeSettings)
  document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings)
  document.getElementById('history-clear-btn')?.addEventListener('click', clearHistory)
  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportData('csv'))
  document.getElementById('export-json-btn')?.addEventListener('click', () => exportData('json'))

  // Profiles modal buttons
  document.getElementById('profiles-save-btn')?.addEventListener('click', saveCurrentProfile)
  document.getElementById('profiles-export-btn')?.addEventListener('click', exportProfiles)
  document.getElementById('profiles-import-btn')?.addEventListener('click', importProfiles)
  document.getElementById('profiles-close-btn')?.addEventListener('click', closeProfiles)

  // Themes modal close button
  document.getElementById('themes-close-btn')?.addEventListener('click', window.closeThemes)

  // CSV modal buttons (wired by ID fallback — step3 also wires these when it renders)
  // The overlay close is handled above; the action buttons are wired in step3 on render

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const meta = e.metaKey || e.ctrlKey
    if (!meta) return
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    if (e.key === 'z' && !e.shiftKey && !inField) { e.preventDefault(); window.doUndo() }
    else if ((e.key === 'z' && e.shiftKey || e.key === 'y') && !inField) { e.preventDefault(); window.doRedo() }
    else if (e.key === ',') { e.preventDefault(); openSettings() }
    else if (e.key === 'n') { e.preventDefault(); window.startOver?.() }
  })
}

// ── BOOTSTRAP — call all step init() functions ────────────────────────────────

function bootstrap() {
  window.initStep1()
  window.initStep2()
  window.initStep3()
  window.initStep4()
  wireStaticHandlers()
}

// ── APP STARTUP ───────────────────────────────────────────────────────────────

async function init() {
  window.initTheme()
  if (window.api) window.S.port = await window.api.getPort()
  try {
    if (window.api) {
      window.S.apiKey = await window.api.loadApiKey() || ''
      if (!window.S.apiKey) {
        const legacy = localStorage.getItem('apiKey') || localStorage.getItem('sq-apikey') || ''
        if (legacy) {
          window.S.apiKey = legacy
          const result = await window.api.storeApiKey(legacy)
          localStorage.removeItem('apiKey')
          localStorage.removeItem('sq-apikey')
          if (!result.encrypted) {
            window.toast('API key stored. Note: OS-level encryption unavailable on this platform.', 'warn')
          }
        }
      }
    } else {
      window.S.apiKey = localStorage.getItem('apiKey') || ''
    }
    window.S.validity = localStorage.getItem('validity') || '30 days'
    window.S.samKey = localStorage.getItem('samKey') || ''
    const v = localStorage.getItem('vendor')
    if (v) Object.assign(window.S.vendor, JSON.parse(v))
  } catch(e) {}
  try {
    const sess = JSON.parse(localStorage.getItem('session') || 'null')
    if (sess && sess.step > 1 && (sess.extracted?.solicitation_number || sess.extracted?.project_title))
      window.S._pendingSession = sess
  } catch(e) {}
  window.render(1)
}

// Expose settings/modal functions globally so step modules and keyboard shortcuts can call them
window.openSettings = openSettings
window.closeSettings = closeSettings
window.saveSettings = saveSettings
window.renderHistory = renderHistory
window.clearHistory = clearHistory
window.openAiModal = openAiModal
window.closeAiModal = closeAiModal
window.saveAiKey = saveAiKey
window.openSamModal = openSamModal
window.closeSamModal = closeSamModal
window.openProfiles = openProfiles
window.closeProfiles = closeProfiles
window.exportData = exportData

bootstrap()
init()
