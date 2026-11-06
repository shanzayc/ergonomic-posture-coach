# 🧘 Ergonomic Posture Coach

A real-time posture monitoring web application that uses AI-powered pose detection to help you maintain healthy posture while working. The app runs entirely in your browser with complete privacy - no video data is uploaded or stored.

## 🌐 Live Demo
https://shanzayc.github.io/ergonomic-posture-coach/

## ✨ Features

- **Real-time Posture Detection**: Uses MediaPipe BlazePose for accurate body pose tracking
- **Automatic Calibration**: Learns your neutral posture in the first 5 seconds
- **Instant Feedback**: Visual alerts when you slouch or tilt your head forward
- **Privacy-First**: All processing happens locally in your browser
- **No Installation Required**: Runs directly in any modern web browser
- **Visual Indicators**: Color-coded status pill shows your posture in real-time

## 🚀 Quick Start

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, or Edge)
- Webcam access
- Internet connection (for loading ML models)

### Running Locally (Optional)

If you want to run the project locally or make modifications:

1. Clone the repository:
```bash
git clone https://github.com/shanzayc/ergonomic-posture-coach.git
cd ergonomic-posture-coach
```

2. Open `index.html` in your web browser

## 📖 How to Use

1. **Position Your Webcam**: Place your webcam directly in front of you at eye level
2. **Click "Start Session"**: Allow camera access when prompted
3. **Sit with Good Posture**: The app will automatically calibrate to your neutral posture in the first 5 seconds
4. **Continue Working**: The app will monitor your posture and alert you if you slouch
5. **Need to recalibrate?**: If you change positions or take a break, click "Start Session" again to recalibrate your neutral posture

### Status Indicators

- 🟢 **Good posture**: You're maintaining proper alignment
- 🟡 **Posture drifting**: Your posture is starting to deviate
- 🔴 **Poor posture**: Adjust your position to avoid strain

## 🛠️ Technical Details

### Technologies Used

- **TensorFlow.js**: Machine learning framework for browser-based AI
- **MediaPipe BlazePose**: High-fidelity body pose tracking
- **HTML5 Canvas**: Real-time video rendering and visualization
- **Vanilla JavaScript**: No framework dependencies for maximum compatibility

### How It Works

1. **Pose Detection**: MediaPipe BlazePose identifies 33 body keypoints in real-time
2. **Feature Extraction**: The app measures shoulder tilt and head-forward position
3. **Baseline Learning**: During calibration, it records your neutral posture metrics
4. **Continuous Monitoring**: Compares current posture against baseline thresholds
5. **Alert System**: Triggers warnings when poor posture is sustained for 4+ seconds

### Configuration

You can customize the detection sensitivity in `postureCoach.js`:

```javascript
const config = {
  autoCalibrateSeconds: 5,   // Calibration duration
  sustainedBadSeconds: 4,    // Time before triggering alert
  leanInThresh: 0.2,         // Shoulders 20% wider in frame = leaning toward the screen
  headDropThresh: 0.18,      // Head sinking toward the shoulders
  headForwardThresh: 0.12,   // Face 12% larger relative to shoulders = head jutting forward
  headSidewaysThresh: 0.15,  // Head shifted to one side (ignored while the head is turned)
  shoulderTiltThresh: 0.12,  // One shoulder lower than the other
};
```

To pick limits for your own setup, open the app with `?debug` at the end of the URL.
A tuning panel shows each reading live and lets you record postures to compare.

## 📁 Project Structure

```
ergonomic-posture-coach/
├── index.html              # Main HTML file
├── style.css              # Styling and layout
├── postureCoach.js        # Main application logic
├── postureTracking.js     # Pose detection wrapper
└── README.md             # Documentation
```

## 🔒 Privacy & Security

- **No Data Collection**: Video never leaves your device
- **Local Processing**: All AI computations run in your browser
- **No Server Required**: Can run completely offline after initial model download
- **Open Source**: Inspect the code yourself - it's all client-side JavaScript

### Development Setup

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request


## 📝 Future Enhancements

- [ ] Add sound notifications for posture alerts
- [ ] Track posture statistics over time
- [ ] Export posture reports
- [ ] Multiple calibration profiles
- [ ] Customizable alert thresholds via UI


## 🙏 Acknowledgments

- [MediaPipe](https://google.github.io/mediapipe/) by Google for pose detection models
- [TensorFlow.js](https://www.tensorflow.org/js) for browser-based ML
- Inspired by the need for better ergonomics in remote work

## Contact

If you’d like to connect or have questions about this project:

- **GitHub:** https://github.com/shanzayc
- **LinkedIn:** https://www.linkedin.com/in/shanzaychaudhry/
- **Email:** shanzayc@outlook.com
