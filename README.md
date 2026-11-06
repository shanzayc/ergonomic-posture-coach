# Ergonomic Posture Coach

A posture coach that runs in your browser. It watches how you sit through your webcam and tells you what's wrong, whether you're leaning toward the screen, slumping back, looking down, pushing your chin forward or leaning to one side. Video never leaves your device.

**Live demo:** https://shanzayc.github.io/ergonomic-posture-coach/

In testing on 55 new trials, it caught 25 of 25 bad postures, up from 13 of 25 with its original rules. ([How it was tested](docs/EVALUATION.md))

![Posture Coach mid-session, alerting "Poor posture — leaning toward the screen" with pose points tracked and session stats alongside](docs/screenshot.png)

## How to use

1. Put your webcam in front of you at about eye level, with your head and shoulders in frame.
2. Click **Start session** and allow camera access. Allow notifications as well if you want alerts while you're in other apps.
3. Sit the way you want to sit for the first 5 seconds while it calibrates.
4. Keep working. If you hold a bad posture for about 4 seconds, you'll get an alert that says what's wrong.
5. Click **Recalibrate** if you change position, and **End session** when you're done.

Each session tracks time, percentage of good posture, your best streak and the number of alerts, and your last 10 sessions are saved on your device.

![Recent sessions list showing each session's date, length, percentage of good posture and number of alerts](docs/history.png)

## How it works

[MediaPipe BlazePose](https://google.github.io/mediapipe/) finds 33 body points in each webcam frame, about 18 times a second on a MacBook Air. The app learns your neutral posture during calibration and compares every frame with it.

A laptop camera only sees you from the front, so the app relies on what changes from that angle. Your shoulders look wider when you lean in and narrower when you slump back. Your face looks bigger relative to your shoulders when your head moves forward, and your nose sits lower when you look down. Turning your head to another monitor also moves it sideways, but it makes your face look narrower, so the app can tell a head turn from leaning to one side and doesn't alert on it.

Readings are smoothed so normal jitter doesn't set anything off. When a bad posture lasts 4 seconds, you get a desktop notification and an optional chime, even if you're in another app. When several problems show up at once, the alert names the cause. Leaning in also makes your face look bigger, for example, so it says "leaning toward the screen" rather than "head jutting forward."

<img src="docs/notification.png" alt="macOS notification from Chrome reading &quot;Sit up: leaning toward the screen&quot;" width="351">

My first version used limits I'd guessed, and its "head forward" check was really measuring head turns. So I built a test mode that records labeled posture trials and replays them through the alert logic, and used the recordings to choose the current signals and limits. You can open it by adding `?debug` to the URL.

## Results

From the second test run: 55 trials, with each posture held for 7 seconds, recorded after all changes were made.

| | Original rules | Current rules |
|---|---|---|
| Bad postures caught | 13/25 (52%) | 25/25 (100%) |
| False alarms during normal movement | 0/30 | 5/30 (17%) |
| Alert named the right problem | — | 17/25 (68%) |

Most false alarms came from stretching. The per-posture results, the first test run and how the limits were chosen are in [docs/EVALUATION.md](docs/EVALUATION.md).

## Limitations

- A stretch held for several seconds can trigger an alert (4 of 5 stretches did in testing).
- Leaning toward the screen is often named "head down," because people tend to drop their head as they lean in.
- Very subtle slouching barely changes what a front-facing camera sees, so it can slip through.
- All testing was done by one person. A different body, chair or camera position may need different limits, which you can check with `?debug`.
- If you're slouching while it calibrates, that becomes your baseline. Recalibrate if that happens.
- Browsers slow down hidden tabs, so alerts can be delayed if the tab stays hidden for a long time.

## Running locally

You need a webcam and an internet connection, since the pose model loads from a CDN. Developed and tested in Chrome.

```bash
git clone https://github.com/shanzayc/ergonomic-posture-coach.git
cd ergonomic-posture-coach
python3 -m http.server 8000
```

Then open http://localhost:8000. Browsers only allow camera access on `https://` or `localhost`, so opening `index.html` straight from your files may not work.

## Privacy

Pose detection runs in your browser and frames are never uploaded or saved. Session history stays in your browser's local storage. There are no accounts, server or analytics. The page only loads its scripts, pose model and font from public CDNs (jsDelivr and Google Fonts).

## Acknowledgments

- [MediaPipe](https://google.github.io/mediapipe/) by Google for the BlazePose model
- [TensorFlow.js pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection) for the browser pose API

## Contact

- GitHub: https://github.com/shanzayc
- LinkedIn: https://www.linkedin.com/in/shanzaychaudhry/
- Email: shanzayc@outlook.com
