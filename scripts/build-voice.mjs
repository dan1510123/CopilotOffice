import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const out = new URL('dist/voice/', root);
await mkdir(out, { recursive: true });
for (const name of [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]) {
  await copyFile(new URL(`node_modules/onnxruntime-web/dist/${name}`, root), new URL(name, out));
}
await build({
  entryPoints: [fileURLToPath(new URL('src/voice/transcription.worker.ts', root))],
  outfile: fileURLToPath(new URL('transcription.worker.js', out)),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  minify: true,
});
