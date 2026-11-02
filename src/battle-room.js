// The live Class Battle room as a Cloudflare Durable Object: one per battle
// code. Students' and the projector's screens connect by WebSocket; the room
// logic itself is in battle-room-core.js. Hibernating WebSockets mean an idle
// room costs nothing while students think.
import { DurableObject } from 'cloudflare:workers';
import { RoomCore, RoomError } from './battle-room-core.js';
import { battle } from './battle-content.js';
import { saveBattle } from './db.js';

export class BattleRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore({
      battle,
      store: { get: (k) => ctx.storage.get(k), put: (k, v) => ctx.storage.put(k, v), deleteAll: () => ctx.storage.deleteAll() },
      alarms: { set: (t) => ctx.storage.setAlarm(t), clear: () => ctx.storage.deleteAlarm() },
      saveResults: (r) => saveBattle(env.DB, r),
    });
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(() => this.core.load());
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/init') {
      try {
        await this.core.init(await request.json());
        return Response.json({ ok: true });
      } catch (e) {
        if (e instanceof RoomError) return Response.json({ error: e.message }, { status: 409 });
        throw e;
      }
    }
    if (url.pathname === '/exists') return Response.json({ ok: this.core.exists, phase: this.core.exists ? this.core.s.phase : null });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    try {
      server.serializeAttachment(await this.core.authorize(url.searchParams));
      await this.broadcast();
    } catch (e) {
      server.send(JSON.stringify({ t: 'error', fatal: true, message: e instanceof RoomError ? e.message : 'Something went wrong.' }));
      server.close(4000, 'refused');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  connected() {
    const pids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const c = ws.deserializeAttachment();
      if (c?.pid) pids.add(c.pid);
    }
    return pids;
  }

  async webSocketMessage(ws, data) {
    let conn = ws.deserializeAttachment();
    if (!conn) return;
    try {
      const res = await this.core.handle(conn, JSON.parse(data), this.connected());
      if (res?.conn) {
        conn = res.conn;
        ws.serializeAttachment(conn);
        ws.send(JSON.stringify({ t: 'joined', pid: conn.pid }));
      }
    } catch (e) {
      if (!(e instanceof RoomError)) console.error(e);
      ws.send(JSON.stringify({ t: 'error', message: e instanceof RoomError ? e.message : 'Something went wrong. Please try again.' }));
    }
    await this.broadcast();
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code, 'bye');
    } catch {
      /* already closed */
    }
    await this.broadcast();
  }

  async alarm() {
    await this.core.alarm();
    await this.broadcast();
  }

  // Sends every screen its own view of the room.
  async broadcast() {
    const online = this.connected();
    for (const ws of this.ctx.getWebSockets()) {
      const conn = ws.deserializeAttachment();
      if (!conn) continue;
      try {
        ws.send(JSON.stringify(await this.core.viewFor(conn, online)));
      } catch {
        /* that screen just disconnected */
      }
    }
  }
}
