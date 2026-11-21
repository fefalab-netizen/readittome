// A small cancellation-safe adapter around browser speech. Boundary offsets are
// relative to the original passage, including when resuming midway through it.
export class BrowserNarrator {
  constructor(synth, Utterance) { this.synth = synth; this.Utterance = Utterance; this.token = 0; this.utterance = null; }
  speak(text, { offset = 0, voice, rate = 1, boundary, end, error }) {
    this.stop();
    const token = this.token;
    const utterance = new this.Utterance(text.slice(offset));
    this.utterance = utterance;
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    utterance.rate = rate;
    utterance.onboundary = event => {
      if (token === this.token && Number.isFinite(event.charIndex)) boundary?.(offset + event.charIndex, event.charLength || 0);
    };
    utterance.onend = () => { if (token === this.token) { this.utterance = null; end?.(); } };
    utterance.onerror = event => { if (token === this.token) { this.utterance = null; error?.(event.error); } };
    this.synth.speak(utterance);
  }
  stop() { this.token++; this.synth?.cancel(); this.utterance = null; }
}
