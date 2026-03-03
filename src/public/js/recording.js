import { S } from "./state.js";
import { log, setStatus } from "./utils.js";
import { stopConversationPolling, requestWakeLock } from "./state.js";
import { updateRecordButton } from "./ui/browser.js";
import { rebuildGlassesDisplay } from "./ui/glasses.js";

function startRecordingG2() {
  S.bridge.audioControl(true);
  log("G2 microphone opened");
}

function stopRecordingG2() {
  S.bridge.audioControl(false);
  log("G2 microphone closed");
}

async function startRecordingBrowser() {
  if (!navigator.mediaDevices?.getUserMedia) {
    log("Browser mic not available (no mediaDevices API)");
    setStatus("Mic not available", "error");
    S.isRecording = false;
    updateRecordButton("ready");
    return;
  }
  try {
    S.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    S.audioContext = new AudioContext({ sampleRate: 16000 });
    const source = S.audioContext.createMediaStreamSource(S.mediaStream);

    S.scriptProcessor = S.audioContext.createScriptProcessor(4096, 1, 1);
    S.scriptProcessor.onaudioprocess = (e) => {
      if (!S.isRecording || !S.ws || S.ws.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      S.ws.send(int16.buffer);
    };

    source.connect(S.scriptProcessor);
    S.scriptProcessor.connect(S.audioContext.destination);
    log("Browser microphone opened");
  } catch (err) {
    log("Mic error: " + err.message);
    throw err;
  }
}

function stopRecordingBrowser() {
  if (S.scriptProcessor) {
    S.scriptProcessor.disconnect();
    S.scriptProcessor = null;
  }
  if (S.audioContext) {
    S.audioContext.close();
    S.audioContext = null;
  }
  if (S.mediaStream) {
    S.mediaStream.getTracks().forEach((t) => t.stop());
    S.mediaStream = null;
  }
  log("Browser microphone closed");
}

export async function toggleRecording() {
  if (!S.session?.selectedContact && !S.session?.selectedMessage) {
    log("No contact or message selected, ignoring tap");
    return;
  }
  requestWakeLock();

  if (!S.isRecording) {
    S.isRecording = true;
    S.appState = "recording";
    stopConversationPolling();
    updateRecordButton("recording");
    const target = S.session.selectedContact?.name || S.session.selectedMessage?.from || "Unknown";
    setStatus(`Recording for ${target}...`);

    if (S.isG2) {
      S.displayRebuilt = false;
      rebuildGlassesDisplay("Recording...\n\nTap to stop", true);
    }

    if (S.isG2) {
      startRecordingG2();
    } else {
      await startRecordingBrowser();
    }
  } else {
    S.isRecording = false;
    S.appState = "processing";
    updateRecordButton("processing");
    setStatus("Processing...");

    if (S.isG2) {
      rebuildGlassesDisplay("Processing...", true);
    }

    if (S.isG2) {
      stopRecordingG2();
    } else {
      stopRecordingBrowser();
    }

    if (S.ws && S.ws.readyState === WebSocket.OPEN) {
      S.ws.send(JSON.stringify({ type: "stop" }));
    }
  }
}
