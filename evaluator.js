// Accuracy test, shown only with ?debug in the URL. It walks you through
// labeled trials (hold each posture for a few seconds, over several rounds),
// stores every frame, and scores the trials by replaying those frames through
// the app's slouch timer under different rule sets. Because the raw frames
// are kept, any rule set can be scored later without redoing the trials.
(function () {
    if (!new URLSearchParams(location.search).has("debug")) return;

    // `expect` lists the alert names that count as naming the problem right.
    const POSTURES = [
        { name: "Good posture", bad: false, hint: "Sit the way you normally sit when it's good." },
        { name: "Look at other monitor", bad: false, hint: "Turn your head as you would to look at another screen." },
        { name: "Reach for a mug", bad: false, hint: "Reach for something on your desk, take a sip, put it back." },
        { name: "Glance down at keyboard", bad: false, hint: "Glance down for a second, look back up, and repeat." },
        { name: "Shift in your chair", bad: false, hint: "Shift around, then settle back into a normal position." },
        { name: "Stretch", bad: false, hint: "Do a quick stretch, then sit back normally." },
        { name: "Lean toward screen", bad: true, hint: "Move your whole upper body closer to the screen.",
          expect: ["leaning toward the screen"] },
        { name: "Slump down", bad: true, hint: "Sink into the chair and round your shoulders.",
          expect: ["slumped back in the chair", "head down"] },
        { name: "Chin forward", bad: true, hint: "Keep your body still and push your head forward.",
          expect: ["head jutting forward"] },
        { name: "Lean on one elbow", bad: true, hint: "Prop yourself up on one elbow.",
          expect: ["leaning to one side"] },
        { name: "Look down at keyboard", bad: true, hint: "Look down at your keyboard or desk and stay there.",
          expect: ["head down"] },
    ];

    const COUNTDOWN_SECONDS = 3;
    // Long enough for the 4-second alert plus smoothing lag.
    const HOLD_SECONDS = 7;
    const STORAGE_KEY = "ergoPosture.eval.v2";
    // Frames are stored as [dt, values] with values in this order, rather
    // than as objects, so a full run fits comfortably in localStorage.
    const KEYS = ["shoulderTilt", "headSideways", "headDrop", "shoulderWidthPx", "earRatio", "eyeRatio", "neckGapPx"];

    // The app's rules before tuning: three fixed limits, no smoothing, and a
    // slouch timer that any single good frame reset.
    const ORIGINAL_CHECKS = [
        { label: "shoulder tilt", test: (f, b) => Math.abs(f.shoulderTilt - b.shoulderTilt) > 0.12 },
        { label: "head sideways", test: (f, b) => Math.abs(f.headSideways - b.headSideways) > 0.22 },
        { label: "head drop", test: (f, b) => f.headDrop - b.headDrop > 0.18 },
    ];
    const originalProblems = (f, b) => ORIGINAL_CHECKS.filter(c => c.test(f, b));

    // Only the current rules use the app's problem names, so only they get a
    // naming score.
    const RULE_SETS = [
        { name: "Original", smooth: false, problemsFn: originalProblems, recoverSeconds: 0 },
        { name: "Original + smoothing", smooth: true, problemsFn: originalProblems },
        { name: "Current", smooth: true, problemsFn: postureProblems, scoresNaming: true },
    ];

    const card = document.getElementById("evalCard");
    const posturePicker = document.getElementById("evalPostures");
    const roundsInput = document.getElementById("evalRounds");
    const startButton = document.getElementById("evalStart");
    const stopButton = document.getElementById("evalStop");
    const prompt = document.getElementById("evalPrompt");
    const runFilter = document.getElementById("evalRunFilter");
    const resultsEl = document.getElementById("evalResults");
    const copyButton = document.getElementById("evalCopy");
    const exportButton = document.getElementById("evalExport");
    const undoButton = document.getElementById("evalUndo");
    const clearButton = document.getElementById("evalClear");

    let trials = loadTrials();
    let recording = null; // { frames, lastAt } while a trial is being held
    let running = false;
    let stopRequested = false;
    let continueResolver = null;
    let viewRun = null; // run number to show, "all", or null for the latest

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ---------------- STORAGE ----------------
    function loadTrials() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function saveTrials() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(trials));
        } catch (err) {
            // Over quota: the trials are still in memory, so they can be
            // downloaded before the page closes.
            console.warn("Could not save evaluation trials:", err);
            prompt.textContent = "Storage is full. Download your data now so it isn't lost.";
        }
    }

    // Four decimals is far finer than the keypoints are accurate.
    const round4 = v => (v === null || v === undefined ? null : Math.round(v * 1e4) / 1e4);

    function compact(f) {
        if (!f) return null;
        return Object.fromEntries(KEYS.map(k => [k, round4(f[k])]));
    }

    const pack = f => (f ? KEYS.map(k => round4(f[k])) : null);
    const unpack = v => (v ? Object.fromEntries(KEYS.map((k, i) => [k, v[i]])) : null);

    // ---------------- RUNS ----------------
    // Each press of "Start test" is a run, so trials recorded after a rule
    // change can be scored apart from the ones the rules were tuned on.
    // Trials from before runs existed count as run 1.
    const runOf = t => t.run ?? 1;
    const lastRun = () => trials.reduce((m, t) => Math.max(m, runOf(t)), 0);

    function shownTrials() {
        const run = viewRun ?? lastRun();
        return run === "all" ? trials : trials.filter(t => runOf(t) === run);
    }

    function renderRunFilter() {
        const runs = [...new Set(trials.map(runOf))].sort((a, b) => a - b);
        const selected = viewRun ?? lastRun();
        runFilter.innerHTML =
            runs
                .map(run => {
                    const inRun = trials.filter(t => runOf(t) === run);
                    const day = new Date(inRun[0].at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    return `<option value="${run}">Run ${run} (${day}, ${inRun.length} trials)</option>`;
                })
                .join("") + (runs.length > 1 ? '<option value="all">All runs</option>' : "");
        runFilter.value = String(selected);
        runFilter.hidden = runs.length === 0;
    }

    // ---------------- SCORING ----------------
    function replay(trial, rules) {
        const timer = newTimer();
        let t = 0;
        for (const [dt, v] of trial.frames) {
            const f = unpack(v);
            t += dt;
            const features = rules.smooth ? smoothInto(timer, f, dt) : f;
            const { phase, problems } = stepTimer(timer, features, dt, trial.baseline, rules);
            if (phase === "bad") return { alerted: true, at: t, problem: problems[0]?.label };
        }
        return { alerted: false };
    }

    function score(list) {
        return RULE_SETS.map(rules => {
            const byPosture = new Map(POSTURES.map(p => [p.name, { alerted: 0, total: 0, named: 0 }]));
            let caught = 0, badTotal = 0, falseAlarms = 0, okTotal = 0, alertTime = 0, named = 0;
            for (const trial of list) {
                const r = replay(trial, rules);
                const row = byPosture.get(trial.posture);
                const expect = POSTURES.find(p => p.name === trial.posture)?.expect;
                const namedRight = r.alerted && rules.scoresNaming && !!expect?.includes(r.problem);
                if (row) {
                    row.total++;
                    if (r.alerted) row.alerted++;
                    if (namedRight) row.named++;
                }
                if (trial.bad) {
                    badTotal++;
                    if (r.alerted) {
                        caught++;
                        alertTime += r.at;
                        if (namedRight) named++;
                    }
                } else {
                    okTotal++;
                    if (r.alerted) falseAlarms++;
                }
            }
            return {
                name: rules.name,
                scoresNaming: !!rules.scoresNaming,
                byPosture,
                caught, badTotal, falseAlarms, okTotal, named,
                detection: badTotal ? caught / badTotal : null,
                falseAlarmRate: okTotal ? falseAlarms / okTotal : null,
                namingRate: rules.scoresNaming && caught ? named / caught : null,
                avgAlertSeconds: caught ? alertTime / caught : null,
            };
        });
    }

    const pct = v => (v === null ? "—" : `${Math.round(v * 100)}%`);

    function describe(list) {
        const rounds = new Set(list.map(t => t.round)).size;
        return `${list.length} trials over ${rounds} round${rounds === 1 ? "" : "s"}`;
    }

    function renderResults() {
        renderRunFilter();
        const list = shownTrials();
        if (!list.length) {
            resultsEl.innerHTML = '<p class="debug-legend">No trials yet.</p>';
            return;
        }
        const scores = score(list);
        const tested = POSTURES.filter(p => list.some(t => t.posture === p.name));
        const head = scores.map(s => `<th>${s.name}</th>`).join("");
        const postureRows = tested.map(p => {
            const cells = scores
                .map(s => {
                    const row = s.byPosture.get(p.name);
                    const naming = s.scoresNaming && p.bad && row.alerted ? ` <span class="eval-label">${row.named} named right</span>` : "";
                    return `<td>${row.alerted}/${row.total}${naming}</td>`;
                })
                .join("");
            return `<tr><td>${p.name} <span class="eval-label">${p.bad ? "should alert" : "shouldn't alert"}</span></td>${cells}</tr>`;
        }).join("");
        const summaryRow = (label, fn) =>
            `<tr class="eval-summary"><td>${label}</td>${scores.map(s => `<td>${fn(s)}</td>`).join("")}</tr>`;

        resultsEl.innerHTML = `
          <p class="debug-legend">${describe(list)}. Cells show alerts / trials.</p>
          <div class="eval-table-wrap">
            <table class="debug-table eval-table">
              <thead><tr><th>Posture</th>${head}</tr></thead>
              <tbody>
                ${postureRows}
                ${summaryRow("Detection rate (bad postures caught)", s => pct(s.detection))}
                ${summaryRow("False alarm rate (okay postures flagged)", s => pct(s.falseAlarmRate))}
                ${summaryRow("Named the right problem", s => (s.scoresNaming ? `${pct(s.namingRate)} (${s.named}/${s.caught})` : "—"))}
                ${summaryRow("Average time to alert", s => (s.avgAlertSeconds === null ? "—" : `${s.avgAlertSeconds.toFixed(1)}s`))}
              </tbody>
            </table>
          </div>`;
    }

    function summaryText() {
        const list = shownTrials();
        const scores = score(list);
        const run = viewRun ?? lastRun();
        const lines = [
            `Posture Coach accuracy test, ${new Date().toLocaleString()}`,
            `${run === "all" ? "All runs" : `Run ${run}`}: ${describe(list)}, ${HOLD_SECONDS}s per trial.`,
            "",
        ];
        for (const s of scores) {
            lines.push(
                `${s.name}: detection ${pct(s.detection)} (${s.caught}/${s.badTotal}), ` +
                    `false alarms ${pct(s.falseAlarmRate)} (${s.falseAlarms}/${s.okTotal})` +
                    (s.scoresNaming ? `, named right ${pct(s.namingRate)} (${s.named}/${s.caught})` : "") +
                    (s.avgAlertSeconds === null ? "" : `, avg time to alert ${s.avgAlertSeconds.toFixed(1)}s`)
            );
        }
        lines.push("", "Per posture (alerts / trials):");
        for (const p of POSTURES) {
            if (!list.some(t => t.posture === p.name)) continue;
            const cells = scores.map(s => {
                const row = s.byPosture.get(p.name);
                const naming = s.scoresNaming && p.bad ? ` (${row.named} named right)` : "";
                return `${s.name} ${row.alerted}/${row.total}${naming}`;
            });
            lines.push(`  ${p.name} (${p.bad ? "should alert" : "shouldn't alert"}): ${cells.join(", ")}`);
        }
        return lines.join("\n");
    }

    // ---------------- RUNNING TRIALS ----------------
    function beep(freq, seconds = 0.12) {
        if (typeof audioCtx === "undefined" || !audioCtx) return;
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + seconds + 0.02);
    }

    function setPrompt(main, sub = "") {
        prompt.innerHTML = `<strong>${main}</strong>${sub ? `<span>${sub}</span>` : ""}`;
    }

    function waitForContinue() {
        startButton.textContent = "Continue";
        startButton.disabled = false;
        return new Promise(resolve => {
            continueResolver = resolve;
        });
    }

    function selectedPostures() {
        const checked = new Set(
            [...posturePicker.querySelectorAll("input:checked")].map(i => i.value)
        );
        return POSTURES.filter(p => checked.has(p.name));
    }

    // Returns the trial, or null if it was stopped or calibration was lost.
    async function runTrial(posture, run, round, total, index) {
        const label = `Round ${round} · ${index}/${total}`;
        for (let i = COUNTDOWN_SECONDS; i > 0; i--) {
            if (stopRequested) return null;
            setPrompt(`Get ready: ${posture.name} (${i})`, `${label} — ${posture.hint}`);
            beep(660, 0.06);
            await sleep(1000);
        }

        const baseline = state.baseline;
        recording = { frames: [], lastAt: performance.now() };
        beep(990, 0.18);
        for (let i = HOLD_SECONDS; i > 0; i--) {
            if (stopRequested || state.mode !== "monitoring" || state.baseline !== baseline) {
                recording = null;
                return null;
            }
            setPrompt(`Hold: ${posture.name} (${i})`, label);
            await sleep(1000);
        }
        const { frames } = recording;
        recording = null;
        beep(440, 0.25);

        return {
            posture: posture.name,
            bad: posture.bad,
            run,
            round,
            at: new Date().toISOString(),
            baseline: compact(baseline),
            frames,
        };
    }

    async function run() {
        if (state.mode !== "monitoring") {
            setPrompt("Start a session and finish calibrating first.");
            return;
        }
        const postures = selectedPostures();
        if (!postures.length) {
            setPrompt("Pick at least one posture to test.");
            return;
        }

        unlockAudio();
        running = true;
        stopRequested = false;
        state.quietAlerts = true; // don't chime or notify during trials
        state.stats.evaluation = true; // a test session isn't real usage; keep it out of history
        startButton.disabled = true;
        stopButton.hidden = false;
        roundsInput.disabled = true;
        posturePicker.querySelectorAll("input").forEach(i => (i.disabled = true));

        const rounds = Math.max(1, Math.min(20, Number(roundsInput.value) || 1));
        const runNumber = lastRun() + 1;
        const firstRound = trials.reduce((m, t) => Math.max(m, t.round), 0) + 1;
        viewRun = null; // follow the new run

        try {
            for (let r = 0; r < rounds && !stopRequested; r++) {
                const round = firstRound + r;
                for (let i = 0; i < postures.length && !stopRequested; i++) {
                    const trial = await runTrial(postures[i], runNumber, round, postures.length, i + 1);
                    if (!trial) {
                        if (!stopRequested) {
                            setPrompt("Calibration changed mid-trial, so that trial was dropped.",
                                "Wait for calibration to finish, then click Continue.");
                            await waitForContinue();
                            i--; // redo the same posture
                            startButton.disabled = true;
                        }
                        continue;
                    }
                    trials.push(trial);
                    saveTrials();
                    renderResults();
                }

                if (r < rounds - 1 && !stopRequested) {
                    setPrompt(`Round ${round} done.`,
                        "If you can, change something: lighting, glasses, chair or camera angle. " +
                            "Click Recalibrate in the app if you moved, then Continue.");
                    await waitForContinue();
                    startButton.disabled = true;
                }
            }
            setPrompt(stopRequested ? "Stopped. Finished trials are saved." : "All rounds done. Results are below.");
        } finally {
            running = false;
            recording = null;
            state.quietAlerts = false;
            // The live slouch timer kept running through the trials; start it
            // fresh so the last bad posture doesn't alert the moment we finish.
            state.timer = newTimer();
            state.status = "neutral";
            startButton.textContent = "Start test";
            startButton.disabled = false;
            stopButton.hidden = true;
            roundsInput.disabled = false;
            posturePicker.querySelectorAll("input").forEach(i => (i.disabled = false));
            renderResults();
        }
    }

    // ---------------- CONTROLS ----------------
    posturePicker.innerHTML = POSTURES.map(
        p => `<label><input type="checkbox" value="${p.name}" checked /> ${p.name}</label>`
    ).join("");

    runFilter.onchange = () => {
        viewRun = runFilter.value === "all" ? "all" : Number(runFilter.value);
        renderResults();
    };

    startButton.onclick = () => {
        if (continueResolver) {
            const resolve = continueResolver;
            continueResolver = null;
            resolve();
        } else if (!running) {
            run();
        }
    };

    stopButton.onclick = () => {
        stopRequested = true;
        if (continueResolver) {
            const resolve = continueResolver;
            continueResolver = null;
            resolve();
        }
    };

    copyButton.onclick = async () => {
        try {
            await navigator.clipboard.writeText(summaryText());
            copyButton.textContent = "Copied!";
        } catch {
            copyButton.textContent = "Couldn't copy";
        }
        setTimeout(() => (copyButton.textContent = "Copy summary"), 2000);
    };

    // Downloads every run, whatever the results view is showing.
    exportButton.onclick = () => {
        const data = {
            exportedAt: new Date().toISOString(),
            holdSeconds: HOLD_SECONDS,
            frameFormat: ["dtSeconds", KEYS],
            config,
            summary: summaryText(),
            trials,
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `posture-eval-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    undoButton.onclick = () => {
        if (running || !trials.length) return;
        const last = trials.pop();
        saveTrials();
        renderResults();
        setPrompt(`Discarded the last trial (${last.posture}, round ${last.round}).`);
    };

    clearButton.onclick = () => {
        if (running || !trials.length) return;
        if (!confirm(`Delete all ${trials.length} trials? Download your data first if you want to keep it.`)) return;
        trials = [];
        viewRun = null;
        saveTrials();
        renderResults();
        setPrompt("All trials cleared.");
    };

    card.hidden = false;
    renderResults();

    window.evaluator = {
        onFeatures(raw) {
            if (!recording) return;
            const now = performance.now();
            const dt = Math.min((now - recording.lastAt) / 1000, config.maxEvalStepSeconds);
            recording.frames.push([Math.round(dt * 1e4) / 1e4, pack(raw)]);
            recording.lastAt = now;
        },
    };
})();
