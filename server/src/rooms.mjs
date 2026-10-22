import { randomBytes } from "node:crypto";
import { createMatch, deploy, step, STEP_MS } from "./engine.mjs";

const token = () => randomBytes(24).toString("base64url");
const COMMAND_LIMIT = 2048;

/** Local demo identities only. Production must replace authenticate with verified Firebase identity. */
export class Rooms {
  constructor({
    now = Date.now,
    reconnectMs = 20000,
    maxSessions = 128,
    maxRooms = 64,
  } = {}) {
    this.now = now;
    this.reconnectMs = reconnectMs;
    this.maxSessions = maxSessions;
    this.maxRooms = maxRooms;
    this.sessions = new Map();
    this.rooms = new Map();
  }

  send(session, message) {
    session?.peer?.send(message);
  }
  error(session, error, commandId) {
    this.send(session, {
      type: "commandRejected",
      error,
      ...(commandId ? { commandId } : {}),
    });
  }

  authenticate(peer, message) {
    if (message.version !== 1) {
      peer.send({ type: "commandRejected", error: "incompatible-version" });
      return null;
    }
    let session;
    if (message.sessionToken !== undefined) {
      session = this.sessions.get(message.sessionToken);
      if (!session) {
        peer.send({ type: "commandRejected", error: "invalid-session" });
        return null;
      }
    } else {
      if (this.sessions.size >= this.maxSessions) {
        peer.send({ type: "commandRejected", error: "server-full" });
        return null;
      }
      session = {
        token: token(),
        room: null,
        side: null,
        peer: null,
        disconnectedAt: null,
      };
      this.sessions.set(session.token, session);
    }
    const previous = session.peer;
    session.peer = peer;
    session.disconnectedAt = null;
    if (previous && previous !== peer) previous.close(4001, "session-replaced");
    this.send(session, {
      type: "authenticated",
      sessionToken: session.token,
      roomCode: session.room,
    });
    return session;
  }

  disconnect(session, peer) {
    if (session?.peer !== peer) return;
    session.peer = null;
    session.disconnectedAt = this.now();
    const room = this.rooms.get(session.room);
    if (room) {
      if (!room.match) room.ready[session.side] = false;
      room.sequence++;
      this.broadcast(room);
    }
  }

  command(session, message) {
    if (message.type === "createRoom" || message.type === "joinRoom") {
      if (session.room) return this.error(session, "already-in-room");
      let room;
      if (message.type === "createRoom") {
        if (this.rooms.size >= this.maxRooms)
          return this.error(session, "server-full");
        let code;
        do {
          code = randomBytes(3).toString("hex").toUpperCase();
        } while (this.rooms.has(code));
        room = {
          code,
          players: [],
          ready: [false, false],
          match: null,
          sequence: 0,
          commands: [new Map(), new Map()],
          createdAt: this.now(),
          endedAt: null,
        };
        this.rooms.set(code, room);
      } else {
        if (
          typeof message.code !== "string" ||
          !/^[A-F0-9]{6}$/.test(message.code)
        )
          return this.error(session, "invalid-room");
        room = this.rooms.get(message.code);
        if (!room) return this.error(session, "room-not-found");
        if (room.players.length >= 2 || room.match)
          return this.error(session, "room-full");
      }
      session.room = room.code;
      session.side = room.players.length;
      room.players.push(session);
      this.send(session, {
        type: message.type === "createRoom" ? "roomCreated" : "roomJoined",
        code: room.code,
        side: session.side,
      });
      room.sequence++;
      return this.broadcast(room);
    }

    const room = this.rooms.get(session.room);
    if (!room) return this.error(session, "not-in-room");
    if (message.type === "resume") {
      if (message.code !== room.code)
        return this.error(session, "invalid-room");
      this.send(session, {
        type: "roomJoined",
        code: room.code,
        side: session.side,
      });
      room.sequence++;
      return this.broadcast(room);
    }
    if (message.type === "leaveRoom") {
      if (room.match && !room.match.result)
        this.finish(room, { winner: 1 - session.side, reason: "surrender" });
      // A waiting room is cancelled for both; completed rooms remain resumable for the other player.
      if (!room.match) {
        for (const player of room.players) {
          player.room = null;
          player.side = null;
          this.send(player, { type: "roomLeft" });
        }
        this.rooms.delete(room.code);
      } else {
        session.room = null;
        session.side = null;
        this.send(session, { type: "roomLeft" });
      }
      return;
    }
    if (message.type === "ready") {
      if (room.match) return this.error(session, "already-started");
      room.ready[session.side] = true;
      if (
        room.players.length === 2 &&
        room.ready.every(Boolean) &&
        room.players.every((p) => p.peer)
      ) {
        room.match = createMatch();
        for (const player of room.players)
          this.send(player, { type: "matchStarted", code: room.code });
      }
      room.sequence++;
      return this.broadcast(room);
    }
    if (message.type === "deploy") {
      if (
        typeof message.commandId !== "string" ||
        !/^[\w-]{1,64}$/.test(message.commandId)
      )
        return this.error(session, "invalid-command-id");
      const commands = room.commands[session.side];
      if (commands.has(message.commandId))
        return this.send(session, commands.get(message.commandId));
      if (commands.size >= COMMAND_LIMIT)
        return this.error(session, "command-limit", message.commandId);
      const result = room.match
        ? deploy(
            room.match,
            session.side,
            message.unitType,
            message.q,
            message.r,
          )
        : { ok: false, error: "not-started" };
      const reply = {
        type: result.ok ? "commandAccepted" : "commandRejected",
        commandId: message.commandId,
        ...(result.ok ? { unitId: result.id } : { error: result.error }),
      };
      commands.set(message.commandId, reply);
      return this.send(session, reply);
    }
    this.error(session, "invalid-command");
  }

  snapshot(room) {
    return {
      type: "snapshot",
      version: 1,
      code: room.code,
      sequence: room.sequence,
      status: !room.match ? "waiting" : room.match.result ? "ended" : "playing",
      connected: room.players.map((p) => !!p.peer),
      ready: room.ready,
      reconnectMs: this.reconnectMs,
      ...(room.match
        ? {
            elapsedMs: room.match.elapsedMs,
            players: room.match.players,
            units: room.match.units,
            result: room.match.result,
          }
        : {}),
    };
  }

  broadcast(room) {
    const snapshot = this.snapshot(room);
    for (const player of room.players)
      if (player.room === room.code) this.send(player, snapshot);
  }

  finish(room, result) {
    if (room.match.result) return;
    room.match.result = result;
    this.publishEnd(room);
  }

  publishEnd(room) {
    room.endedAt = this.now();
    room.sequence++;
    this.broadcast(room);
    for (const player of room.players)
      if (player.room === room.code)
        this.send(player, { type: "matchEnded", result: room.match.result });
  }

  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (room.match && !room.match.result) {
        const expired = room.players.map(
          (p) => !p.peer && now - p.disconnectedAt >= this.reconnectMs,
        );
        if (expired.some(Boolean)) {
          this.finish(room, {
            winner: expired.every(Boolean) ? null : expired[0] ? 1 : 0,
            reason: "disconnect",
          });
        } else {
          step(room.match);
          room.sequence++;
          if (room.match.result) this.publishEnd(room);
          else if (room.match.elapsedMs % (STEP_MS * 2) === 0)
            this.broadcast(room);
        }
      }
      if (
        (!room.match && now - room.createdAt > 600000) ||
        (room.endedAt !== null && now - room.endedAt > 120000)
      ) {
        for (const player of room.players)
          if (player.room === room.code) {
            player.room = null;
            player.side = null;
            this.send(player, { type: "roomLeft", reason: "expired" });
          }
        this.rooms.delete(room.code);
      }
    }
    for (const [key, session] of this.sessions) {
      if (
        !session.peer &&
        !session.room &&
        now - session.disconnectedAt > 600000
      )
        this.sessions.delete(key);
    }
  }
}
