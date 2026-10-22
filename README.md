# hexaclash-live

Juego de estrategia con combate continuo para Android: dos jugadores despliegan unidades sobre un tablero hexagonal y buscan destruir la base rival.

## Estado

Prototipo local jugable desde dos pestañas: salas privadas, tres unidades, combate continuo, energía, victoria y reconexión. El servidor controla las reglas y envía el mismo estado a ambos jugadores.

Todavía no hay cliente Flutter ni conexión a Firebase. Las sesiones locales son tokens temporales por pestaña; no representan cuentas verificadas. El servidor escucha únicamente en `127.0.0.1`. No es un despliegue público.

## Ejecutar

Requiere Node.js 22 o superior y npm.

```sh
npm ci
npm test
npm start
```

Abre `http://127.0.0.1:8173` en dos pestañas nuevas. En la primera, pulsa **Crear una sala**; en la segunda, introduce su código de seis caracteres. Ambos deben pulsar **Estoy listo**. Elige una unidad y toca una casilla iluminada de tu zona. Las unidades se mueven y atacan automáticamente.

**Probar reconexión** corta el socket y recupera la misma identidad y el tablero. También puedes recargar la pestaña. La partida continúa durante el corte; tienes 20 segundos para volver. Si ambos agotan ese margen, el resultado es empate. **Rendirme y salir** concede la victoria al rival; después puedes crear otra sala.

El puerto se configura con `PORT`, por ejemplo en PowerShell: `$env:PORT='8174'` antes de `npm start`. Para detener el proceso, pulsa Ctrl+C.

## Verificación

19 pruebas automatizadas de motor y conexiones WebSocket reales: partida hasta destrucción de base, igualdad de snapshots, reintentos sin doble gasto, rechazo de suplantación de bando, reconexión, abandono, rendición, caducidad de salas, mensajes inválidos, límites de frecuencia y tamaño, origen de navegador y archivos HTTP. Los tests de red usan puertos efímeros y un reloj controlado; no necesitan esperar los tres minutos de una partida.

Comprobación manual en navegador: dos pestañas, despliegue por ambos equipos, resolución de partida, recuperación de sesión y vistas de 319 y 1280 píxeles sin desbordamiento horizontal.

## Estructura

- `docs/game-design.md`: reglas del primer prototipo.
- `docs/architecture.md`: responsabilidades y etapas de implementación.
- `docs/protocol.md`: contrato implementado para la demo local y límites del transporte.
- `server/`: simulación y servidor WebSocket; usa la biblioteca `ws`.
- `public/`: arena web de pruebas, adaptable a escritorio y móvil, sin compilación.

No se necesitan credenciales ni servicios externos para ejecutar las pruebas.

## Límites actuales

Las salas, sesiones y resultados viven en memoria: reiniciar el servidor los borra. Las salas sin iniciar caducan a los diez minutos; las terminadas se conservan dos minutos. El cliente interpola las posiciones entre estados; los efectos de combate, balance, pruebas bajo latencia real y rendimiento con muchos jugadores están pendientes. El bucle local usa pasos de 50 ms: un bloqueo prolongado del proceso puede ralentizar la simulación.

El siguiente paso es conectar el cliente Flutter y añadir autenticación verificada con Firebase, persistencia de resultados y alojamiento WSS antes de abrir partidas por Internet.
