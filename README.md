# hexaclash-live
Juego de estrategia con combate continuo para Android: dos jugadores despliegan unidades sobre un tablero hexagonal y buscan destruir la base rival.

## Estado

Inicio del proyecto. Reglas y arquitectura propuestas en `docs/`. Motor local determinista en `server/src/engine.mjs`, con pruebas mediante `node --test server/test/*.test.mjs` (Node.js 22 o superior).

Todavía no hay cliente Flutter, transporte WebSocket ni conexión a Firebase. El motor es la base para probar las reglas antes de conectar jugadores.

## Estructura

- `docs/game-design.md`: reglas del primer prototipo.
- `docs/architecture.md`: responsabilidades y etapas de implementación.
- `docs/protocol.md`: contrato previsto para las partidas en línea.
- `server/`: simulación autoritativa sin dependencias externas.

No se necesitan credenciales ni servicios externos para ejecutar las pruebas.
