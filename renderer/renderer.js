const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const copyBtn = document.getElementById('copy-btn');
const recordBtn = document.getElementById('record-btn');

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setOverlayClass(toggleClass, enabled) {
  const root = document.documentElement;
  if (!root) return;
  if (enabled) root.classList.add(toggleClass);
  else root.classList.remove(toggleClass);
}

async function startRecording() {
  if (isRecording) return;
  try {
    if (!mediaStream) {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstart = () => {
      isRecording = true;
      setStatus('Recording… Press Ctrl+Alt+Space to stop.');
      setOverlayClass('recording', true);
    };
    mediaRecorder.onstop = async () => {
      isRecording = false;
      setOverlayClass('recording', false);
      setStatus('Transcribing…');
      setOverlayClass('loading', true);
      const blob = new Blob(recordedChunks, { type: 'audio/webm;codecs=opus' });
      const arrayBuffer = await blob.arrayBuffer();

      const result = await window.cheatAPI.sendAudio(arrayBuffer, 'audio/webm');
      if (!result || !result.ok) {
        setStatus('Error');
        transcriptEl.textContent = result && result.error ? String(result.error) : 'Unknown error';
        setOverlayClass('loading', false);
        return;
      }
      setStatus('Answer');
      const display = formatDisplay(result.transcript, result.answer);
      transcriptEl.textContent = display;
      setOverlayClass('loading', false);
    };
    mediaRecorder.start();
  } catch (error) {
    setStatus('Mic error');
    transcriptEl.textContent = error && error.message ? error.message : String(error);
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
}

function formatDisplay(transcript, answer) {
  let output = '';
  if (transcript && transcript.trim().length > 0) {
    output += `You: ${transcript.trim()}\n`;
  }
  if (answer && answer.trim().length > 0) {
    output += `AI: ${answer.trim()}`;
  }
  return output || 'No response';
}

window.cheatAPI.onToggleRecord(({ start }) => {
  if (start) startRecording();
  else stopRecording();
});

window.cheatAPI.onClickThroughChanged(({ ignoring }) => {
  setOverlayClass('clickable', !ignoring);
  setStatus(ignoring ? 'Mouse passthrough ON' : 'Mouse passthrough OFF');
});

setStatus('Ready. Press Ctrl+Alt+Space to record.');

if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      const text = transcriptEl.textContent || '';
      await navigator.clipboard.writeText(text);
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    } catch (_) {}
  });
}

if (recordBtn) {
  recordBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}

window.cheatAPI.onStatusText(({ text }) => {
  if (typeof text === 'string') setStatus(text);
});

