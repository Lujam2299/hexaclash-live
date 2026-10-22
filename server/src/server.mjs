import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer, WebSocket } from "ws";
import { Rooms } from "./rooms.mjs";
import { STEP_MS } from "./engine.mjs";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

export function createGameServer({
  autoTick = true,
  now = Date.now,
  reconnectMs = 20000,
} = {}) {
  const rooms = new Rooms({ now, reconnectMs });
  const http = createServer(async (req, res) => {
    const asset = assets.get(req.url);
    if (req.method !== "GET" || !asset) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const body = await readFile(
        new URL(`../../public/${asset[0]}`, import.meta.url),
      );
      res.writeHead(200, {
        "Content-Type": asset[1],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end("Asset unavailable");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  http.on("upgrade", (req, socket, head) => {
    // Same-origin browser connections only; native clients may omit Origin.
    const origin = req.headers.origin;
    const allowed =
      origin === `http://${req.headers.host}` ||
      origin === `https://${req.headers.host}`;
    if (req.url !== "/ws" || (origin && !allowed) || wss.clients.size >= 128) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws) => {
    let session = null;
    let budget = 30;
    let previous = now();
    let alive = true;
    const peer = {
      send(message) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > 256000) {
          ws.terminate();
          return;
        }
        ws.send(JSON.stringify(message));
      },
      close: (code, reason) => ws.close(code, reason),
    };
    const authenticationTimeout = setTimeout(() => {
      if (!session) ws.close(4000, "authentication-timeout");
    }, 5000);
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 5000);
    ws.on("pong", () => {
      alive = true;
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(authenticationTimeout);
      clearInterval(heartbeat);
      rooms.disconnect(session, peer);
    });
    ws.on("message", (data, binary) => {
      if (session && session.peer !== peer) return;
      const time = now();
      budget = Math.min(30, budget + Math.max(0, time - previous) * 0.015);
      previous = time;
      if (budget < 1) {
        peer.send({ type: "commandRejected", error: "rate-limit" });
        ws.close(4008, "rate-limit");
        return;
      }
      budget--;
      let message;
      try {
        message = binary ? null : JSON.parse(data.toString());
      } catch {
        /* handled below */
      }
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        typeof message.type !== "string"
      ) {
        peer.send({ type: "commandRejected", error: "invalid-message" });
        return;
      }
      if (!session) {
        if (message.type !== "authenticate") {
          peer.send({
            type: "commandRejected",
            error: "authentication-required",
          });
          return;
        }
        session = rooms.authenticate(peer, message);
        if (session) clearTimeout(authenticationTimeout);
      } else if (message.type === "authenticate")
        rooms.error(session, "already-authenticated");
      else rooms.command(session, message);
    });
  });
  const timer = autoTick ? setInterval(() => rooms.tick(), STEP_MS) : null;
  return {
    http,
    rooms,
    async listen(port = 8173, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          resolve();
        });
      });
      return http.address();
    },
    async close() {
      clearInterval(timer);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (http.listening) await new Promise((resolve) => http.close(resolve));
    },
  };
}
