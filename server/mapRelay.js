/* Semantic-only RPC relay inside the existing Vite server. Never connects to hardware. */
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
const loopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
const authorityKey = Symbol.for('moontology.authoritativeBrowser');
/** Silence after which the pinned publisher tab is presumed gone (freshness window is 1.5 s, read tokens 2 s). */
const DEAD_PUBLISHER_MS = 10000;
export function mapRelayPlugin() {
  let owner = null, lastSeen = 0, latest = null;
  let publisherClient = null;
  const pending = new Map(), reads = new Map();
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const response = (res, status, value) => {
    if (value.observation) {
      const token = randomUUID();
      reads.set(token, { scene_session_id: value.observation.scene_session_id,
        scene_revision: value.observation.scene_revision, observation_sequence: value.observation.observation_sequence,
        read_at: Date.now() });
      value = { ...value, read_token: token };
      for (const [key, read] of reads) if (Date.now() - read.read_at > 2000) reads.delete(key);
    }
    json(res, status, value);
  };
  return { name: 'live-map-relay',
    // The existing launcher passes --host 127.0.0.1; keep that process/port,
    // and keep the consolidated Air controller on loopback.
    configResolved(config) { config.server.host = '127.0.0.1'; },
    configureServer(server) {
    // Reuse Vite's existing socket: commands reach the scene without polling latency.
    server.ws.on('map:ready', (data, client) => {
      if (owner && data?.secret === owner.secret) publisherClient = client;
    });
    server.ws.on('map:reply', (data, client) => {
      if (!owner || data?.secret !== owner.secret || client !== publisherClient) return;
      const reply = data.reply, item = pending.get(reply?.id);
      if (!item) return;
      pending.delete(reply.id); clearTimeout(item.timer);
      lastSeen = Date.now(); latest = reply.body.observation;
      response(item.res, reply.status, reply.body);
    });
    server.middlewares.use(async (req, res, next) => {
      const path = req.url?.split('?')[0];
      if (!path?.startsWith('/api/map/')) return next();
      const ip = req.socket.remoteAddress ?? '';
      if (!loopback(ip)) return json(res, 403, { error: 'local_air_only' });
      // Browser requests must be same-origin; native local HTTP clients need no Origin.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
        return json(res, 403, { error: 'cross_origin_denied' });
      try {
        let body = {};
        if (req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 262144) return json(res, 413, { error: 'body_too_large' });
          }
          body = JSON.parse(raw || '{}');
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object_required');
        }
        if (path === '/api/map/health' && req.method === 'GET')
          return json(res, 200, { publisher_connected: !!owner && Date.now() - lastSeen < 1500,
            authoritative_browser: latest?.authoritative_browser ?? null,
            scene_session_id: latest?.scene_session_id ?? null, publisher_age_ms: owner ? Date.now() - lastSeen : null,
            command_transport: publisherClient ? 'vite_websocket' : 'http_poll', last_observation: latest, remote_address: ip });
        if (path === '/api/map/publisher/claim' && req.method === 'POST') {
          if (!loopback(ip)) return json(res, 403, { error: 'publisher_must_be_localhost' });
          if (typeof body.browser_id !== 'string') throw new Error('browser_id_required');
          // A user may display the same map in another task. Transfer only from
          // a hidden, fully idle scene with no active telemetry or pending RPC.
          if (owner && owner.browser_id !== body.browser_id && body.presentation_visible === true &&
              latest?.performance?.visible === false && latest?.mission_state?.run_id === null &&
              latest?.mission_state?.map_armed === false && latest?.robot_pose?.telemetry_fresh === false && !pending.size) {
            owner = null; publisherClient = null; latest = null; reads.clear();
            globalThis[authorityKey] = body.browser_id;
          }
          // A pinned tab that has not published for DEAD_PUBLISHER_MS is closed, crashed or asleep
          // (its last observation may still claim visible: true). A visible local tab takes over so
          // the operator never has to restart Vite; if the old tab wakes, its tick is refused and it
          // re-claims only once this one goes silent. Rehearsal hit this twice after tab reloads.
          if (globalThis[authorityKey] && globalThis[authorityKey] !== body.browser_id && body.presentation_visible === true &&
              Date.now() - lastSeen > DEAD_PUBLISHER_MS && !pending.size) {
            owner = null; publisherClient = null; latest = null; reads.clear();
            globalThis[authorityKey] = body.browser_id;
          }
          if (globalThis[authorityKey] && globalThis[authorityKey] !== body.browser_id)
            return json(res, 409, { error: 'authority_already_pinned' });
          if (!owner && !globalThis[authorityKey] && body.presentation_visible !== true)
            return json(res, 409, { error: 'show_authoritative_scene' });
          if (owner && owner.browser_id !== body.browser_id) return json(res, 409, { error: 'authority_already_pinned' });
          globalThis[authorityKey] = body.browser_id;
          owner = { browser_id: body.browser_id, secret: randomUUID() };
          publisherClient = null;
          for (const item of pending.values()) { clearTimeout(item.timer); json(item.res, 409, { error: 'publisher_reloaded', requires_observation: true }); }
          pending.clear(); reads.clear(); latest = null; lastSeen = Date.now();
          return json(res, 200, owner);
        }
        if (path === '/api/map/publisher/tick' && req.method === 'POST') {
          if (!loopback(ip) || !owner || req.headers['x-map-publisher'] !== owner.secret)
            return json(res, 403, { error: 'not_authoritative_publisher' });
          lastSeen = Date.now(); latest = body.observation;
          for (const reply of body.replies ?? []) {
            const item = pending.get(reply.id);
            if (!item) continue;
            pending.delete(reply.id); clearTimeout(item.timer);
            response(item.res, reply.status, reply.body);
          }
          const commands = [];
          for (const item of pending.values()) if (!item.sent) { item.sent = true; commands.push(item.command); }
          return json(res, 200, { commands });
        }
        const kind = path.slice('/api/map/'.length);
        if (!(['observation'].includes(kind) && req.method === 'GET') &&
          !(['mission', 'interaction', 'reset', 'telemetry', 'intelligence'].includes(kind) && req.method === 'POST'))
          return json(res, 404, { error: 'unknown_endpoint' });
        if (!owner || Date.now() - lastSeen > 1500)
          return json(res, 503, { error: 'authoritative_scene_unavailable', requires_observation: true });
        let context = null;
        if (kind !== 'observation') {
          context = reads.get(body.read_token);
          if (!context || Date.now() - context.read_at > 2000)
            return json(res, 409, { error: 'read_observation_required', requires_observation: true });
          if (typeof body.command_id !== 'string' || body.command_id.length > 128)
            return json(res, 400, { error: 'command_id_required' });
        }
        if (pending.size >= 64) return json(res, 429, { error: 'busy' });
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); json(res, 504, { error: 'scene_response_timeout', requires_observation: true }); }, 1400);
        pending.set(id, { res, timer, sent: false, command: { id, kind, body, context, expires_at: Date.now() + 1000 } });
        if (publisherClient) {
          const item = pending.get(id); item.sent = true;
          publisherClient.send('map:command', item.command);
        }
        res.on('close', () => { const item = pending.get(id); if (item) { clearTimeout(item.timer); pending.delete(id); } });
      } catch (error) { json(res, 400, { error: 'invalid_request', detail: String(error.message ?? error) }); }
    });
    server.httpServer?.once('close', () => {
      for (const item of pending.values()) { clearTimeout(item.timer); json(item.res, 503, { error: 'server_restart' }); }
      pending.clear();
    });
  } };
}
