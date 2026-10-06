/**
 * SmartMed Speech Services (STT & TTS)
 * Modular Speech-to-Text and Text-to-Speech abstraction layer.
 * 
 * Architecture:
 * - STT: Microphone -> Local Browser / Whisper Provider -> Transcribed Text
 * - TTS: AI Text Response -> Local Browser / Piper Provider -> Speaker
 * 
 * Supports plugging in local offline engines (Whisper / Piper) without UI changes.
 */

// ─── Base URL for Local & Cloud Deployments ──────────────────────────────────
const SPEECH_API_BASE = typeof window !== 'undefined'
  ? ((import.meta as any).env?.VITE_API_BASE_URL ?? (window.location.port === '8100' ? 'http://localhost:8100' : ''))
  : 'http://localhost:8100';

// ─── STT Provider Interface ──────────────────────────────────────────────────

export interface STTListeningOptions {
  lang?: string;
  onStart?: () => void;
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface ISTTProvider {
  name: string;
  isSupported(): boolean;
  startListening(options: STTListeningOptions): void;
  stopListening(): void;
  abort(): void;
  isListening(): boolean;
}

// ─── TTS Provider Interface ──────────────────────────────────────────────────

export interface TTSSpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export interface ITTSProvider {
  name: string;
  isSupported(): boolean;
  speak(text: string, options?: TTSSpeakOptions): void;
  stop(): void;
  isSpeaking(): boolean;
  unlock?(): void;
}

// ─── Browser SpeechRecognition (Web Speech API) ─────────────────────────────

interface IWindowSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
        confidence: number;
      };
    };
  };
}

class BrowserSTTProvider implements ISTTProvider {
  name = 'Browser Web Speech API';
  private recognition: IWindowSpeechRecognition | null = null;
  private _isListening = false;
  private activeOptions: STTListeningOptions | null = null;

  private getSpeechRecognitionClass(): (new () => IWindowSpeechRecognition) | null {
    if (typeof window === 'undefined') return null;
    const win = window as unknown as {
      SpeechRecognition?: new () => IWindowSpeechRecognition;
      webkitSpeechRecognition?: new () => IWindowSpeechRecognition;
    };
    return win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }

  isSupported(): boolean {
    return this.getSpeechRecognitionClass() !== null;
  }

  isListening(): boolean {
    return this._isListening;
  }

  startListening(options: STTListeningOptions): void {
    const RecognitionClass = this.getSpeechRecognitionClass();
    if (!RecognitionClass) {
      options.onError?.('Speech recognition is not supported in this browser. You can use the quick response buttons.');
      return;
    }

    // Stop any existing instance
    this.stopListening();
    this.activeOptions = options;

    try {
      const recognition = new RecognitionClass();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // Language code mapping
      const langMap: Record<string, string> = {
        en: 'en-US',
        ta: 'ta-IN',
        hi: 'hi-IN',
        ur: 'ur-PK',
      };
      recognition.lang = langMap[options.lang || 'en'] || options.lang || 'en-US';

      recognition.onstart = () => {
        this._isListening = true;
        options.onStart?.();
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        const text = finalTranscript || interimTranscript;
        if (text.trim()) {
          options.onResult(text.trim(), !!finalTranscript);
        }
      };

      recognition.onerror = (event: { error: string }) => {
        this._isListening = false;
        // 'no-speech' is a common benign event
        if (event.error === 'no-speech') {
          options.onError?.('No speech detected. Please try again.');
        } else if (event.error === 'not-allowed') {
          options.onError?.('Microphone permission was denied. Please allow microphone access in your browser.');
        } else {
          options.onError?.(`Speech recognition error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        this._isListening = false;
        options.onEnd?.();
      };

      this.recognition = recognition;
      recognition.start();
    } catch (err) {
      this._isListening = false;
      options.onError?.(err instanceof Error ? err.message : 'Failed to start microphone');
    }
  }

  stopListening(): void {
    if (this.recognition && this._isListening) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this._isListening = false;
  }

  abort(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
    }
    this._isListening = false;
  }
}

// ─── Offline Whisper STT Provider (MediaRecorder + Local AI STT Engine) ──────

export class OfflineWhisperSTTProvider implements ISTTProvider {
  name = 'SmartMed Offline Whisper STT';
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private animFrameId: number | null = null;
  private speechDetected = false;
  private _isListening = false;

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!navigator?.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  isListening(): boolean {
    return this._isListening;
  }

  async startListening(options: STTListeningOptions): Promise<void> {
    if (!this.isSupported()) {
      options.onError?.('Microphone recording is not supported in this browser.');
      return;
    }

    this.stopListening();
    this.audioChunks = [];
    this.speechDetected = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this.mediaStream = stream;

      // Determine supported audio container
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4',
        '',
      ];
      let selectedMime = '';
      for (const m of mimeTypes) {
        if (!m || MediaRecorder.isTypeSupported(m)) {
          selectedMime = m;
          break;
        }
      }

      const recorder = selectedMime
        ? new MediaRecorder(stream, { mimeType: selectedMime })
        : new MediaRecorder(stream);
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        this._isListening = false;
        const chunks = [...this.audioChunks];
        this.audioChunks = [];
        this.cleanupAudio();

        if (chunks.length === 0) {
          options.onError?.('No speech detected. Please try again.');
          options.onEnd?.();
          return;
        }

        const audioBlob = new Blob(chunks, { type: selectedMime || 'audio/webm' });
        if (audioBlob.size < 500) {
          options.onError?.('No speech detected. Please try again.');
          options.onEnd?.();
          return;
        }

        // Send recorded audio to local offline Whisper engine on port 8100
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = reader.result as string;
            try {
              const res = await fetch(`${SPEECH_API_BASE}/api/ai/stt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audio_base64: base64Audio,
                  language: options.lang || 'en',
                }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data.success && data.transcript && data.transcript.trim()) {
                  options.onResult(data.transcript.trim(), true);
                } else {
                  options.onError?.('No speech detected. Please try again.');
                }
              } else {
                options.onError?.('Offline speech recognition could not transcribe audio.');
              }
            } catch {
              options.onError?.('Cannot connect to local AI server on port 8100.');
            } finally {
              options.onEnd?.();
            }
          };
        } catch {
          options.onError?.('Failed to process recorded audio.');
          options.onEnd?.();
        }
      };

      // Voice Activity Detection (VAD) using Web Audio Analyser
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          this.audioContext = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          this.analyser = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const checkVolume = () => {
            if (!this._isListening) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;

            if (avg > 14) {
              this.speechDetected = true;
              if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
              }
            } else if (this.speechDetected && !this.silenceTimer) {
              // Automatically finalize after 1.3 seconds of silence following speech
              this.silenceTimer = setTimeout(() => {
                if (this._isListening) {
                  this.stopListening();
                }
              }, 1300);
            }

            this.animFrameId = requestAnimationFrame(checkVolume);
          };
          this.animFrameId = requestAnimationFrame(checkVolume);
        }
      } catch {
        // Fallback to manual tap or maxDuration
      }

      // Safety timeout: max 8 seconds per voice utterance
      this.maxDurationTimer = setTimeout(() => {
        if (this._isListening) {
          this.stopListening();
        }
      }, 8000);

      recorder.start(250);
      this._isListening = true;
      options.onStart?.();
    } catch (err: unknown) {
      this._isListening = false;
      this.cleanupAudio();
      const error = err as { name?: string; message?: string };
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        options.onError?.('Microphone permission was denied. Please allow microphone access in your browser.');
      } else {
        options.onError?.('Failed to access microphone for offline speech.');
      }
    }
  }

  stopListening(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this._isListening = false;
  }

  abort(): void {
    this._isListening = false;
    this.cleanupAudio();
  }

  private cleanupAudio(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }
  }
}

// ─── Smart Hybrid STT Provider (Online Browser + Seamless Offline Whisper) ──

export class HybridSTTProvider implements ISTTProvider {
  name = 'SmartMed Hybrid Speech Recognition (Web Speech + Offline Whisper)';
  public browserProvider = new BrowserSTTProvider();
  public offlineProvider = new OfflineWhisperSTTProvider();
  private activeProvider: ISTTProvider = this.browserProvider;

  isSupported(): boolean {
    return this.browserProvider.isSupported() || this.offlineProvider.isSupported();
  }

  isListening(): boolean {
    return this.activeProvider.isListening();
  }

  startListening(options: STTListeningOptions): void {
    // If the browser is known to be offline, immediately activate Offline Whisper STT
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    if (isOffline || !this.browserProvider.isSupported()) {
      this.activeProvider = this.offlineProvider;
      this.offlineProvider.startListening(options);
      return;
    }

    // Try browser Web Speech API, with automatic seamless failover on network error
    this.activeProvider = this.browserProvider;
    this.browserProvider.startListening({
      ...options,
      onError: (err: string) => {
        // Catch 'network' or 'service-not-allowed' errors emitted by Chrome/Brave/Edge when offline
        if (err.includes('network') || err.includes('service-not-allowed')) {
          console.info('[SmartMed HybridSTT] Web Speech network error detected. Seamlessly activating Offline Whisper STT...');
          this.activeProvider = this.offlineProvider;
          this.offlineProvider.startListening(options);
        } else {
          options.onError?.(err);
        }
      },
    });
  }

  stopListening(): void {
    this.activeProvider.stopListening();
  }

  abort(): void {
    this.browserProvider.abort();
    this.offlineProvider.abort();
  }
}

// ─── Browser SpeechSynthesis (TTS Provider) ──────────────────────────────────
 
class BrowserTTSProvider implements ITTSProvider {
  name = 'Browser Web Speech Synthesis';
  private _isSpeaking = false;
  // Strong reference prevents Chromium V8 garbage collection while speaking
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.initVoices();
    }
  }

  private initVoices(): void {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        this.voices = window.speechSynthesis.getVoices();
        if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
          window.speechSynthesis.onvoiceschanged = () => {
            this.voices = window.speechSynthesis.getVoices();
          };
        }
      }
    } catch {
      this.voices = [];
    }
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  isSpeaking(): boolean {
    return this._isSpeaking || (typeof window !== 'undefined' && !!window.speechSynthesis?.speaking);
  }

  // Pre-warm and resume speech synthesis on user interaction
  unlock(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      this.initVoices();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // ignore
    }
  }

  speak(text: string, options: TTSSpeakOptions = {}): void {
    if (!this.isSupported()) {
      options.onError?.('Speech synthesis not supported in this browser');
      return;
    }

    const cleanText = text
      .replace(/[*_~`#]/g, '')
      .replace(/<\|[^|]+\|>/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    if (!cleanText) {
      options.onEnd?.();
      return;
    }

    // In Chromium, if speech is active, calling cancel() followed immediately by speak()
    // will cancel the new utterance due to an asynchronous IPC race.
    // Delaying by 50ms ensures the cancellation completes before queuing the new utterance.
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      this.stop();
      setTimeout(() => {
        this.doSpeak(cleanText, options);
      }, 50);
    } else {
      this.doSpeak(cleanText, options);
    }
  }

  private doSpeak(cleanText: string, options: TTSSpeakOptions): void {
    try {
      // Always ensure synthesizer is resumed before speaking
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      this.activeUtterance = utterance; // Strong reference against GC!

      const langMap: Record<string, string> = {
        en: 'en-US',
        ta: 'ta-IN',
        hi: 'hi-IN',
        ur: 'ur-PK',
        te: 'te-IN',
        ml: 'ml-IN',
        kn: 'kn-IN',
      };
      const targetLang = langMap[options.lang || 'en'] || options.lang || 'en-US';
      utterance.lang = targetLang;
      utterance.rate = options.rate ?? 1.0;
      utterance.pitch = options.pitch ?? 1.0;
      utterance.volume = 1.0;

      // Select matching voice
      if (this.voices.length === 0) {
        this.voices = window.speechSynthesis.getVoices();
      }

      if (this.voices.length > 0) {
        const langPrefix = targetLang.split('-')[0].toLowerCase();
        const matchedVoice =
          this.voices.find(v => v.lang.toLowerCase() === targetLang.toLowerCase()) ||
          this.voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix)) ||
          this.voices.find(v => v.lang.toLowerCase().includes('en')) ||
          this.voices.find(v => v.default) ||
          this.voices[0];

        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }
      }

      let isFinished = false;
      const cleanup = () => {
        if (isFinished) return;
        isFinished = true;
        this._isSpeaking = false;
        if (this.watchdogTimer) {
          clearInterval(this.watchdogTimer);
          this.watchdogTimer = null;
        }
        if (this.safetyTimer) {
          clearTimeout(this.safetyTimer);
          this.safetyTimer = null;
        }
        this.activeUtterance = null;
      };

      utterance.onstart = () => {
        this._isSpeaking = true;
        options.onStart?.();

        // Chromium watchdog: pulse resume every 2.5s to prevent the 15s freeze bug
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        this.watchdogTimer = setInterval(() => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.resume();
          }
        }, 2500);
      };

      utterance.onend = () => {
        cleanup();
        options.onEnd?.();
      };

      utterance.onerror = (e) => {
        cleanup();
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          console.warn('[SmartMed TTS] Utterance error:', e.error);
          // If synthesis-failed occurs on mobile or linux without local TTS voice packs,
          // invoke onEnd so conversation state transitions cleanly without hanging
          if (e.error === 'synthesis-failed') {
            options.onEnd?.();
            return;
          }
          options.onError?.(e.error);
        } else {
          options.onEnd?.();
        }
      };

      // Safety duration fallback: cleanText length * 130ms + 5000ms buffer
      const maxDuration = Math.max(7000, cleanText.length * 130 + 5000);
      this.safetyTimer = setTimeout(() => {
        if (!isFinished) {
          console.warn('[SmartMed TTS] Safety duration reached, resetting voice state');
          cleanup();
          this.stop();
          options.onEnd?.();
        }
      }, maxDuration);

      this._isSpeaking = true;
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      this._isSpeaking = false;
      this.activeUtterance = null;
      options.onError?.(err instanceof Error ? err.message : 'Speech synthesis error');
    }
  }

  stop(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    this._isSpeaking = false;
    this.activeUtterance = null;
    if (this.isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
}

// ─── Neural TTS Provider (Piper ONNX & Kokoro TTS via Local AI Server) ──────

export class NeuralTTSProvider implements ITTSProvider {
  name = 'SmartMed Neural Voice (Piper ONNX / Kokoro TTS)';
  private _isSpeaking = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private abortController: AbortController | null = null;

  isSupported(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  isSpeaking(): boolean {
    return this._isSpeaking;
  }

  unlock(): void {
    // Neural TTS plays standard HTML5 audio blobs
  }

  async speak(text: string, options: TTSSpeakOptions = {}): Promise<void> {
    const cleanText = text
      .replace(/[*_~`#]/g, '')
      .replace(/<\|[^|]+\|>/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    if (!cleanText) {
      options.onEnd?.();
      return;
    }

    this.stop();

    this.abortController = new AbortController();
    try {
      const response = await fetch(`${SPEECH_API_BASE}/api/ai/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          engine: 'auto',
          speed: options.rate ?? 1.0,
          lang: options.lang || 'en',
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS server responded with ${response.status}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Empty audio received from TTS engine');
      }

      const blobUrl = URL.createObjectURL(blob);
      this.currentBlobUrl = blobUrl;
      const audio = new Audio(blobUrl);
      this.currentAudio = audio;

      audio.onplay = () => {
        this._isSpeaking = true;
        options.onStart?.();
      };

      audio.onended = () => {
        this._isSpeaking = false;
        this.cleanup();
        options.onEnd?.();
      };

      audio.onerror = () => {
        this._isSpeaking = false;
        this.cleanup();
        options.onError?.('Failed to play neural audio');
      };

      await audio.play();
    } catch (err: unknown) {
      this._isSpeaking = false;
      this.cleanup();
      const error = err as { name?: string; message?: string };
      if (error?.name !== 'AbortError') {
        options.onError?.(error?.message || 'Neural TTS failed');
      }
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // ignore
      }
      this.currentAudio = null;
    }
    this._isSpeaking = false;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl);
      } catch {
        // ignore
      }
      this.currentBlobUrl = null;
    }
  }
}

// ─── Hybrid TTS Provider (Smart Fallback Engine) ────────────────────────────

export class HybridTTSProvider implements ITTSProvider {
  name = 'SmartMed Hybrid Speech (Neural Piper/Kokoro + Browser Fallback)';
  public neuralProvider = new NeuralTTSProvider();
  public browserProvider = new BrowserTTSProvider();
  private isServerReady: boolean | null = null;
  private lastHealthCheck = 0;

  isSupported(): boolean {
    return this.neuralProvider.isSupported() || this.browserProvider.isSupported();
  }

  isSpeaking(): boolean {
    return this.neuralProvider.isSpeaking() || this.browserProvider.isSpeaking();
  }

  unlock(): void {
    this.browserProvider.unlock();
  }

  private async checkServerReady(): Promise<boolean> {
    const now = Date.now();
    // Cache check for 10 seconds
    if (this.isServerReady !== null && now - this.lastHealthCheck < 10000) {
      return this.isServerReady;
    }

    try {
      const res = await fetch(`${SPEECH_API_BASE}/api/ai/tts/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = await res.json();
        this.isServerReady = data.status === 'ready' || data.piper?.available || data.kokoro?.available;
      } else {
        this.isServerReady = false;
      }
    } catch {
      this.isServerReady = false;
    }
    this.lastHealthCheck = now;
    return this.isServerReady;
  }

  async speak(text: string, options: TTSSpeakOptions = {}): Promise<void> {
    const serverReady = await this.checkServerReady();

    if (serverReady) {
      // Try neural offline voice first
      let fallbackTriggered = false;
      this.neuralProvider.speak(text, {
        ...options,
        onError: (err) => {
          if (!fallbackTriggered) {
            fallbackTriggered = true;
            console.warn('[SmartMed HybridTTS] Neural voice failed, falling back to Browser TTS:', err);
            this.browserProvider.speak(text, options);
          }
        },
      });
    } else {
      // Fallback directly to browser web speech
      this.browserProvider.speak(text, options);
    }
  }

  stop(): void {
    this.neuralProvider.stop();
    this.browserProvider.stop();
  }
}

// ─── Export Singletons ──────────────────────────────────────────────────────

export const browserTtsProvider = new BrowserTTSProvider();
export const neuralTtsProvider = new NeuralTTSProvider();
export const hybridTtsProvider = new HybridTTSProvider();

export const browserSttProvider = new BrowserSTTProvider();
export const offlineSttProvider = new OfflineWhisperSTTProvider();
export const hybridSttProvider = new HybridSTTProvider();

export const sttProvider: ISTTProvider = hybridSttProvider;
export const ttsProvider: ITTSProvider = hybridTtsProvider;


