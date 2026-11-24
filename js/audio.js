// Web Audio synth for the engine note.
//
// A plain oscillator (even filtered/distorted) reads as "synthesizer" because
// it is perfectly periodic and perfectly smooth. A real small glow engine is
// neither: each revolution is a distinct combustion "crack" with cycle-to-
// cycle irregularity, and the exhaust pipe rings (resonates) after each one.
// This version builds the tone from:
//   - a narrow-pulse custom waveform (bright, buzzy harmonic spectrum close
//     to a real combustion crack, instead of a smooth sawtooth/square),
//   - continuous audio-rate noise-derived wobble on pitch/amplitude (organic
//     cycle-to-cycle instability, not a steppy per-frame random jitter),
//   - a resonant feedback-delay "pipe" that rings after each pulse like a
//     tuned exhaust, and
//   - a pulse-shaped (not sine-shaped) amplitude gate so idle sounds like
//     distinct "putt-putt-putt" chugs that smear into a continuous scream
//     as RPM rises, instead of a smooth tremolo.
//
// Mobile browsers require audio to be started/resumed from a user gesture,
// so init() must be called from a click/tap handler (the Start Engine
// button).

// Builds a PeriodicWave approximating a narrow-duty pulse train: harmonic
// amplitudes follow a sinc-ish envelope (bright, with spectral notches)
// rather than a sawtooth's smooth 1/n roll-off, which is what makes a small
// glow engine sound "cracky" instead of "musical". A little per-harmonic
// phase randomization breaks the perfect symmetry of a textbook pulse wave.
function buildEngineWave(ctx, duty, seedRng) {
  const n = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const amp = Math.abs(Math.sin(Math.PI * k * duty) / (Math.PI * k)) * 2;
    const phaseWobble = (seedRng() - 0.5) * 0.6;
    imag[k] = amp * Math.cos(phaseWobble);
    real[k] = amp * Math.sin(phaseWobble) * 0.5;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// A narrow positive pulse (not a sine) for the amplitude gate, so low-RPM
// idle reads as separate percussive "chugs" rather than a smooth tremolo.
function buildGateWave(ctx, duty) {
  const n = 48;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const amp = Math.sin(Math.PI * k * duty) / (Math.PI * k);
    imag[k] = amp;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function makeNoiseBuffer(ctx, seconds) {
  const bufferSize = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
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
    let seed = 1337;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    // --- Combustion core: narrow-pulse oscillator -------------------------
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(buildEngineWave(ctx, 0.14, rng));
    this.osc.frequency.value = 36;

    // --- Continuous organic instability -------------------------------
    // White noise through a very narrow low-pass acts as a slow, smooth
    // random wander (cycle-to-cycle combustion variation) rather than a
    // steppy per-frame Math.random() jitter.
    this.wobbleNoise = ctx.createBufferSource();
    this.wobbleNoise.buffer = makeNoiseBuffer(ctx, 2);
    this.wobbleNoise.loop = true;
    this.wobbleFilter = ctx.createBiquadFilter();
    this.wobbleFilter.type = "lowpass";
    this.wobbleFilter.frequency.value = 14;
    this.wobbleFilter.Q.value = 0.3;
    this.wobbleToDetune = ctx.createGain();
    this.wobbleToDetune.gain.value = 0; // cents of detune wander
    this.wobbleNoise.connect(this.wobbleFilter);
    this.wobbleFilter.connect(this.wobbleToDetune);
    this.wobbleToDetune.connect(this.osc.detune);

    // A second, faster wobble feeds amplitude for a rougher, less-clean note.
    this.roughNoise = ctx.createBufferSource();
    this.roughNoise.buffer = makeNoiseBuffer(ctx, 2);
    this.roughNoise.loop = true;
    this.roughFilter = ctx.createBiquadFilter();
    this.roughFilter.type = "lowpass";
    this.roughFilter.frequency.value = 45;
    this.roughToAmp = ctx.createGain();
    this.roughToAmp.gain.value = 0;
    this.roughOffset = ctx.createConstantSource();
    this.roughOffset.offset.value = 1;
    this.roughNoise.connect(this.roughFilter);
    // roughSum computes an envelope SIGNAL (1 + wobble) by multiplying a
    // constant "1" audio input by a gain param driven from the offset +
    // noise wobble; its *output* is then usable as a modulation source.
    this.unityCarrier = ctx.createConstantSource();
    this.unityCarrier.offset.value = 1;
    const roughSum = ctx.createGain();
    this.unityCarrier.connect(roughSum);
    this.roughFilter.connect(this.roughToAmp);
    this.roughToAmp.connect(roughSum.gain);
    this.roughOffset.connect(roughSum.gain);

    // --- Amplitude gate: pulse-shaped, tied to firing rate ----------------
    // At idle this creates distinct "putt-putt" chugs; as depth is reduced
    // with RPM/throttle it smears into a continuous note, like a real
    // engine's idle-to-scream transition.
    this.gateOsc = ctx.createOscillator();
    this.gateOsc.setPeriodicWave(buildGateWave(ctx, 0.3));
    this.gateOsc.frequency.value = 36;
    this.gateDepth = ctx.createGain();
    this.gateDepth.gain.value = 0;
    this.gateOffset = ctx.createConstantSource();
    this.gateOffset.offset.value = 1;
    const gateSum = ctx.createGain();
    this.unityCarrier.connect(gateSum);
    this.gateOsc.connect(this.gateDepth);
    this.gateDepth.connect(gateSum.gain);
    this.gateOffset.connect(gateSum.gain);

    // --- Exhaust pipe resonance: feedback comb filter ---------------------
    // A short feedback delay rings at 1/delayTime, giving the metallic
    // "tuned pipe" ring a static peaking EQ can't reproduce.
    this.pipeDelay = ctx.createDelay(0.05);
    this.pipeDelay.delayTime.value = 1 / 2200;
    this.pipeFeedback = ctx.createGain();
    this.pipeFeedback.gain.value = 0.55;
    this.pipeDamping = ctx.createBiquadFilter();
    this.pipeDamping.type = "lowpass";
    this.pipeDamping.frequency.value = 6000;
    this.pipeDelay.connect(this.pipeDamping);
    this.pipeDamping.connect(this.pipeFeedback);
    this.pipeFeedback.connect(this.pipeDelay);

    this.pipeWetGain = ctx.createGain();
    this.pipeWetGain.gain.value = 0.5;
    this.pipeDryGain = ctx.createGain();
    this.pipeDryGain.gain.value = 0.8;

    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 220;
    this.highpass.Q.value = 0.7;

    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;

    // --- Exhaust rasp: filtered noise, amplitude-gated with the core ------
    this.noise = ctx.createBufferSource();
    this.noise.buffer = makeNoiseBuffer(ctx, 2);
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 3200;
    this.noiseFilter.Q.value = 0.5;
    this.noiseGateGain = ctx.createGain();
    this.noiseGateGain.gain.value = 0; // value comes entirely from gateSum's modulation
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;

    // --- Wire the graph ----------------------------------------------------
    const core = ctx.createGain(); // combustion core, pre-roughening
    this.osc.connect(core);

    const roughened = ctx.createGain();
    roughened.gain.value = 0; // value comes entirely from roughSum's modulation
    core.connect(roughened);
    roughSum.connect(roughened.gain);

    roughened.connect(this.highpass);
    this.highpass.connect(this.pipeDryGain);
    this.highpass.connect(this.pipeDelay);
    this.pipeDelay.connect(this.pipeWetGain);

    const piped = ctx.createGain();
    this.pipeDryGain.connect(piped);
    this.pipeWetGain.connect(piped);

    const gated = ctx.createGain();
    gated.gain.value = 0; // value comes entirely from gateSum's modulation
    piped.connect(gated);
    gateSum.connect(gated.gain);

    gated.connect(this.oscGain);

    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGateGain);
    gateSum.connect(this.noiseGateGain.gain);
    this.noiseGateGain.connect(this.noiseGain);

    this.master = ctx.createGain();
    this.master.gain.value = 0.32;
    this.oscGain.connect(this.master);
    this.noiseGain.connect(this.master);
    this.master.connect(ctx.destination);

    this.osc.start();
    this.gateOsc.start();
    this.wobbleNoise.start();
    this.roughNoise.start();
    this.roughOffset.start();
    this.gateOffset.start();
    this.unityCarrier.start();
    this.noise.start();

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

    // Firing frequency: once per revolution, pitched up ~30% from the
    // literal firing rate for a brighter, less bassy note. RPM 2200 ->
    // ~48Hz idle putter, RPM 32000 -> ~693Hz full-throttle whine.
    const freq = (rpm / 60) * 1.3;
    const leanness = Math.max(0, -mixDev);
    const richness = Math.max(0, mixDev);

    // Lean mixtures run hotter and misfire more -> more wobble/instability,
    // and a sharper, slightly higher note ("angry").
    const instability = Math.min(1, leanness / 7);
    const tunedFreq = freq * (1 + instability * 0.1);
    this.osc.frequency.setTargetAtTime(tunedFreq, t, 0.02);
    this.gateOsc.frequency.setTargetAtTime(tunedFreq, t, 0.02);

    this.wobbleToDetune.gain.setTargetAtTime(6 + instability * 70, t, smooth);
    this.roughToAmp.gain.setTargetAtTime(0.04 + instability * 0.35, t, smooth);

    // Exhaust pipe resonance tracks RPM a bit (shorter effective pipe at
    // higher RPM reads as a higher ring frequency), and leaner runs ring
    // harder/brighter (closer to the edge of misfire).
    const resonantFreq = 1000 + tunedFreq * 2.6;
    this.pipeDelay.delayTime.setTargetAtTime(1 / resonantFreq, t, smooth);
    this.pipeFeedback.gain.setTargetAtTime(0.45 + instability * 0.2, t, smooth);
    this.pipeDamping.frequency.setTargetAtTime(3500 + throttleFrac * 4000, t, smooth);

    // Amplitude gate depth: strong separated "putt-putt" at idle (normal),
    // smearing into a continuous scream as throttle/RPM rise on a correctly
    // tuned engine. An over-rich mixture keeps a loose, blubbery gate open
    // even at higher throttle instead of cleaning out.
    const idleGate = Math.max(0, 1 - throttleFrac * 1.8);
    const richBlubber = Math.min(1, richness / 6) * throttleFrac;
    const gateDepth = Math.min(0.95, idleGate * 0.9 + richBlubber * 0.7);
    this.gateDepth.gain.setTargetAtTime(gateDepth, t, smooth);

    const volume = 0.18 + throttleFrac * 0.22 - Math.min(0.08, richness * 0.01);
    this.oscGain.gain.setTargetAtTime(Math.max(0.05, volume), t, smooth);

    const noiseVol = 0.05 + throttleFrac * 0.07 + richness * 0.004 + instability * 0.03;
    this.noiseGain.gain.setTargetAtTime(noiseVol, t, smooth);
    this.noiseFilter.frequency.setTargetAtTime(2200 + tunedFreq * 3.5, t, smooth);
  }
}
