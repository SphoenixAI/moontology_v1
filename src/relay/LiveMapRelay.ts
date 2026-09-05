import { LiveMapState, type MapContext, type Command } from './LiveMapState';
export function connectLiveMapRelay(context: MapContext) {
  // LAN viewer tabs cannot publish or take ownership of the localhost scene.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
  let browserId = sessionStorage.getItem('moontology-map-browser-id');
  if (!browserId) { browserId = crypto.randomUUID(); sessionStorage.setItem('moontology-map-browser-id', browserId); }
  const state = new LiveMapState(context, browserId, location.href);
  try { const saved = sessionStorage.getItem('moontology-map-held-pose'); if (saved) state.restorePose(JSON.parse(saved)); } catch { /* no saved pose */ }
  let stopped = false, secret: string | null = null;
  let failed = false;
  let replies: ReturnType<LiveMapState['handle']>[] = [];
  const onCommand = (command: Command) => {
    if (!stopped && secret) import.meta.hot?.send('map:reply', { secret, reply: state.handle(command) });
  };
  import.meta.hot?.on('map:command', onCommand);
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`/api/map/publisher/${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Map-Publisher': secret } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(1200) });
    if (!response.ok) throw new Error(`publisher ${response.status}`);
    return response.json();
  };
  const pump = async () => {
    if (stopped) return;
    try {
      if (!secret) {
        secret = (await post('claim', { browser_id: browserId, presentation_visible: document.visibilityState === 'visible' })).secret;
        import.meta.hot?.send('map:ready', { secret });
      }
      const response = await post('tick', { observation: state.observation(), replies });
      failed = false;
      const saved = state.savedPose();
      if (saved) sessionStorage.setItem('moontology-map-held-pose', JSON.stringify(saved));
      else sessionStorage.removeItem('moontology-map-held-pose');
      replies = (response.commands ?? []).map((command: Command) => state.handle(command));
    } catch (error) {
      console.warn('[map relay]', String(error));
      if (!failed) state.resetNotice('relay_disconnected');
      failed = true; secret = null; replies = [];
    }
    if (!stopped) window.setTimeout(pump, replies.length ? 0 : 150);
  };
  void pump();
  const onReset = () => state.resetNotice();
  window.addEventListener('moontology:scene-reset', onReset);
  return { state, dispose() { stopped = true; import.meta.hot?.off('map:command', onCommand); window.removeEventListener('moontology:scene-reset', onReset); } };
}
