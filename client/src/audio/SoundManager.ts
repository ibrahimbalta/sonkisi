class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private musicEnabled = true;
  private volume = 0.65;

  // Procedural upbeat fantasy party music sequencer
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicIntense = false;
  private userUnlocked = false;

  setSettings(enabled: boolean, volume: number, musicEnabled?: boolean) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (musicEnabled !== undefined) {
      this.musicEnabled = musicEnabled;
    }
    if (!this.musicEnabled || this.volume <= 0.01) {
      this.stopMusicLoop();
    } else if (this.userUnlocked) {
      this.startMusicLoop();
    }
  }

  public unlockAndStartMusic() {
    this.userUnlocked = true;
    this.ensureContext();
    if (this.musicEnabled && this.volume > 0.01) {
      this.startMusicLoop();
    }
  }

  public setMusicIntensity(intense: boolean) {
    if (this.musicIntense === intense) return;
    this.musicIntense = intense;
    if (this.musicTimer !== null) {
      this.stopMusicLoop();
      this.startMusicLoop();
    }
  }

  private startMusicLoop() {
    if (this.musicTimer !== null || !this.musicEnabled) return;
    // 16th-note step duration: 122 BPM in menu/lobby, 136 BPM during active match!
    const stepMs = this.musicIntense ? 110 : 123;
    this.musicTimer = window.setInterval(() => {
      if (!this.musicEnabled || this.volume <= 0.01) return;
      this.playMusicStep(this.musicStep);
      this.musicStep = (this.musicStep + 1) % 32;
    }, stepMs);
  }

  private stopMusicLoop() {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private playMusicStep(step: number) {
    const ctx = this.ensureContext(true);
    if (!ctx || ctx.state !== 'running') return;

    // Bright upbeat C-major / A-minor fantasy party progression (C - G - Am - F)
    const melodyHz = [
      523.25, 0, 659.25, 783.99, 1046.5, 0, 783.99, 659.25,
      587.33, 0, 783.99, 987.77, 1174.66, 0, 987.77, 783.99,
      440.0, 0, 523.25, 659.25, 880.0, 0, 659.25, 523.25,
      698.46, 0, 880.0, 1046.5, 987.77, 880.0, 783.99, 659.25,
    ];
    const bassHz = [
      130.81, 0, 0, 130.81, 196.0, 0, 130.81, 0,
      196.0, 0, 0, 196.0, 246.94, 0, 196.0, 0,
      110.0, 0, 0, 110.0, 164.81, 0, 110.0, 0,
      174.61, 0, 0, 174.61, 196.0, 0, 196.0, 0,
    ];

    const now = ctx.currentTime;
    const mVol = this.volume * 0.14;

    // Lead sparkle synth
    const leadFreq = melodyHz[step];
    if (leadFreq > 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(leadFreq, now);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(mVol * 0.75, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    }

    // Bouncy warm bass
    const bFreq = bassHz[step];
    if (bFreq > 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(bFreq, now);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(mVol * 1.15, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    }

    // Soft punchy kick on every beat (0, 4, 8, 12...)
    if (step % 4 === 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);
      g.gain.setValueAtTime(mVol * 1.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    }

    // Offbeat crisp hi-hat tick during active match
    if (this.musicIntense && step % 4 === 2) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(2400, now);
      g.gain.setValueAtTime(mVol * 0.16, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    }
  }

  private ensureContext(forMusic = false): AudioContext | null {
    if (!forMusic && !this.enabled) return null;
    if (this.volume <= 0.01) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
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

  playExplosion() {
    this.playTone(150, 0.32, 'sawtooth', 0.3, 35);
    this.playTone(95, 0.36, 'triangle', 0.25, 28, 0.03);
  }

  playKnockout() {
    this.playTone(660, 0.09, 'triangle', 0.26, undefined, 0);
    this.playTone(990, 0.16, 'triangle', 0.3, 1320, 0.08);
  }
}

export const soundManager = new SoundManager();
