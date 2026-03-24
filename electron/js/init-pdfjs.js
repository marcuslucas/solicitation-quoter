// init-pdfjs.js — sets PDF.js worker path after pdf.js UMD script loads
// Loaded as a plain <script src> (not module) — window.pdfjsLib is set by pdf.js UMD.
// Must use an absolute file:// URL for workerSrc — bare relative paths fail in Electron's
// file:// renderer when passed directly to new Worker(). Build the URL from location.href.
if (window.pdfjsLib) {
  const base = location.href.replace(/\/[^/]+$/, '/')
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'vendor/pdfjs/pdf.worker.js'
}
