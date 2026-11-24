# Nitro Tune Trainer

A mobile-friendly web app that teaches how to tune an RC nitro engine's
needle valves by ear, smoke, and temperature — the way you actually do it
trackside, with no literal fuel-mixture readout.

Open `index.html` in a browser, or serve the folder statically (it's plain
HTML/CSS/JS, no build step, no dependencies).

## What it simulates

- **High-speed needle (HSN)** — meters fuel at mid/high RPM.
- **Low-speed needle (LSN)** — meters fuel at idle and the throttle
  transition.
- **Idle speed screw** — a mechanical throttle-barrel stop that sets idle
  RPM only; it doesn't touch the mixture.

Needles are adjusted in "clock hours" (12 hours = one full turn).
Counter-clockwise richens, clockwise leans — matching real needle-valve
convention. The step selector lets you choose 1/4 hour, 1/2 hour, or
1 hour per tap of the +/- buttons, and each tap shows exactly how much
and which direction you just turned.

## Weather, not random mistuning

The needles always start at the same factory-baseline position each
session. What changes is the weather: a randomized track temperature and
humidity (shown in the "Track Conditions" bar, since that's information a
real tuner would actually have) shift the *hidden* correct needle
position. Hot/humid air is less dense, so the engine ingests less oxygen
per revolution — the same needle setting ends up running effectively
richer and needs leaning to compensate. Cold/dry air is denser, so the
same needle setting runs effectively leaner and can take a touch more
fuel. This mirrors why real pit crews re-check their tune through the day
as conditions change, rather than the needles themselves having moved.

The simulation drives RPM, head temperature, exhaust smoke, and a
synthesized engine note (Web Audio) from the needle positions and
throttle, modeling real symptoms:

- **Too rich:** sluggish throttle response, heavy wet smoke, a blubbery
  "4-stroking" sound that should have cleaned out by full throttle, idle
  that hangs high after you let off (and eventually fouls the plug if left
  idling too rich for too long).
- **Too lean:** a harsh, higher-pitched "angry" note, surging/hunting RPM,
  thin-to-no smoke, and rising head temperature — sustained lean running
  under load risks a simulated lean seizure (real nitro engines can
  genuinely seize and damage internals this way).
- **Correctly tuned:** a clean two-stroke scream at full throttle with a
  bit of normal 4-stroke burble at idle/off-throttle, a thin wisp of
  smoke, a stable idle, and temperatures holding in a safe band run after
  run.

A "Tune Checklist" tracks idle stability, transition crispness, top-end
temperature, and top-end power/sound over a run and marks each green once
it's been demonstrated, so there's a concrete signal for "the tune is
right" instead of just a vibe.

An "Instructor mode" toggle reveals whether each needle is currently rich,
lean, or spot-on for learning purposes — real tuning has no such readout,
so it's off by default.

## Research basis

Modeled on widely-used trackside tuning guidance: set the HSN first (warm
engine, from the rich side down), then the LSN; judge the tune by sound,
smoke, and temperature rather than a numeric mixture; watch for the
specific rich/lean symptoms above; and treat sustained lean-running under
load as a real engine-damage risk. See:

- [CompetitionX – Nitro Engines: The Three Needles](https://www.competitionx.com/?p=8160)
- [R/C Tech Forums – the tuning bible](https://www.rctech.net/forum/onroad-nitro-engine-zone/295490-tuning-bible-9-printthread.html)
- [radiocontrol.fandom.com – Nitro engine tuning](https://radiocontrol.fandom.com/wiki/Nitro_engine_tuning)
- [R/C Tech Forums – when too lean](https://www.rctech.net/forum/offroad-nitro-engine-forum/938438-when-too-lean-2.html)
- [RCUniverse – tune your nitro engine tips](https://www.rcuniverse.com/forum/rc-1-8th-scale-buggies-244/2879615-tune-your-nitro-engine-tips.html)

## Files

- `index.html` — layout and controls
- `css/styles.css` — mobile-first styling
- `js/engineModel.js` — the tuning/physics simulation
- `js/audio.js` — Web Audio engine-sound synth
- `js/app.js` — UI wiring, canvas gauges, main loop
