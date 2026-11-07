"""Re-score Posture Coach accuracy-test exports, independently of the app.

The in-app accuracy test (open the app with ?debug) scores trials by
replaying recorded frames through the app's JavaScript alert logic. This
script re-implements that logic in Python and scores the same exported
trials, as a check that the numbers in docs/EVALUATION.md are right.

Usage:
    python3 tools/verify_eval.py docs/data/posture-eval.json
    python3 tools/verify_eval.py docs/data/posture-eval.json --run 2

Only the standard library is needed.
"""

import argparse
import json
import math
from collections import defaultdict

# Alert names that count as naming each bad posture correctly (mirrors
# POSTURES in evaluator.js).
EXPECTED_NAMES = {
    "Lean toward screen": {"leaning toward the screen"},
    "Slump down": {"slumped back in the chair", "head down"},
    "Chin forward": {"head jutting forward"},
    "Lean on one elbow": {"leaning to one side"},
    "Look down at keyboard": {"head down"},
}


def rel(now, base):
    """Fractional change from baseline, or None if either reading is missing."""
    if now is None or not base:
        return None
    return now / base - 1


def face_change(f, b):
    """Face width change, preferring the eyes and falling back to the ears."""
    eyes = rel(f["eyeRatio"], b["eyeRatio"])
    return eyes if eyes is not None else rel(f["earRatio"], b["earRatio"])


def above(value, limit):
    return value is not None and value > limit


# ---------------- RULE SETS ----------------
# Each returns the problems found in one frame, in the order the app would
# name them.

def original_rules(f, b, cfg):
    """The first version: three fixed limits."""
    problems = []
    if abs(f["shoulderTilt"] - b["shoulderTilt"]) > 0.12:
        problems.append("shoulder tilt")
    if abs(f["headSideways"] - b["headSideways"]) > 0.22:
        problems.append("head sideways")
    if f["headDrop"] - b["headDrop"] > 0.18:
        problems.append("head drop")
    return problems


def _common_checks(f, b, cfg):
    face = face_change(f, b)
    turned = face is not None and face < -cfg["headTurnThresh"]
    width = rel(f["shoulderWidthPx"], b["shoulderWidthPx"])
    drop = f["headDrop"] - b["headDrop"]
    return {
        "leaning to one side": face is not None and not turned
        and f["headSideways"] - b["headSideways"] > cfg["headSidewaysThresh"],
        "head down": drop > cfg["headDropThresh"],
        "leaning toward the screen": above(width, cfg["leanInThresh"]),
        "head jutting forward": above(face, cfg["headForwardThresh"]),
        "shoulders uneven": f["shoulderTilt"] - b["shoulderTilt"] > cfg["shoulderTiltThresh"],
        "slumped back in the chair": width is not None
        and -width > cfg.get("slumpBackThresh", 0.15)
        and drop > cfg.get("slumpDropMin", 0.03),
    }


def tuned_v1_rules(f, b, cfg):
    """The rules tested in Run 1: no slumped-back check, fixed list order."""
    fired = _common_checks(f, b, cfg)
    order = ["leaning toward the screen", "head down", "head jutting forward",
             "leaning to one side", "shoulders uneven"]
    return [name for name in order if fired[name]]


def current_rules(f, b, cfg):
    """The current rules: slumped-back check, causes named first."""
    fired = _common_checks(f, b, cfg)
    order = ["leaning to one side", "head down", "slumped back in the chair",
             "leaning toward the screen", "head jutting forward", "shoulders uneven"]
    return [name for name in order if fired[name]]


RULE_SETS = [
    # name, rules, smoothing, recovery seconds (None = use the config value)
    ("Original", original_rules, False, 0),
    ("Original + smoothing", original_rules, True, None),
    ("Tuned (Run 1)", tuned_v1_rules, True, None),
    ("Current", current_rules, True, None),
]


# ---------------- SLOUCH TIMER ----------------

def smooth(prev, new, dt, cfg):
    """Time-based moving average, matching smoothFeatures in postureCoach.js."""
    if prev is None:
        return new
    a = 1 - math.exp(-dt / cfg["smoothingSeconds"])
    return {k: new[k] if prev[k] is None or new[k] is None else prev[k] + a * (new[k] - prev[k])
            for k in new}


def replay(trial, keys, cfg, rules, smoothing, recover_seconds):
    """Return (seconds until the alert, problems at that moment), or (None, None)."""
    if recover_seconds is None:
        recover_seconds = cfg["recoverSeconds"]
    smoothed, bad_for, good_for, t = None, 0.0, 0.0, 0.0
    for dt, values in trial["frames"]:
        t += dt
        frame = dict(zip(keys, values)) if values else None
        if smoothing:
            smoothed = frame and smooth(smoothed, frame, dt, cfg)
            frame = smoothed
        if not frame:
            bad_for = good_for = 0.0
            continue
        problems = rules(frame, trial["baseline"], cfg)
        if not problems:
            if bad_for > 0:
                good_for += dt
                if good_for < recover_seconds:
                    continue  # not trusted yet; hold the timer
            bad_for = good_for = 0.0
            continue
        good_for = 0.0
        bad_for += dt
        if bad_for >= cfg["sustainedBadSeconds"]:
            return t, problems
    return None, None


# ---------------- REPORT ----------------

def pct(part, whole):
    return f"{part / whole:.0%}" if whole else "—"


def score(trials, keys, cfg):
    for name, rules, smoothing, recover in RULE_SETS:
        per_posture = defaultdict(lambda: [0, 0])  # alerts, trials
        caught = bad = false_alarms = okay = named_right = 0
        alert_time = 0.0
        for trial in trials:
            at, problems = replay(trial, keys, cfg, rules, smoothing, recover)
            row = per_posture[trial["posture"]]
            row[1] += 1
            if at is not None:
                row[0] += 1
            if trial["bad"]:
                bad += 1
                if at is not None:
                    caught += 1
                    alert_time += at
                    if problems[0] in EXPECTED_NAMES.get(trial["posture"], ()):
                        named_right += 1
            else:
                okay += 1
                if at is not None:
                    false_alarms += 1

        line = (f"{name}: detection {pct(caught, bad)} ({caught}/{bad}), "
                f"false alarms {pct(false_alarms, okay)} ({false_alarms}/{okay})")
        if rules is not original_rules:
            line += f", named right {pct(named_right, caught)} ({named_right}/{caught})"
        if caught:
            line += f", avg time to alert {alert_time / caught:.1f}s"
        print(line)
        for posture, (alerts, total) in per_posture.items():
            print(f"    {posture:<24} {alerts}/{total}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("export", help="JSON file from the accuracy test's Download data button")
    parser.add_argument("--run", type=int, help="only score this test run (default: each run separately)")
    args = parser.parse_args()

    with open(args.export) as fh:
        data = json.load(fh)
    keys = data["frameFormat"][1]
    cfg = data["config"]

    runs = defaultdict(list)
    for trial in data["trials"]:
        runs[trial.get("run", 1)].append(trial)  # trials from before runs existed are run 1

    for run in sorted(runs):
        if args.run is not None and run != args.run:
            continue
        trials = runs[run]
        rounds = len({t["round"] for t in trials})
        print(f"\n=== Run {run}: {len(trials)} trials over {rounds} rounds ===")
        score(trials, keys, cfg)


if __name__ == "__main__":
    main()
