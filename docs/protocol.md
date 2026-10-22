# Contrato WebSocket propuesto (v1)

Este documento es una especificación; el transporte todavía no está implementado.

Conexión de producción por WSS. Tras abrirla, el cliente envía `authenticate` con un token de Firebase y versión de protocolo. El servidor verifica el token y asocia la conexión a una identidad. Los tokens no viajan en la URL ni se registran en logs.

Comandos posteriores: `createRoom`, `joinRoom` con código, `ready`, `deploy` con `commandId`, `unitType`, `q`, `r`, y `resume` con identificador de partida. El jugador no proporciona su bando ni un tiempo de simulación autorizado.

Eventos del servidor: `authenticated`, `roomCreated`, `roomJoined`, `matchStarted`, `commandAccepted`, `commandRejected`, `snapshot` y `matchEnded`.

Ejemplo de intención de despliegue:

```json
{"type":"deploy","commandId":"device-42","unitType":"tank","q":-3,"r":0}
```

`commandId` permite detectar reintentos durante una partida: repetir una orden reconocida devuelve su resultado previo sin gastar energía otra vez. Los identificadores tendrán longitud y cantidad máximas; el transporte deberá implementar este registro.

Cada snapshot contiene versión, identificador de partida, secuencia creciente, tiempo de simulación, bases, energía, unidades y resultado. El cliente descarta secuencias antiguas e interpola posiciones; al reconectar recibe un snapshot completo, sin repetir despliegues pendientes automáticamente. El servidor comprueba que la identidad pertenece a la partida antes de permitir `resume`.

Errores previstos: mensaje inválido, versión incompatible, sesión no válida, sala llena, partida terminada, energía insuficiente, posición inválida y exceso de solicitudes. El rechazo no modifica el estado.
