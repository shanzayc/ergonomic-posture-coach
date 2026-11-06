// Posture tracking state
let detector = null;
let video = null;
let stream = null;
let sendPoseCallback = null;

// Bumped on every start/stop. A loop left over from an earlier start sees
// its id is stale and exits instead of running alongside the new one.
let loopId = 0;

function describeCameraError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow camera permissions for this site and try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No webcam was found. Connect a camera and try again.";
    case "NotReadableError":
      return "Your webcam is being used by another app. Close it there and try again.";
    default:
      return "Could not start the webcam.";
  }
}

async function setupPostureTracking(videoElement, sendPose, onStatus = () => {}) {
  video = videoElement;
  sendPoseCallback = sendPose;

  if (!stream) {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("This browser can't access the webcam here. Open the page over https.");
      return false;
    }

    onStatus("Starting camera…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      console.error("Error starting camera:", error);
      stopCamera();
      alert(describeCameraError(error));
      return false;
    }
  }

  // Kept across sessions: re-downloading the model every time is slow.
  if (!detector) {
    onStatus("Loading posture model…");
    try {
      // Pose model (MediaPipe BlazePose via TF pose-detection)
      const model = poseDetection.SupportedModels.BlazePose;
      const detectorConfig = {
        runtime: "mediapipe",
        solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/pose",
        modelType: "full",
      };

      detector = await poseDetection.createDetector(model, detectorConfig);
    } catch (error) {
      console.error("Error loading pose model:", error);
      stopCamera();
      alert("Could not load the posture model. Check your internet connection and try again.");
      return false;
    }
  }

  console.log("Posture tracking initialized successfully");
  return true;
}

function startDetection() {
  if (!detector || !video) {
    console.error("Posture tracking not initialized");
    return;
  }
  detectPose(++loopId);
}

function stopDetection() {
  loopId++;
}

// Stops detection and releases the webcam so its light turns off.
function stopCamera() {
  stopDetection();
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (video) video.srcObject = null;
}

async function detectPose(id) {
  if (id !== loopId) return;

  try {
    const poses = await detector.estimatePoses(video, { flipHorizontal: true });

    // Stopped while this estimate was in flight; drop the result.
    if (id !== loopId) return;

    // Send the first pose (if detected)
    if (sendPoseCallback) {
      sendPoseCallback(poses[0] || null);
    }
  } catch (error) {
    console.error("Error detecting pose:", error);
  }

  setTimeout(() => detectPose(id), 33);
}

window.postureTracking = {
  setupPostureTracking,
  startDetection,
  stopDetection,
  stopCamera,
};
