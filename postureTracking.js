// Posture tracking state
let detector = null;
let video = null;
let isDetecting = false;
let sendPoseCallback = null;

async function setupPostureTracking(videoElement, sendPose) {
  video = videoElement;
  sendPoseCallback = sendPose;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
    });

    video.srcObject = stream;
    await video.play();

    // Pose model (MediaPipe BlazePose via TF pose-detection)
    const model = poseDetection.SupportedModels.BlazePose;
    const detectorConfig = {
      runtime: "mediapipe",
      solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/pose",
      modelType: "full",
    };

    detector = await poseDetection.createDetector(model, detectorConfig);
    console.log("Posture tracking initialized successfully");
    return true;
  } catch (error) {
    console.error("Error setting up posture tracking:", error);
    alert("Could not access webcam. Please allow camera permissions.");
    return false;
  }
}

function startDetection() {
  if (!detector || !video) {
    console.error("Posture tracking not initialized");
    return;
  }
  isDetecting = true;
  detectPose();
}

function stopDetection() {
  isDetecting = false;
}

async function detectPose() {
  if (!isDetecting) return;

  try {
    const poses = await detector.estimatePoses(video, { flipHorizontal: true });

    // Send the first pose (if detected)
    if (sendPoseCallback) {
      sendPoseCallback(poses[0] || null);
    }
  } catch (error) {
    console.error("Error detecting pose:", error);
  }

  setTimeout(() => detectPose(), 33);
}

window.postureTracking = {
  setupPostureTracking,
  startDetection,
  stopDetection,
};
