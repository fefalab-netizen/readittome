import { chunks, extractLines } from './text.js';
import { readPageText } from './pdf-text.js';
import { buildSegments } from './cleanup.js';
import { APP_VERSION, normalizeBook, wordStart, movePassage, sortedBooks, bookmarkAt, relocate } from './reader-state.js';
import { BrowserNarrator } from './narrator.js';
import { LocalVoice } from './local-voice.js';
import { setupUpdates } from './updates.js';

const $ = id => document.getElementById(id);
const synth = window.speechSynthesis;
const browserVoice = new BrowserNarrator(synth, window.SpeechSynthesisUtterance);
const localVoice = new LocalVoice(text => { $('local-state').textContent = text; });
let books = [], current = null, db = null, voices = [], playing = false, generation = 0, importing = false;
let pdfModule, localKey = '', localPending, sleepDeadline = 0, wakeLock, wakeRequest, lastSaved = 0, activeWord = -1, loadingVoice = false, initialized = false;
const say = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const prefs = { get(key) { try { return localStorage.getItem('leaf-' + key); } catch { return null; } }, set(key, value) { try { localStorage.setItem('leaf-' + key, value); } catch {} } };
$('version').textContent = `Leaf ${APP_VERSION}`;

function transaction(mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', mode), request = fn(tx.objectStore('books'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Storage interrupted'));
  });
}
async function save(book = current) {
  if (!db || !book) return false;
  try { await transaction('readwrite', store => store.put(book)); return true; }
  catch { say('Could not save to browser storage. You can listen now, but changes may not be here next time.', true); return false; }
}
function pause(message = '') {
  playing = false; generation++; browserVoice.stop(); localVoice.pause();
  updateControls(); syncWake(); save(); renderLibrary(); if (message) say(message);
}
function stop() { pause(); localVoice.stop(); localKey = ''; activeWord = -1; }
function localSelected() { return $('voice').value.startsWith('local:'); }
function updateControls() {
  const available = !!current?.segments.length;
  $('play').disabled = !available || (!synth && !localSelected());
  $('back').disabled = !available || current.cursor <= 0;
  $('forward').disabled = !available || current.cursor >= current.segments.length - 1;
  $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Listen';
  const fraction = available && current.segments[current.cursor] ? (current.offset || 0) / Math.max(1, current.segments[current.cursor].text.length) : 0;
  const percent = available ? Math.min(100, Math.round((current.cursor + fraction) / current.segments.length * 100)) : 0;
  $('progress').value = percent; $('percent').textContent = percent + '%';
  $('position').textContent = available ? (current.cursor >= current.segments.length ? 'Finished · Listen to start again' : `Passage ${current.cursor + 1} of ${current.segments.length}`) : 'Nothing queued';
  $('add-bookmark').disabled = !available || current.cursor >= current.segments.length;
  $('reclean').disabled = !current?.rawPages || importing;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}
function button(label, handler, className = '') {
  const node = document.createElement('button'); node.textContent = label; node.onclick = handler; node.className = className; return node;
}
function renderLibrary() {
  $('book-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;
  $('library').replaceChildren();
  for (const book of sortedBooks(books, $('search').value, $('sort').value)) {
    const card = document.createElement('div'); card.className = 'book' + (book.id === current?.id ? ' selected' : '');
    const open = button('', () => selectBook(book), 'book-open');
    const title = document.createElement('strong'); title.textContent = book.title; open.title = book.title;
    const info = document.createElement('small'); info.textContent = `${book.pageCount} pages · ${Math.round(book.cursor / book.segments.length * 100)}% read${book.lastListened ? ' · ' + new Date(book.lastListened).toLocaleDateString() : ''}`;
    open.append(title, info);
    const actions = document.createElement('div'); actions.className = 'book-actions';
    const rename = button('Rename', async () => {
      const name = prompt('Book title', book.title); if (!name?.trim()) return;
      book.title = name.trim().slice(0, 200); await save(book); renderLibrary();
      if (current?.id === book.id) $('book-title').textContent = book.title;
    });
    rename.setAttribute('aria-label', `Rename ${book.title}`);
    const remove = button('Remove', async () => {
      if (!confirm(`Remove “${book.title}” and its bookmarks from this browser?`)) return;
      // Stop before deleting, so a pending playback callback cannot recreate it.
      if (current?.id === book.id) stop();
      if (db) { try { await transaction('readwrite', store => store.delete(book.id)); } catch { say('Could not remove this book. Please try again.', true); return; } }
      books = books.filter(x => x.id !== book.id);
      if (current?.id === book.id) {
        current = null;
        if (books.length) selectBook(books[0]);
        else { $('empty').hidden = false; $('reading').hidden = true; $('book-title').textContent = 'A good read starts here.'; $('page-count').textContent = '—'; updateControls(); prefs.set('last', ''); }
      }
      renderLibrary();
    });
    remove.setAttribute('aria-label', `Remove ${book.title}`);
    actions.append(rename, remove); card.append(open, actions); $('library').append(card);
  }
  if (!$('library').children.length && books.length) { const p = document.createElement('p'); p.textContent = 'No matching titles.'; $('library').append(p); }
}
function selectBook(book) {
  stop(); current = book; prefs.set('last', book.id);
  $('empty').hidden = true; $('reading').hidden = false; $('book-title').textContent = book.title;
  $('page-count').textContent = `${book.pageCount} pages`;
  $('page').replaceChildren();
  for (let i = 1; i <= book.pageCount; i++) $('page').add(new Option(String(i), String(i)));
  renderPage(book.segments[Math.min(book.cursor, book.segments.length - 1)].page);
  updateControls(); renderLibrary(); renderBookmarks();
}
function renderPage(page) {
  $('page').value = String(page); $('prev-page').disabled = page <= 1; $('next-page').disabled = page >= current.pageCount;
  $('passages').replaceChildren();
  current.segments.forEach((segment, index) => {
    if (segment.page !== page) return;
    const node = button(segment.text, () => seek(index, 0, true), 'passage'); node.dataset.index = index;
    $('passages').append(node);
  });
  if (!$('passages').children.length) { const p = document.createElement('p'); p.className = 'blank-page'; p.textContent = 'No readable text on this page. Scanned pages are not supported.'; $('passages').append(p); }
  highlight();
}
function highlight() {
  if (!current) return;
  for (const node of $('passages').querySelectorAll('.passage')) {
    const index = Number(node.dataset.index), active = index === current.cursor, text = current.segments[index].text;
    node.classList.toggle('active', active); node.setAttribute('aria-current', active ? 'true' : 'false');
    if (active && activeWord >= 0 && !localSelected()) {
      const length = text.slice(activeWord).match(/^\S+/u)?.[0].length || 1;
      const mark = document.createElement('mark'); mark.textContent = text.slice(activeWord, activeWord + length);
      node.replaceChildren(document.createTextNode(text.slice(0, activeWord)), mark, document.createTextNode(text.slice(activeWord + length)));
    } else node.textContent = text;
    if (active && playing && $('follow').checked) {
      const parent = $('passages'), rect = node.getBoundingClientRect(), box = parent.getBoundingClientRect();
      if (rect.top < box.top || rect.bottom > box.bottom) parent.scrollTop += rect.top - box.top - 24;
    }
  }
}
function seek(cursor, offset = 0, resume = playing) {
  stop(); current.cursor = Math.max(0, Math.min(current.segments.length, cursor));
  current.offset = wordStart(current.segments[current.cursor]?.text || '', offset); activeWord = current.offset;
  const segment = current.segments[Math.min(current.cursor, current.segments.length - 1)];
  renderPage(segment.page); updateControls(); save(); if (resume) start();
}
function renderBookmarks() {
  $('bookmarks').replaceChildren(); $('bookmark-count').textContent = `${current.bookmarks.length} saved`;
  for (const mark of current.bookmarks) {
    const row = document.createElement('div'); row.className = 'bookmark-row';
    const go = button(`${mark.label} · p. ${mark.page}`, () => seek(mark.cursor, mark.offset, false));
    const remove = button('Remove', () => { current.bookmarks = current.bookmarks.filter(x => x.id !== mark.id); save(); renderBookmarks(); });
    remove.setAttribute('aria-label', `Remove bookmark ${mark.label}`); row.append(go, remove); $('bookmarks').append(row);
  }
}
function advance(token) {
  if (!playing || token !== generation) return;
  current.cursor++; current.offset = 0; activeWord = -1; localKey = ''; localVoice.stop(); save();
  if (current.cursor >= current.segments.length) { pause('You’ve reached the end.'); return; }
  speakPassage(token);
}
async function speakPassage(token) {
  if (!playing || token !== generation) return;
  const segment = current.segments[current.cursor];
  if (!segment) { pause('You’ve reached the end.'); return; }
  if ((current.offset || 0) >= segment.text.length) { advance(token); return; }
  if (Number($('page').value) !== segment.page && $('follow').checked) renderPage(segment.page);
  highlight(); updateControls(); save();
  const rate = Number($('rate').value);
  if (localSelected()) {
    try {
      if (!localVoice.ready) throw new Error('Load the downloaded voice first, or select a browser voice.');
      const voice = $('voice').value.slice(6), key = `${current.id}:${current.cursor}:${current.offset}:${voice}`;
      if (localKey !== key || !localVoice.audio) {
        say('Preparing this passage with your local voice…');
        if (localPending?.key !== key) localPending = { key, promise: localVoice.generate(segment.text.slice(current.offset), voice) };
        const data = await localPending.promise;
        if (!playing || token !== generation) return;
        localVoice.setAudio(data); localKey = key;
      }
      if (!playing || token !== generation) return;
      await localVoice.unlock();
      if (!playing || token !== generation) return;
      localVoice.play(rate, () => advance(token)); say('Listening with a local AI voice.');
    } catch (error) { if (token === generation) { pause(); say(error.message, true); if (!localVoice.ready) loadVoices(); } }
  } else {
    browserVoice.speak(segment.text, { offset: current.offset || 0, voice: voices.find(v => v.voiceURI === $('voice').value), rate,
      boundary: offset => {
        if (token !== generation || !playing) return;
        current.offset = wordStart(segment.text, offset); activeWord = current.offset; highlight(); updateControls();
        if (Date.now() - lastSaved > 1500) { lastSaved = Date.now(); save(); }
      }, end: () => advance(token), error: error => { if (token === generation) { pause(); say(`Speech stopped (${error}). Try another voice, then tap Listen.`, true); } },
    });
  }
}
function start() {
  if (!current || playing) return;
  if (sleepDeadline && Date.now() >= sleepDeadline) { expireSleep(); return; }
  if (current.cursor >= current.segments.length) { current.cursor = 0; current.offset = 0; }
  if (localSelected()) {
    if (!localVoice.ready) { say('Load the local voices first, or choose a browser voice.', true); return; }
    // Unlock audio directly within the user gesture; inference follows later.
    try { localVoice.unlock().catch(error => { pause(); say(error.message, true); }); } catch (error) { say(error.message, true); return; }
  } else if (!synth) { say('This browser does not support built-in speech. Try the downloadable voice.', true); return; }
  current.lastListened = Date.now(); playing = true; const token = ++generation;
  syncWake(); renderLibrary(); updateControls(); speakPassage(token);
}
function voiceNote() {
  if (localSelected()) { $('voice-note').textContent = 'English AI voice · processed on this device. Pause resumes the same audio within this session; reloading resumes the passage.'; return; }
  const voice = voices.find(v => v.voiceURI === $('voice').value);
  $('voice-note').textContent = (voice?.localService ? 'Reported as an on-device voice.' : 'This voice may send text to an online speech service.') + ' Resume uses word boundaries where supported; otherwise it repeats the current passage.';
}
function loadVoices() {
  const selected = $('voice').value || prefs.get('voice') || '';
  voices = synth?.getVoices() || []; $('voice').replaceChildren(new Option('Device default', ''));
  for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · local' : ' · online'}`, voice.voiceURI));
  if (localVoice.ready) for (const [id, name] of [['af_heart', 'Heart'], ['am_michael', 'Michael']]) $('voice').add(new Option(`${name} · English · downloaded AI`, `local:${id}`));
  if ([...$('voice').options].some(option => option.value === selected)) $('voice').value = selected;
  voiceNote(); updateControls();
}
const cleanupOptions = () => ({ margins: $('clean-margins').checked, numbers: $('clean-numbers').checked });
function rebuildBook(book, segments) {
  const old = book.segments[book.cursor];
  const position = old ? relocate(segments, { ...old, offset: book.offset }) : { cursor: segments.length, offset: 0 };
  const bookmarks = book.bookmarks.map(mark => ({ ...mark, ...relocate(segments, mark) })).filter(mark => mark.cursor < segments.length);
  Object.assign(book, { segments, ...position, bookmarks });
}
async function importFiles(files) {
  if (importing || !initialized) return;
  importing = true; $('file').disabled = true; $('dropzone').setAttribute('aria-busy', 'true'); updateControls();
  try {
    for (const file of files) {
      let task;
      try {
        if (!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
        if (file.size > 40 * 1024 * 1024) throw new Error('This PDF is over the 40 MB limit.');
        say(`Opening ${file.name}…`);
        pdfModule ||= await import('./vendor/package/legacy/build/pdf.mjs');
        pdfModule.GlobalWorkerOptions.workerSrc = new URL('./vendor/package/legacy/build/pdf.worker.mjs', import.meta.url).href;
        const data = new Uint8Array(await file.arrayBuffer());
        const digest = await crypto.subtle.digest('SHA-256', data);
        const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        const existing = books.find(b => b.id === id);
        if (existing?.rawPages) { selectBook(existing); say('This PDF is already in your library.'); continue; }
        task = pdfModule.getDocument({ data, isEvalSupported: false, cMapUrl: new URL('./vendor/package/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/package/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/package/wasm/', import.meta.url).href });
        const pdf = await task.promise; // PasswordException is reported without leaving an unresolved callback.
        const rawPages = []; let blank = 0;
        for (let page = 1; page <= pdf.numPages; page++) {
          say(`Reading ${file.name} · page ${page} of ${pdf.numPages}…`);
          const pdfPage = await pdf.getPage(page), content = await readPageText(pdfPage), text = extractLines(content.items);
          if (!text.trim()) blank++; rawPages.push({ page, text }); pdfPage.cleanup();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const result = buildSegments(rawPages, cleanupOptions());
        if (!result.segments.length) throw new Error(rawPages.some(p => p.text.trim()) ? 'Cleanup removed all text. Turn off text cleanup and import again.' : 'No readable text found. Scanned PDFs are not supported.');
        let book;
        if (existing) { if (current?.id === id) stop(); rebuildBook(existing, result.segments); existing.rawPages = rawPages; book = existing; }
        else { book = normalizeBook({ id, title: file.name.replace(/\.pdf$/i, ''), pageCount: pdf.numPages, segments: result.segments, rawPages, cursor: 0, added: Date.now() }); books.unshift(book); }
        book.cleanup = cleanupOptions(); const saved = await save(book); selectBook(book);
        say(`Added “${book.title}”. Skipped ${result.removed} margin lines${blank ? ` and ${blank} empty pages` : ''}.${saved ? '' : ' Browser storage unavailable; keep your original PDF.'}`, !saved);
      } catch (error) { say(`${file.name}: ${/password/i.test(error.message) ? 'Password-protected PDFs are not supported.' : error.message || 'Could not read this PDF.'}`, true); }
      finally { if (task) await task.destroy().catch(() => {}); }
    }
  } finally { importing = false; $('file').disabled = false; $('file').value = ''; $('dropzone').removeAttribute('aria-busy'); updateControls(); }
}

async function syncWake() {
  const wanted = playing && $('keep-awake').checked && document.visibilityState === 'visible';
  if (!wanted) { await wakeLock?.release().catch(() => {}); wakeLock = null; return; }
  if (!navigator.wakeLock) { $('wake-state').textContent = 'Screen wake lock is not available in this browser.'; return; }
  if (wakeLock || wakeRequest) return;
  wakeRequest = navigator.wakeLock.request('screen');
  try {
    const lock = await wakeRequest;
    if (!playing || !$('keep-awake').checked || document.visibilityState !== 'visible') { await lock.release(); return; }
    wakeLock = lock; $('wake-state').textContent = 'Keeping screen awake while listening.';
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; $('wake-state').textContent = 'Screen wake lock released.'; });
  } catch { $('wake-state').textContent = 'Could not keep the screen awake. Device settings may prevent it.'; }
  finally { wakeRequest = null; }
}
function expireSleep() { sleepDeadline = 0; $('sleep').value = '0'; $('sleep-status').textContent = 'Timer finished'; pause('Sleep timer finished. Your place is saved.'); }
function tickSleep() {
  if (!sleepDeadline) return;
  if (Date.now() >= sleepDeadline) { expireSleep(); return; }
  const seconds = Math.ceil((sleepDeadline - Date.now()) / 1000);
  $('sleep-status').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining`;
}
$('sleep').onchange = () => { sleepDeadline = Number($('sleep').value) ? Date.now() + Number($('sleep').value) * 60000 : 0; $('sleep-status').textContent = ''; tickSleep(); };
setInterval(tickSleep, 1000);
document.addEventListener('visibilitychange', () => { tickSleep(); syncWake(); if (current) save(); });

for (const id of ['follow', 'keep-awake', 'clean-margins', 'clean-numbers']) {
  const value = prefs.get(id); if (value !== null) $(id).checked = value === 'true';
  $(id).onchange = () => { prefs.set(id, $(id).checked); if (id === 'keep-awake') syncWake(); if (id === 'follow') { if ($(id).checked && current?.segments[current.cursor]) renderPage(current.segments[current.cursor].page); highlight(); } };
}
const media = window.matchMedia('(prefers-color-scheme: dark)');
function appearance() { document.documentElement.dataset.theme = $('theme').value === 'system' ? (media.matches ? 'dark' : 'light') : $('theme').value; document.documentElement.style.setProperty('--reader-size', `${$('font-size').value}px`); }
for (const id of ['theme', 'font-size', 'sort', 'rate']) {
  const saved = prefs.get(id); if ([...$(id).options].some(option => option.value === saved)) $(id).value = saved;
}
for (const id of ['theme', 'font-size']) $(id).onchange = () => { prefs.set(id, $(id).value); appearance(); };
media.addEventListener?.('change', appearance); appearance();
$('search').oninput = renderLibrary; $('sort').onchange = () => { prefs.set('sort', $('sort').value); renderLibrary(); };
$('reclean').onclick = async () => {
  if (!current?.rawPages) return;
  const result = buildSegments(current.rawPages, cleanupOptions());
  if (!result.segments.length) { say('Cleanup would remove all text. Disable the cleanup options and try again.', true); return; }
  stop(); rebuildBook(current, result.segments); current.cleanup = cleanupOptions(); await save(); selectBook(current); say(`Text rebuilt. Skipped ${result.removed} margin lines. Your original extracted text is retained.`);
};
$('add-bookmark').onclick = () => {
  const label = prompt('Bookmark name', `Page ${current.segments[current.cursor].page}`); if (label === null) return;
  const mark = bookmarkAt(current, label.slice(0, 120), crypto.randomUUID()); if (mark) { current.bookmarks.push(mark); save(); renderBookmarks(); }
};
$('file').onchange = event => importFiles([...event.target.files]);
$('dropzone').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!importing) $('file').click(); } };
for (const eventName of ['dragenter', 'dragover']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); importFiles([...event.dataTransfer.files]); };
$('play').onclick = () => playing ? pause('Paused. Your place is saved.') : start();
for (const [id, delta] of [['back', -1], ['forward', 1]]) $(id).onclick = () => { const next = movePassage(current, delta); seek(next.cursor); };
function changePage(page) { const index = current.segments.findIndex(x => x.page >= page); seek(index < 0 ? current.segments.length : index, 0, false); renderPage(page); }
$('page').onchange = () => changePage(Number($('page').value));
$('prev-page').onclick = () => changePage(Number($('page').value) - 1);
$('next-page').onclick = () => changePage(Number($('page').value) + 1);
$('voice').onchange = () => { const resume = playing; stop(); prefs.set('voice', $('voice').value); voiceNote(); if (resume) start(); };
$('rate').onchange = () => { const resume = playing; pause(); prefs.set('rate', $('rate').value); if (resume) start(); };
$('download-voice').onclick = async () => {
  if (loadingVoice) return;
  loadingVoice = true; $('download-voice').disabled = true; $('cancel-voice').hidden = false;
  try {
    $('local-state').textContent = 'Downloading and testing local voices. This may take several minutes.';
    await localVoice.load(); stop(); loadVoices(); $('voice').value = 'local:af_heart'; prefs.set('voice', $('voice').value); voiceNote(); updateControls();
    const cached = await localVoice.cached();
    $('local-state').textContent = 'Heart and Michael passed a local synthesis test. ' + (cached ? 'Files are saved for offline use. Select a voice and tap Listen.' : 'Some files could not be cached. These voices work this session but may need internet next time.');
    $('download-voice').textContent = 'Local voices loaded';
  } catch (error) { localVoice.cancel(); loadVoices(); $('local-state').textContent = error.name === 'AbortError' ? 'Download canceled. Browser voices remain available.' : error.message; }
  finally { loadingVoice = false; $('download-voice').disabled = localVoice.ready; $('cancel-voice').hidden = true; }
};
$('cancel-voice').onclick = () => localVoice.cancel();
$('remove-voice').onclick = async () => {
  if (!confirm('Remove the downloaded AI voice files? Your PDF library will stay.')) return;
  if (localSelected()) stop();
  try { await localVoice.remove(); localKey = ''; localPending = null; loadVoices(); $('download-voice').disabled = false; $('download-voice').textContent = 'Download & test voices'; $('local-state').textContent = 'Voice download removed. Browser voices remain available.'; }
  catch (error) { $('local-state').textContent = error.message; }
};
$('sample').onclick = async () => {
  let sample = books.find(b => b.id === 'leaf-sample');
  if (!sample) {
    const rawPages = [
      { page: 1, text: 'There is a particular kind of quiet that arrives when we give one thing our full attention. A page. A voice. The afternoon light moving across a wall. We do not always need to do more. Sometimes, we need to notice more. Welcome to Leaf, a small space for your books and ideas. You can listen at your own pace, change the voice, or tap a passage to begin there.' },
      { page: 2, text: 'A good idea can find you anywhere. While you make a cup of tea, sit by a window, or take a moment between the busy parts of your day. Bring a text-based PDF into your library to make it your next listen. Your reading position is saved in this browser, so you can return to it another day. For now, take a breath. There is no hurry to turn the page.' },
    ];
    sample = normalizeBook({ id: 'leaf-sample', title: 'The art of paying attention', pageCount: 2, cursor: 0, added: Date.now(), rawPages, segments: rawPages.flatMap(p => chunks(p.text).map(text => ({ page: p.page, text }))) });
    books.unshift(sample); await save(sample);
  }
  selectBook(sample); say('Choose a voice and tap Listen.');
};
window.addEventListener('pagehide', () => pause());
async function init() {
  $('file').disabled = true; $('sample').disabled = true;
  try {
    db = await new Promise((resolve, reject) => { const request = indexedDB.open('leaf-library', 1); request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    books = (await transaction('readonly', store => store.getAll())).map(normalizeBook).filter(book => book.segments.length);
  } catch { db = null; say('Browser storage unavailable. Your library will only last for this session.', true); }
  initialized = true; $('file').disabled = false; $('sample').disabled = false;
  renderLibrary(); const last = books.find(b => b.id === prefs.get('last')); if (last) selectBook(last);
  loadVoices(); synth?.addEventListener('voiceschanged', loadVoices); updateControls();
  localVoice.cached().then(cached => { if (cached && !loadingVoice) { $('download-voice').textContent = 'Load saved AI voices'; $('local-state').textContent = 'Voice files are saved on this device. Load them to use local narration.'; } }).catch(() => {});
  setupUpdates({ say, beforeUpdate: async () => { if (importing || loadingVoice) throw new Error('Finish the import or voice download before updating.'); pause(); await save(); } });
  if ('mediaSession' in navigator) for (const [action, handler] of Object.entries({ play: start, pause: () => pause(), previoustrack: () => current && seek(movePassage(current, -1).cursor), nexttrack: () => current && seek(movePassage(current, 1).cursor) })) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
}
init();
