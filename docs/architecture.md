# Arquitectura y etapas

## Componentes previstos

Cliente Flutter para Android: tablero, selección de unidades, HUD de energía y vida, animaciones e interpolación de estados. El cliente envía intenciones; no decide daño, recursos ni resultado.

Servidor de partidas Node.js: salas de dos jugadores, validación de acciones, simulación a 20 pasos por segundo y publicación de estados por WebSocket inicialmente a 10 Hz. El motor no depende del transporte ni de Firebase y se prueba sin red. Un proceso conserva las partidas activas en memoria durante el prototipo; reiniciar ese proceso interrumpirá esas partidas.

Firebase Authentication: identidad anónima inicial y posterior vinculación de cuentas. El servidor verificará los tokens antes de admitir conexiones. Firestore guardará perfiles y resultados a través del servidor; no se utilizará como bucle de simulación.

## Orden de construcción

1. Reglas, motor determinista y pruebas de combate, energía y victoria. Incluido en este arranque.
2. Salas privadas y WebSocket: validar mensajes, limitar frecuencia, programar pasos fijos y añadir pruebas con dos conexiones reales.
3. Cliente Flutter con tablero interactivo y una partida completa entre dos dispositivos.
4. Autenticación Firebase, reconexión, resultados persistentes y pruebas con latencia.
5. Ajustar balance, presentación y compilación Android.

Flutter no está instalado en el entorno actual. No se genera un esqueleto de cliente sin poder validarlo con sus herramientas. La elección del proveedor de alojamiento y el despliegue quedan pendientes; no se han creado recursos remotos.

## Límites de confianza

La identidad del jugador procede de la sesión autenticada del servidor, nunca de un campo del mensaje. Cada despliegue valida tipo de unidad, coordenadas, zona propia, energía y estado de partida. El transporte deberá limitar tamaño de mensajes, conexiones y frecuencia de comandos. Ninguna credencial administrativa de Firebase se incluirá en el cliente o en Git.
