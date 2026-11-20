class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private volume = 0.65;

  setSettings(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled || this.volume <= 0.01) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainPeak = 0.25,
    endFreq?: number,
    delay = 0
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainPeak * this.volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playClick() {
    this.playTone(540, 0.07, 'triangle', 0.2, 760);
  }

  playCountdownTick(final = false) {
    if (final) {
      this.playTone(880, 0.22, 'triangle', 0.3, 1175);
    } else {
      this.playTone(520, 0.1, 'sine', 0.22);
    }
  }

  playSafeColorAnnounce() {
    this.playTone(523.25, 0.11, 'triangle', 0.25, undefined, 0);
    this.playTone(659.25, 0.11, 'triangle', 0.25, undefined, 0.08);
    this.playTone(783.99, 0.18, 'triangle', 0.28, undefined, 0.16);
  }

  playWarning() {
    this.playTone(340, 0.1, 'sawtooth', 0.12, 260, 0);
    this.playTone(340, 0.1, 'sawtooth', 0.12, 260, 0.18);
  }

  playTileDrop() {
    this.playTone(260, 0.28, 'sawtooth', 0.18, 70);
  }

  playFall() {
    // Classic funny cartoon falling whistle
    this.playTone(880, 0.48, 'sine', 0.28, 170);
    this.playTone(200, 0.15, 'triangle', 0.2, 80, 0.45);
  }

  playRoundSurvive() {
    this.playTone(587.33, 0.1, 'sine', 0.22, undefined, 0);
    this.playTone(880, 0.18, 'sine', 0.25, undefined, 0.09);
  }

  playVictory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, idx === 3 ? 0.45 : 0.14, 'triangle', 0.3, undefined, idx * 0.11);
    });
  }

  playEmojiPop() {
    this.playTone(460, 0.09, 'sine', 0.16, 820);
  }

  playDash() {
    this.playTone(280, 0.16, 'triangle', 0.28, 920);
    this.playTone(600, 0.12, 'sine', 0.14, 1200, 0.04);
  }

  playPowerUp(kind: 'speed' | 'shield') {
    if (kind === 'shield') {
      this.playTone(440, 0.12, 'sine', 0.25, undefined, 0);
      this.playTone(659.25, 0.14, 'sine', 0.26, undefined, 0.08);
      this.playTone(880, 0.22, 'triangle', 0.28, undefined, 0.16);
    } else {
      this.playTone(587.33, 0.1, 'triangle', 0.26, 987.77, 0);
      this.playTone(880, 0.16, 'triangle', 0.28, 1318.5, 0.09);
    }
  }

  playLevelUp() {
    this.playTone(392, 0.1, 'triangle', 0.22, undefined, 0);
    this.playTone(523.25, 0.1, 'triangle', 0.24, undefined, 0.08);
    this.playTone(659.25, 0.18, 'triangle', 0.26, undefined, 0.16);
  }
}

export const soundManager = new SoundManager();
