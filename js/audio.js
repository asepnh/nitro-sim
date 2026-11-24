// Web Audio synth for the engine note. Mobile browsers require audio to be
// started/resumed from a user gesture, so init() must be called from a
// click/tap handler (the Start Engine button).
export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    const ctx = this.ctx;

    // Base tone: a saw oscillator whose frequency tracks RPM, giving the
    // buzzy harmonic-rich character of a small two-stroke.
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 60;

    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;

    // A resonant bandpass models the tuned exhaust pipe, and its center
    // frequency is swept with RPM.
    this.pipeFilter = ctx.createBiquadFilter();
    this.pipeFilter.type = "bandpass";
    this.pipeFilter.Q.value = 4;
    this.pipeFilter.frequency.value = 400;

    // Broadband noise adds exhaust rasp / combustion roughness.
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;

    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "highpass";
    this.noiseFilter.frequency.value = 800;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;

    // Stroke-pop LFO: amplitude-modulates the tone to create the
    // "4-stroking" blubber pattern of a rich/idle mixture.
    this.strokeLfo = ctx.createOscillator();
    this.strokeLfo.type = "sine";
    this.strokeLfo.frequency.value = 10;
    this.strokeDepth = ctx.createGain();
    this.strokeDepth.gain.value = 0;
    this.strokeOffset = ctx.createConstantSource();
    this.strokeOffset.offset.value = 1;

    this.strokeLfo.connect(this.strokeDepth);
    const strokeSum = ctx.createGain();
    this.strokeDepth.connect(strokeSum.gain);
    this.strokeOffset.connect(strokeSum.gain);

    this.osc.connect(this.pipeFilter);
    this.pipeFilter.connect(strokeSum);
    strokeSum.connect(this.oscGain);

    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);

    this.master = ctx.createGain();
    this.master.gain.value = 0.35;

    this.oscGain.connect(this.master);
    this.noiseGain.connect(this.master);
    this.master.connect(ctx.destination);

    this.osc.start();
    this.noise.start();
    this.strokeLfo.start();
    this.strokeOffset.start();

    this.ready = true;
  }

  stop() {
    if (!this.ready) return;
    this.oscGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  // Drive the synth from live engine state each frame.
  update({ rpm, throttleFrac, mixDev, running }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const smooth = 0.08;

    if (!running || rpm < 100) {
      this.oscGain.gain.setTargetAtTime(0, t, smooth);
      this.noiseGain.gain.setTargetAtTime(0, t, smooth);
      return;
    }

    const freq = 35 + (rpm / 32000) * 320;
    this.osc.frequency.setTargetAtTime(freq, t, smooth);
    this.pipeFilter.frequency.setTargetAtTime(freq * 3, t, smooth);

    // Lean mixtures: push pitch up and add jitter for the "angry"/surging note.
    const leanness = Math.max(0, -mixDev);
    const leanJitter = Math.min(1, leanness / 8);
    const jitter = (Math.random() * 2 - 1) * leanJitter * freq * 0.08;
    this.osc.frequency.setTargetAtTime(freq + freq * leanJitter * 0.15 + jitter, t, 0.03);

    // Stroke-pop depth: strong at idle (normal 4-stroking), should fade out
    // by full throttle on a correctly tuned engine; an over-rich mixture
    // keeps it present even at high throttle.
    const richness = Math.max(0, mixDev);
    const idleBurble = Math.max(0, 1 - throttleFrac * 2.2);
    const richBurbleAtSpeed = Math.min(1, richness / 6) * throttleFrac;
    const strokeDepth = Math.min(0.9, idleBurble * 0.8 + richBurbleAtSpeed);
    this.strokeDepth.gain.setTargetAtTime(strokeDepth, t, smooth);
    this.strokeLfo.frequency.setTargetAtTime(6 + throttleFrac * 4, t, smooth);

    const volume = 0.15 + throttleFrac * 0.25;
    this.oscGain.gain.setTargetAtTime(volume, t, smooth);

    const noiseVol = 0.03 + throttleFrac * 0.05 + richness * 0.004;
    this.noiseGain.gain.setTargetAtTime(noiseVol, t, smooth);
    this.noiseFilter.frequency.setTargetAtTime(600 + freq * 2, t, smooth);
  }
}
