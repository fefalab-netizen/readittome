export async function setupUpdates({ say, beforeUpdate }) {
  const status = document.getElementById('offline-state');
  const check = document.getElementById('check-update'), apply = document.getElementById('apply-update');
  if (!('serviceWorker' in navigator)) { status.textContent = 'Offline caching is unavailable in this browser.'; check.disabled = true; return; }
  let applying = false, registration;
  const show = () => { apply.hidden = !registration?.waiting; };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
  const observe = worker => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') { show(); status.textContent = registration.waiting ? 'A new version is ready. Use Update available to reload.' : 'App ready offline · voice availability depends on your device'; }
      if (worker.state === 'redundant' && !registration.active) status.textContent = 'Offline installation failed. Check that all app files were uploaded.';
    });
  };
  check.onclick = async () => {
    check.disabled = true;
    try { await registration.update(); show(); say(registration.waiting ? 'An update is ready. Tap Update available to save your place and reload.' : registration.installing ? 'Downloading an app update…' : 'No newer app version found.'); }
    catch { say('Could not check for updates. Try again with an internet connection.', true); }
    finally { check.disabled = false; }
  };
  apply.onclick = async () => {
    try {
      await beforeUpdate();
      if (!registration.waiting) { show(); say('The update is no longer waiting. Check for updates again.'); return; }
      applying = true; apply.disabled = true;
      registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
    } catch (error) { say(error.message, true); }
  };
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    show(); observe(registration.installing);
    registration.addEventListener('updatefound', () => observe(registration.installing));
    if (registration.active) status.textContent = 'App ready offline · voice availability depends on your device';
    if (registration.waiting) status.textContent = 'A new version is ready. Your library will be preserved.';
  } catch { status.textContent = 'Offline caching unavailable. Keep an internet connection when loading the app.'; check.disabled = true; }
}
