import { chunks, extractLines } from './text.js';
import { readPageText } from './pdf-text.js';
const $ = id => document.getElementById(id);
const synth = window.speechSynthesis;
let books = [], current = null, db = null, voices = [], playing = false, generation = 0, importing = false, utterance = null;
let pdfModule;
const say = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const prefs = { get(key) { try { return localStorage.getItem('leaf-' + key); } catch { return null; } }, set(key, value) { try { localStorage.setItem('leaf-' + key, value); } catch {} } };
function transaction(mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', mode), request = fn(tx.objectStore('books'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Storage interrupted'));
  });
}
async function save(book) {
  if (!db) return false;
  try { await transaction('readwrite', store => store.put(book)); return true; }
  catch { say('Your browser could not save this book. You can listen now, but it may not be here next time. Free some storage and import it again.', true); return false; }
}
function stop() { playing = false; generation++; synth?.cancel(); utterance = null; updateControls(); }
function updateControls() {
  const available = !!current?.segments.length;
  $('play').disabled = !available || !synth;
  $('back').disabled = !available || current.cursor <= 0;
  $('forward').disabled = !available || current.cursor >= current.segments.length - 1;
  $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Listen';
  const percent = available ? Math.round(current.cursor / current.segments.length * 100) : 0;
  $('progress').value = percent; $('percent').textContent = percent + '%';
  $('position').textContent = available ? (current.cursor === current.segments.length ? 'Finished · press Listen to start again' : `Passage ${current.cursor + 1} of ${current.segments.length}`) : 'Nothing queued';
}
function renderLibrary() {
  $('book-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;
  $('library').replaceChildren();
  for (const book of books) {
    const card = document.createElement('div'); card.className = 'book' + (book.id === current?.id ? ' selected' : '');
    const open = document.createElement('button'); open.className = 'book-open';
    const title = document.createElement('strong'); title.textContent = book.title; open.title = book.title;
    const info = document.createElement('small'); info.textContent = `${book.pageCount} pages · ${Math.round(book.cursor / book.segments.length * 100)}% read`;
    open.append(title, info); open.onclick = () => selectBook(book);
    const remove = document.createElement('button'); remove.className = 'delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${book.title}`);
    remove.onclick = async () => {
      if (!confirm(`Remove “${book.title}” from this browser?`)) return;
      if (db) { try { await transaction('readwrite', store => store.delete(book.id)); } catch { say('Could not remove this book. Please try again.', true); return; } }
      books = books.filter(x => x.id !== book.id);
      if (current?.id === book.id) { stop(); current = null; if (books.length) selectBook(books[0]); else { $('empty').hidden = false; $('reading').hidden = true; $('book-title').textContent = 'A good read starts here.'; $('page-count').textContent = '—'; updateControls(); prefs.set('last', ''); } }
      renderLibrary();
    };
    card.append(open, remove); $('library').append(card);
  }
}
function selectBook(book) {
  stop(); current = book; prefs.set('last', book.id);
  $('empty').hidden = true; $('reading').hidden = false; $('book-title').textContent = book.title;
  $('page-count').textContent = `${book.pageCount} pages`;
  $('page').replaceChildren(...Array.from({ length: book.pageCount }, (_, i) => new Option(String(i + 1), String(i + 1))));
  renderPage(book.segments[Math.min(book.cursor, book.segments.length - 1)].page);
  updateControls(); renderLibrary();
}
function renderPage(page) {
  $('page').value = String(page); $('prev-page').disabled = page <= 1; $('next-page').disabled = page >= current.pageCount;
  $('passages').replaceChildren();
  current.segments.forEach((segment, index) => {
    if (segment.page !== page) return;
    const button = document.createElement('button'); button.className = 'passage'; button.dataset.index = index; button.textContent = segment.text;
    button.onclick = () => { stop(); current.cursor = index; save(current); speak(); };
    $('passages').append(button);
  });
  if (!$('passages').children.length) { const p = document.createElement('p'); p.className = 'blank-page'; p.textContent = 'No readable text on this page. Scanned pages are not supported yet.'; $('passages').append(p); }
  highlight();
}
function highlight() {
  for (const node of $('passages').querySelectorAll('.passage')) {
    const active = Number(node.dataset.index) === current.cursor;
    node.classList.toggle('active', active); node.setAttribute('aria-current', active ? 'true' : 'false');
    if (active && playing) $('passages').scrollTop = node.offsetTop - $('passages').offsetTop - 35;
  }
}
function speak() {
  if (!current || !synth) return;
  if (current.cursor >= current.segments.length) current.cursor = 0;
  playing = true; const token = ++generation;
  const next = () => {
    if (token !== generation || !playing) return;
    const segment = current.segments[current.cursor];
    if (!segment) { stop(); save(current); renderLibrary(); say('You’ve reached the end. A little more knowledge, a little more you.'); return; }
    if (Number($('page').value) !== segment.page) renderPage(segment.page);
    highlight(); updateControls(); save(current);
    utterance = new SpeechSynthesisUtterance(segment.text);
    const voice = voices.find(v => v.voiceURI === $('voice').value);
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    utterance.rate = Number($('rate').value);
    utterance.onend = () => { if (token !== generation) return; current.cursor++; next(); };
    utterance.onerror = event => { if (token !== generation) return; stop(); say(`Speech stopped (${event.error}). Try another voice, then tap Listen.`, true); };
    synth.speak(utterance);
  };
  next();
}
function voiceNote() {
  const voice = voices.find(v => v.voiceURI === $('voice').value);
  $('voice-note').textContent = voice?.localService ? 'Reported as an on-device voice. Test in airplane mode to confirm offline availability.' : 'This voice may use an online speech service. Text may be sent to that service.';
}
function loadVoices() {
  if (!synth) { say('This browser does not support read-aloud. Try Safari, Chrome, or Edge.', true); return; }
  const selected = $('voice').value || prefs.get('voice') || '';
  voices = synth.getVoices(); $('voice').replaceChildren(new Option('Device default', ''));
  for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · local' : ' · online'}`, voice.voiceURI));
  if (voices.some(v => v.voiceURI === selected)) $('voice').value = selected;
  voiceNote();
}
async function importFiles(files) {
  if (importing) return;
  importing = true; $('file').disabled = true; $('dropzone').setAttribute('aria-busy', 'true');
  for (const file of files) {
    let task;
    try {
      if (!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
      if (file.size > 40 * 1024 * 1024) throw new Error('This PDF is over the 40 MB limit. Try a smaller file.');
      say(`Opening ${file.name}…`);
      pdfModule ||= await import('./vendor/package/legacy/build/pdf.mjs');
      pdfModule.GlobalWorkerOptions.workerSrc = new URL('./vendor/package/legacy/build/pdf.worker.mjs', import.meta.url).href;
      const data = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', data);
      const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const existing = books.find(b => b.id === id);
      if (existing) { selectBook(existing); say('That PDF is already in your library. Your place is saved.'); continue; }
      task = pdfModule.getDocument({ data, isEvalSupported: false, cMapUrl: new URL('./vendor/package/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/package/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/package/wasm/', import.meta.url).href });
      task.onPassword = () => { task.destroy(); };
      const pdf = await task.promise;
      const segments = []; let blank = 0;
      for (let page = 1; page <= pdf.numPages; page++) {
        say(`Reading ${file.name} · page ${page} of ${pdf.numPages}…`);
        const pdfPage = await pdf.getPage(page), content = await readPageText(pdfPage);
        const parts = chunks(extractLines(content.items)); if (!parts.length) blank++;
        segments.push(...parts.map(text => ({ page, text }))); pdfPage.cleanup();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!segments.length) throw new Error('No readable text found. Scanned PDFs are not supported yet.');
      const book = { id, title: file.name.replace(/\.pdf$/i, ''), pageCount: pdf.numPages, segments, cursor: 0, added: Date.now() };
      books.unshift(book); const saved = await save(book); selectBook(book);
      say(`Added “${book.title}”.${blank ? ` ${blank} pages have no readable text and will be skipped.` : ''} Tap Listen when you’re ready.${saved ? '' : ' Could not save to browser storage: this book may only last for this session.'}`, !saved);
    } catch (error) { say(`${file.name}: ${/password|destroy/i.test(error.message) ? 'Password-protected PDFs are not supported yet.' : error.message || 'Could not read this PDF.'}`, true); }
    finally { if (task) await task.destroy().catch(() => {}); }
  }
  importing = false; $('file').disabled = false; $('file').value = ''; $('dropzone').removeAttribute('aria-busy');
}
$('file').onchange = event => importFiles([...event.target.files]);
$('dropzone').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!importing) $('file').click(); } };
for (const eventName of ['dragenter', 'dragover']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); importFiles([...event.dataTransfer.files]); };
$('play').onclick = () => { if (playing) { stop(); save(current); renderLibrary(); say('Paused. Listen resumes from the start of this passage.'); } else speak(); };
for (const [id, delta] of [['back', -1], ['forward', 1]]) $(id).onclick = () => { const resume = playing; stop(); current.cursor = Math.max(0, Math.min(current.segments.length - 1, current.cursor + delta)); renderPage(current.segments[current.cursor].page); updateControls(); save(current); if (resume) speak(); };
function changePage(page) { stop(); renderPage(page); const index = current.segments.findIndex(x => x.page >= page); current.cursor = index < 0 ? current.segments.length : index; highlight(); updateControls(); save(current); }
$('page').onchange = () => changePage(Number($('page').value));
$('prev-page').onclick = () => changePage(Number($('page').value) - 1);
$('next-page').onclick = () => changePage(Number($('page').value) + 1);
for (const id of ['voice', 'rate']) $(id).onchange = () => { prefs.set(id, $(id).value); voiceNote(); if (playing) { stop(); speak(); } };
if (['0.75', '1', '1.25', '1.5', '1.75', '2'].includes(prefs.get('rate'))) $('rate').value = prefs.get('rate');
$('sample').onclick = async () => {
  let sample = books.find(b => b.id === 'leaf-sample');
  if (!sample) {
    sample = { id: 'leaf-sample', title: 'The art of paying attention', pageCount: 2, cursor: 0, added: Date.now(), segments: [
      ...chunks('There is a particular kind of quiet that arrives when we give one thing our full attention. A page. A voice. The afternoon light moving across a wall. We do not always need to do more. Sometimes, we need to notice more. Welcome to Leaf, a small space for your books and ideas. You can listen at your own pace, change the voice, or tap a passage to begin there.').map(text => ({ page: 1, text })),
      ...chunks('A good idea can find you anywhere. While you make a cup of tea, sit by a window, or take a moment between the busy parts of your day. Bring a text-based PDF into your library to make it your next listen. Your reading position is saved in this browser, so you can return to it another day. For now, take a breath. There is no hurry to turn the page.').map(text => ({ page: 2, text })) ] };
    books.unshift(sample); await save(sample);
  }
  selectBook(sample); say('A short original sample. Choose a voice and tap Listen.');
};
window.addEventListener('pagehide', () => { if (current) save(current); stop(); });
async function init() {
  try {
    db = await new Promise((resolve, reject) => { const request = indexedDB.open('leaf-library', 1); request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    books = (await transaction('readonly', store => store.getAll())).sort((a, b) => b.added - a.added);
  } catch { db = null; say('Browser storage is unavailable. You can listen, but your library will only last for this session.', true); }
  renderLibrary(); const last = books.find(b => b.id === prefs.get('last')); if (last) selectBook(last);
  loadVoices(); synth?.addEventListener('voiceschanged', loadVoices); updateControls();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; $('offline-state').textContent = 'App ready offline · voice availability depends on your device'; }
    catch { $('offline-state').textContent = 'Offline caching unavailable. Keep an internet connection for loading the app.'; }
  } else $('offline-state').textContent = 'Offline app caching is not supported in this browser.';
}
init();
