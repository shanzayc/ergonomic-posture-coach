// Tuning panel, shown only with ?debug in the URL. It shows each posture
// signal live against the calibrated baseline, and records short averages
// while you hold specific postures, so alert thresholds can come from real
// readings instead of guesses.
(function () {
    if (!new URLSearchParams(location.search).has("debug")) return;

    // pct: show change as a percentage. The original three signals sit near
    // zero at baseline, where percentages are meaningless.
    const SIGNALS = [
        { key: "shoulderTilt", label: "Shoulder tilt" },
        { key: "headSideways", label: "Head sideways" },
        { key: "headDrop", label: "Head drop" },
        { key: "shoulderWidthPx", label: "Closeness (px)", px: true, pct: true },
        { key: "earRatio", label: "Face size, ears", pct: true },
        { key: "eyeRatio", label: "Face size, eyes", pct: true },
        { key: "neckGapPx", label: "Neck height (px)", px: true, pct: true },
    ];

    const POSTURES = [
        "Good posture",
        "Lean toward screen",
        "Slump down",
        "Chin forward",
        "Look at other monitor",
        "Lean on one elbow",
        "Look down at keyboard",
    ];

    const COUNTDOWN_SECONDS = 3;
    const RECORD_SECONDS = 3;
    const MIN_READINGS = 10;

    const card = document.getElementById("debugCard");
    const liveBody = document.getElementById("debugLive");
    const postureBox = document.getElementById("debugPostures");
    const statusEl = document.getElementById("debugStatus");
    const output = document.getElementById("debugOutput");
    const copyButton = document.getElementById("debugCopy");

    let recording = null; // { name, samples } while a posture is being held
    let busy = false;
    const results = new Map(); // posture name -> { avg, base }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function fmt(s, v) {
        if (v === null || v === undefined) return "—";
        return s.px ? v.toFixed(0) : v.toFixed(3);
    }

    function change(s, now, base) {
        if (now === null || now === undefined || base === null || base === undefined) return "—";
        const d = now - base;
        const sign = d >= 0 ? "+" : "−";
        const abs = Math.abs(d);
        const text = `${sign}${s.px ? abs.toFixed(0) : abs.toFixed(3)}`;
        if (!s.pct || !base) return text;
        return `${text} ${sign}${Math.abs((d / base) * 100).toFixed(0)}%`;
    }

    // Signals that the app's real alert checks currently flag.
    function flaggedSignals(now, base) {
        if (!now || !base) return new Set();
        return new Set(postureProblems(now, base).flatMap(c => c.signals));
    }

    function renderLive() {
        const base = state.baseline;
        const now = state.smoothed;
        const flagged = flaggedSignals(now, base);
        liveBody.innerHTML = SIGNALS.map(s => {
            const b = base?.[s.key];
            const n = now?.[s.key];
            const over = flagged.has(s.key);
            return `
              <tr class="${over ? "over" : ""}">
                <td>${s.label}</td>
                <td>${fmt(s, b)}</td>
                <td>${fmt(s, n)}</td>
                <td>${change(s, n, b)}</td>
              </tr>`;
        }).join("");

        const ready = state.mode === "monitoring" && !busy;
        postureBox.querySelectorAll("button").forEach(b => {
            b.disabled = !ready;
        });
        if (!busy && state.mode !== "monitoring") {
            statusEl.textContent = "Start a session and finish calibrating to record postures.";
        } else if (!busy && !statusEl.dataset.touched) {
            statusEl.textContent = "Pick a posture. You get 3 seconds to get into it, then hold it for 3.";
        }
    }

    async function record(name) {
        busy = true;
        statusEl.dataset.touched = "1";
        for (let i = COUNTDOWN_SECONDS; i > 0; i--) {
            statusEl.textContent = `Get into position: ${name}… ${i}`;
            await sleep(1000);
        }

        recording = { name, samples: [] };
        statusEl.textContent = `Recording “${name}” — hold it…`;
        await sleep(RECORD_SECONDS * 1000);
        const { samples } = recording;
        recording = null;
        busy = false;

        if (samples.length < MIN_READINGS) {
            statusEl.textContent = `Not enough readings for “${name}”. Stay in frame and try again.`;
            return;
        }

        results.set(name, { avg: averageFeatures(samples), base: state.baseline });
        statusEl.textContent = `Saved “${name}” (${samples.length} readings).`;
        renderButtons();
        renderOutput();
    }

    function renderButtons() {
        postureBox.innerHTML = "";
        POSTURES.forEach(name => {
            const b = document.createElement("button");
            b.className = "btn btn-ghost btn-small";
            b.textContent = results.has(name) ? `✓ ${name}` : name;
            b.onclick = () => record(name);
            postureBox.appendChild(b);
        });
    }

    function renderOutput() {
        const lines = [
            `Posture Coach tuning data, ${new Date().toLocaleString()}`,
            `Alert limits: lean in +${config.leanInThresh * 100}%, head down +${config.headDropThresh}, ` +
                `head forward +${config.headForwardThresh * 100}%, sideways ±${config.headSidewaysThresh} ` +
                `(skipped when turned ${config.headTurnThresh * 100}%+), shoulder tilt ±${config.shoulderTiltThresh}`,
        ];

        for (const [name, { avg, base }] of results) {
            const tripped = postureProblems(avg, base);
            lines.push(
                "",
                `${name}  (alerts with current rules: ${
                    tripped.length ? "YES, " + tripped.map(c => c.label).join(", ") : "no"
                })`
            );
            SIGNALS.forEach(s => {
                lines.push(
                    `  ${s.label}: ${fmt(s, avg[s.key])}  baseline ${fmt(s, base[s.key])}  change ${change(
                        s,
                        avg[s.key],
                        base[s.key]
                    )}`
                );
            });
        }

        output.value = lines.join("\n");
    }

    copyButton.onclick = async () => {
        try {
            await navigator.clipboard.writeText(output.value);
            copyButton.textContent = "Copied!";
        } catch {
            output.select(); // let them copy it by hand
            copyButton.textContent = "Press Cmd+C to copy";
        }
        setTimeout(() => (copyButton.textContent = "Copy results"), 2000);
    };

    card.hidden = false;
    renderButtons();
    renderOutput();
    setInterval(renderLive, 200);

    window.debugPanel = {
        onFeatures(raw) {
            if (recording && raw) recording.samples.push(raw);
        },
    };
})();
