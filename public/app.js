const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const costs = { attacker: 3, tank: 5, ranged: 4 };
const names = { attacker: "Atacante", tank: "Tanque", ranged: "Tirador" };
const maxHp = { attacker: 30, tank: 60, ranged: 20 };
const errors = {
  "room-not-found": "No encontramos esa sala. Comprueba el código.",
  "room-full": "Esa sala ya tiene dos jugadores o la partida empezó.",
  "invalid-room": "El código debe tener seis letras (A–F) o números.",
  "insufficient-energy": "No tienes suficiente energía. Espera un momento.",
  "invalid-position": "Despliega dentro de las dos columnas de tu zona.",
  "not-started": "Ambos jugadores deben estar listos para comenzar.",
  "match-ended": "La partida terminó. Sal de la sala para jugar otra.",
  "rate-limit": "Demasiadas acciones seguidas. Reconectando…",
  "server-full": "El servidor local está lleno. Inténtalo más tarde.",
  "already-in-room": "Ya perteneces a una sala.",
  "command-limit": "Se alcanzó el límite de órdenes de esta partida.",
};
const storageKey = "hexaclash.local-session.v1";
let savedToken;
try {
  savedToken = sessionStorage.getItem(storageKey);
} catch {
  /* Storage is optional. */
}
function remember(value) {
  savedToken = value;
  try {
    value
      ? sessionStorage.setItem(storageKey, value)
      : sessionStorage.removeItem(storageKey);
  } catch {
    /* optional */
  }
}
let socket,
  connected = false,
  roomCode = null,
  side = null,
  snapshot = null;
let selected = "attacker",
  lastSequence = -1,
  attempts = 0,
  retryTimer,
  replaced = false,
  pendingLobby = false;
let restoring = false;
const cells = [];
const visualUnits = new Map();

function notice(text, error = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("error", error);
}
function send(message) {
  if (socket?.readyState !== WebSocket.OPEN || !connected) return false;
  socket.send(JSON.stringify(message));
  return true;
}
function connect() {
  clearTimeout(retryTimer);
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  );
  const current = socket;
  current.addEventListener("open", () => {
    current.send(
      JSON.stringify({
        type: "authenticate",
        version: 1,
        ...(savedToken ? { sessionToken: savedToken } : {}),
      }),
    );
  });
  current.addEventListener("message", ({ data }) => {
    if (current !== socket) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === "authenticated") {
      remember(message.sessionToken);
      connected = true;
      attempts = 0;
      if (message.roomCode) {
        restoring = true;
        send({ type: "resume", code: message.roomCode });
      } else resetRoom();
      notice("Conectado. Crea una sala y comparte el código con tu rival.");
    } else if (
      message.type === "roomCreated" ||
      message.type === "roomJoined"
    ) {
      if (roomCode !== message.code) {
        snapshot = null;
        lastSequence = -1;
      }
      roomCode = message.code;
      side = message.side;
      pendingLobby = false;
      notice(
        message.type === "roomCreated"
          ? "Sala creada. Comparte el código y espera a tu rival."
          : "Estás en la sala. Marca que estás listo cuando quieras empezar.",
      );
    } else if (message.type === "snapshot") {
      if (message.code !== roomCode || message.sequence <= lastSequence) return;
      lastSequence = message.sequence;
      snapshot = message;
      updateUnits(message.units ?? []);
      if (restoring) {
        restoring = false;
        notice(
          message.status === "playing"
            ? "Conexión recuperada. Tu partida continúa."
            : message.status === "ended"
              ? "Conexión recuperada. La partida ya terminó."
              : "Sala recuperada. Marca que estás listo para empezar.",
        );
      }
    } else if (message.type === "commandRejected") {
      pendingLobby = false;
      if (message.error === "invalid-session") {
        remember(null);
        resetRoom();
        current.send(JSON.stringify({ type: "authenticate", version: 1 }));
      } else
        notice(
          errors[message.error] ?? `Acción rechazada: ${message.error}`,
          true,
        );
    } else if (message.type === "commandAccepted")
      notice(
        `${names[selected]} desplegado. Tu unidad avanza automáticamente.`,
      );
    else if (message.type === "matchStarted")
      notice("¡Combate en marcha! Selecciona una unidad y toca tu zona.");
    else if (message.type === "matchEnded")
      notice("Partida terminada. Puedes salir y crear otra sala.");
    else if (message.type === "roomLeft") {
      resetRoom();
      notice(
        message.reason === "expired"
          ? "La sala caducó. Puedes crear otra."
          : "Has salido de la sala.",
      );
    }
    render();
  });
  current.addEventListener("close", (event) => {
    if (current !== socket) return;
    connected = false;
    pendingLobby = false;
    if (event.code === 4001) {
      replaced = true;
      remember(null);
      resetRoom();
      notice(
        "Esta sesión se abrió en otra ventana. Pulsa reconectar para iniciar una sesión distinta.",
        true,
      );
    } else {
      notice(
        "Se perdió la conexión. Intentando recuperar tu partida; tienes 20 segundos.",
        true,
      );
      retryTimer = setTimeout(connect, Math.min(500 * 2 ** attempts++, 5000));
    }
    render();
  });
  current.addEventListener("error", () => {});
}

function resetRoom() {
  roomCode = null;
  side = null;
  snapshot = null;
  lastSequence = -1;
  pendingLobby = false;
  restoring = false;
  updateUnits([]);
}

function svg(name, attributes, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  parent?.append(node);
  return node;
}
function point(q, r) {
  return { x: 500 + Math.sqrt(3) * 44 * (q + r / 2), y: 360 + 66 * r };
}
for (let q = -4; q <= 4; q++)
  for (let r = -4; r <= 4; r++) {
    if (Math.abs(q + r) > 4) continue;
    const { x, y } = point(q, r);
    const points = Array.from({ length: 6 }, (_, i) => {
      const angle = ((60 * i - 30) * Math.PI) / 180;
      return `${x + 41 * Math.cos(angle)},${y + 41 * Math.sin(angle)}`;
    }).join(" ");
    const node = svg(
      "polygon",
      {
        points,
        class: "hex",
        role: "button",
        tabindex: "-1",
        "aria-label": `Desplegar en casilla ${q}, ${r}`,
      },
      $("cells"),
    );
    const act = () => {
      if (node.getAttribute("aria-disabled") === "true") {
        notice(
          snapshot?.status === "playing"
            ? "Elige una casilla de tu zona y comprueba tu energía."
            : "Crea una sala y espera a que ambos jugadores estén listos.",
          true,
        );
        return;
      }
      send({
        type: "deploy",
        commandId: crypto.randomUUID(),
        unitType: selected,
        q,
        r,
      });
    };
    node.addEventListener("click", act);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        act();
      }
    });
    cells.push({ node, q, r });
  }
for (const team of [0, 1]) {
  const { x, y } = point(team ? 4 : -4, 0);
  const group = svg(
    "g",
    { transform: `translate(${x} ${y})`, "aria-hidden": "true" },
    $("bases"),
  );
  svg(
    "path",
    {
      d: "M-17 -17 L0 -27 L17 -17 L17 14 L0 25 L-17 14Z",
      class: `base-shape${team ? " enemy" : ""}`,
    },
    group,
  );
  const text = svg(
    "text",
    { y: 5, class: `base-label${team ? " enemy" : ""}` },
    group,
  );
  text.textContent = "H";
}

function updateUnits(units) {
  const existing = new Set(units.map((unit) => unit.id));
  for (const [id, visual] of visualUnits)
    if (!existing.has(id)) {
      visual.group.remove();
      visualUnits.delete(id);
    }
  const grouped = new Map();
  for (const unit of units) {
    const key = `${unit.q},${unit.r}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(unit.id);
  }
  const now = performance.now();
  for (const unit of units) {
    const cell = point(unit.q, unit.r),
      stack = grouped.get(`${unit.q},${unit.r}`);
    const index = stack.indexOf(unit.id),
      radius = stack.length > 1 ? 12 : 0;
    const target = {
      x: cell.x + radius * Math.cos((index * 2 * Math.PI) / stack.length),
      y: cell.y + radius * Math.sin((index * 2 * Math.PI) / stack.length),
    };
    let visual = visualUnits.get(unit.id);
    if (!visual) {
      const group = svg("g", {}, $("units"));
      svg(
        "circle",
        {
          r: unit.type === "tank" ? 17 : 14,
          class: `unit-body${unit.side ? " enemy" : ""}`,
        },
        group,
      );
      const text = svg("text", { y: 4, class: "unit-letter" }, group);
      text.textContent = { attacker: "A", tank: "T", ranged: "R" }[unit.type];
      svg(
        "rect",
        { x: -15, y: -25, width: 30, height: 3, fill: "#101820", rx: 1 },
        group,
      );
      const health = svg(
        "rect",
        {
          x: -15,
          y: -25,
          height: 3,
          rx: 1,
          class: `unit-health${unit.side ? " enemy" : ""}`,
        },
        group,
      );
      visual = { group, health, x: target.x, y: target.y };
      visualUnits.set(unit.id, visual);
    }
    Object.assign(visual, {
      fromX: visual.x,
      fromY: visual.y,
      target,
      at: now,
    });
    visual.health.setAttribute("width", (30 * unit.hp) / maxHp[unit.type]);
  }
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function animate(now) {
  for (const visual of visualUnits.values()) {
    const alpha = reducedMotion ? 1 : Math.min(1, (now - visual.at) / 100);
    visual.x = visual.fromX + (visual.target.x - visual.fromX) * alpha;
    visual.y = visual.fromY + (visual.target.y - visual.fromY) * alpha;
    visual.group.setAttribute(
      "transform",
      `translate(${visual.x} ${visual.y})`,
    );
  }
  requestAnimationFrame(animate);
}

function render() {
  $("connection").textContent = connected
    ? "Servidor conectado"
    : "Sin conexión";
  $("connection-dot").classList.toggle("online", connected);
  $("create").disabled = $("join").disabled = !connected || pendingLobby;
  $("reconnect").disabled = !connected && !replaced;
  $("lobby-controls").hidden = !!roomCode;
  $("room-controls").hidden = !roomCode;
  $("code").textContent = roomCode ?? "—";
  $("your-team").textContent =
    side === null
      ? ""
      : `Tu equipo: ${side ? "NARANJA · derecha" : "CIAN · izquierda"}`;
  $("your-team").className = `team-label ${side === 1 ? "orange" : "cyan"}`;
  const status = snapshot?.status ?? "waiting",
    playing = status === "playing";
  const energy = snapshot?.players?.[side]?.energy ?? 0;
  $("own-ready").textContent = snapshot?.ready?.[side] ? "Listo ✓" : "En sala";
  $("rival-state").textContent = !snapshot?.connected?.[1 - side]
    ? snapshot?.connected?.length === 2
      ? "Desconectado"
      : "Esperando…"
    : snapshot?.ready?.[1 - side]
      ? "Listo ✓"
      : "En sala";
  $("ready").hidden = status !== "waiting";
  $("ready").disabled = !connected || !!snapshot?.ready?.[side];
  $("ready").textContent = snapshot?.ready?.[side]
    ? "Esperando al rival…"
    : "Estoy listo";
  $("leave").disabled = !connected;
  $("leave").textContent = playing ? "Rendirme y salir" : "Salir de la sala";
  $("phase").textContent =
    status === "ended"
      ? "Combate finalizado"
      : playing
        ? "Combate en curso"
        : roomCode
          ? "Esperando comandantes"
          : "Prepara tu estrategia";
  const seconds = Math.max(
    0,
    Math.ceil((180000 - (snapshot?.elapsedMs ?? 0)) / 1000),
  );
  $("timer").textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  for (const [index, color] of ["cyan", "orange"].entries()) {
    const hp = snapshot?.players?.[index]?.base.hp ?? 100;
    $(`${color}-hp`).textContent = hp;
    $(`${color}-bar`).value = hp;
  }
  $("energy").textContent = snapshot?.players ? Math.floor(energy) : "—";
  $("energy-bar").value = energy;
  $("selection-hint").textContent =
    `${names[selected]} seleccionado · ${costs[selected]} de energía`;
  $("board-hint").textContent = !connected
    ? "Reconectando…"
    : !roomCode
      ? "Crea o únete a una sala para comenzar"
      : !playing
        ? status === "ended"
          ? "Sal de la sala para jugar otra vez"
          : "Ambos jugadores deben marcar «Estoy listo»"
        : !snapshot.connected[1 - side]
          ? "Rival desconectado · 20 s para volver"
          : "Toca tu zona iluminada para desplegar";
  $("result").hidden = status !== "ended";
  if (snapshot?.result) {
    const result = snapshot.result;
    const why = {
      "base-destroyed": "Base destruida",
      "time-limit": "Tiempo agotado",
      disconnect: "Desconexión",
      surrender: "Rendición",
    }[result.reason];
    $("result").textContent =
      `${result.winner === null ? "Empate" : result.winner === side ? "Victoria" : "Derrota"} · ${why}`;
  }
  for (const cell of cells) {
    const home = side === 0 ? cell.q <= -3 : side === 1 && cell.q >= 3;
    const enabled = connected && playing && home && energy >= costs[selected];
    cell.node.setAttribute(
      "class",
      `hex${cell.q <= -3 ? " home-cyan" : cell.q >= 3 ? " home-orange" : ""}${enabled ? " deployable" : ""}`,
    );
    cell.node.setAttribute("aria-disabled", String(!enabled));
    cell.node.setAttribute("tabindex", enabled ? "0" : "-1");
  }
  for (const button of document.querySelectorAll("[data-unit]")) {
    button.classList.toggle("selected", button.dataset.unit === selected);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.unit === selected),
    );
  }
}

$("create").addEventListener("click", () => {
  pendingLobby = send({ type: "createRoom" });
  render();
});
$("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  pendingLobby = send({
    type: "joinRoom",
    code: $("room-code").value.trim().toUpperCase(),
  });
  render();
});
$("ready").addEventListener("click", () => send({ type: "ready" }));
$("leave").addEventListener("click", () => {
  if (
    snapshot?.status !== "playing" ||
    confirm("¿Rendirte y salir de esta partida?")
  )
    send({ type: "leaveRoom" });
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    notice("Código copiado. Compártelo con tu rival.");
  } catch {
    notice(`Copia este código: ${roomCode}`);
  }
});
$("reconnect").addEventListener("click", () => {
  if (replaced) {
    replaced = false;
    connect();
  } else socket.close(4000, "test-reconnect");
});
for (const button of document.querySelectorAll("[data-unit]"))
  button.addEventListener("click", () => {
    selected = button.dataset.unit;
    render();
  });
render();
connect();
requestAnimationFrame(animate);
