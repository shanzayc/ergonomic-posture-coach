const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const startButton = document.getElementById("startButton");

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingStatus = document.getElementById("loadingStatus");

const posturePill = document.getElementById("posturePill");

// ---------------- CONFIG ----------------
const config = {
    autoCalibrateSeconds: 5,
    sustainedBadSeconds: 4,
    headForwardThresh: 0.22,
    shoulderTiltThresh: 0.12,
    headDropThresh: 0.18,

};

// ---------------- STATE ----------------
let state = {
    mode: "idle", // idle | autoCalibrating | monitoring
    pose: null,

    baseline: null,
    samples: [],
    badDuration: 0,
    lastTick: null,
};

// ---------------- HELPERS ----------------
function setPill(text, cls) {
    posturePill.textContent = text;
    posturePill.className = `posture-pill ${cls}`;
}

function getKP(pose, name) {
    return pose?.keypoints?.find(k => k.name === name && k.score > 0.4);
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function extractFeatures(pose) {
  const ls = getKP(pose, "left_shoulder");
  const rs = getKP(pose, "right_shoulder");
  const nose = getKP(pose, "nose");

  if (!ls || !rs || !nose) return null;

  const shoulderWidth = dist(ls, rs);
  const shoulderMid = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
  };

  const headDrop =
    (nose.y - shoulderMid.y) / shoulderWidth;

  return {
    shoulderTilt: Math.abs(ls.y - rs.y) / shoulderWidth,
    headForward: Math.abs(nose.x - shoulderMid.x) / shoulderWidth,
    headDrop: headDrop,
  };
}


function averageFeatures(samples) {
  const sum = samples.reduce(
    (a, f) => ({
      shoulderTilt: a.shoulderTilt + f.shoulderTilt,
      headForward: a.headForward + f.headForward,
      headDrop: a.headDrop + f.headDrop,
    }),
    { shoulderTilt: 0, headForward: 0, headDrop: 0 }
  );

  return {
    shoulderTilt: sum.shoulderTilt / samples.length,
    headForward: sum.headForward / samples.length,
    headDrop: sum.headDrop / samples.length,
  };
}



function drawKeypoints(pose) {
    if (!pose || !pose.keypoints) return;

    ctx.fillStyle = "rgba(255,255,255,0.85)";

    pose.keypoints.forEach(kp => {
        if (kp.score > 0.5) {
            ctx.beginPath();
            ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

// ---------------- MAIN LOOP ----------------
function tick() {
    const now = performance.now();
    const dt = state.lastTick ? (now - state.lastTick) / 1000 : 0;
    state.lastTick = now;

    const features = extractFeatures(state.pose);

    // ---- AUTO CALIBRATION ----
    if (state.mode === "autoCalibrating") {
        setPill("Learning your neutral posture…", "warn");

        if (features) state.samples.push(features);

        if (state.samples.length >= config.autoCalibrateSeconds * 15) {
            state.baseline = averageFeatures(state.samples);
            state.mode = "monitoring";
            setPill("Posture monitoring active ✅", "good");
        }
    }

    // ---- MONITORING ----
    if (state.mode === "monitoring") {
        if (!features) {
            setPill("No pose detected", "neutral");
        } else {
            const bad =
                Math.abs(features.shoulderTilt - state.baseline.shoulderTilt) >
                config.shoulderTiltThresh ||
                Math.abs(features.headForward - state.baseline.headForward) >
                config.headForwardThresh ||
                (features.headDrop - state.baseline.headDrop) >
                config.headDropThresh;

            if (bad) {
                state.badDuration += dt;

                if (state.badDuration >= config.sustainedBadSeconds) {
                    setPill("Poor posture — adjust", "bad");
                } else {
                    setPill("Posture drifting…", "warn");
                }
            } else {
                state.badDuration = 0;
                setPill("Good posture ✅", "good");
            }
        }
    }

    // ---- DRAW CAMERA ----
    const webcam = document.getElementById("webcam");
    if (webcam.readyState === webcam.HAVE_ENOUGH_DATA) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(webcam, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        drawKeypoints(state.pose);

    }

    requestAnimationFrame(tick);
}

// ---------------- START ----------------
async function startSession() {
    loadingOverlay.classList.remove("hidden");
    loadingStatus.textContent = "Starting camera…";

    const webcam = document.getElementById("webcam");
    const ok = await window.postureTracking.setupPostureTracking(webcam, pose => {
        state.pose = pose;
    });

    loadingOverlay.classList.add("hidden");
    if (!ok) return;

    window.postureTracking.startDetection();

    overlay.classList.add("hidden");

    state.mode = "autoCalibrating";
    state.samples = [];
    state.badDuration = 0;
    state.lastTick = null;

    tick();
}

startButton.onclick = startSession;
