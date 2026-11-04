import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { TranscriptionRequest, TranscriptionResponse } from './types';

env.allowLocalModels = false;
// Ship runtime assets with the app; only public model weights need downloading.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = new URL('.', self.location.href).href;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}
let model: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

function send(message: TranscriptionResponse): void {
  self.postMessage(message);
}

async function load(id: number): Promise<AutomaticSpeechRecognitionPipeline> {
  const progress_callback = (progress: { status: string; progress?: number }) => {
    send({
      id, type: 'progress',
      detail: progress.status === 'progress'
        ? `Downloading voice model: ${Math.round(progress.progress ?? 0)}%`
        : 'Loading local English voice model...',
    });
  };
  const gpu = 'gpu' in navigator ? navigator.gpu : undefined;
  if (gpu && typeof gpu === 'object' && 'requestAdapter' in gpu && typeof gpu.requestAdapter === 'function') {
    try {
      if (await gpu.requestAdapter()) {
        return await pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
          device: 'webgpu', dtype: 'q8', progress_callback,
        });
      }
    } catch (error) {
      console.warn('[voice] WebGPU unavailable; switching to local WASM', error);
      send({ id, type: 'progress', detail: 'GPU unavailable; loading local CPU voice model...' });
    }
  }
  return pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
    device: 'wasm', dtype: 'q8', progress_callback,
  });
}

async function handle(request: TranscriptionRequest): Promise<void> {
  try {
    const transcriber = await (model ??= load(request.id));
    if (request.type === 'load') {
      send({ id: request.id, type: 'ready' });
    } else {
      const result = await transcriber(request.audio);
      send({ id: request.id, type: 'text', text: (Array.isArray(result) ? result[0]?.text : result.text) ?? '' });
    }
  } catch (error) {
    model = undefined;
    send({ id: request.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

// A cancelled UI request may still be computing. Never run two inferences on
// the same model instance while its successor waits for a result.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<TranscriptionRequest>) => {
  queue = queue.then(() => handle(event.data));
};
