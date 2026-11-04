export interface VoiceTarget {
  officeId: string;
  agentId: string;
  sessionId: string;
}

export type VoicePhase = 'idle' | 'loading' | 'recording' | 'transcribing' | 'waiting' | 'speaking' | 'error';

export interface VoiceState {
  phase: VoicePhase;
  target: VoiceTarget | null;
  detail: string;
}

export type TranscriptionRequest =
  | { id: number; type: 'load' }
  | { id: number; type: 'transcribe'; audio: Float32Array };

export type TranscriptionResponse =
  | { id: number; type: 'progress'; detail: string }
  | { id: number; type: 'ready' }
  | { id: number; type: 'text'; text: string }
  | { id: number; type: 'error'; error: string };
