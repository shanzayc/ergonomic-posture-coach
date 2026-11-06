const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const startButton = document.getElementById("startButton");
const endButton = document.getElementById("endButton");

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingStatus = document.getElementById("loadingStatus");

const posturePill = document.getElementById("posturePill");
const notifyNote = document.getElementById("notifyNote");
const soundToggle = document.getElementById("soundToggle");

const statDuration = document.getElementById("statDuration");
const statGood = document.getElementById("statGood");
const statStreak = document.getElementById("statStreak");
const statAlerts = document.getElementById("statAlerts");
const historyList = document.getElementById("historyList");

// ---------------- CONFIG ----------------
const config = {
    autoCalibrateSeconds: 5,
    sustainedBadSeconds: 4,
    // Alert limits, picked from recorded postures (open the app with ?debug
    // to record your own). Percentages are change from your baseline.
    // Normal shifting in the chair reached +12%; leaning in was +28%.
    leanInThresh: 0.2, // shoulders 20% wider in frame: leaning toward the screen
    headDropThresh: 0.18, // head sunk toward the shoulders: looking down
    headForwardThresh: 0.12, // face 12% larger next to the shoulders: head jutting out
    headSidewaysThresh: 0.15, // head further off-center than baseline: leaning to one side
    shoulderTiltThresh: 0.12, // shoulders more uneven than baseline
    // Face 15% narrower means the head is turned (e.g. to another monitor).
    // A turned head shifts sideways too, so that check is skipped.
    headTurnThresh: 0.15,
    minCalibrationSamples: 45,

    // Keypoints jitter frame to frame. Readings are smoothed over roughly
    // this window, and posture has to look good for recoverSeconds straight
    // before the slouch timer resets, so one clean frame can't wipe it.
    smoothingSeconds: 0.5,
    recoverSeconds: 1,

    // Don't nag more than once a minute while you're looking elsewhere.
    notifyCooldownSeconds: 60,
    soundCooldownSeconds: 20,
    soundKey: "ergoPosture.sound.v1",

    // A hidden tab can be frozen outright; without a cap one resume would
    // dump the whole frozen stretch into a single posture bucket.
    maxEvalStepSeconds: 2,

    historyKey: "ergoPosture.history.v1",
    maxHistorySessions: 10,
};

// ---------------- STATE ----------------
function freshStats() {
    return {
        startedAt: Date.now(),
        goodMs: 0,
        warnMs: 0,
        badMs: 0,
        noPoseMs: 0,
        currentStreakMs: 0,
        bestStreakMs: 0,
        alerts: 0,
    };
}

let state = {
    mode: "idle", // idle | autoCalibrating | monitoring
    pose: null,
    status: "neutral", // neutral | good | warn | bad | nopose

    baseline: null,
    samples: [],
    smoothed: null,
    badDuration: 0,
    goodRunSec: 0,
    lastEvalAt: null,
    calibStartedAt: null,
    lastSampledPose: null,

    stats: freshStats(),
    lastNotifyAt: -Infinity, // "never notified" — 0 would mute the first minute
    lastSoundAt: -Infinity,
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

function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function extractFeatures(pose) {
    const ls = getKP(pose, "left_shoulder");
    const rs = getKP(pose, "right_shoulder");
    const nose = getKP(pose, "nose");

    if (!ls || !rs || !nose) return null;

    const shoulderWidth = dist(ls, rs);
    if (!shoulderWidth) return null;

    const shoulderMid = {
        x: (ls.x + rs.x) / 2,
        y: (ls.y + rs.y) / 2,
    };

    // Ears and eyes can be hidden by hair or glasses, so these are optional.
    const le = getKP(pose, "left_ear");
    const re = getKP(pose, "right_ear");
    const leo = getKP(pose, "left_eye_outer");
    const reo = getKP(pose, "right_eye_outer");

    return {
        shoulderTilt: Math.abs(ls.y - rs.y) / shoulderWidth,
        headSideways: Math.abs(nose.x - shoulderMid.x) / shoulderWidth,
        headDrop: (nose.y - shoulderMid.y) / shoulderWidth,
        shoulderWidthPx: shoulderWidth, // grows as you lean toward the camera
        // Face width next to the shoulders: grows when the head juts forward,
        // shrinks when it turns away.
        earRatio: le && re ? dist(le, re) / shoulderWidth : null,
        eyeRatio: leo && reo ? dist(leo, reo) / shoulderWidth : null,
        // Only shown in the ?debug panel; didn't separate postures well.
        neckGapPx: le && re ? shoulderMid.y - (le.y + re.y) / 2 : null,
    };
}

// Fractional change from baseline, or null if either reading is missing.
function relChange(now, base) {
    if (now === null || now === undefined || !base) return null;
    return now / base - 1;
}

// Prefer the eyes (rarely hidden), fall back to the ears. Both readings must
// come from the same pair to be comparable.
function faceChange(f, b) {
    return relChange(f.eyeRatio, b.eyeRatio) ?? relChange(f.earRatio, b.earRatio);
}

function headTurned(f, b) {
    const face = faceChange(f, b);
    return face !== null && face < -config.headTurnThresh;
}

// Each check is one way posture can go wrong. `signals` are the readings it
// looks at, so the ?debug panel can highlight them. Checks only fire in the
// "worse" direction: if calibration caught you slightly off, sitting
// straighter than that shouldn't count against you.
const POSTURE_CHECKS = [
    {
        label: "leaning toward the screen",
        signals: ["shoulderWidthPx"],
        test: (f, b) => relChange(f.shoulderWidthPx, b.shoulderWidthPx) > config.leanInThresh,
    },
    {
        label: "head down",
        signals: ["headDrop"],
        test: (f, b) => f.headDrop - b.headDrop > config.headDropThresh,
    },
    {
        label: "head jutting forward",
        signals: ["eyeRatio", "earRatio"],
        test: (f, b) => faceChange(f, b) > config.headForwardThresh,
    },
    {
        // Unknown head direction counts as turned: better a missed lean than
        // an alert every time they look at their other monitor.
        label: "leaning to one side",
        signals: ["headSideways"],
        test: (f, b) =>
            faceChange(f, b) !== null &&
            !headTurned(f, b) &&
            f.headSideways - b.headSideways > config.headSidewaysThresh,
    },
    {
        label: "shoulders uneven",
        signals: ["shoulderTilt"],
        test: (f, b) => f.shoulderTilt - b.shoulderTilt > config.shoulderTiltThresh,
    },
];

function postureProblems(f, b) {
    return POSTURE_CHECKS.filter(c => c.test(f, b));
}

// Optional signals can be null on some frames; each key averages whatever
// readings it has.
function averageFeatures(samples) {
    const avg = {};
    for (const key of Object.keys(samples[0])) {
        const vals = samples.map(f => f[key]).filter(v => v !== null);
        avg[key] = vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
    }
    return avg;
}

// Time-based moving average, so it behaves the same at any frame rate.
function smoothFeatures(prev, next, dtSec) {
    if (!prev) return next;
    const a = 1 - Math.exp(-dtSec / config.smoothingSeconds);
    const out = {};
    for (const key of Object.keys(next)) {
        const p = prev[key];
        const n = next[key];
        out[key] = p === null || n === null ? n : p + a * (n - p);
    }
    return out;
}

// ---------------- NOTIFICATIONS ----------------
function notificationsSupported() {
    return typeof Notification !== "undefined";
}

function describeNotifyState() {
    if (!notificationsSupported()) {
        return "Background alerts aren't supported in this browser.";
    }
    if (Notification.permission === "granted") {
        return "🔔 Background alerts on — you'll be notified while you're in another app or tab.";
    }
    if (Notification.permission === "denied") {
        return "🔕 Background alerts blocked. Enable notifications in your browser's site settings to be alerted while you're in another app or tab.";
    }
    return "🔔 Allow notifications to be alerted while you're in another app or tab.";
}

function refreshNotifyNote() {
    if (notifyNote) notifyNote.textContent = describeNotifyState();
}

async function requestNotificationPermission() {
    if (!notificationsSupported()) return;
    if (Notification.permission === "default") {
        try {
            await Notification.requestPermission();
        } catch (err) {
            console.warn("Notification permission request failed:", err);
        }
    }
    refreshNotifyNote();
}

function notifyBadPosture(problem) {
    if (!notificationsSupported() || Notification.permission !== "granted") return;

    // If they're looking at the page the pill already told them. A visible
    // but unfocused window (beside an editor, on another monitor) still
    // counts as looking away.
    if (!document.hidden && document.hasFocus()) return;

    // performance.now() throughout, so the cooldown shares one clock
    // with the posture timers.
    const now = performance.now();
    if (now - state.lastNotifyAt < config.notifyCooldownSeconds * 1000) return;
    state.lastNotifyAt = now;

    try {
        const note = new Notification(`Sit up: ${problem}`, {
            body: "You've been holding this posture for a few seconds.",
            tag: "ergo-posture", // replace the old one instead of stacking
            renotify: true,
            silent: soundEnabled, // the chime already played; don't double up
        });
        note.onclick = () => {
            window.focus();
            note.close();
        };
    } catch (err) {
        console.warn("Could not show notification:", err);
    }
}

// ---------------- SOUND ----------------
let audioCtx = null;
let soundEnabled = loadSoundPref();

function loadSoundPref() {
    try {
        return localStorage.getItem(config.soundKey) !== "off";
    } catch {
        return true;
    }
}

function saveSoundPref() {
    try {
        localStorage.setItem(config.soundKey, soundEnabled ? "on" : "off");
    } catch {
        // Not worth bothering anyone about; it just won't be remembered.
    }
}

// Browsers only allow audio after a user gesture, so this runs from clicks.
function unlockAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
}

function playChime() {
    if (!audioCtx) return;

    // Two soft descending tones: noticeable without being an alarm.
    const t = audioCtx.currentTime;
    [880, 660].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const start = t + i * 0.18;
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
    });
}

function soundBadPosture() {
    if (!soundEnabled) return;

    const now = performance.now();
    if (now - state.lastSoundAt < config.soundCooldownSeconds * 1000) return;
    state.lastSoundAt = now;

    playChime();
}

// ---------------- EVALUATION ----------------
// Driven by the pose callback, NOT requestAnimationFrame: rAF is paused
// while the tab is hidden, which is exactly when we need to be watching.
function evaluatePosture() {
    if (state.mode === "idle") return;

    const now = performance.now();
    const dtSec =
        state.lastEvalAt === null
            ? 0
            : Math.min(
                  (now - state.lastEvalAt) / 1000,
                  config.maxEvalStepSeconds
              );
    state.lastEvalAt = now;
    const dtMs = dtSec * 1000;

    const raw = extractFeatures(state.pose);
    const features = raw && smoothFeatures(state.smoothed, raw, dtSec);
    state.smoothed = features;
    window.debugPanel?.onFeatures(raw);

    // ---- AUTO CALIBRATION ----
    if (state.mode === "autoCalibrating") {
        if (state.calibStartedAt === null) state.calibStartedAt = now;

        // Poses can arrive faster than they change; only sample new ones.
        if (raw && state.pose !== state.lastSampledPose) {
            state.samples.push(raw);
            state.lastSampledPose = state.pose;
        }

        const elapsed = (now - state.calibStartedAt) / 1000;
        const remaining = Math.max(
            0,
            Math.ceil(config.autoCalibrateSeconds - elapsed)
        );
        setPill(`Learning your neutral posture… ${remaining}s`, "warn");

        if (elapsed >= config.autoCalibrateSeconds) {
            if (state.samples.length >= config.minCalibrationSamples) {
                state.baseline = averageFeatures(state.samples);
                state.mode = "monitoring";
                setPill("Posture monitoring active ✅", "good");
            } else {
                // Too few clean reads to trust a baseline — keep collecting.
                setPill("Sit in frame to calibrate…", "warn");
            }
        }
        return;
    }

    // ---- MONITORING ----
    if (!features) {
        state.status = "nopose";
        state.stats.noPoseMs += dtMs;
        state.badDuration = 0;
        state.goodRunSec = 0;
        setPill("No pose detected", "neutral");
        return;
    }

    const problems = postureProblems(features, state.baseline);
    const bad = problems.length > 0;

    if (!bad && state.badDuration > 0) {
        state.goodRunSec += dtSec;
    }

    if (!bad && state.badDuration > 0 && state.goodRunSec < config.recoverSeconds) {
        // Looks fine, but not for long enough to trust yet. Hold the slouch
        // timer where it is and keep the current status.
        if (state.status === "bad") state.stats.badMs += dtMs;
        else state.stats.warnMs += dtMs;
    } else if (bad) {
        state.goodRunSec = 0;
        state.badDuration += dtSec;

        if (state.badDuration >= config.sustainedBadSeconds) {
            // Count the alert once per slouch, not once per frame.
            if (state.status !== "bad") {
                state.stats.alerts += 1;
                state.status = "bad";
                soundBadPosture();
            }
            state.stats.badMs += dtMs;
            setPill(`Poor posture — ${problems[0].label}`, "bad");
            notifyBadPosture(problems[0].label);
        } else {
            state.status = "warn";
            state.stats.warnMs += dtMs;
            setPill("Posture drifting…", "warn");
        }

        if (state.stats.currentStreakMs > state.stats.bestStreakMs) {
            state.stats.bestStreakMs = state.stats.currentStreakMs;
        }
        state.stats.currentStreakMs = 0;
    } else {
        state.badDuration = 0;
        state.goodRunSec = 0;
        state.status = "good";
        state.stats.goodMs += dtMs;
        state.stats.currentStreakMs += dtMs;
        if (state.stats.currentStreakMs > state.stats.bestStreakMs) {
            state.stats.bestStreakMs = state.stats.currentStreakMs;
        }
        setPill("Good posture ✅", "good");
    }
}

// ---------------- STATS UI ----------------
function trackedMs(s) {
    return s.goodMs + s.warnMs + s.badMs;
}

function goodPercent(s) {
    const tracked = trackedMs(s);
    return tracked > 0 ? Math.round((s.goodMs / tracked) * 100) : null;
}

function renderStats() {
    const s = state.stats;
    statDuration.textContent = formatDuration(trackedMs(s));
    const pct = goodPercent(s);
    statGood.textContent = pct === null ? "—" : `${pct}%`;
    statStreak.textContent = formatDuration(s.bestStreakMs);
    statAlerts.textContent = String(s.alerts);
}

// ---------------- HISTORY ----------------
function loadHistory() {
    try {
        const raw = localStorage.getItem(config.historyKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn("Could not read session history:", err);
        return [];
    }
}

function saveSessionToHistory(s) {
    const tracked = trackedMs(s);
    if (tracked < 10000) return; // ignore accidental few-second sessions

    const entry = {
        startedAt: s.startedAt,
        trackedMs: tracked,
        goodPct: goodPercent(s),
        bestStreakMs: s.bestStreakMs,
        alerts: s.alerts,
    };

    try {
        const history = [entry, ...loadHistory()].slice(
            0,
            config.maxHistorySessions
        );
        localStorage.setItem(config.historyKey, JSON.stringify(history));
    } catch (err) {
        // Private browsing and full quotas both land here; stats still
        // worked for the session they just finished.
        console.warn("Could not save session history:", err);
    }
}

function renderHistory() {
    const history = loadHistory();

    if (history.length === 0) {
        historyList.innerHTML =
            '<p class="history-empty">No sessions yet — finish one to see it here.</p>';
        return;
    }

    historyList.innerHTML = history
        .map(h => {
            const date = new Date(h.startedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            });
            const pct = h.goodPct === null ? "—" : `${h.goodPct}%`;
            const cls =
                h.goodPct === null ? "" : h.goodPct >= 70 ? "good" : h.goodPct >= 40 ? "warn" : "bad";
            return `
              <div class="history-row">
                <span class="history-date">${date}</span>
                <span class="history-duration">${formatDuration(h.trackedMs)}</span>
                <span class="history-pct ${cls}">${pct} good</span>
                <span class="history-alerts">${h.alerts} alert${h.alerts === 1 ? "" : "s"}</span>
              </div>`;
        })
        .join("");
}

// ---------------- DRAW LOOP ----------------
// Purely visual, so it's fine that the browser pauses this when hidden.
let drawFrameId = null;

function drawLoop() {
    const webcam = document.getElementById("webcam");
    if (webcam.readyState === webcam.HAVE_ENOUGH_DATA) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(webcam, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        drawKeypoints(state.pose);
    }

    renderStats();

    if (state.mode !== "idle") drawFrameId = requestAnimationFrame(drawLoop);
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

// ---------------- SESSION ----------------
// Re-learns the neutral posture. Stats carry on: it's still the same session.
function beginCalibration() {
    state.mode = "autoCalibrating";
    state.samples = [];
    state.smoothed = null;
    state.badDuration = 0;
    state.goodRunSec = 0;
    state.status = "neutral";
    state.calibStartedAt = null;
    state.lastSampledPose = null;
    state.stats.currentStreakMs = 0;
}

async function startSession() {
    // Camera, detection and drawing are already running; don't start more.
    if (state.mode !== "idle") {
        beginCalibration();
        return;
    }

    unlockAudio();
    startButton.disabled = true;
    loadingOverlay.classList.remove("hidden");
    loadingStatus.textContent = "Starting camera…";

    await requestNotificationPermission();

    const webcam = document.getElementById("webcam");
    const ok = await window.postureTracking.setupPostureTracking(
        webcam,
        pose => {
            state.pose = pose;
            evaluatePosture();
        },
        message => {
            loadingStatus.textContent = message;
        }
    );

    loadingOverlay.classList.add("hidden");
    startButton.disabled = false;
    if (!ok) return;

    state.stats = freshStats();
    state.lastEvalAt = null;
    state.lastNotifyAt = -Infinity;
    state.lastSoundAt = -Infinity;
    beginCalibration();

    window.postureTracking.startDetection();
    overlay.classList.add("hidden");

    startButton.textContent = "Recalibrate";
    endButton.classList.remove("hidden");

    renderStats();
    drawLoop();
}

function endSession() {
    if (state.mode === "idle") return;

    window.postureTracking.stopCamera();
    cancelAnimationFrame(drawFrameId);
    saveSessionToHistory(state.stats);

    state.mode = "idle";
    state.pose = null;
    state.status = "neutral";

    startButton.textContent = "Start session";
    endButton.classList.add("hidden");
    overlay.classList.remove("hidden");
    document.getElementById("overlayMessage").textContent =
        "Session ended — your stats are saved below.";
    setPill("", "neutral");

    renderStats();
    renderHistory();
}

startButton.onclick = startSession;
endButton.onclick = endSession;

soundToggle.checked = soundEnabled;
soundToggle.onchange = () => {
    soundEnabled = soundToggle.checked;
    saveSoundPref();
    if (soundEnabled) {
        // Doubles as a preview, and the click unlocks audio.
        unlockAudio();
        playChime();
    }
};

// Save rather than lose the session if they close the tab mid-run.
window.addEventListener("pagehide", () => {
    if (state.mode !== "idle") saveSessionToHistory(state.stats);
});

refreshNotifyNote();
renderStats();
renderHistory();
