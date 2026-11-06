# How Posture Coach was tested

This is the long version of the results in the [README](../README.md): how the limits were picked, how accuracy was measured, and what the numbers showed. All trials were done by one person (me), at one desk, with a MacBook Air webcam.

## The test method

The app has a hidden test mode. Open it by adding `?debug` to the URL:
https://shanzayc.github.io/ergonomic-posture-coach/?debug

The accuracy test walks you through rounds of labeled trials. For each posture there's a 3-second countdown, then you hold the posture for 7 seconds while every frame is recorded. Alerts need 4 seconds of bad posture, so 7 seconds leaves room for that plus smoothing. You recalibrate at the start of each round.

Scoring replays the recorded frames through the same alert code the live app uses, under three rule sets:

- **Original**: the first version's three fixed limits, no smoothing, and a timer that any single clean frame reset
- **Original + smoothing**: the same limits with the jitter fix, to separate how much each change helped
- **Current**: the rules as they are now

Because the raw frames are kept, every rule set is scored on exactly the same trials. I also rewrote the scoring in Python and re-ran it on the exported data, and it matched trial for trial.

## Picking the signals

The first version measured how far your nose slid left or right of your shoulders and called it "head forward." Before running a full test I recorded each posture once and looked at what the readings actually did. The numbers below are the change from the calibrated baseline.

| Posture | Shoulder width | Face size | Head drop | Head sideways |
|---|---|---|---|---|
| Good posture | +1% | −1% | −0.01 | −0.01 |
| Lean toward screen | +28% | +23% | +0.20 | −0.03 |
| Look at other monitor | +2% | −35% | −0.07 | +0.195 |
| Lean on one elbow | +9% | +29% | +0.13 | +0.215 |
| Look down at keyboard | +4% | +45% | +0.52 | −0.01 |

Leaning in barely moved the old "head forward" reading but made the shoulders 28% wider in the frame. Looking at another monitor and leaning on an elbow both shifted the head about the same amount sideways (0.195 and 0.215, against an old limit of 0.22), so one rule couldn't catch the lean without also catching the head turn. Face width tells them apart: it shrank 35% when the head turned and grew 29% on the elbow lean. The sideways check now ignores frames where the face has narrowed by 15% or more.

A second recording showed normal shifting in the chair reaching +12% shoulder width, so the lean-in limit was set at 20%.

## Run 1

70 trials over 10 rounds: 5 bad postures and 2 normal ones, 10 times each. The rules were fixed before the run.

| Posture | Original | Original + smoothing | Tuned |
|---|---|---|---|
| Lean toward screen | 2/10 | 2/10 | 10/10 |
| Lean on one elbow | 4/10 | 6/10 | 10/10 |
| Look down at keyboard | 8/10 | 9/10 | 9/10 |
| Chin forward | 1/10 | 1/10 | 5/10 |
| Slump down | 2/10 | 3/10 | 1/10 |
| **Bad postures caught** | **34%** | **42%** | **70%** |
| Good posture (false alarms) | 0/10 | 0/10 | 0/10 |
| Look at other monitor (false alarms) | 0/10 | 0/10 | 1/10 |

Smoothing alone took detection from 34% to 42%. The new signals did the rest.

Two problems stood out. Slumping was caught once in 10 tries. Looking at the recordings, in 7 of the 10 slumps I'd sunk back *away* from the camera, making my shoulders 19 to 37% narrower in the frame, and nothing checked for that. Also, the alert named the right problem only 43% of the time. It named the first check in a fixed list that fired, and leaning in tended to trigger the face-size check too, so the name often described a side effect instead of the cause.

## Changes after Run 1

- A **slumped-back** check: shoulders at least 15% narrower than baseline while the head also sits a little lower. Requiring both means sitting back upright doesn't count.
- **Cause-first naming**: checks are ordered so the alert names the cause. Leaning in makes the face look bigger, so "leaning toward the screen" now outranks "head jutting forward."
- The test gained four more normal movements (reach for a mug, glance down at the keyboard, shift in your chair, stretch) and a score for whether the alert named the right problem.

These changes were chosen by looking at Run 1, so Run 1 can't fairly measure them. Run 2 used new trials.

## Run 2

55 trials over 5 rounds: 5 bad postures and 6 normal movements, 5 times each. Recorded after all the changes above.

| Posture | Original | Original + smoothing | Current | Named right (current) |
|---|---|---|---|---|
| Lean toward screen | 4/5 | 4/5 | 5/5 | 0/5 |
| Slump down | 1/5 | 1/5 | 5/5 | 5/5 |
| Chin forward | 0/5 | 0/5 | 5/5 | 3/5 |
| Lean on one elbow | 3/5 | 4/5 | 5/5 | 4/5 |
| Look down at keyboard | 5/5 | 5/5 | 5/5 | 5/5 |
| **Bad postures caught** | **52%** (13/25) | **56%** (14/25) | **100%** (25/25) | **68%** (17/25) |
| Good posture | 0/5 | 0/5 | 0/5 | |
| Look at other monitor | 0/5 | 0/5 | 0/5 | |
| Reach for a mug | 0/5 | 0/5 | 0/5 | |
| Glance down at keyboard | 0/5 | 0/5 | 0/5 | |
| Shift in your chair | 0/5 | 0/5 | 1/5 | |
| Stretch | 0/5 | 4/5 | 4/5 | |
| **False alarms** | **0%** (0/30) | **13%** (4/30) | **17%** (5/30) | |

Every bad posture was caught, and the slumped-back check went from no coverage to 5 of 5. Average time from holding a bad posture to the alert was 4.2 seconds.

Stretching caused 4 of the 5 false alarms. A stretch held for several seconds really does look like bad posture to the camera: one shoulder raised, leaning back, head to one side. The original rules had no false alarms, but mostly because they caught so little.

Leaning toward the screen was always caught but named "head down" every time, because I dropped my head as I leaned in. "Head down" ranks above leaning in so that looking down at the keyboard gets the right name, and these two cases are hard to tell apart from the front.

## What I'd change next

- The "shoulders uneven" check was the only reason for 2 of the 5 false alarms and never caught a bad posture by itself. Dropping it, or requiring a longer hold before stretch-like movements alert, would be the first thing to try. Any change would need a new run to measure honestly.
- All 125 trials were mine. Someone with a different build, chair or camera height may need different limits.
- 25 bad-posture trials is a small sample. A longer run, or a few hours of normal work with every alert marked right or wrong, would give a firmer false-alarm rate.

## Tuning it yourself

The `?debug` page also has a tuning panel that shows every reading live next to your baseline and records a 3-second average while you hold a posture. The limits live in `postureCoach.js`:

```javascript
const config = {
  autoCalibrateSeconds: 5,   // Calibration duration
  sustainedBadSeconds: 4,    // How long a bad posture lasts before an alert
  leanInThresh: 0.2,         // Shoulders 20% wider in frame = leaning toward the screen
  headDropThresh: 0.18,      // Head sinking toward the shoulders
  headForwardThresh: 0.12,   // Face 12% larger relative to shoulders = head jutting forward
  headSidewaysThresh: 0.15,  // Head further off-center (ignored while the head is turned)
  shoulderTiltThresh: 0.12,  // Shoulders more uneven than baseline
  slumpBackThresh: 0.15,     // Shoulders 15% narrower = sank back away from the camera...
  slumpDropMin: 0.03,        // ...while the head sits at least this much lower
  headTurnThresh: 0.15,      // Face 15% narrower = head turned
};
```

Test runs are kept separate in the accuracy test, and **Download data** exports every trial with its raw frames.
