# Open issues

From the 2026-09-17 review of the offscreen/local-WASM pipeline.

## 1. Bundle model weights + ORT runtime with the extension

Weights are fetched from the HF Hub on first run (network dependency for a
"local" filter). Fix: vendor `models/nli-deberta-v3-xsmall/` (int8 ~87 MB, q4
smaller) and the full `dist/` folder of the npm package into the extension, then:

```js
env.allowRemoteModels = false;
env.localModelPath = chrome.runtime.getURL('/models/');
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/libs/dist/');
```

Alternative: warm the Cache API at `chrome.runtime.onInstalled` (smaller
package, but cache is evictable). Sizes are far under the Web Store 2 GB cap.

## 2. Replace the 50-sentence cap with chunked streaming classification

`MAX_SENTENCES = 50` silently drops everything past sentence 50 of long pages,
and there is no progress feedback. Fix: segment in content.js, send chunks of
~50 as separate messages, mark incrementally per chunk, batch each chunk in one
`classifier(sentences[], topics)` call. Requires: `requestId` on every message
to drop stale runs, and `unmark()` once per FILTER instead of once per result.

## 3. WASM backend loads executable code from jsdelivr CDN (CSP + policy)

`transformers.min.js` was vendored as a single file without its `dist/`
siblings, so ONNX Runtime dynamically imports
`ort-wasm-simd-threaded.jsep.mjs` from
`cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/` — blocked by the
extension-page CSP (`script-src 'self' 'wasm-unsafe-eval'`), producing
"no available backend found". Also a Web Store remote-code violation even if
allowed via CSP. Same fix as issue 1: vendor `dist/` + set `wasmPaths`.

(See <https://github.com/huggingface/transformers.js/issues/1248>)
