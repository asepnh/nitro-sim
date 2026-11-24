// Nitro engine tuning model.
//
// Two needles meter fuel (in "hours" of rotation, 12 hours = 1 full turn,
// counter-clockwise = richer/more fuel, clockwise = leaner/less fuel):
//   - High-speed needle (HSN): meters fuel at mid/high RPM.
//   - Low-speed needle (LSN): meters fuel at idle/transition.
// A mechanical idle screw sets idle RPM but doesn't change the mixture.
//
// "Optimal" needle positions are hidden from the player by default (like a
// real engine, you tune by ear/smoke/heat, not a readout) and are randomized
// per session within realistic ranges so the same car doesn't always tune
// the same way.

export class EngineModel {
  constructor(rng = Math.random) {
    this.rng = rng;

    // Hidden "correct" needle positions, in hours-open-from-fully-closed.
    this.hsnOptimal = 26 + rng() * 10; // ~2.2 - 3.0 turns out
    this.lsnOptimal = 8 + rng() * 6; // ~0.7 - 1.2 turns out

    // Player-controlled state.
    this.hsnHours = this.hsnOptimal + (rng() * 10 - 5); // start mistuned
    this.lsnHours = this.lsnOptimal + (rng() * 6 - 3);
    this.idleScrew = 50; // 0-100, mechanical idle-speed stop
    this.throttle = 0; // 0-100

    this.running = false;
    this.ambientF = 75;

    // Simulated physical state.
    this.rpm = 0;
    this.targetRpm = 0;
    this.tempF = this.ambientF;
    this.smoke = 0; // 0-100 density
    this.warmup = 0; // 0-1
    this.fouled = false; // flooded/fouled plug
    this.seized = false; // lean seizure (damage)
    this.stalled = false;

    this.leanHeatAccum = 0; // builds toward seizure under sustained lean+load
    this.richFoulAccum = 0; // builds toward fouling under sustained rich+idle

    this.idleHangTimer = 0;
    this.lastThrottle = 0;

    // Rolling "tune quality" telemetry used by the status checklist.
    this.history = {
      idleStableTime: 0,
      idleStallEvents: 0,
      transitionBogEvents: 0,
      topEndTime: 0,
      topEndGoodTime: 0,
      topEndOverheatTime: 0,
      topEndSmokeGoodTime: 0,
      topEndSmokeHeavyTime: 0,
      topEndSmokeNoneTime: 0,
    };
  }

  clampNeedles() {
    this.hsnHours = Math.max(0, Math.min(60, this.hsnHours));
    this.lsnHours = Math.max(0, Math.min(36, this.lsnHours));
    this.idleScrew = Math.max(0, Math.min(100, this.idleScrew));
  }

  // Positive = too rich, negative = too lean, 0 = perfect, in "hours".
  get hsnDeviation() {
    return this.hsnHours - this.hsnOptimal;
  }
  get lsnDeviation() {
    return this.lsnHours - this.lsnOptimal;
  }

  adjustHSN(hours) {
    this.hsnHours += hours;
    this.clampNeedles();
  }
  adjustLSN(hours) {
    this.lsnHours += hours;
    this.clampNeedles();
  }
  adjustIdleScrew(percent) {
    this.idleScrew += percent;
    this.clampNeedles();
  }

  startEngine() {
    if (this.seized) return false;
    this.running = true;
    this.stalled = false;
    this.fouled = false;
    return true;
  }

  stopEngine() {
    this.running = false;
    this.rpm = 0;
  }

  reset() {
    const rng = this.rng;
    Object.assign(this, new EngineModel(rng));
  }

  setThrottle(pct) {
    this.throttle = Math.max(0, Math.min(100, pct));
  }

  // Core physics step. dt in seconds.
  step(dt) {
    if (!this.running) {
      this.rpm = Math.max(0, this.rpm - 4000 * dt);
      this.tempF += (this.ambientF - this.tempF) * Math.min(1, dt * 0.05);
      this.smoke = Math.max(0, this.smoke - 60 * dt);
      return;
    }

    if (this.stalled || this.seized) {
      this.rpm = Math.max(0, this.rpm - 6000 * dt);
      this.running = this.rpm > 50;
      this.tempF += (this.ambientF - this.tempF) * Math.min(1, dt * 0.03);
      return;
    }

    this.warmup = Math.min(1, this.warmup + dt / 15);

    const throttleFrac = this.throttle / 100;
    const hsnDev = this.hsnDeviation; // + rich, - lean
    const lsnDev = this.lsnDeviation;

    // Blend influence of HSN vs LSN by throttle position: LSN dominates the
    // idle/transition circuit, HSN dominates mid-high throttle.
    const lsnWeight = Math.max(0, 1 - throttleFrac * 2.2);
    const hsnWeight = 1 - lsnWeight;
    const mixDev = lsnDev * lsnWeight + hsnDev * hsnWeight;

    // --- RPM / power model -------------------------------------------------
    const idleBaseRpm = 2200 + (this.idleScrew - 50) * 30; // mechanical stop
    const maxRpm = 32000;
    let powerFactor;
    if (mixDev >= 0) {
      // Rich: fuel-fouled, sluggish, bogs harder the richer it gets.
      powerFactor = 1 - Math.min(0.85, mixDev * 0.05);
    } else {
      const leanness = -mixDev;
      const safeLean = 3; // hours leaner than optimal still considered safe
      if (leanness <= safeLean) {
        // Slightly lean of peak is genuinely the most power, as in reality.
        powerFactor = 1 + leanness * 0.03;
      } else {
        const overLean = leanness - safeLean;
        // Misfire/surge regime: power gets unstable and falls off.
        powerFactor = 1 + safeLean * 0.03 - overLean * 0.06;
        powerFactor -= this.rng() * overLean * 0.03; // surging
      }
    }
    powerFactor = Math.max(0.1, powerFactor);

    this.targetRpm =
      idleBaseRpm + (maxRpm - idleBaseRpm) * throttleFrac * powerFactor;
    this.targetRpm *= 0.4 + 0.6 * this.warmup;

    // Idle hang: an over-rich low-speed needle keeps RPM elevated after the
    // throttle is released instead of settling back to idle quickly.
    if (this.throttle < 15 && this.lastThrottle >= 15) {
      this.idleHangTimer = Math.max(0, lsnDev) * 0.4;
    }
    if (this.idleHangTimer > 0) {
      this.idleHangTimer -= dt;
      this.targetRpm = Math.max(this.targetRpm, idleBaseRpm * 1.6);
    }

    // An over-lean low-speed needle makes idle unstable / prone to stalling.
    if (throttleFrac < 0.15) {
      const idleLeanness = Math.max(0, -lsnDev);
      if (idleLeanness > 2) {
        const stallChance = Math.min(0.9, (idleLeanness - 2) * 0.12) * dt;
        if (this.rng() < stallChance) {
          this.stalled = true;
          this.history.idleStallEvents++;
        }
        this.targetRpm *= 1 - this.rng() * 0.3; // surging/hunting
      } else {
        this.history.idleStableTime += dt;
      }
    }

    // Approach target RPM with inertia (engines don't snap instantly).
    const rpmRate = this.rpm < this.targetRpm ? 14060 : 10940;
    const maxStep = rpmRate * dt;
    const delta = this.targetRpm - this.rpm;
    this.rpm += Math.max(-maxStep, Math.min(maxStep, delta));
    this.rpm = Math.max(0, this.rpm);

    // Bog on hard throttle punch with a badly over-rich transition.
    if (
      this.throttle > this.lastThrottle + 20 &&
      lsnDev + hsnDev * 0.5 > 6
    ) {
      this.history.transitionBogEvents++;
      this.rpm *= 0.85;
    }

    // --- Temperature model ---------------------------------------------
    const loadHeat = 55 * throttleFrac * (0.5 + 0.5 * this.warmup);
    let mixHeat;
    if (mixDev >= 0) {
      mixHeat = -Math.min(35, mixDev * 3); // richer runs cooler
    } else {
      const leanness = -mixDev;
      mixHeat = Math.min(140, leanness * leanness * 1.6); // lean runs hot, fast
    }
    const targetTemp = this.ambientF + 110 * this.warmup + loadHeat + mixHeat;
    this.tempF += (targetTemp - this.tempF) * Math.min(1, dt * 0.6);

    if (throttleFrac > 0.6) {
      this.history.topEndTime += dt;
      if (this.tempF < 260) this.history.topEndGoodTime += dt;
      if (this.tempF > 270) this.history.topEndOverheatTime += dt;
    }

    // Sustained dangerous lean + load risks a seizure (real engine damage).
    if (mixDev < -3 && throttleFrac > 0.5 && this.tempF > 260) {
      this.leanHeatAccum += dt * (this.tempF - 260) * 0.02;
      if (this.leanHeatAccum > 6) {
        this.seized = true;
        this.running = false;
      }
    } else {
      this.leanHeatAccum = Math.max(0, this.leanHeatAccum - dt * 2);
    }

    // Sustained over-rich idle risks fouling the glow plug.
    if (lsnDev > 5 && throttleFrac < 0.1 && this.rpm < idleBaseRpm * 1.3) {
      this.richFoulAccum += dt;
      if (this.richFoulAccum > 12) {
        this.fouled = true;
        this.stalled = true;
      }
    } else {
      this.richFoulAccum = Math.max(0, this.richFoulAccum - dt * 1.5);
    }

    // --- Smoke -----------------------------------------------------------
    // A correctly tuned engine still trails a thin wisp of smoke at full
    // throttle, not none - "none" means you've already gone past peak into
    // lean territory, which is exactly the trap the tuning guide warns about.
    let targetSmoke = 15 + Math.max(0, mixDev) * 7 - throttleFrac * 5;
    if (mixDev < -1) targetSmoke -= 8; // lean of peak = thin/no smoke
    targetSmoke = Math.max(0, Math.min(100, targetSmoke));
    this.smoke += (targetSmoke - this.smoke) * Math.min(1, dt * 1.5);

    if (throttleFrac > 0.6) {
      if (this.smoke >= 5 && this.smoke <= 35) this.history.topEndSmokeGoodTime += dt;
      if (this.smoke > 50) this.history.topEndSmokeHeavyTime += dt;
      if (this.smoke < 3) this.history.topEndSmokeNoneTime += dt;
    }

    this.lastThrottle = this.throttle;
  }

  // Simple diagnostic classification used by the UI to render feedback
  // without ever showing the player the raw numeric deviation.
  getDiagnostics() {
    const throttleFrac = this.throttle / 100;
    const lsnWeight = Math.max(0, 1 - throttleFrac * 2.2);
    const hsnWeight = 1 - lsnWeight;
    const mixDev = this.lsnDeviation * lsnWeight + this.hsnDeviation * hsnWeight;

    let mixtureState = "good";
    if (mixDev > 4) mixtureState = "very-rich";
    else if (mixDev > 1.5) mixtureState = "rich";
    else if (mixDev < -5) mixtureState = "very-lean";
    else if (mixDev < -1.5) mixtureState = "lean";

    return { mixDev, mixtureState };
  }

  getTuneStatus() {
    const h = this.history;
    const idleOk =
      h.idleStableTime > 4 && h.idleStallEvents === 0 && !this.fouled;
    const transitionOk = h.transitionBogEvents === 0 && h.topEndTime > 2;
    const tempOk =
      h.topEndTime > 3 && h.topEndOverheatTime / Math.max(1, h.topEndTime) < 0.1;
    const powerOk =
      h.topEndGoodTime > 3 && Math.abs(this.hsnDeviation) < 2.5;
    const smokeOk =
      h.topEndTime > 3 &&
      h.topEndSmokeGoodTime / Math.max(1, h.topEndTime) > 0.5 &&
      h.topEndSmokeHeavyTime / Math.max(1, h.topEndTime) < 0.2 &&
      h.topEndSmokeNoneTime / Math.max(1, h.topEndTime) < 0.2;

    return { idleOk, transitionOk, tempOk, powerOk, smokeOk };
  }
}
