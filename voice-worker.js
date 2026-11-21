import { MODEL_ID, MODEL_REVISION, VOICE_CACHE } from './voice-config.js';
let tts;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, type } = data;
    try {
      if (type === 'init') {
        const { KokoroTTS, env, transformersEnv } = await import('./vendor/kokoro/package/dist/kokoro.web.js');
        env.wasmPaths = new URL('./vendor/kokoro/', import.meta.url).href;
        transformersEnv.backends.onnx.wasm.numThreads = 1;
        transformersEnv.allowLocalModels = false;
        transformersEnv.useBrowserCache = false;
        transformersEnv.useFSCache = false;
        transformersEnv.useCustomCache = true;
        transformersEnv.customCache = await caches.open(VOICE_CACHE);
        transformersEnv.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
        tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm', progress_callback: progress => {
          self.postMessage({ type: 'progress', text: progress.status === 'progress' ? `Loading ${progress.file}: ${Math.round(progress.progress || 0)}%` : 'Preparing local voice…' });
        } });
        // Verify inference and both voice files before advertising availability.
        await tts.generate('Ready.', { voice: 'af_heart' });
        await tts.generate('Ready.', { voice: 'am_michael' });
        self.postMessage({ id, result: true });
      } else if (type === 'generate') {
        if (!tts) throw new Error('Load the local voice first.');
        const audio = await tts.generate(data.text, { voice: data.voice, speed: 1 });
        const samples = new Float32Array(audio.audio);
        self.postMessage({ id, result: { samples, rate: audio.sampling_rate } }, [samples.buffer]);
      }
    } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
  });
};
