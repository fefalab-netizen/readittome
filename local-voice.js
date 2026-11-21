import { VOICE_ASSETS, VOICE_CACHE, MODEL_FILES, modelURL } from './voice-config.js';

export class LocalVoice {
  constructor(onStatus) { this.onStatus = onStatus; this.pending = new Map(); this.sequence = 0; this.ready = false; this.source = null; this.audio = null; this.elapsed = 0; this.run = 0; this.loadToken = 0; }
  async cached() {
    if (!globalThis.caches) return false;
    const cache = await caches.open(VOICE_CACHE);
    const urls = [...VOICE_ASSETS.map(path => new URL(path, import.meta.url).href), ...MODEL_FILES.map(modelURL)];
    return (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
  }
  async load() {
    if (this.ready) return;
    const token = ++this.loadToken;
    this.abort = new AbortController();
    const cache = await caches.open(VOICE_CACHE);
    for (const path of VOICE_ASSETS) {
      if (token !== this.loadToken) throw new Error('Voice download canceled.');
      const url = new URL(path, import.meta.url).href;
      if (!(await cache.match(url))) {
        this.onStatus('Downloading voice runtime…');
        const response = await fetch(url, { signal: this.abort.signal });
        if (!response.ok) throw new Error(`Missing voice file (${response.status}): ${path}`);
        await cache.put(url, response);
      }
    }
    if (token !== this.loadToken) throw new Error('Voice download canceled.');
    this.worker = new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { this.onStatus(data.text); return; }
      const pending = this.pending.get(data.id); if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timeout);
      data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
    };
    this.worker.onerror = () => this.cancel('Local voice could not run in this browser. Try a browser voice.');
    await this.request('init', {}, 600000);
    if (token !== this.loadToken) throw new Error('Voice download canceled.');
    this.ready = true;
  }
  request(type, fields, milliseconds = 180000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => { this.cancel('Voice processing timed out. This device may be too slow; try a browser voice.'); }, milliseconds);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, type, ...fields });
    });
  }
  unlock() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support local audio playback.');
    this.context ||= new Context();
    // Called synchronously from the Listen gesture, before model inference.
    return this.context.resume();
  }
  async generate(text, voice) { return this.request('generate', { text, voice }); }
  setAudio(data) {
    this.stop();
    this.audio = this.context.createBuffer(1, data.samples.length, data.rate);
    this.audio.copyToChannel(data.samples, 0); this.elapsed = 0;
  }
  play(rate, onEnd) {
    if (!this.audio) return;
    const token = ++this.run;
    this.source = this.context.createBufferSource(); this.source.buffer = this.audio;
    this.source.playbackRate.value = rate; this.source.connect(this.context.destination);
    this.started = this.context.currentTime; this.rate = rate;
    this.source.onended = () => { if (token === this.run) { this.source = null; this.elapsed = this.audio.duration; onEnd(); } };
    this.source.start(0, Math.min(this.elapsed, this.audio.duration));
  }
  pause() {
    if (!this.source) return;
    this.elapsed = Math.min(this.audio.duration, this.elapsed + (this.context.currentTime - this.started) * this.rate);
    this.run++; this.source.stop(); this.source.disconnect(); this.source = null;
  }
  stop() { this.pause(); this.audio = null; this.elapsed = 0; }
  cancel(message = 'Voice download canceled.') {
    this.loadToken++; this.abort?.abort(); this.worker?.terminate(); this.worker = null; this.ready = false; this.stop();
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(message)); }
    this.pending.clear();
  }
  async remove() { this.cancel(); await caches.delete(VOICE_CACHE); }
}
