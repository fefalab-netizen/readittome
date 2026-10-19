# Leaf — PDF listener

A static, mobile-friendly PDF read-aloud prototype. Upload this folder's contents to GitHub Pages. No server, API key, account system, package installation, or build step is required. PDF.js is vendored locally.

## Put it on GitHub Pages

1. Create a repository and upload **everything inside this folder**, preserving subfolders (especially `vendor/package`). `index.html` should be at the repository root. Upload the extracted files, not just the ZIP.
2. In repository **Settings → Pages**, choose **Deploy from a branch**, then your branch (usually `main`) and **/(root)**, and save.
3. Open the HTTPS Pages address after deployment. On iPhone, use Safari. Tap **Try a short sample**, select a voice, then **Listen**. Next, use **Bring a PDF** to select one from Files.
4. Optional: Safari **Share → Add to Home Screen**. Browser/OS versions may use slightly different labels.

If you keep `pdf-listener` as a subfolder in an existing Pages repository, open `https://YOUR-NAME.github.io/YOUR-REPO/pdf-listener/`. All assets, the worker, and the manifest use relative URLs for project/subfolder hosting.

Do not double-click `index.html`: browser security restrictions prevent PDF modules and workers from working correctly under `file://`. Use GitHub Pages. This project does not start a local server or open a port.

## Included

- Multiple PDF imports, drag-and-drop on desktop, duplicate detection, 40 MB per-file limit.
- Local IndexedDB library of **extracted text**, page numbers, and listening positions. Original PDF bytes are not retained; this is a text reader, not an original-layout PDF viewer.
- Page selection, clickable passages, previous/next passage, play/pause, speed and voice selection.
- Pause resumes from the beginning of the current passage, rather than the exact word. Short passages help reduce repeated speech.
- Local PDF processing using Mozilla PDF.js 6.4.299. PDF text is inserted as text, never HTML.
- Offline app cache after the first successful load; saved library is specific to the browser/device. No cloud sync.
- Original built-in sample, mobile layout, keyboard controls, status announcements, reduced-motion support.

## Prototype limits

- Uses browser/OS speech voices, **not bundled neural voices**. A voice marked `local` is reported as local by the browser; test actual offline playback in airplane mode. Other voices may send text to the device/browser speech provider. No text or PDFs are uploaded by the app itself.
- Keep the page open while listening. Safari may suspend speech on lock or when backgrounded. This is not guaranteed background audiobook playback.
- Text-based PDFs only. Scans and password-protected PDFs are not supported. Blank/image-only pages in mixed PDFs are skipped. OCR is deliberately deferred.
- PDF content order is preserved; columns, equations, tables, and repeating headers may not read naturally. No AI cleanup or layout reconstruction.
- Browser storage can be cleared/evicted, and private browsing may prevent persistence. Keep your original files. The app does not claim to be a permanent backup.
- Modern browsers required. iPhone Safari/device voice behavior needs real-device testing.

## Checks without opening a port

With Node.js 22.13+ installed, run from this folder:

```sh
node --check app.js
node --test test/*.test.mjs
```

After changing app files or dependencies, regenerate the committed offline asset manifest:

```sh
node prepare-offline.mjs
```

Then upload the changed files together. An already-open tab may need to be closed/reopened after an update. The service worker uses a content hash to version its cache.

## Test on your iPhone

1. Play the sample and try each voice/speed setting.
2. Import a normal text PDF, pause, change pages, and tap a passage.
3. Reload and check that the library and listening position return.
4. Wait for **App ready offline**, then try airplane mode using a local voice.
5. Try a scanned PDF: it should report no readable text, without adding an empty book.
6. Check locked-screen behavior separately; it is browser-dependent.

## Dependencies and licenses

Mozilla PDF.js: https://github.com/mozilla/pdf.js — Apache-2.0. License included at `vendor/package/LICENSE`. Supporting font/WASM license files remain alongside their assets. Package provenance and exact release metadata are in `vendor/package-info.json`. The download integrity is verified against that metadata during preparation. No CDN requests, external fonts, analytics, or backend are used.

Browser visual testing and iPhone audio testing have not been performed in this workspace. No preview server was launched.
