# HexaClash Live: primer prototipo

Reglas iniciales propuestas, sujetas a ajustes de balance durante las pruebas.

## Objetivo y partida

Dos jugadores, una base cada uno y combate continuo. Gana quien destruye la base rival. La partida dura 180 segundos; al agotarse el tiempo gana quien conserve más vida en su base. Igualdad o destrucción simultánea: empate.

Tablero hexagonal de radio 4, coordenadas axiales `(q, r)`. Bases en `(-4, 0)` y `(4, 0)`, con 100 puntos de vida. Se permite desplegar en las dos columnas de hexágonos más cercanas a la base propia. Varias unidades pueden compartir una casilla en esta primera versión.

## Energía y unidades

Cada jugador empieza con 5 de energía, acumula 1 por segundo y puede almacenar 10. Desplegar descuenta energía inmediatamente. No hay azar, cartas aleatorias ni daño entre aliados.

| Unidad | Coste | Vida | Daño | Alcance | Movimiento | Ataque |
| --- | --- | --- | --- | --- | --- | --- |
| Tanque | 5 | 60 | 8 | 1 casilla | cada 1 s | cada 1 s |
| Atacante | 3 | 30 | 10 | 1 casilla | cada 0,5 s | cada 1 s |
| Tirador | 4 | 20 | 6 | 3 casillas | cada 0,75 s | cada 1 s |

Las unidades priorizan al enemigo más cercano; a igualdad de distancia, el identificador más antiguo. Si no hay enemigos, avanzan hacia la base rival. En alcance, atacan; fuera de alcance, avanzan por una casilla que reduzca la distancia al objetivo. Las unidades recién desplegadas esperan su primer intervalo de movimiento o ataque.

La simulación usa pasos fijos de 50 ms. El movimiento se decide sobre el mismo estado inicial del paso y el daño se aplica simultáneamente. Esto permite eliminaciones mutuas sin favorecer al primer jugador procesado.

## Alcance inicial

Primero se valida el motor local. Después se conectan dos jugadores por código de sala, con servidor autoritativo y recuperación del estado tras una desconexión. En la versión conectada se propone una tolerancia de 20 segundos antes de perder por abandono; todavía no está implementada.

Quedan fuera del primer prototipo: clasificación, chat, monetización, equipamiento, obstáculos y emparejamiento público.
