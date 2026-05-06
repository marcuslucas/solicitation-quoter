// electron/js/state.js
// Loaded first via <script src>. Sets window.S for all step modules.

// ── STATE ────────────────────────────────────────────────────────────────────
const S = {
  step: 1, done: new Set(), port: null,
  apiKey: '', validity: '30 days',
  samKey: '', samNoticeId: '',
  file: null, filePath: null,
  extracted: {},
  vendor: {
    company_name:'', address:'', city_state_zip:'', phone:'', email:'',
    website:'', prepared_by:'', title:'', quote_number:'', sam_uei:'',
    validity_period:'30 days', freight:'', tax_rate:'', notes:'',
    terms:'Net 30. FOB Destination. Vendor certifies SAM.gov registration and compliance with all applicable solicitation requirements.',
    logo_b64:'', logo_ext:'', logo_name:'',
    delivery_days:'',
    option_years_enabled: false,
    option_years: [],
    line_item_schema: 'standard',
    include_signature: true,
    include_notes: true
  },
  aiUsage: { calls: 0, tokens: 0 },
  items: []
}

const TITLES = {1:'Upload Solicitation',2:'Review Extracted Data',3:'Company Info & Quote Lines',4:'Generate & Export'}

window.S = S
window.TITLES = TITLES
