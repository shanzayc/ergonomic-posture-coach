# Ergonomic Posture Coach

A posture coach that watches you through your webcam while you work and tells you exactly what's wrong: leaning toward the screen, head down, head jutting forward, or leaning to one side. Everything runs in your browser. No video is uploaded or stored.

**Live demo:** https://shanzayc.github.io/ergonomic-posture-coach/

![Posture Coach mid-session, alerting "Poor posture — leaning toward the screen" with pose points tracked and session stats alongside](docs/screenshot.png)

## What makes it different

- **Uses what a front-facing camera can actually see.** A laptop webcam can't see you from the side, so instead of side-view angles it watches for signs it *can* see: your shoulders getting wider in the frame when you lean in, and your face getting larger relative to your shoulders when your head juts forward.
- **Limits picked from recorded data, not guesses.** A built-in tuning mode records what each signal does while you hold specific postures. The current limits came from those recordings (see [Tuning from real data](#tuning-from-real-data)).
- **Tells a head turn from a slouch.** Glancing at a second monitor shifts your head sideways, just like leaning on an elbow. The app tells them apart by face width and doesn't alert on head turns.
- **Calibrated to you.** It learns your neutral posture at the start of each session and only flags changes that are worse than that.
- **Alerts that reach you.** A desktop notification like "Sit up: leaning toward the screen" and an optional chime, even while you're working in another app.

  <img src="docs/notification.png" alt="macOS notification from Chrome reading &quot;Sit up: leaning toward the screen&quot;" width="351">

Also includes session stats (time tracked, % good posture, best streak, alerts), a history of your last 10 sessions, and smoothing so normal jitter doesn't trigger false alarms.

![Recent sessions list showing each session's date, length, percentage of good posture (color-coded) and number of alerts](docs/history.png)

## How to use

1. Put your webcam in front of you, near eye level, with your head and shoulders in frame.
2. Click **Start session** and allow camera access. Allow notifications too if you want alerts while you're in other apps.
3. Sit the way you want to sit for the first 5 seconds while it calibrates. Everything afterwards is measured against this.
4. Keep working. Hold a bad posture for about 4 seconds and you'll get an alert saying what's wrong.
5. Shifted position? Click **Recalibrate**. Done? Click **End session**: the camera turns off and the session is saved.

## How it works

[MediaPipe BlazePose](https://google.github.io/mediapipe/) finds 33 body points in each webcam frame, about 30 times a second. From your shoulders, nose, eyes and ears, the app runs five checks against your calibrated baseline:

| Check | What it looks at | Fires when |
|---|---|---|
| Leaning toward the screen | Shoulder width in the frame | 20%+ wider than baseline |
| Head down | How far your nose sits below your shoulders | 0.18+ lower than baseline |
| Head jutting forward | Face width ÷ shoulder width | 12%+ larger than baseline |
| Leaning to one side | How far your head sits off-center | 0.15+ further off-center (skipped while your head is turned) |
| Shoulders uneven | Height difference between your shoulders | 0.12+ more than baseline |

Readings are smoothed over about half a second. An alert fires after a bad posture lasts 4 seconds, and posture has to look good for a full second before that timer resets.

## Tuning from real data

The first version measured your nose sliding left or right of your shoulders and called it "head forward." Recording real postures showed that was the wrong signal:

| Posture | Shoulder width | Face size | Head drop | Head sideways |
|---|---|---|---|---|
| Good posture | +1% | −1% | −0.01 | −0.01 |
| Lean toward screen | **+28%** | **+23%** | **+0.20** | −0.03 |
| Look at other monitor | +2% | **−35%** | −0.07 | **+0.195** |
| Lean on one elbow | +9% | **+29%** | +0.13 | **+0.215** |
| Look down at keyboard | +4% | **+45%** | **+0.52** | −0.01 |

*Change from the calibrated baseline, one recording per posture.*

- **Leaning in** showed up clearly in shoulder width (+28%) but barely moved the old "head forward" signal.
- **Looking at another monitor** came within 0.025 of the old rule's 0.22 limit, a false alarm waiting to happen, while **leaning on an elbow** stayed just under it and was never flagged.
- **Face width separates the two:** it shrinks when you turn your head (−35%) and grows when you lean (+29%), so the sideways check now skips frames where your head is turned.

A second recording showed exaggerated slumping and chin-forward being caught (head drop +0.28, face size +16%), and normal shifting in the chair reaching +12% shoulder width, so the lean-in limit was set to 20%.

### Tune it for your setup

Add `?debug` to the URL (for example `https://shanzayc.github.io/ergonomic-posture-coach/?debug`) to open a tuning panel. It shows every reading live next to your baseline, records a 3-second average while you hold each of seven postures, and gives you the results as text to copy.

<details>
<summary>Settings in <code>postureCoach.js</code></summary>

```javascript
const config = {
  autoCalibrateSeconds: 5,   // Calibration duration
  sustainedBadSeconds: 4,    // How long a bad posture lasts before an alert
  leanInThresh: 0.2,         // Shoulders 20% wider in frame = leaning toward the screen
  headDropThresh: 0.18,      // Head sinking toward the shoulders
  headForwardThresh: 0.12,   // Face 12% larger relative to shoulders = head jutting forward
  headSidewaysThresh: 0.15,  // Head further off-center (ignored while the head is turned)
  shoulderTiltThresh: 0.12,  // Shoulders more uneven than baseline
  headTurnThresh: 0.15,      // Face 15% narrower = head turned
};
```

</details>

## Running locally

You need a webcam and an internet connection (the pose model loads from a CDN). Developed and tested in Chrome.

```bash
git clone https://github.com/shanzayc/ergonomic-posture-coach.git
cd ergonomic-posture-coach
python3 -m http.server 8000
```

Then open http://localhost:8000. Browsers only allow camera access on `https://` or `localhost`, so opening `index.html` directly from your files may not work.

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page layout and styling |
| `postureCoach.js` | Signals, calibration, posture checks, alerts, stats and history |
| `postureTracking.js` | Camera and pose-detection wrapper |
| `debugPanel.js` | The `?debug` tuning panel |

The live demo is served by GitHub Pages from the `gh-pages` branch.

## Privacy

Pose detection runs in your browser, and video frames are never uploaded or saved. Session history stays in your browser's local storage. There are no accounts, server or analytics; the page only loads its scripts, pose model and font from public CDNs (jsDelivr and Google Fonts).

## Limitations

- **Subtle slouching can slip through.** A slight slump or chin-forward barely changes what a front-facing camera sees, so only clear versions are caught. Catching subtle ones would cause false alarms during normal sitting.
- **Limits come from one person's recordings.** Different cameras, desks and bodies may need different limits. Use `?debug` to check yours.
- **Calibration matters.** If you're slouching during the first 5 seconds, that becomes your baseline. Recalibrate if that happens.
- **Background alerts may slow down.** Browsers throttle hidden tabs, which can delay alerts if the tab stays hidden for a long time.

## Future enhancements

- [ ] Settings panel for alert sensitivity
- [ ] Break reminders (e.g. stand up every 30 minutes)
- [ ] Chart of posture over past sessions
- [ ] Export posture reports
- [ ] Multiple calibration profiles

## Acknowledgments

- [MediaPipe](https://google.github.io/mediapipe/) by Google for the BlazePose model
- [TensorFlow.js pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection) for the browser pose API

## Contact

- **GitHub:** https://github.com/shanzayc
- **LinkedIn:** https://www.linkedin.com/in/shanzaychaudhry/
- **Email:** shanzayc@outlook.com
