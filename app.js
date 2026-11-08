/* Audio recordings carry the timing, including in the background. */
'use strict';
const config = window.METRONOMI_CONFIG;
const intervals = config.intervals.filter(value => [1, 5, 15].includes(value));
if (!intervals.length) intervals.push(1);
const audio = document.querySelector('#audio');
const stopButton = document.querySelector('#stop');
const intervalButtons = [];
const status = document.querySelector('#playback-status');
const countdown = document.querySelector('#countdown');
const progressFill = document.querySelector('#progress-fill');
let countdownFrame;
const storageKey = 'metronomi.interval.v1';
let interval = intervals.includes(config.defaultInterval) ? config.defaultInterval : intervals[0];
try {
  const stored = Number(localStorage.getItem(storageKey));
  const saved = stored === 30 ? 15 : stored;
  if (intervals.includes(saved)) interval = saved;
} catch { /* Playback still works when storage is unavailable. */ }
let playbackRequest = 0;
let playbackError = "";
let storageError = "";
let installPrompt;

function updatePlayback() {
  const playing = !audio.paused;
  stopButton.disabled = !playing;
  for (const button of intervalButtons) {
    button.setAttribute('aria-pressed', String(playing && Number(button.value) === interval));
  }
  status.textContent = playbackError || storageError;
  cancelAnimationFrame(countdownFrame);
  updateCountdown();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}
function updateCountdown() {
  if (audio.paused) {
    countdown.textContent = '.00s';
    progressFill.style.transform = 'scaleX(0)';
    return;
  }
  // The recording starts with a beep at zero and repeats every interval.
  // Read media time rather than subtracting wall-clock time, so buffering,
  // pauses, and returning from the lock screen cannot make the display drift.
  const phase = audio.currentTime % interval;
  const remaining = interval - phase;
  progressFill.style.transform = `scaleX(${remaining / interval})`;
  // Show completed hundredths, starting just below the full interval.
  const hundredths = Math.min(interval * 100 - 1, Math.floor(remaining * 100 + 1e-7));
  const seconds = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, '0');
  countdown.textContent = `${seconds || (interval === 1 ? '' : '0')}.${fraction}s`;
  if (!document.hidden) countdownFrame = requestAnimationFrame(updateCountdown);
}
document.addEventListener('visibilitychange', updatePlayback);
function updateMetadata() {
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Every ${interval} second${interval === 1 ? '' : 's'}`,
      artist: 'Metronomi', album: 'Metronome',
      artwork: [{ src: new URL('./assets/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
    });
  }
}
function selectInterval(value) {
  playbackRequest++;
  audio.pause();
  interval = value;
  playbackError = '';
  audio.src = `./assets/tick-${interval}s.wav`;
  try { localStorage.setItem(storageKey, String(interval)); storageError = ''; }
  catch { storageError = 'Could not save interval.'; }
  updateMetadata();
}
for (const value of intervals) {
  const button = document.createElement('button');
  button.type = 'button';
  button.value = value;
  button.setAttribute('aria-label', `Play every ${value} second${value === 1 ? '' : 's'}`);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    selectInterval(value);
    return start();
  });
  button.textContent = `${value}s`;
  intervalButtons.push(button);
  document.querySelector('#interval-options').append(button);
}
async function start() {
  if (!audio.paused) return;
  const request = ++playbackRequest;
  playbackError = '';
  try {
    // Call play directly from the user gesture; do not await other work first.
    const playback = audio.play();
    updatePlayback();
    await playback;
  } catch {
    // Switching intervals or stopping may reject an older play request.
    if (request === playbackRequest) playbackError = 'Could not play audio. Tap an interval to retry.';
  }
  if (request === playbackRequest) updatePlayback();
}
function stop() {
  playbackRequest++;
  playbackError = '';
  audio.pause();
  audio.currentTime = 0;
  updatePlayback();
}
stopButton.addEventListener('click', stop);
for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, updatePlayback);
audio.addEventListener('error', () => {
  playbackError = 'Audio unavailable. Connect and reload the app.';
  updatePlayback();
});
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: start, pause: () => audio.pause(), stop })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional browser support. */ }
  }
}
selectInterval(interval);
updatePlayback();

const offlineStatus = document.querySelector('#offline-status');
async function checkOfflineReady() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      offlineStatus.textContent = event.data.ready ? 'Offline ready' : 'Offline setup incomplete';
      channel.port1.close();
    };
    worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
  } catch { offlineStatus.textContent = 'Offline setup unavailable'; }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(checkOfflineReady).catch(() => {
    offlineStatus.textContent = 'Offline setup unavailable';
  });
  navigator.serviceWorker.addEventListener('controllerchange', checkOfflineReady);
} else offlineStatus.hidden = true;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event;
  document.querySelector('#install').hidden = false;
});
document.querySelector('#install').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  document.querySelector('#install').hidden = true;
});
