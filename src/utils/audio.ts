// Web Audio API Sound Synthesizer & Speech Assistant

class SoundManager {
  private ctx: AudioContext | null = null;
  private ringInterval: number | null = null;

  public resumeAudioContext(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch {
      // AudioContext may be restricted by browser policy
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch {
        return null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Play a pleasant chime when a pill is marked taken
  playSuccessChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Note 1 (E5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // Note 2 (G#5)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(830.61, now + 0.12);
      gain2.gain.setValueAtTime(0.25, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.7);

      // Note 3 (B5)
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(987.77, now + 0.25);
      gain3.gain.setValueAtTime(0.3, now + 0.25);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.25);
      osc3.stop(now + 1.0);
    } catch {
      // Audio playback fails gracefully if muted
    }
  }

  // Start phone ring sound (two-tone phone pulse)
  startRinging() {
    this.stopRinging();
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const playRingBurst = () => {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const oscA = this.ctx.createOscillator();
        const oscB = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        oscA.type = 'sine';
        oscB.type = 'sine';
        oscA.frequency.setValueAtTime(440, now); // 440 Hz
        oscB.frequency.setValueAtTime(480, now); // 480 Hz (Standard telephone ring tones)

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.setValueAtTime(0.12, now + 0.8);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

        oscA.connect(gain);
        oscB.connect(gain);
        gain.connect(this.ctx.destination);

        oscA.start(now);
        oscB.start(now);
        oscA.stop(now + 0.85);
        oscB.stop(now + 0.85);
      };

      playRingBurst();
      this.ringInterval = window.setInterval(playRingBurst, 2500);
    } catch {
      // Ignore audio error
    }
  }

  // Stop phone ring
  stopRinging() {
    if (this.ringInterval !== null) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  // Speak AI text using SpeechSynthesis in browser
  speak(text: string, lang: string = 'en') {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      
      const langMap: Record<string, string> = {
        en: 'en-US',
        ta: 'ta-IN',
        hi: 'hi-IN',
        ur: 'ur-PK'
      };
      utterance.lang = langMap[lang] || 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.05;

      window.speechSynthesis.speak(utterance);
    } catch {
      // fallback silently
    }
  }

  stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

export const soundManager = new SoundManager();
