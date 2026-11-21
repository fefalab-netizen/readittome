export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
export const VOICE_CACHE = 'leaf-voices-' + new URL('./', import.meta.url).href;
export const VOICE_ASSETS = [
  './vendor/kokoro/package/dist/kokoro.web.js',
  './vendor/kokoro/ort-wasm-simd-threaded.jsep.mjs',
  './vendor/kokoro/ort-wasm-simd-threaded.jsep.wasm',
  './vendor/kokoro/package/voices/af_heart.bin',
  './vendor/kokoro/package/voices/am_michael.bin',
];
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
export const modelURL = file => `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`;
