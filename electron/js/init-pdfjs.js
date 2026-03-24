// init-pdfjs.js — loads PDF.js ES module and exposes it as window.pdfjsLib
// Loaded via <script src="js/init-pdfjs.js" type="module"> in index.html
// import.meta.url resolves to the absolute file:// URL of this script,
// allowing the worker path to resolve correctly in Electron.
import * as pdfjsLib from '../vendor/pdfjs/pdf.mjs'
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href
window.pdfjsLib = pdfjsLib
