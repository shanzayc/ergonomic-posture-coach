const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const overlay = document.getElementById("overlay");
const startButton = document.getElementById("startButton");
const endButton = document.getElementById("endButton");

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingStatus = document.getElementById("loadingStatus");

const posturePill = document.getElementById("posturePill");
const notifyNote = document.getElementById("notifyNote");

const statDuration = document.getElementById("statDuration");
const statGood = document.getElementById("statGood");
const statStreak = document.getElementById("statStreak");
const statAlerts = document.getElementById("statAlerts");
const historyList = document.getElementById("historyList");

// ---------------- CONFIG ----------------
const config = {
    autoCalibrateSeconds: 5,
    sustainedBadSeconds: 4,
    headForwardThresh: 0.22,
    shoulderTiltThresh: 0.12,
    headDropThresh: 0.18,
    minCalibrationSamples: 45,

    // Don't nag more than once a minute while the tab is in the background.
    notifyCooldownSeconds: 60,

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
    badDuration: 0,
    lastEvalAt: null,
    calibStartedAt: null,
    lastSampledPose: null,

    stats: freshStats(),
    lastNotifyAt: -Infinity, // "never notified" — 0 would mute the first minute
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

    return {
        shoulderTilt: Math.abs(ls.y - rs.y) / shoulderWidth,
        headForward: Math.abs(nose.x - shoulderMid.x) / shoulderWidth,
        headDrop: (nose.y - shoulderMid.y) / shoulderWidth,
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

// ---------------- NOTIFICATIONS ----------------
function notificationsSupported() {
    return typeof Notification !== "undefined";
}

function describeNotifyState() {
    if (!notificationsSupported()) {
        return "Background alerts aren't supported in this browser.";
    }
    if (Notification.permission === "granted") {
        return "🔔 Background alerts on — you'll be notified even on another tab.";
    }
    if (Notification.permission === "denied") {
        return "🔕 Background alerts blocked. Enable notifications in your browser's site settings to be alerted while on another tab.";
    }
    return "🔔 Allow notifications to be alerted while you're on another tab.";
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

function notifyBadPosture() {
    if (!notificationsSupported() || Notification.permission !== "granted") return;

    // If they're looking at the tab the pill already told them.
    if (!document.hidden) return;

    // performance.now() throughout, so the cooldown shares one clock
    // with the posture timers.
    const now = performance.now();
    if (now - state.lastNotifyAt < config.notifyCooldownSeconds * 1000) return;
    state.lastNotifyAt = now;

    try {
        const note = new Notification("Sit up 🪑", {
            body: "You've been slouching for a few seconds.",
            tag: "ergo-posture", // replace the old one instead of stacking
            renotify: true,
        });
        note.onclick = () => {
            window.focus();
            note.close();
        };
    } catch (err) {
        console.warn("Could not show notification:", err);
    }
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

    const features = extractFeatures(state.pose);

    // ---- AUTO CALIBRATION ----
    if (state.mode === "autoCalibrating") {
        if (state.calibStartedAt === null) state.calibStartedAt = now;

        // Poses can arrive faster than they change; only sample new ones.
        if (features && state.pose !== state.lastSampledPose) {
            state.samples.push(features);
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
                state.stats = freshStats();
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
        setPill("No pose detected", "neutral");
        return;
    }

    const bad =
        Math.abs(features.shoulderTilt - state.baseline.shoulderTilt) >
            config.shoulderTiltThresh ||
        Math.abs(features.headForward - state.baseline.headForward) >
            config.headForwardThresh ||
        features.headDrop - state.baseline.headDrop > config.headDropThresh;

    if (bad) {
        state.badDuration += dtSec;

        if (state.badDuration >= config.sustainedBadSeconds) {
            // Count the alert once per slouch, not once per frame.
            if (state.status !== "bad") {
                state.stats.alerts += 1;
                state.status = "bad";
            }
            state.stats.badMs += dtMs;
            setPill("Poor posture — adjust", "bad");
            notifyBadPosture();
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

    if (state.mode !== "idle") requestAnimationFrame(drawLoop);
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
async function startSession() {
    loadingOverlay.classList.remove("hidden");
    loadingStatus.textContent = "Starting camera…";

    await requestNotificationPermission();

    const webcam = document.getElementById("webcam");
    const ok = await window.postureTracking.setupPostureTracking(webcam, pose => {
        state.pose = pose;
        evaluatePosture();
    });

    loadingOverlay.classList.add("hidden");
    if (!ok) return;

    window.postureTracking.startDetection();
    overlay.classList.add("hidden");

    state.mode = "autoCalibrating";
    state.samples = [];
    state.badDuration = 0;
    state.status = "neutral";
    state.lastEvalAt = null;
    state.calibStartedAt = null;
    state.lastSampledPose = null;
    state.stats = freshStats();
    state.lastNotifyAt = -Infinity;

    startButton.textContent = "Recalibrate";
    endButton.classList.remove("hidden");

    renderStats();
    drawLoop();
}

function endSession() {
    if (state.mode === "idle") return;

    window.postureTracking.stopDetection();
    saveSessionToHistory(state.stats);

    state.mode = "idle";
    state.pose = null;
    state.status = "neutral";

    startButton.textContent = "Start Session";
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

// Save rather than lose the session if they close the tab mid-run.
window.addEventListener("pagehide", () => {
    if (state.mode !== "idle") saveSessionToHistory(state.stats);
});

refreshNotifyNote();
renderStats();
renderHistory();
