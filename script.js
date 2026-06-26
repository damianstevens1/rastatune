const guitarStrings = [
  { key: "E2", note: "E", octave: "2", name: "Low E", hz: 82.41 },
  { key: "A2", note: "A", octave: "2", name: "A", hz: 110.0 },
  { key: "D3", note: "D", octave: "3", name: "D", hz: 146.83 },
  { key: "G3", note: "G", octave: "3", name: "G", hz: 196.0 },
  { key: "B3", note: "B", octave: "3", name: "B", hz: 246.94 },
  { key: "E4", note: "E", octave: "4", name: "High E", hz: 329.63 },
];

const stringsByKey = Object.fromEntries(guitarStrings.map((string) => [string.key, string]));

const canonicalCharacterFrame = "assets/rasta-character-base.png";

const stateCopy = {
  "way-low": { title: "Way Low", direction: "Tune Up" },
  low: { title: "Getting Closer", direction: "Tune Up" },
  "almost-low": { title: "Almost There", direction: "Almost There" },
  perfect: { title: "Perfect Tune", direction: "Perfect Tune" },
  "almost-high": { title: "Almost There", direction: "Almost There" },
  high: { title: "Getting Higher", direction: "Tune Down" },
  "way-high": { title: "Way High", direction: "Tune Down" },
};

const app = document.querySelector(".app-shell");
const characterFrameA = document.querySelector("#characterFrameA");
const characterFrameB = document.querySelector("#characterFrameB");
const selectedNote = document.querySelector("#selectedNote");
const selectedOctave = document.querySelector("#selectedOctave");
const selectedHz = document.querySelector("#selectedHz");
const selectedName = document.querySelector("#selectedName");
const stateTitle = document.querySelector("#stateTitle");
const directionText = document.querySelector("#directionText");
const frequencyText = document.querySelector("#frequencyText");
const centsText = document.querySelector("#centsText");
const proximityText = document.querySelector("#proximityText");
const targetOverlay = document.querySelector("#targetOverlay");
const detectedNoteText = document.querySelector("#detectedNoteText");
const statusText = document.querySelector("#statusText");
const lockStatus = document.querySelector("#lockStatus");
const demoSlider = document.querySelector("#demoSlider");
const resetDemo = document.querySelector("#resetDemo");
const micButton = document.querySelector("#micButton");
const muteButton = document.querySelector("#muteButton");
const autoButton = document.querySelector("#autoButton");
const stringButtons = [...document.querySelectorAll(".string-button")];

const visual = {
  front: characterFrameA,
  back: characterFrameB,
  currentFrame: canonicalCharacterFrame,
  currentMood: "perfect",
  veilTimer: null,
};

let selectedKey = "E2";
let lockedKey = "E2";
let autoMode = true;
let candidateKey = null;
let candidateStartedAt = 0;
let candidateHits = 0;
let smoothedCents = 0;
let smoothedFrequency = stringsByKey.E2.hz;
let lastSoundAt = 0;
let lastPitchAt = 0;
let lastState = "perfect";
let lastVirtualStage = 8;
let lastPerfectAt = 0;
let soundContext = null;
let muted = false;
let micStream = null;
let pitchContext = null;
let analyser = null;
let sourceNode = null;
let pitchBuffer = null;
let animationId = null;
let attractAnimationId = null;
let attractStartedAt = 0;

const attractLoopDuration = 9200;
const attractKeyframes = [
  { t: 0, cents: -28 },
  { t: 1200, cents: -12 },
  { t: 2400, cents: -2 },
  { t: 3450, cents: 0 },
  { t: 4650, cents: 8 },
  { t: 6100, cents: 24 },
  { t: 7500, cents: 50 },
  { t: 9200, cents: -28 },
];

function installImageGuards() {
  document.querySelectorAll("img").forEach((img) => {
    const markLoaded = () => {
      if (!img.naturalWidth) return;

      img.classList.remove("image-missing");
      if (img.classList.contains("logo")) {
        delete app.dataset.logoMissing;
      }
      if (img.classList.contains("character-frame")) {
        delete app.dataset.characterMissing;
      }
    };

    const markMissing = () => {
      img.classList.add("image-missing");
      if (img.classList.contains("logo")) {
        app.dataset.logoMissing = "true";
      }
      if (img.classList.contains("character-frame")) {
        app.dataset.characterMissing = "true";
      }
    };

    img.addEventListener("load", markLoaded);
    img.addEventListener("error", markMissing);

    if (img.complete) {
      if (img.naturalWidth) {
        markLoaded();
      } else {
        markMissing();
      }
    }
  });
}

installImageGuards();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function centsFromFrequency(frequency, target) {
  return 1200 * Math.log2(frequency / target);
}

function frequencyFromCents(cents, target) {
  return target * Math.pow(2, cents / 1200);
}

function normalizePitchToTarget(frequency, target) {
  let bestFrequency = frequency;
  let bestDistance = Math.abs(centsFromFrequency(frequency, target));

  for (let octave = -3; octave <= 3; octave += 1) {
    const candidate = frequency * Math.pow(2, octave);
    if (candidate < 45 || candidate > 700) continue;

    const distance = Math.abs(centsFromFrequency(candidate, target));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestFrequency = candidate;
    }
  }

  return bestFrequency;
}

function nearestStringForPitch(frequency) {
  return guitarStrings.reduce((best, string) => {
    const normalizedFrequency = normalizePitchToTarget(frequency, string.hz);
    const cents = centsFromFrequency(normalizedFrequency, string.hz);
    const distance = Math.abs(cents);

    if (!best || distance < best.distance) {
      return { string, key: string.key, normalizedFrequency, cents, distance };
    }

    return best;
  }, null);
}

function stringDistance(frequency, key) {
  const string = stringsByKey[key];
  const normalizedFrequency = normalizePitchToTarget(frequency, string.hz);
  const cents = centsFromFrequency(normalizedFrequency, string.hz);
  return { string, key, normalizedFrequency, cents, distance: Math.abs(cents) };
}

function stateForCents(cents) {
  if (cents < -34) return "way-low";
  if (cents < -18) return "low";
  if (cents < -5) return "almost-low";
  if (cents <= 5) return "perfect";
  if (cents <= 18) return "almost-high";
  if (cents <= 34) return "high";
  return "way-high";
}

function visualPositionForCents(cents) {
  const clamped = clamp(cents, -50, 50);
  if (clamped < 0) {
    return ((clamped + 50) / 50) * 3;
  }
  return 3 + (clamped / 50) * 3;
}

function visualStageForCents(cents) {
  return Math.round((visualPositionForCents(cents) / 6) * 16);
}

function spriteFrameForCents(cents) {
  if (cents < -42) return 0;
  if (cents < -30) return 1;
  if (cents < -18) return 2;
  if (cents < -5) return 3;
  if (cents <= 5) return 4;
  if (cents <= 15) return 5;
  if (cents <= 34) return 6;
  return 7;
}

function triggerFrameVeil() {
  app.classList.remove("frame-transition");
  window.requestAnimationFrame(() => {
    app.classList.add("frame-transition");
  });

  window.clearTimeout(visual.veilTimer);
  visual.veilTimer = window.setTimeout(() => {
    app.classList.remove("frame-transition");
  }, 240);
}

function formatCents(cents) {
  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents.toFixed(1)}`;
}

function coachCopy(cents, stringName) {
  const distance = Math.abs(cents);
  if (distance <= 5) return `Locked on ${stringName}`;
  if (distance <= 12) return `Closer to ${stringName}`;
  if (distance <= 25) return `Finding ${stringName}`;
  return `Far from ${stringName}`;
}

function setMode(nextAutoMode) {
  autoMode = nextAutoMode;
  autoButton.classList.toggle("active", autoMode);
  autoButton.textContent = autoMode ? "Auto Detect" : "Manual";
  stringButtons.forEach((button) => {
    button.classList.toggle("manual-mode", !autoMode);
  });
  updateLockStatus();
}

function updateTarget(key) {
  selectedKey = key;
  lockedKey = key;
  const string = stringsByKey[key];

  selectedNote.textContent = string.note;
  selectedOctave.textContent = string.octave;
  selectedHz.textContent = `${string.hz.toFixed(2)} Hz`;
  selectedName.textContent = string.name;
  targetOverlay.textContent = `Target ${string.name} ${string.hz.toFixed(2)} Hz`;

  stringButtons.forEach((button) => {
    const active = button.dataset.string === key;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateLockStatus(extra = "") {
  if (!lockStatus) return;
  if (!autoMode) {
    lockStatus.textContent = `Manual target: ${stringsByKey[lockedKey].name}`;
    return;
  }

  lockStatus.textContent = extra || `Auto locked to ${stringsByKey[lockedKey].name}`;
}

function applyVisual(cents) {
  const position = visualPositionForCents(cents);
  const mood = stateForCents(cents);
  const distance = Math.min(Math.abs(cents), 50);
  const closeness = 1 - distance / 50;
  const overheat = clamp((cents - 8) / 42, 0, 1);
  const flare = clamp((cents - 16) / 34, 0, 1.35);
  const spark = clamp(0.16 + closeness * 0.8 + overheat * 0.32, 0, 1.35);
  const flame = clamp(0.08 + closeness * 0.92 + overheat * 0.72, 0.05, 1.65);
  const virtualStage = visualStageForCents(cents);
  const spriteFrame = spriteFrameForCents(cents);

  if (visual.currentFrame !== canonicalCharacterFrame) {
    visual.currentFrame = canonicalCharacterFrame;
    visual.front.src = canonicalCharacterFrame;
  }

  if (visual.currentMood !== mood) {
    visual.currentMood = mood;
    triggerFrameVeil();
  }

  visual.front.style.opacity = "1";
  visual.back.style.opacity = "0";

  app.dataset.visualStage = String(virtualStage);
  app.dataset.visualMood = mood;
  app.style.setProperty("--frame-progress", (position / 6).toFixed(3));
  app.style.setProperty("--spark-level", spark.toFixed(3));
  app.style.setProperty("--flame-level", flame.toFixed(3));
  app.style.setProperty("--flare-level", flare.toFixed(3));
  app.style.setProperty("--sprite-position", `${((spriteFrame / 7) * 100).toFixed(3)}%`);
  app.style.setProperty("--closeness", closeness.toFixed(3));
  app.style.setProperty("--overheat", overheat.toFixed(3));
  app.style.setProperty("--stage-brightness", (0.78 + closeness * 0.2 + overheat * 0.1).toFixed(3));

  return virtualStage;
}

function renderTuner({ cents, frequency, targetKey, source, confidence = 1 }) {
  const string = stringsByKey[targetKey];
  const state = stateForCents(cents);
  const copy = stateCopy[state];
  const meterPercent = ((clamp(cents, -50, 50) + 50) / 100) * 100;
  const needleAngle = (clamp(cents, -50, 50) / 50) * 78;
  const direction = cents < -5 ? "flat" : cents > 5 ? "sharp" : "centered";
  const virtualStage = applyVisual(cents);

  app.dataset.state = state;
  app.style.setProperty("--meter-x", `${meterPercent}%`);
  app.style.setProperty("--needle-angle", `${needleAngle}deg`);
  updateTarget(targetKey);

  stateTitle.textContent = copy.title;
  directionText.textContent = copy.direction;
  frequencyText.textContent = `${frequency.toFixed(2)} Hz`;
  centsText.textContent = formatCents(cents);
  proximityText.textContent = coachCopy(cents, string.name);
  detectedNoteText.textContent = `${autoMode ? "Auto" : "Manual"} ${string.name} - ${direction}`;

  if (source === "attract") {
    statusText.textContent = "Preview is running without mic access. Tap Mic for live tuning.";
  } else if (source === "demo") {
    statusText.textContent = "Demo mode is previewing the animation states.";
  } else if (source === "mic") {
    statusText.textContent = `Live mic - confidence ${Math.round(confidence * 100)}%`;
  }

  triggerStateFeedback(state, virtualStage, source);
}

function lockTargetForPitch(rawFrequency, confidence) {
  const now = performance.now();
  const nearest = nearestStringForPitch(rawFrequency);
  if (!nearest || confidence < 0.72 || nearest.distance > 70) {
    return stringDistance(rawFrequency, lockedKey);
  }

  if (!autoMode) {
    return stringDistance(rawFrequency, lockedKey);
  }

  if (nearest.key === candidateKey) {
    candidateHits += 1;
  } else {
    candidateKey = nearest.key;
    candidateStartedAt = now;
    candidateHits = 1;
  }

  const currentLock = stringDistance(rawFrequency, lockedKey);
  const candidateStable = candidateHits >= 4 || now - candidateStartedAt > 170;
  const clearlyDifferent = nearest.key !== lockedKey && nearest.distance < 28 && currentLock.distance > 42;
  const heldDifferent = nearest.key !== lockedKey && candidateStable && nearest.distance + 12 < currentLock.distance;

  if (clearlyDifferent || heldDifferent) {
    lockedKey = nearest.key;
    selectedKey = nearest.key;
    smoothedCents = nearest.cents;
    smoothedFrequency = nearest.normalizedFrequency;
    updateLockStatus(`Auto locked to ${nearest.string.name}`);
    return nearest;
  }

  updateLockStatus(candidateStable ? `Auto locked to ${stringsByKey[lockedKey].name}` : `Checking ${nearest.string.name}`);
  return currentLock;
}

function smoothReading(reading, confidence) {
  const alpha = confidence > 0.9 ? 0.42 : 0.26;
  smoothedCents = lerp(smoothedCents, reading.cents, alpha);
  smoothedFrequency = lerp(smoothedFrequency, reading.normalizedFrequency, alpha);
  return { ...reading, cents: smoothedCents, normalizedFrequency: smoothedFrequency };
}

function useDemoValue(source = "demo") {
  const cents = Number(demoSlider.value);
  const string = stringsByKey[lockedKey];
  const frequency = frequencyFromCents(cents, string.hz);
  smoothedCents = cents;
  smoothedFrequency = frequency;
  renderTuner({ cents, frequency, targetKey: lockedKey, source, confidence: 1 });
}

async function startMic({ automatic = false } = {}) {
  stopAttractLoop();

  if (micStream) return true;

  statusText.textContent = automatic
    ? "Requesting microphone access. Allow it once to start live tuning."
    : "Requesting microphone access.";

  if (!navigator.mediaDevices?.getUserMedia) {
    statusText.textContent = "Microphone access is not available in this browser.";
    return false;
  }

  try {
    pitchContext = new (window.AudioContext || window.webkitAudioContext)();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    if (pitchContext.state === "suspended") {
      await pitchContext.resume();
    }

    analyser = pitchContext.createAnalyser();
    analyser.fftSize = 4096;
    pitchBuffer = new Float32Array(analyser.fftSize);
    sourceNode = pitchContext.createMediaStreamSource(micStream);
    sourceNode.connect(analyser);
    micButton.textContent = "Stop";
    micButton.classList.add("active");
    setMode(true);
    statusText.textContent = "Listening. Pluck any standard guitar string.";
    runPitchLoop();
    return true;
  } catch (error) {
    statusText.textContent = automatic
      ? "Browser permission is required. Tap Mic if the permission prompt did not appear."
      : "Microphone permission was blocked or unavailable.";
    stopMic({ renderDemo: false });
    return false;
  }
}

async function toggleMic() {
  if (micStream) {
    stopMic();
    return;
  }
  startMic();
}

function stopMic({ renderDemo = true } = {}) {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;

  if (sourceNode) sourceNode.disconnect();
  sourceNode = null;

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
  }
  micStream = null;

  if (pitchContext) {
    pitchContext.close();
  }
  pitchContext = null;
  analyser = null;
  pitchBuffer = null;
  micButton.textContent = "Mic";
  micButton.classList.remove("active");
  if (renderDemo) {
    statusText.textContent = "Mic stopped. Demo slider is active.";
    useDemoValue();
  }
}

function centsForAttractLoop(elapsed) {
  const loopTime = elapsed % attractLoopDuration;
  for (let i = 0; i < attractKeyframes.length - 1; i += 1) {
    const current = attractKeyframes[i];
    const next = attractKeyframes[i + 1];
    if (loopTime >= current.t && loopTime <= next.t) {
      const span = next.t - current.t || 1;
      const progress = easeInOut((loopTime - current.t) / span);
      return lerp(current.cents, next.cents, progress);
    }
  }
  return attractKeyframes[0].cents;
}

function runAttractLoop(now) {
  if (!attractStartedAt) attractStartedAt = now;
  const cents = centsForAttractLoop(now - attractStartedAt);
  const string = stringsByKey[lockedKey];
  const frequency = frequencyFromCents(cents, string.hz);
  demoSlider.value = String(Math.round(cents));
  renderTuner({ cents, frequency, targetKey: lockedKey, source: "attract", confidence: 1 });
  attractAnimationId = requestAnimationFrame(runAttractLoop);
}

function startAttractLoop() {
  if (attractAnimationId || micStream) return;
  app.dataset.previewMode = "auto";
  attractStartedAt = 0;
  attractAnimationId = requestAnimationFrame(runAttractLoop);
}

function stopAttractLoop() {
  if (attractAnimationId) {
    cancelAnimationFrame(attractAnimationId);
  }
  attractAnimationId = null;
  attractStartedAt = 0;
  delete app.dataset.previewMode;
}

function runPitchLoop() {
  if (!analyser || !pitchBuffer) return;

  analyser.getFloatTimeDomainData(pitchBuffer);
  const pitch = detectPitch(pitchBuffer, pitchContext.sampleRate);

  if (pitch && pitch.frequency > 45 && pitch.frequency < 700) {
    lastPitchAt = performance.now();
    const lockedReading = lockTargetForPitch(pitch.frequency, pitch.confidence);
    const smoothed = smoothReading(lockedReading, pitch.confidence);
    renderTuner({
      cents: smoothed.cents,
      frequency: smoothed.normalizedFrequency,
      targetKey: lockedReading.key,
      source: "mic",
      confidence: pitch.confidence,
    });
  } else {
    const silentFor = performance.now() - lastPitchAt;
    if (silentFor > 900) {
      candidateKey = null;
      candidateHits = 0;
      updateLockStatus(autoMode ? "Waiting for a clean string pluck" : "");
      statusText.textContent = "Listening. Pluck any standard guitar string.";
    }
  }

  animationId = requestAnimationFrame(runPitchLoop);
}

function detectPitch(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return null;

  const minFrequency = 55;
  const maxFrequency = 430;
  const minTau = Math.floor(sampleRate / maxFrequency);
  const maxTau = Math.min(Math.floor(sampleRate / minFrequency), buffer.length - 1);
  const difference = new Float32Array(maxTau + 1);
  const cmnd = new Float32Array(maxTau + 1);

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < buffer.length - tau; i += 1) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  let runningSum = 0;
  let bestTau = -1;
  let bestValue = 1;
  const threshold = 0.16;

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    if (runningSum === 0) continue;
    cmnd[tau] = (difference[tau] * tau) / runningSum;
    if (cmnd[tau] < bestValue) {
      bestValue = cmnd[tau];
      bestTau = tau;
    }
  }

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) {
        tau += 1;
      }
      bestTau = tau;
      bestValue = cmnd[tau];
      break;
    }
  }

  if (bestTau <= 0 || bestValue > 0.32) return null;

  const prev = cmnd[bestTau - 1] || bestValue;
  const next = cmnd[bestTau + 1] || bestValue;
  const denominator = 2 * (2 * bestValue - next - prev);
  const shift = denominator ? (next - prev) / denominator : 0;
  const frequency = sampleRate / (bestTau + shift);
  const confidence = clamp(1 - bestValue, 0, 1);

  if (!Number.isFinite(frequency) || confidence < 0.68) return null;
  return { frequency, confidence, rms };
}

function ensureSoundContext() {
  if (muted) return null;
  if (!soundContext) {
    soundContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (soundContext.state === "suspended") {
    soundContext.resume();
  }
  return soundContext;
}

function tone(frequency, start, duration, type = "sine", peak = 0.1) {
  const ctx = ensureSoundContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playSpark() {
  const ctx = ensureSoundContext();
  if (!ctx) return;
  tone(1280, ctx.currentTime, 0.045, "triangle", 0.038);
}

function playWhoosh() {
  const ctx = ensureSoundContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(190, now, 0.16, "sawtooth", 0.035);
  tone(260, now + 0.035, 0.13, "triangle", 0.032);
}

function playSputter() {
  const ctx = ensureSoundContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(95, now, 0.045, "square", 0.032);
  tone(68, now + 0.07, 0.035, "square", 0.025);
}

function playPerfect() {
  const ctx = ensureSoundContext();
  if (!ctx) return;

  const root = clamp(stringsByKey[lockedKey].hz * 2, 160, 440);
  const now = ctx.currentTime;
  const chord = [root, root * 1.25, root * 1.5];
  chord.forEach((note) => tone(note, now, 0.1, "triangle", 0.055));
  chord.forEach((note) => tone(note, now + 0.15, 0.12, "triangle", 0.05));
}

function triggerStateFeedback(state, virtualStage, source) {
  if (source !== "demo" && source !== "mic") return;

  const now = performance.now();
  const enteredNewState = state !== lastState;
  const crossedStage = Math.abs(virtualStage - lastVirtualStage) >= 2;
  if (!enteredNewState && !crossedStage && now - lastSoundAt < 850) return;

  if (state === "perfect") {
    if (enteredNewState && now - lastPerfectAt > 1200) {
      playPerfect();
      if ("vibrate" in navigator) navigator.vibrate([18, 28, 38]);
      lastPerfectAt = now;
    }
  } else if (state === "way-low" || state === "way-high") {
    playSputter();
  } else if (state === "almost-low" || state === "almost-high") {
    playWhoosh();
  } else if (enteredNewState || crossedStage) {
    playSpark();
  }

  lastSoundAt = now;
  lastState = state;
  lastVirtualStage = virtualStage;
}

demoSlider.addEventListener("input", () => {
  stopAttractLoop();
  useDemoValue();
});

resetDemo.addEventListener("click", () => {
  stopAttractLoop();
  demoSlider.value = "0";
  useDemoValue();
});

micButton.addEventListener("click", toggleMic);

autoButton.addEventListener("click", () => {
  stopAttractLoop();
  setMode(true);
  statusText.textContent = micStream ? "Auto detect is active." : "Auto detect will lock when the mic is running.";
});

muteButton.addEventListener("click", () => {
  muted = !muted;
  muteButton.setAttribute("aria-pressed", String(muted));
  muteButton.textContent = muted ? "Mute" : "SFX";
  if (muted && soundContext) {
    soundContext.suspend();
  }
});

stringButtons.forEach((button) => {
  button.addEventListener("click", () => {
    stopAttractLoop();
    setMode(false);
    lockedKey = button.dataset.string;
    selectedKey = lockedKey;
    smoothedCents = Number(demoSlider.value);
    smoothedFrequency = frequencyFromCents(smoothedCents, stringsByKey[lockedKey].hz);
    useDemoValue();
  });
});

setMode(true);
updateTarget(lockedKey);
const queryParams = new URLSearchParams(window.location.search);
const demoCentsParam = queryParams.get("cents");
const screenFitPreference = queryParams.get("fit");
if (demoCentsParam !== null) {
  const demoCents = clamp(Number(demoCentsParam), -50, 50);
  if (Number.isFinite(demoCents)) {
    demoSlider.value = String(Math.round(demoCents));
  }
}

let fitFrame = null;

function shouldFitScreen() {
  if (screenFitPreference === "off") return false;
  if (screenFitPreference === "screen" || screenFitPreference === "on") return true;
  return window.matchMedia("(max-width: 520px)").matches;
}

function measureViewport() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width || window.innerWidth,
    height: viewport?.height || window.innerHeight,
  };
}

function applyScreenFit() {
  if (!shouldFitScreen()) {
    document.documentElement.classList.remove("fit-screen");
    document.body.classList.remove("fit-screen");
    app.style.removeProperty("--fit-scale");
    app.style.removeProperty("--fit-offset-y");
    return;
  }

  document.documentElement.classList.add("fit-screen");
  document.body.classList.add("fit-screen");
  app.style.setProperty("--fit-scale", "1");
  app.style.setProperty("--fit-offset-y", "0px");

  window.requestAnimationFrame(() => {
    const viewport = measureViewport();
    const rect = app.getBoundingClientRect();
    const horizontalGutter = 18;
    const verticalGutter = 14;
    const widthScale = (viewport.width - horizontalGutter) / rect.width;
    const heightScale = (viewport.height - verticalGutter) / rect.height;
    const scale = clamp(Math.min(widthScale, heightScale, 1), 0.58, 1);
    const offset = Math.max(0, (viewport.height - rect.height * scale) / 2);

    app.style.setProperty("--fit-scale", scale.toFixed(4));
    app.style.setProperty("--fit-offset-y", `${Math.min(offset, 20).toFixed(1)}px`);
  });
}

function scheduleScreenFit() {
  if (fitFrame) {
    window.cancelAnimationFrame(fitFrame);
  }
  fitFrame = window.requestAnimationFrame(() => {
    fitFrame = null;
    applyScreenFit();
  });
}

window.addEventListener("resize", scheduleScreenFit);
window.addEventListener("orientationchange", () => {
  window.setTimeout(scheduleScreenFit, 120);
});
window.visualViewport?.addEventListener("resize", scheduleScreenFit);
window.visualViewport?.addEventListener("scroll", scheduleScreenFit);
document.fonts?.ready?.then(scheduleScreenFit);
document.querySelectorAll("img").forEach((img) => {
  img.addEventListener("load", scheduleScreenFit, { once: true });
});

async function bootTuner() {
  if (demoCentsParam !== null) {
    useDemoValue("demo");
    scheduleScreenFit();
    return;
  }

  useDemoValue("idle");
  scheduleScreenFit();

  if (queryParams.get("preview") === "off" || queryParams.get("mic") === "off") {
    statusText.textContent = "Ready without mic. Tap Mic for live tuning.";
    scheduleScreenFit();
    return;
  }

  const started = await startMic({ automatic: true });
  if (!started) {
    startAttractLoop();
  }
  scheduleScreenFit();
}

bootTuner();
scheduleScreenFit();
window.setTimeout(scheduleScreenFit, 300);
