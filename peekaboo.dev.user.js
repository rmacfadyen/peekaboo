// ==UserScript==
// @name         Peekaboo (dev)
// @namespace    https://github.com/rmacfadyen/peekaboo
// @version      0.1.0
// @description  Capture screenshots, freehand annotations and spoken narration, exported as a ZIP for an AI coding agent.
// @author       Robert MacFadyen
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        none
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/config.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/store.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/zip.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/audio.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/capture.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/annotate.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/exporter.js
// @require      file:///C:/Users/Robert/source/repos/peekaboo/src/main.js
// ==/UserScript==

// Development entry point. All code lives in src/ and is loaded through the @require
// lines above, in that order; main.js starts Peekaboo. Edit the files in src/, then
// reload the page under test. If the repository is somewhere else, change the paths.
