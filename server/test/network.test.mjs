import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createGameServer } from "../src/server.mjs";

async function client(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = new Set();
  socket.on("message", (data) => {
    messages.push(JSON.parse(data));
    for (const wake of [...waiters]) wake();
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    messages,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    next(type, predicate = () => true) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`Missing ${type}`));
        }, 2500);
        function check() {
          const index = messages.findIndex(
            (m) => m.type === type && predicate(m),
          );
          if (index < 0) return;
          clearTimeout(timeout);
          waiters.delete(check);
          resolve(messages.splice(index, 1)[0]);
        }
        waiters.add(check);
        check();
      });
    },
  };
}

async function setup(t, options = {}) {
  let now = 100000;
  const server = createGameServer({
    autoTick: false,
    now: () => now,
    ...options,
  });
  const address = await server.listen(0);
  t.after(() => server.close());
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const connect = async (sessionToken) => {
    const c = await client(url);
    c.send({
      type: "authenticate",
      version: 1,
      ...(sessionToken ? { sessionToken } : {}),
    });
    c.auth = await c.next("authenticated");
    return c;
  };
  const tick = (ms) => {
    for (let i = 0; i < ms / 50; i++) {
      now += 50;
      server.rooms.tick();
    }
  };
  return {
    server,
    url,
    connect,
    tick,
    get now() {
      return now;
    },
  };
}

async function start(f) {
  const a = await f.connect(),
    b = await f.connect();
  a.send({ type: "createRoom" });
  const { code } = await a.next("roomCreated");
  b.send({ type: "joinRoom", code });
  assert.equal((await b.next("roomJoined")).side, 1);
  a.send({ type: "ready" });
  b.send({ type: "ready" });
  await Promise.all([a.next("matchStarted"), b.next("matchStarted")]);
  return { a, b, code };
}

test("two real sockets share deployments, deduplicate commands and finish a full match", async (t) => {
  const f = await setup(t);
  const { a, b, code } = await start(f);
  const order = {
    type: "deploy",
    commandId: "first",
    unitType: "attacker",
    q: -3,
    r: 0,
    side: 1,
  };
  a.send(order);
  const accepted = await a.next("commandAccepted");
  a.send(order);
  assert.deepEqual(await a.next("commandAccepted"), accepted);
  f.tick(100);
  const [sa, sb] = await Promise.all([
    a.next("snapshot", (s) => s.elapsedMs === 100),
    b.next("snapshot", (s) => s.elapsedMs === 100),
  ]);
  assert.deepEqual(sa, sb);
  assert.equal(sa.units.length, 1);
  assert.equal(sa.units[0].side, 0); // Spoofed side is ignored.
  assert.ok(Math.abs(sa.players[0].energy - 2.1) < 0.00001);
  const outsider = await f.connect();
  outsider.send({ type: "joinRoom", code });
  assert.equal((await outsider.next("commandRejected")).error, "room-full");
  f.tick(30000);
  const [ea, eb] = await Promise.all([
    a.next("matchEnded"),
    b.next("matchEnded"),
  ]);
  assert.deepEqual(ea, eb);
  assert.deepEqual(ea.result, { winner: 0, reason: "base-destroyed" });
  assert.equal(f.server.rooms.rooms.get(code).match.players[1].base.hp, 0);
});

test("reconnection restores identity and state; expired disconnect awards the rival", async (t) => {
  const f = await setup(t);
  const { a, b, code } = await start(f);
  const closed = new Promise((resolve) => a.socket.once("close", resolve));
  a.socket.close();
  await closed;
  await b.next("snapshot", (s) => !s.connected[0]);
  f.tick(1000);
  const resumed = await f.connect(a.auth.sessionToken);
  resumed.send({ type: "resume", code });
  assert.equal((await resumed.next("roomJoined")).side, 0);
  assert.equal((await resumed.next("snapshot")).elapsedMs, 1000);
  await b.next("snapshot", (s) => s.connected[0] && s.elapsedMs === 1000);
  b.messages.length = 0;
  const closedAgain = new Promise((resolve) =>
    resumed.socket.once("close", resolve),
  );
  resumed.socket.close();
  await closedAgain;
  await b.next("snapshot", (s) => !s.connected[0] && s.elapsedMs === 1000);
  f.tick(20000);
  assert.deepEqual((await b.next("matchEnded")).result, {
    winner: 1,
    reason: "disconnect",
  });
});

test("invalid sessions, malformed messages and hostile unit types do not crash the server", async (t) => {
  const f = await setup(t);
  const raw = await client(f.url);
  raw.send({ type: "authenticate", version: 1, sessionToken: "not-a-session" });
  assert.equal((await raw.next("commandRejected")).error, "invalid-session");
  raw.send({ type: "authenticate", version: 2 });
  assert.equal(
    (await raw.next("commandRejected")).error,
    "incompatible-version",
  );
  raw.socket.send("{");
  assert.equal((await raw.next("commandRejected")).error, "invalid-message");
  raw.send({ type: "createRoom" });
  assert.equal(
    (await raw.next("commandRejected")).error,
    "authentication-required",
  );
  const { a } = await start(f);
  a.send({
    type: "deploy",
    commandId: "bad",
    unitType: { toString: null },
    q: -3,
    r: 0,
  });
  assert.equal((await a.next("commandRejected")).error, "invalid-command");
  a.send({
    type: "deploy",
    commandId: "bad-cell",
    unitType: "tank",
    q: 3,
    r: 0,
  });
  assert.equal((await a.next("commandRejected")).error, "invalid-position");
});

test("a session cannot resume another room or command the replaced socket", async (t) => {
  const f = await setup(t);
  const { a, code } = await start(f);
  const c = await f.connect();
  c.send({ type: "resume", code });
  assert.equal((await c.next("commandRejected")).error, "not-in-room");
  const closed = new Promise((resolve) => a.socket.once("close", resolve));
  const replacement = await f.connect(a.auth.sessionToken);
  assert.equal(await closed, 4001);
  replacement.send({ type: "resume", code });
  assert.equal((await replacement.next("roomJoined")).side, 0);
});

test("both disconnected players draw after the grace period", async (t) => {
  const f = await setup(t);
  const { a, b, code } = await start(f);
  const closes = [a, b].map(
    (c) =>
      new Promise((resolve) => {
        c.socket.once("close", resolve);
        c.socket.close();
      }),
  );
  await Promise.all(closes);
  // Both close callbacks on the server must have run before advancing its clock.
  await new Promise((resolve) => setTimeout(resolve, 20));
  f.tick(20000);
  assert.deepEqual(f.server.rooms.rooms.get(code).match.result, {
    winner: null,
    reason: "disconnect",
  });
});

test("excessive command rate closes the connection", async (t) => {
  const f = await setup(t);
  const c = await f.connect();
  const closed = new Promise((resolve) => c.socket.once("close", resolve));
  for (let i = 0; i < 35; i++) c.send({ type: "unknown" });
  assert.equal(await closed, 4008);
});

test("HTTP only serves known assets and rejects foreign browser origins", async (t) => {
  const f = await setup(t);
  const base = f.url.replace("ws:", "http:").replace("/ws", "");
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /HexaClash Live/);
  assert.match(
    (await fetch(`${base}/app.js`)).headers.get("content-type"),
    /javascript/,
  );
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  const ws = new WebSocket(f.url, { origin: "https://untrusted.example" });
  const status = await new Promise((resolve, reject) => {
    ws.once("unexpected-response", (_, response) => {
      resolve(response.statusCode);
      response.resume();
      ws.terminate();
    });
    ws.on("error", () => {});
    ws.once("open", () => reject(new Error("Foreign origin accepted")));
  });
  assert.equal(status, 403);
});

test("a ready player can disconnect in the lobby and ready again after resuming", async (t) => {
  const f = await setup(t);
  const a = await f.connect(),
    b = await f.connect();
  a.send({ type: "createRoom" });
  const { code } = await a.next("roomCreated");
  b.send({ type: "joinRoom", code });
  await b.next("roomJoined");
  a.send({ type: "ready" });
  await b.next("snapshot", (s) => s.ready[0]);
  a.socket.close();
  await b.next("snapshot", (s) => !s.connected[0]);
  b.send({ type: "ready" });
  await b.next("snapshot", (s) => s.ready[1]);
  const resumed = await f.connect(a.auth.sessionToken);
  resumed.send({ type: "resume", code });
  const state = await resumed.next("snapshot");
  assert.equal(state.ready[0], false);
  resumed.send({ type: "ready" });
  await resumed.next("matchStarted");
});

test("oversized frames are rejected at the transport boundary", async (t) => {
  const f = await setup(t);
  const c = await f.connect();
  const closed = new Promise((resolve) => c.socket.once("close", resolve));
  c.send({ type: "unknown", padding: "x".repeat(3000) });
  assert.equal(await closed, 1009);
});

test("leaving a lobby releases both players and expired rooms are removed", async (t) => {
  const f = await setup(t);
  const a = await f.connect(),
    b = await f.connect();
  a.send({ type: "createRoom" });
  const { code } = await a.next("roomCreated");
  b.send({ type: "joinRoom", code });
  await b.next("roomJoined");
  a.send({ type: "leaveRoom" });
  await Promise.all([a.next("roomLeft"), b.next("roomLeft")]);
  assert.equal(f.server.rooms.rooms.size, 0);
  a.send({ type: "createRoom" });
  await a.next("roomCreated");
  f.tick(600050);
  await a.next("roomLeft");
  assert.equal(f.server.rooms.rooms.size, 0);
});

test("surrender is shared and completed rooms do not block another match", async (t) => {
  const f = await setup(t);
  const { a, b, code } = await start(f);
  a.send({ type: "leaveRoom" });
  assert.deepEqual((await b.next("matchEnded")).result, {
    winner: 1,
    reason: "surrender",
  });
  await a.next("roomLeft");
  a.send({ type: "createRoom" });
  const next = await a.next("roomCreated");
  assert.notEqual(next.code, code);
  f.tick(120050);
  await b.next("roomLeft");
  assert.equal(f.server.rooms.rooms.has(code), false);
  assert.equal(
    f.server.rooms.sessions.get(a.auth.sessionToken).room,
    next.code,
  );
});
