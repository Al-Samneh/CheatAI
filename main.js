const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

/**
 * Creates the transparent, click-through overlay window.
 */
function createOverlayWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 220,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    focusable: false,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Make the window ignore mouse by default (undetectable by mouse), but still forward
  // to allow hover effects if needed.
  window.setIgnoreMouseEvents(true, { forward: true });
  try { window.setContentProtection(true); } catch (_) {}

  // Position at top-center of primary display once ready
  window.once('ready-to-show', () => {
    positionTopCenter(window);
    window.showInactive();
  });

  // Ensure renderer receives initial state after load
  window.webContents.on('did-finish-load', () => {
    try {
      window.webContents.send('click-through-changed', { ignoring: isClickThrough });
      window.webContents.send('status-text', { text: 'Ready. Ctrl+Alt+Space: record • Ctrl+Alt+M: interact • Ctrl+Alt+P: protect • Ctrl+Alt+H: show/hide' });
    } catch (_) {}
  });

  return window;
}

let mainWindow = null;
let isRecording = false;
let isClickThrough = true;
let isContentProtected = true;
let isVisible = true;

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  // Auto-allow mic permission requests
  try {
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      if (permission === 'media') return callback(true);
      return callback(false);
    });
  } catch (_) {}
  mainWindow = createOverlayWindow();

  // Toggle record: Ctrl+Alt+Space
  globalShortcut.register('Control+Alt+Space', () => {
    isRecording = !isRecording;
    if (mainWindow) {
      mainWindow.webContents.send('toggle-record', { start: isRecording });
    }
  });

  // Backup record hotkeys
  globalShortcut.register('Alt+Shift+Space', () => {
    isRecording = !isRecording;
    if (mainWindow) {
      mainWindow.webContents.send('toggle-record', { start: isRecording });
    }
  });
  globalShortcut.register('Control+Alt+R', () => {
    isRecording = !isRecording;
    if (mainWindow) {
      mainWindow.webContents.send('toggle-record', { start: isRecording });
    }
  });

  // Toggle click-through mouse ignore: Ctrl+Alt+M (+ backup)
  const toggleClickThrough = () => {
    isClickThrough = !isClickThrough;
    if (mainWindow) {
      mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
      // Allow focusing and interaction only when not click-through
      if (process.platform === 'win32' || process.platform === 'linux') {
        try { mainWindow.setFocusable(!isClickThrough); } catch (_) {}
      }
      if (!isClickThrough) {
        try { mainWindow.focus(); } catch (_) {}
      }
      mainWindow.webContents.send('click-through-changed', { ignoring: isClickThrough });
    }
  };
  globalShortcut.register('Control+Alt+M', toggleClickThrough);
  globalShortcut.register('Alt+Shift+M', toggleClickThrough);

  // Toggle content protection: Ctrl+Alt+P (+ backup)
  const toggleProtection = () => {
    isContentProtected = !isContentProtected;
    if (mainWindow) {
      try { mainWindow.setContentProtection(isContentProtected); } catch (_) {}
      mainWindow.webContents.send('status-text', { text: isContentProtected ? 'Capture protection ON' : 'Capture protection OFF' });
    }
  };
  globalShortcut.register('Control+Alt+P', toggleProtection);
  globalShortcut.register('Alt+Shift+P', toggleProtection);

  // Toggle visibility: Ctrl+Alt+H
  const toggleVisibility = () => {
    if (!mainWindow) return;
    if (isVisible) {
      isVisible = false;
      try { mainWindow.hide(); } catch (_) {}
    } else {
      isVisible = true;
      try {
        positionTopCenter(mainWindow);
        mainWindow.showInactive();
      } catch (_) {}
    }
  };
  globalShortcut.register('Control+Alt+H', toggleVisibility);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createOverlayWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC: Audio data from renderer → transcribe with Deepgram → ask OpenRouter → return answer
ipcMain.handle('transcribe-and-ask', async (_event, payload) => {
  const { audioArrayBuffer, mimeType } = payload || {};
  if (!audioArrayBuffer || !mimeType) {
    return { ok: false, error: 'Missing audio data or mime type' };
  }

  try {
    const transcript = await transcribeWithDeepgram(Buffer.from(audioArrayBuffer), mimeType);
    if (!transcript) {
      return { ok: false, error: 'No transcript returned' };
    }
    const answer = await askOpenRouterDeepSeek(transcript);
    return { ok: true, transcript, answer };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
});

async function transcribeWithDeepgram(buffer, mimeType) {
  const DG_KEY = process.env.DEEPGRAM_API_KEY;
  if (!DG_KEY) throw new Error('Missing DEEPGRAM_API_KEY in environment');

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-2');
  url.searchParams.set('smart_format', 'true');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DG_KEY}`,
      'Content-Type': mimeType,
    },
    body: buffer,
  });

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new Error(`Deepgram error ${response.status}: ${text}`);
  }

  const data = await response.json();
  // Deepgram JSON structure: results.channels[0].alternatives[0].transcript
  const transcript =
    data &&
    data.results &&
    data.results.channels &&
    data.results.channels[0] &&
    data.results.channels[0].alternatives &&
    data.results.channels[0].alternatives[0] &&
    data.results.channels[0].alternatives[0].transcript;

  return transcript || '';
}

async function askOpenRouterDeepSeek(prompt) {
  const models = getOpenRouterModelsFromEnv();
  let lastError = null;
  for (const model of models) {
    try {
      return await askOpenRouterOnce(model, prompt);
    } catch (err) {
      lastError = err;
      const status = err && err.status;
      const body = err && err.body ? String(err.body) : '';
      // Provider/model not available → try next model
      if (status === 404 && (/No allowed providers/i.test(body) || /No endpoints found/i.test(body))) {
        continue;
      }
      // Otherwise, fail fast
      throw err;
    }
  }
  if (lastError) throw lastError;
  throw new Error('OpenRouter: no models available to try. Set OPENROUTER_MODEL or OPENROUTER_MODELS.');
}

function getOpenRouterModelsFromEnv() {
  const list = (process.env.OPENROUTER_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (list.length > 0) return list;
  const single = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-r1:free';
  return [single];
}

async function askOpenRouterOnce(model, prompt) {
  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) throw new Error('Missing OPENROUTER_API_KEY in environment');

  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const siteUrl = process.env.OPENROUTER_SITE_URL || '';
  const siteTitle = process.env.OPENROUTER_SITE_TITLE || 'cheatAI overlay';

  const headers = {
    Authorization: `Bearer ${OR_KEY}`,
    'Content-Type': 'application/json',
    'X-Title': siteTitle,
  };
  if (siteUrl) headers['HTTP-Referer'] = siteUrl;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a concise assistant. Answer directly.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await safeReadText(response);
    if (response.status === 404) {
      if (/No allowed providers/i.test(text)) {
        const err = new Error(`OpenRouter: No allowed providers for model "${model}". Enable at least one provider for this model in your OpenRouter settings, or choose a different model.`);
        err.status = 404;
        err.body = text;
        throw err;
      }
      if (/Free model publication/i.test(text)) {
        const err = new Error(
          'OpenRouter privacy setting is blocking free models. Enable Free model publication or switch models.\n' +
          'Open: https://openrouter.ai/settings/privacy\n' +
          `Current model: ${model}`
        );
        err.status = 404;
        err.body = text;
        throw err;
      }
    }
    const generic = new Error(`OpenRouter error ${response.status}: ${text}`);
    generic.status = response.status;
    generic.body = text;
    throw generic;
  }

  const data = await response.json();
  const answer =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  return answer || '';
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch (e) {
    return '<no body>';
  }
}

function positionTopCenter(win) {
  try {
    const display = screen.getPrimaryDisplay();
    const work = display.workArea;
    const [w, h] = win.getSize();
    const x = Math.round(work.x + (work.width - w) / 2);
    const y = Math.max(work.y + 20, work.y); // 20px margin from top
    win.setPosition(x, y);
  } catch (_) {
    // noop
  }
}

