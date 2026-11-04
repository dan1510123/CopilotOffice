export interface VoiceRecording {
  stop(): Promise<Float32Array>;
  cancel(): void;
}

export async function startMicrophone(): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    let cancelled = false;
    const result = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('Microphone recording failed.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    });
    // A recorder error can occur before the user releases the button.
    void result.catch((error: unknown) => console.error('[voice] Recording error', error));
    const release = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.start(250);
    return {
      cancel() { cancelled = true; release(); },
      async stop() {
        release();
        const blob = await result;
        if (cancelled) throw new Error('Recording cancelled.');
        const context = new AudioContext({ sampleRate: 16_000 });
        try {
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16_000), 16_000);
          const source = offline.createBufferSource();
          source.buffer = decoded;
          source.connect(offline.destination);
          source.start();
          return (await offline.startRendering()).getChannelData(0);
        } finally {
          await context.close();
        }
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}

export function hasSpeechAudio(audio: Float32Array): boolean {
  if (audio.length < 1600) return false;
  let energy = 0;
  for (const value of audio) energy += value * value;
  return Math.sqrt(energy / audio.length) > 0.005;
}
