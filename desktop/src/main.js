import { invoke } from '@tauri-apps/api/core';
import { Command } from '@tauri-apps/plugin-shell';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { load } from '@tauri-apps/plugin-store';
import { openUrl } from '@tauri-apps/plugin-opener';

let serverChild = null;
let store = null;

const mediaPathInput = document.getElementById('mediaPath');
const portInput = document.getElementById('portInput');
const browseBtn = document.getElementById('browseBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const serverUrlDiv = document.getElementById('serverUrl');
const urlLink = document.getElementById('urlLink');
const logPre = document.getElementById('log');

// --- Init ---
async function init() {
  store = await load('settings.json', { autoSave: true });

  const lastPath = await store.get('mediaRoot');
  if (lastPath) {
    mediaPathInput.value = lastPath;
    startBtn.disabled = false;
  }

  const lastPort = await store.get('port');
  if (lastPort) portInput.value = lastPort;
}

// --- Browse ---
browseBtn.addEventListener('click', async () => {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: 'Select Media Folder',
  });
  if (selected) {
    mediaPathInput.value = selected;
    startBtn.disabled = false;
    await store.set('mediaRoot', selected);
  }
});

// --- Start ---
startBtn.addEventListener('click', async () => {
  if (serverChild) return;

  const mediaRoot = mediaPathInput.value;
  if (!mediaRoot) return;

  const port = portInput.value || '3443';
  await store.set('port', port);

  logPre.textContent = '';
  setStatus('starting', 'Starting...');

  try {
    // Get the path to the bundled Express app
    const appPath = await invoke('get_resource_path');
    const serverScript = appPath + '/server.js';

    appendLog(`App path: ${appPath}`);
    appendLog(`Starting server on port ${port}...`);

    const command = Command.sidecar('binaries/node', [
      serverScript,
      '--media-root', mediaRoot,
      '--port', port,
      '--host', '0.0.0.0',
      '--certs-dir', appPath + '/certs',
    ]);

    command.stdout.on('data', (line) => {
      appendLog(line);
      if (line.includes('running on') || line.includes('listening')) {
        setStatus('running', 'Running');
        serverUrlDiv.style.display = 'block';
        const url = `https://localhost:${port}`;
        urlLink.textContent = url;
        urlLink.onclick = (e) => {
          e.preventDefault();
          openUrl(url);
        };
        // Show LAN URL
        appendLog(`Local network: https://<your-ip>:${port}`);
      }
    });

    command.stderr.on('data', (line) => {
      appendLog('[ERR] ' + line);
    });

    command.on('close', (data) => {
      appendLog(`Server exited (code ${data.code})`);
      serverChild = null;
      setStatus('stopped', 'Stopped');
      serverUrlDiv.style.display = 'none';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      browseBtn.disabled = false;
      portInput.disabled = false;
    });

    command.on('error', (err) => {
      appendLog('[ERROR] ' + err);
      serverChild = null;
      setStatus('stopped', 'Error');
    });

    serverChild = await command.spawn();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    browseBtn.disabled = true;
    portInput.disabled = true;
  } catch (e) {
    appendLog('[ERROR] ' + e);
    setStatus('stopped', 'Failed to start');
  }
});

// --- Stop ---
stopBtn.addEventListener('click', async () => {
  if (serverChild) {
    appendLog('Stopping server...');
    await serverChild.kill();
    serverChild = null;
  }
});

// --- Kill on window close ---
window.addEventListener('beforeunload', () => {
  if (serverChild) {
    serverChild.kill();
  }
});

// --- Helpers ---
function setStatus(state, text) {
  statusDot.className = 'dot ' + state;
  statusText.textContent = text;
}

function appendLog(text) {
  const line = text.endsWith('\n') ? text : text + '\n';
  logPre.textContent += line;
  logPre.scrollTop = logPre.scrollHeight;
}

init();
