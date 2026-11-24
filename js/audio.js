// Web Audio synth for the engine note. Mobile browsers require audio to be
// started/resumed from a user gesture, so init() must be called from a
// click/tap handler (the Start Engine button).
//
// A nitro glow engine is a tiny, very-high-revving single-cylinder two-stroke:
// the sound is a bright, buzzy, almost siren-like whine dominated by high
// harmonics (not a low rumble), with a resonant tuned-pipe peak, built from
// the firing rate (RPM/60, since it fires once per revolution).
function makeDistortionCurve(amount) {
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

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

    // Fundamental: fires once per revolution, so frequency = RPM / 60.
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 36;

    // A second oscillator an octave+ up adds the bright overtone buzz a
    // small glow engine has, beyond what one sawtooth's harmonics give.
    this.oscHigh = ctx.createOscillator();
    this.oscHigh.type = "square";
    this.oscHigh.frequency.value = 72;
    this.oscHighGain = ctx.createGain();
    this.oscHighGain.gain.value = 0.18;

    // Mild waveshaper distortion adds bite/edge to the harmonics, like a
    // small engine's hard-edged exhaust note rather than a soft synth tone.
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeDistortionCurve(18);
    this.shaper.oversample = "2x";

    // Cut the muddy low end - nitro engines have almost no bass content.
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 180;
    this.highpass.Q.value = 0.7;

    // Resonant peak modeling the tuned exhaust pipe's "scream" character,
    // swept with RPM.
    this.pipeFilter = ctx.createBiquadFilter();
    this.pipeFilter.type = "peaking";
    this.pipeFilter.frequency.value = 2200;
    this.pipeFilter.Q.value = 2.2;
    this.pipeFilter.gain.value = 10;

    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;

    // Broadband noise, filtered high, adds exhaust sizzle/rasp rather than
    // a muddy hiss.
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer;
    this.noise.loop = true;

    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 3500;
    this.noiseFilter.Q.value = 0.6;

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

    const oscMix = ctx.createGain();
    this.osc.connect(oscMix);
    this.oscHigh.connect(this.oscHighGain);
    this.oscHighGain.connect(oscMix);

    oscMix.connect(this.shaper);
    this.shaper.connect(this.highpass);
    this.highpass.connect(this.pipeFilter);
    this.pipeFilter.connect(strokeSum);
    strokeSum.connect(this.oscGain);

    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);

    this.master = ctx.createGain();
    this.master.gain.value = 0.3;

    this.oscGain.connect(this.master);
    this.noiseGain.connect(this.master);
    this.master.connect(ctx.destination);

    this.osc.start();
    this.oscHigh.start();
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
    const smooth = 0.06;

    if (!running || rpm < 100) {
      this.oscGain.gain.setTargetAtTime(0, t, smooth);
      this.noiseGain.gain.setTargetAtTime(0, t, smooth);
      return;
    }

    // Firing frequency: once per revolution. RPM 2200 -> ~37Hz idle burble,
    // RPM 32000 -> ~533Hz full-throttle whine.
    const freq = rpm / 60;

    // Lean mixtures: push pitch up and add jitter for the "angry"/surging note.
    const leanness = Math.max(0, -mixDev);
    const leanJitter = Math.min(1, leanness / 8);
    const jitter = (Math.random() * 2 - 1) * leanJitter * freq * 0.1;
    const tunedFreq = freq * (1 + leanJitter * 0.12) + jitter;

    this.osc.frequency.setTargetAtTime(tunedFreq, t, 0.025);
    this.oscHigh.frequency.setTargetAtTime(tunedFreq * 2.01, t, 0.025);
    this.pipeFilter.frequency.setTargetAtTime(1200 + tunedFreq * 3.2, t, smooth);
    this.pipeFilter.gain.setTargetAtTime(8 + leanJitter * 6, t, smooth);

    // Stroke-pop depth: strong at idle (normal 4-stroking), should fade out
    // by full throttle on a correctly tuned engine; an over-rich mixture
    // keeps it present even at high throttle. Rate scales with RPM so the
    // pops feel mechanically tied to the engine rather than a fixed wobble.
    const richness = Math.max(0, mixDev);
    const idleBurble = Math.max(0, 1 - throttleFrac * 2.2);
    const richBurbleAtSpeed = Math.min(1, richness / 6) * throttleFrac;
    const strokeDepth = Math.min(0.85, idleBurble * 0.75 + richBurbleAtSpeed);
    this.strokeDepth.gain.setTargetAtTime(strokeDepth, t, smooth);
    this.strokeLfo.frequency.setTargetAtTime(Math.max(4, freq / 4), t, smooth);

    const volume = 0.16 + throttleFrac * 0.22;
    this.oscGain.gain.setTargetAtTime(volume, t, smooth);
    this.oscHighGain.gain.setTargetAtTime(0.14 + throttleFrac * 0.1, t, smooth);

    const noiseVol = 0.02 + throttleFrac * 0.035 + richness * 0.003;
    this.noiseGain.gain.setTargetAtTime(noiseVol, t, smooth);
    this.noiseFilter.frequency.setTargetAtTime(2500 + tunedFreq * 4, t, smooth);
  }
}
