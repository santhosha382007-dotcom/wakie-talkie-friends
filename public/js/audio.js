/**
 * Audio Engine for Walkie Friends App
 * High-performance 16kHz PCM voice capture & playback with optional walkie-talkie sound FX.
 */

class SimpleAudio {
  constructor() {
    this.ctx = null;
    this.micStream = null;
    this.micProcessor = null;
    this.analyser = null;
    this.isTransmitting = false;
    this.soundEffects = true; // Fun walkie-talkie beeps toggle
    this.volume = 1.0;
    this.nextPlayTime = 0;
    this.sampleRate = 16000;
    this.bufferSize = 1024;
    this.onChunk = null; // (pcmInt16) => void
  }

  async init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx({ sampleRate: this.sampleRate });

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 64;

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  async initMic() {
    if (this.micStream) return true;
    try {
      await this.init();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const source = this.ctx.createMediaStreamSource(this.micStream);
      this.micProcessor = this.ctx.createScriptProcessor(this.bufferSize, 1, 1);

      this.micProcessor.onaudioprocess = (e) => {
        if (!this.isTransmitting) return;

        const input = e.inputBuffer.getChannelData(0);
        const pcmInt16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcmInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        if (this.onChunk) {
          this.onChunk(pcmInt16);
        }
      };

      source.connect(this.micProcessor);
      this.micProcessor.connect(this.ctx.destination);
      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      return false;
    }
  }

  async startTalking() {
    await this.init();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.micStream) {
      const ok = await this.initMic();
      if (!ok) return false;
    }

    this.isTransmitting = true;
    if (this.soundEffects) {
      this.playChirp();
    }
    return true;
  }

  stopTalking() {
    if (!this.isTransmitting) return;
    this.isTransmitting = false;

    if (this.soundEffects) {
      this.playRogerBeep();
    }
  }

  playIncomingVoice(pcmInt16) {
    if (!pcmInt16 || pcmInt16.length === 0) return;
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const float32 = new Float32Array(pcmInt16.length);
    for (let i = 0; i < pcmInt16.length; i++) {
      float32[i] = pcmInt16[i] / 32768.0;
    }

    const audioBuf = this.ctx.createBuffer(1, float32.length, this.sampleRate);
    audioBuf.copyToChannel(float32, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(this.masterGain);

    const now = this.ctx.currentTime;
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.04;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuf.duration;
  }

  playFriendStoppedTalking() {
    this.nextPlayTime = 0;
    if (this.soundEffects) {
      this.playRogerBeep();
    }
  }

  playChirp() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(2200, now + 0.04);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playRogerBeep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(1150, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  getAudioLevel() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return Math.min(100, Math.round((sum / data.length) * 1.5));
  }
}

window.simpleAudio = new SimpleAudio();
