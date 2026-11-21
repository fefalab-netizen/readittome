# Local voice dependencies

Kokoro.js 1.2.1 by hexgrad and contributors, Apache-2.0.
Source: https://github.com/hexgrad/kokoro/tree/664c76a704021239ba59c84dcbaa4d3dece01fe9/kokoro.js
License: `package/LICENSE`.

The published browser bundle contains Transformers.js 3.5.1 (Apache-2.0), ONNX Runtime Web (MIT), and phonemizer.js 1.2.1 (Apache-2.0 wrapper, based on eSpeak NG). Retained license files: `LICENSE-TRANSFORMERS`, `LICENSE-ONNXRUNTIME`, `LICENSE-PHONEMIZER`.

Dependency source and notices:
- https://github.com/huggingface/transformers.js/tree/3.5.1
- https://github.com/microsoft/onnxruntime
- https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt
- https://github.com/xenova/phonemizer.js
- https://github.com/espeak-ng/espeak-ng (eSpeak NG sources and COPYING)

The two ONNX runtime files are from the published Transformers.js 3.5.1 distribution. This app configures single-threaded WebAssembly execution.

Leaf adaptations to `package/dist/kokoro.web.js`: export the existing Transformers environment as `transformersEnv`, use relative local voice binary URLs, and scope the voice cache to this app's hosting path. `prepare-kokoro.mjs` records the exact reproducible replacements and validates the original npm tarball integrity before modifying it. No voice model weights or inference algorithms are modified.

Model downloaded by the app: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231 (Apache-2.0). Download metadata is retained in `model-info.json`.
