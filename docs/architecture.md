# Arquitectura y etapas

## Componentes

Cliente Flutter para Android: tablero, selección de unidades, HUD de energía y vida, animaciones e interpolación de estados. El cliente envía intenciones; no decide daño, recursos ni resultado.

Servidor de partidas Node.js: salas de dos jugadores, validación de acciones, simulación a 20 pasos por segundo y publicación de estados por WebSocket inicialmente a 10 Hz. El motor no depende del transporte ni de Firebase y se prueba sin red. Un proceso conserva las partidas activas en memoria durante el prototipo; reiniciar ese proceso interrumpirá esas partidas.

Implementado: `rooms.mjs` administra sesiones, salas y abandono; `server.mjs` sirve la arena web y el WebSocket `/ws`; `main.mjs` arranca en loopback. El cliente provisional `public/` dibuja el tablero SVG, interpola unidades, recupera la sesión tras recargar y permite dos participantes en pestañas distintas. La sesión se conserva en `sessionStorage`, no en una cookie compartida entre pestañas. Reutilizar un token en otra conexión reemplaza la conexión anterior.

Firebase Authentication: identidad anónima inicial y posterior vinculación de cuentas. El servidor verificará los tokens antes de admitir conexiones. Firestore guardará perfiles y resultados a través del servidor; no se utilizará como bucle de simulación.

## Orden de construcción

1. Reglas, motor determinista y pruebas de combate, energía y victoria. Implementado.
2. Salas privadas y WebSocket, validación, límites de frecuencia y tamaño, estados compartidos, reconexión y arena web de pruebas. Implementado y probado con sockets reales.
3. Cliente Flutter con tablero interactivo y una partida completa entre dos dispositivos.
4. Autenticación Firebase, resultados persistentes y pruebas con latencia real.
5. Ajustar balance, presentación y compilación Android.

Flutter no está instalado en el entorno actual. No se genera un esqueleto de cliente sin poder validarlo con sus herramientas. La elección del proveedor de alojamiento y el despliegue quedan pendientes; no se han creado recursos remotos.

## Límites de confianza

La identidad provisional procede de un token aleatorio emitido por el servidor local, nunca de un bando enviado por el cliente. No equivale a autenticación Firebase. Cada despliegue valida tipo de unidad, coordenadas, zona propia, energía y estado de partida. El transporte limita mensajes a 2 KiB, 128 conexiones, 64 salas y una ráfaga de 30 mensajes con recuperación de 15 por segundo. Comprueba el origen de los navegadores, exige identificación en cinco segundos y utiliza ping/pong para detectar sockets rotos. Los clientes lentos se desconectan si acumulan más de 256 KB pendientes. Ninguna credencial administrativa de Firebase se incluirá en el cliente o en Git.

La implementación WebSocket sigue los patrones de servidor HTTP compartido y heartbeat de la [documentación oficial de ws](https://github.com/websockets/ws). El servicio permanece en loopback: los tokens locales no bastan para publicar este prototipo en Internet.
