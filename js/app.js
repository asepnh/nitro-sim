import { EngineModel } from "./engineModel.js";
import { EngineAudio } from "./audio.js";

const model = new EngineModel();
const audio = new EngineAudio();

let tempUnit = "C";
let selectedStep = { hsn: 1, lsn: 1, idle: 1 };

// ---------- DOM refs ----------
const el = (sel) => document.querySelector(sel);
const startStopBtn = el("#startStopBtn");
const resetBtn = el("#resetBtn");
const instructorMode = el("#instructorMode");
const throttleSlider = el("#throttleSlider");
const statusBanner = el("#statusBanner");
const unitToggle = el("#unitToggle");
const guideToggle = el("#guideToggle");
const guidePanel = el("#guidePanel");

const rpmCanvas = document.querySelector("#rpmGauge canvas");
const tempCanvas = document.querySelector("#tempGauge canvas");
const smokePuff = el("#smokePuff");

guideToggle.addEventListener("click", () => {
  const open = guidePanel.classList.toggle("hidden");
  guideToggle.setAttribute("aria-expanded", String(!open));
});

unitToggle.addEventListener("click", () => {
  tempUnit = tempUnit === "F" ? "C" : "F";
  unitToggle.textContent = `°${tempUnit}`;
});

// ---------- Throttle ----------
throttleSlider.addEventListener("input", () => {
  model.setThrottle(Number(throttleSlider.value));
  updateThrottlePresetHighlight();
});
document.querySelectorAll(".throttle-presets button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = Number(btn.dataset.throttle);
    model.setThrottle(val);
    throttleSlider.value = String(val);
    updateThrottlePresetHighlight();
  });
});
function updateThrottlePresetHighlight() {
  document.querySelectorAll(".throttle-presets button").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.throttle) === model.throttle);
  });
}

// ---------- Start/stop/reset ----------
startStopBtn.addEventListener("click", () => {
  if (model.running) {
    model.stopEngine();
  } else {
    if (model.seized) return;
    audio.init();
    model.startEngine();
  }
  updateRunButton();
});

resetBtn.addEventListener("click", () => {
  audio.stop();
  model.reset(); // rebuilds history (and everything else) via the constructor
  throttleSlider.value = "0";
  updateThrottlePresetHighlight();
  updateRunButton();
});

function updateRunButton() {
  startStopBtn.textContent = model.running ? "Stop Engine" : "Start Engine";
  startStopBtn.classList.toggle("running", model.running);
}

// ---------- Needle controls ----------
const needleKeyMap = { hsn: "hsn", lsn: "lsn", idle: "idle" };

document.querySelectorAll(".needle-card").forEach((card) => {
  const key = card.dataset.needle;

  card.querySelectorAll("[data-step-selector] button").forEach((btn) => {
    btn.addEventListener("click", () => {
      card.querySelectorAll("[data-step-selector] button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedStep[key] = Number(btn.dataset.step);
    });
  });

  card.querySelector(".plus-btn").addEventListener("click", () => {
    applyNeedleMove(key, selectedStep[key]);
  });
  card.querySelector(".minus-btn").addEventListener("click", () => {
    applyNeedleMove(key, -selectedStep[key]);
  });
});

function applyNeedleMove(key, hours) {
  if (key === "hsn") model.adjustHSN(hours);
  else if (key === "lsn") model.adjustLSN(hours);
  else if (key === "idle") model.adjustIdleScrew(hours * 4); // screw: coarser %, not hours

  const card = document.querySelector(`.needle-card[data-needle="${key}"]`);
  const lastMove = card.querySelector("[data-last-move]");
  const dirLabel =
    key === "idle"
      ? hours > 0 ? "faster" : "slower"
      : hours > 0 ? "CCW (richer)" : "CW (leaner)";
  const hourLabels = { 0.25: "1/4 hr", 0.5: "1/2 hr", 1: "1 hr" };
  const amountLabel = hourLabels[Math.abs(hours)] || `${Math.abs(hours)} hr`;
  lastMove.textContent = `Turned ${amountLabel} ${dirLabel}`;
}

// ---------- Canvas gauges ----------
function drawDial(canvas, frac, color, label) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = w / 2 - 10;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#2b3542";
  ctx.stroke();

  const sweep = 1.5 * Math.PI * Math.max(0, Math.min(1, frac));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 0.75 * Math.PI + sweep);
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawClockDial(canvas, hoursMod12, color) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = w / 2 - 6;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#151b22";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#2b3542";
  ctx.stroke();

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(a) * (r - 6);
    const y1 = cy + Math.sin(a) * (r - 6);
    const x2 = cx + Math.cos(a) * (r - 2);
    const y2 = cy + Math.sin(a) * (r - 2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = "#3a4654";
    ctx.lineWidth = i % 3 === 0 ? 2 : 1;
    ctx.stroke();
  }

  const angle = (hoursMod12 / 12) * Math.PI * 2 - Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * (r - 14), cy + Math.sin(angle) * (r - 14));
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

const needleDials = {
  hsn: document.querySelector('.needle-card[data-needle="hsn"] .clock-dial canvas'),
  lsn: document.querySelector('.needle-card[data-needle="lsn"] .clock-dial canvas'),
  idle: document.querySelector('.needle-card[data-needle="idle"] .clock-dial canvas'),
};
const needleReadouts = {
  hsn: document.querySelector('.needle-card[data-needle="hsn"] [data-readout]'),
  lsn: document.querySelector('.needle-card[data-needle="lsn"] [data-readout]'),
  idle: document.querySelector('.needle-card[data-needle="idle"] [data-readout]'),
};

function fmtTurns(hours) {
  const turns = hours / 12;
  return `${turns.toFixed(2)} turns open`;
}

// ---------- Status checklist ----------
const statusItems = {
  idle: el("#status-idle"),
  transition: el("#status-transition"),
  temp: el("#status-temp"),
  power: el("#status-power"),
  smoke: el("#status-smoke"),
};

function updateChecklist() {
  const s = model.getTuneStatus();
  statusItems.idle.classList.toggle("ok", s.idleOk);
  statusItems.idle.classList.toggle("bad", !s.idleOk && model.history.idleStallEvents > 0);
  statusItems.transition.classList.toggle("ok", s.transitionOk);
  statusItems.transition.classList.toggle("bad", !s.transitionOk && model.history.transitionBogEvents > 0);
  statusItems.temp.classList.toggle("ok", s.tempOk);
  statusItems.temp.classList.toggle("bad", !s.tempOk && model.history.topEndOverheatTime > 1);
  statusItems.power.classList.toggle("ok", s.powerOk);
  statusItems.smoke.classList.toggle("ok", s.smokeOk);
  statusItems.smoke.classList.toggle(
    "bad",
    !s.smokeOk &&
      (model.history.topEndSmokeHeavyTime > 1 || model.history.topEndSmokeNoneTime > 1)
  );
}

// ---------- Status banner ----------
function updateBanner() {
  if (model.seized) {
    statusBanner.className = "status-banner seized";
    statusBanner.textContent =
      "⚠ Engine seized! You ran it too lean under load for too long. Richen the needles and reset to try again.";
  } else if (model.fouled) {
    statusBanner.className = "status-banner fouled";
    statusBanner.textContent =
      "Plug fouled: the low-speed needle was far too rich at idle. Lean the LSN and reset to restart.";
  } else if (model.stalled && model.running === false && !model.seized) {
    statusBanner.className = "status-banner stalled";
    statusBanner.textContent = "Engine stalled. Check your low-speed needle if this keeps happening at idle.";
  } else {
    statusBanner.className = "status-banner hidden";
  }
}

// ---------- Main loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  model.step(dt);
  const diag = model.getDiagnostics();

  audio.update({
    rpm: model.rpm,
    throttleFrac: model.throttle / 100,
    mixDev: diag.mixDev,
    running: model.running,
  });

  // Gauges
  drawDial(rpmCanvas, model.rpm / 32000, "#ff7a30");
  el("#rpmValue").textContent = Math.round(model.rpm).toLocaleString();

  const tempFrac = (model.tempF - 70) / (300 - 70);
  const tempColor = model.tempF > 270 ? "#ff4d4f" : model.tempF > 250 ? "#f5c542" : "#3fa9f5";
  drawDial(tempCanvas, tempFrac, tempColor);
  const tempDisplay =
    tempUnit === "F" ? `${Math.round(model.tempF)}°F` : `${Math.round((model.tempF - 32) * 5 / 9)}°C`;
  el("#tempValue").textContent = tempDisplay;

  smokePuff.style.height = `${10 + model.smoke * 0.5}%`;
  smokePuff.style.opacity = String(0.1 + model.smoke / 130);
  el("#smokeValue").textContent =
    model.smoke > 55 ? "Heavy / wet" : model.smoke > 25 ? "Visible" : model.smoke > 8 ? "Light" : "Clean";

  for (const key of ["hsn", "lsn", "idle"]) {
    const hours = key === "hsn" ? model.hsnHours : key === "lsn" ? model.lsnHours : model.idleScrew * 0.12;
    const dev =
      key === "hsn" ? model.hsnDeviation : key === "lsn" ? model.lsnDeviation : 0;
    const color = dev > 1 ? "#3fa9f5" : dev < -1 ? "#ff4d4f" : "#e8edf2";
    drawClockDial(needleDials[key], hours % 12, color);
    if (key === "idle") {
      needleReadouts[key].textContent =
        model.idleScrew < 35 ? "Slow idle" : model.idleScrew > 65 ? "Fast idle" : "Mid idle";
    } else {
      needleReadouts[key].textContent = fmtTurns(hours);
    }
  }

  if (instructorMode.checked) {
    needleReadouts.hsn.textContent += model.hsnDeviation > 0 ? " (rich)" : model.hsnDeviation < 0 ? " (lean)" : " (spot on)";
    needleReadouts.lsn.textContent += model.lsnDeviation > 0 ? " (rich)" : model.lsnDeviation < 0 ? " (lean)" : " (spot on)";
  }

  updateChecklist();
  updateBanner();
  updateRunButton();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
