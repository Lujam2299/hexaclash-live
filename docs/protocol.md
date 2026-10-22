# Contrato WebSocket local (v1)

Implementado en `/ws`. Producción requerirá WSS y verificación Firebase; la demo usa sesiones locales y escucha exclusivamente en loopback.

Tras abrir la conexión, el cliente envía `{"type":"authenticate","version":1}`. El servidor responde `authenticated` con `sessionToken` y `roomCode` (nulo si no pertenece a una sala). Para reconectar envía el mismo mensaje incluyendo `sessionToken`; un token desconocido se rechaza. Los tokens no viajan en la URL ni se registran en logs. Conservar el token permite controlar esa identidad: el cliente lo guarda solo en `sessionStorage`. Otra conexión con el mismo token reemplaza la anterior (cierre 4001).

Comandos posteriores: `createRoom`, `joinRoom` con `code` de seis caracteres hexadecimales en mayúsculas, `ready`, `deploy` con `commandId`, `unitType`, `q`, `r`, `resume` con `code` y `leaveRoom`. El servidor obtiene el bando de la sesión; ignora cualquier bando o tiempo de simulación enviado por el cliente. `resume` solo permite recuperar la sala de esa sesión. Ambos jugadores deben estar conectados y listos para iniciar; desconectarse en el lobby desmarca su estado listo.

Eventos: `authenticated`, `roomCreated`, `roomJoined` (incluyen `code` y `side`), `matchStarted`, `commandAccepted`, `commandRejected`, `snapshot`, `matchEnded` y `roomLeft`. Los tipos de unidad son `attacker`, `tank` y `ranged`.

Ejemplo de intención de despliegue:

```json
{
  "type": "deploy",
  "commandId": "device-42",
  "unitType": "tank",
  "q": -3,
  "r": 0
}
```

`commandId` permite detectar reintentos: repetir una orden reconocida devuelve su resultado previo sin gastar energía otra vez. Se conserva también el rechazo: si faltó energía, un nuevo intento necesita otro identificador. Los identificadores admiten de 1 a 64 caracteres alfanuméricos, guion y guion bajo; se conservan hasta 2048 resultados por jugador y sala. Al alcanzar el límite se rechazan nuevas órdenes; los reintentos existentes siguen disponibles. `commandAccepted` incluye `unitId`; un rechazo incluye `error` y, si el identificador es válido, `commandId`.

Cada snapshot contiene `version`, `code`, `sequence`, `status` (`waiting`, `playing`, `ended`), `connected`, `ready` y `reconnectMs`. Durante una partida añade `elapsedMs`, `players` (energía y base), `units` y `result` (nulo hasta terminar). El servidor envía estados completos a 10 Hz, además de cambios de sala. El cliente descarta secuencias antiguas e interpola posiciones; al reconectar recibe un snapshot completo, sin repetir despliegues pendientes automáticamente.

`result` contiene `winner` (0, 1 o nulo para empate) y `reason`: `base-destroyed`, `time-limit`, `disconnect` o `surrender`. `matchEnded` comparte ese resultado con ambos jugadores. La tolerancia de reconexión es de 20 segundos; la simulación continúa durante el corte. Salas vacías de inicio caducan a los diez minutos y resultados a los dos minutos; al caducar se envía `roomLeft`.

Errores implementados incluyen `invalid-message`, `incompatible-version`, `invalid-session`, `authentication-required`, `room-full`, `room-not-found`, `already-in-room`, `invalid-room`, `not-in-room`, `not-started`, `already-started`, `invalid-command`, `invalid-command-id`, `command-limit`, `match-ended`, `insufficient-energy`, `invalid-position`, `server-full` y `rate-limit`. El rechazo de un despliegue no modifica el estado del combate.

El transporte rechaza frames de más de 2 KiB (cierre 1009), limita frecuencia (cierre 4008) y rechaza orígenes de navegador ajenos. No existe chat, listado público de salas ni endpoint para consultar tokens.
