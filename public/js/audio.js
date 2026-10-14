/**
 * Web Audio API Sound Synthesizer & Asset Player
 * Procedurally generates all sound effects and dark ambient BGM with ZERO external files required.
 * Automatically checks for real files in /assets/audio/ and falls back to synthesized audio.
 */

class SoundSystem {
  constructor() {
    this.ctx = null;
    this.bgmNode = null;
    this.bgmGain = null;
    this.masterGain = null;
    this.isMuted = false;
    this.volume = 0.5;
    this.audioFiles = {
      bgm: '/assets/audio/bgm.mp3',
      correct: '/assets/audio/correct.mp3',
      wrong: '/assets/audio/wrong.mp3',
      alarm: '/assets/audio/alarm.mp3',
      unlock: '/assets/audio/unlock.mp3',
      victory: '/assets/audio/victory.mp3',
      heartbeat: '/assets/audio/heartbeat.mp3'
    };
    this.availableFiles = new Set();
    this.checkAvailableFiles();
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  async checkAvailableFiles() {
    for (const [key, url] of Object.entries(this.audioFiles)) {
      try {
        const resp = await fetch(url, { method: 'HEAD' });
        if (resp.ok && resp.headers.get('content-type')?.includes('audio')) {
          this.availableFiles.add(key);
        }
      } catch (e) {
        // Fallback to Web Audio synthesis
      }
    }
  }

  playFileOrSynth(key, synthFallback) {
    this.init();
    if (!this.ctx || this.isMuted) return;

    if (this.availableFiles.has(key)) {
      const audio = new Audio(this.audioFiles[key]);
      audio.volume = this.volume;
      audio.play().catch(() => synthFallback());
    } else {
      synthFallback();
    }
  }

  setMute(mute) {
    this.isMuted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume * 0.3, this.ctx.currentTime);
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (!this.isMuted && this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
    if (!this.isMuted && this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.volume * 0.3, this.ctx.currentTime);
    }
  }

  // --- Synthesized Effects ---

  playCorrect() {
    this.playFileOrSynth('correct', () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      
      // Cyber Arpeggio Chime
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + idx * 0.07);

        gain.gain.setValueAtTime(0, t + idx * 0.07);
        gain.gain.linearRampToValueAtTime(0.2, t + idx * 0.07 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.07 + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + idx * 0.07);
        osc.stop(t + idx * 0.07 + 0.36);
      });

      // Subtle noise burst simulating crowd/applause
      this.playNoiseBurst(0.4, 0.15);
    });
  }

  playWrong() {
    this.playFileOrSynth('wrong', () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;

      // Low failure buzzer
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.linearRampToValueAtTime(80, t + 0.28);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.31);
    });
  }

  playUnlock() {
    this.playFileOrSynth('unlock', () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.2);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  playHint() {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.setValueAtTime(950, t + 0.08);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.21);
  }

  playTick() {
    if (!this.ctx || this.isMuted) return;
    this.init();
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, t);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playHeartbeat(rateMultiplier = 1.0) {
    this.playFileOrSynth('heartbeat', () => {
      if (!this.ctx || this.isMuted) return;
      const t = this.ctx.currentTime;

      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(75, t);
      osc1.frequency.exponentialRampToValueAtTime(35, t + 0.12);

      gain1.gain.setValueAtTime(0.3, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc1.connect(gain1);
      gain1.connect(this.masterGain);
      osc1.start(t);
      osc1.stop(t + 0.15);

      // Second thump
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(65, t + 0.16);
      osc2.frequency.exponentialRampToValueAtTime(30, t + 0.28);

      gain2.gain.setValueAtTime(0.2, t + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(t + 0.16);
      osc2.stop(t + 0.31);
    });
  }

  playSiren() {
    this.playFileOrSynth('alarm', () => {
      if (!this.ctx || this.isMuted) return;
      const t = this.ctx.currentTime;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(500, t);
      osc.frequency.linearRampToValueAtTime(900, t + 0.25);
      osc.frequency.linearRampToValueAtTime(500, t + 0.5);
      osc.frequency.linearRampToValueAtTime(900, t + 0.75);
      osc.frequency.linearRampToValueAtTime(500, t + 1.0);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.95);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.05);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 1.06);
    });
  }

  playVictory() {
    this.playFileOrSynth('victory', () => {
      if (!this.ctx || this.isMuted) return;
      const t = this.ctx.currentTime;
      // Majestic Fanfare: C4, G4, C5, E5, G5
      const notes = [
        { f: 261.63, start: 0, dur: 0.18 },
        { f: 392.00, start: 0.18, dur: 0.18 },
        { f: 523.25, start: 0.36, dur: 0.24 },
        { f: 659.25, start: 0.60, dur: 0.24 },
        { f: 783.99, start: 0.84, dur: 0.8 }
      ];

      notes.forEach(n => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.f, t + n.start);

        gain.gain.setValueAtTime(0.25, t + n.start);
        gain.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + n.start);
        osc.stop(t + n.start + n.dur + 0.05);
      });
    });
  }

  playNoiseBurst(duration, gainVal) {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;

    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(t);
    noise.stop(t + duration);
  }

  // --- Background Ambient Music Loop ---

  startBgm() {
    this.init();
    if (!this.ctx || this.bgmNode) return;

    if (this.availableFiles.has('bgm')) {
      const bgmAudio = new Audio(this.audioFiles.bgm);
      bgmAudio.loop = true;
      bgmAudio.volume = this.isMuted ? 0 : this.volume * 0.3;
      bgmAudio.play().catch(() => this.startSynthBgm());
      this.bgmAudioElement = bgmAudio;
    } else {
      this.startSynthBgm();
    }
  }

  startSynthBgm() {
    if (!this.ctx || this.bgmGain) return;
    const t = this.ctx.currentTime;

    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume * 0.25, t);
    this.bgmGain.connect(this.ctx.destination);

    // Dark ambient drone: two slightly detuned low sawtooth oscillators through a lowpass filter
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(55, t); // A1 note
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(55.4, t); // subtle beat frequency

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, t);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(this.bgmGain);

    osc1.start();
    osc2.start();

    this.bgmNode = { osc1, osc2, filter };
  }

  stopBgm() {
    if (this.bgmAudioElement) {
      this.bgmAudioElement.pause();
      this.bgmAudioElement = null;
    }
    if (this.bgmNode) {
      try {
        this.bgmNode.osc1.stop();
        this.bgmNode.osc2.stop();
      } catch (e) {}
      this.bgmNode = null;
    }
    if (this.bgmGain) {
      this.bgmGain.disconnect();
      this.bgmGain = null;
    }
  }

  // --- Morse Code Audio Player ---
  // Plays S-H-A-D-O-W (... .... .- -.. --- .--)
  playMorseCode(pattern = '... .... .- -.. --- .--', onComplete = null) {
    this.init();
    if (!this.ctx || this.isMuted) return;

    const dotDuration = 0.08;
    const dashDuration = dotDuration * 3;
    const intraCharPause = dotDuration;
    const interCharPause = dotDuration * 3;
    const wordPause = dotDuration * 7;

    let timeOffset = 0;
    const t0 = this.ctx.currentTime + 0.05;

    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === '.') {
        this.scheduleTone(t0 + timeOffset, dotDuration, 750);
        timeOffset += dotDuration + intraCharPause;
      } else if (char === '-') {
        this.scheduleTone(t0 + timeOffset, dashDuration, 750);
        timeOffset += dashDuration + intraCharPause;
      } else if (char === ' ') {
        timeOffset += interCharPause;
      } else if (char === '/') {
        timeOffset += wordPause;
      }
    }

    if (onComplete) {
      setTimeout(onComplete, (timeOffset + 0.1) * 1000);
    }
  }

  scheduleTone(startTime, duration, freq = 750) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.2, startTime + 0.005);
    gain.gain.setValueAtTime(0.2, startTime + duration - 0.005);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}

// Global instance
window.soundSystem = new SoundSystem();
