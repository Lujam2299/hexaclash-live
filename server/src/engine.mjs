export const STEP_MS = 50;
export const UNITS = Object.freeze({
  tank: Object.freeze({ cost: 5, hp: 60, damage: 8, range: 1, moveMs: 1000 }),
  attacker: Object.freeze({ cost: 3, hp: 30, damage: 10, range: 1, moveMs: 500 }),
  ranged: Object.freeze({ cost: 4, hp: 20, damage: 6, range: 3, moveMs: 750 }),
});
const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
export const distance = (a, b) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const validCell = (q, r) => Number.isInteger(q) && Number.isInteger(r)
  && Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 4;

export function createMatch() {
  return {
    elapsedMs: 0, nextId: 1, result: null,
    players: [0, 1].map((side) => ({ energy: 5, base: { q: side ? 4 : -4, r: 0, hp: 100 } })),
    units: [],
  };
}

// Internal server API: side must come from the authenticated connection.
export function deploy(match, side, type, q, r) {
  const stats = typeof type === 'string' && Object.hasOwn(UNITS, type) ? UNITS[type] : null;
  if (match.result) return { ok: false, error: 'match-ended' };
  if ((side !== 0 && side !== 1) || !stats) return { ok: false, error: 'invalid-command' };
  if (!validCell(q, r) || (side === 0 ? q > -3 : q < 3))
    return { ok: false, error: 'invalid-position' };
  const player = match.players[side];
  if (player.energy < stats.cost) return { ok: false, error: 'insufficient-energy' };
  player.energy -= stats.cost;
  const id = match.nextId++;
  match.units.push({ id, side, type, q, r, hp: stats.hp,
    nextMove: match.elapsedMs + stats.moveMs, nextAttack: match.elapsedMs + 1000 });
  return { ok: true, id };
}

export function step(match) {
  if (match.result) return;
  match.elapsedMs += STEP_MS;
  for (const player of match.players) player.energy = Math.min(10, player.energy + STEP_MS / 1000);
  const moves = [];
  const damage = new Map();
  for (const unit of match.units) {
    const stats = UNITS[unit.type];
    const enemies = match.units.filter((enemy) => enemy.side !== unit.side);
    enemies.sort((a, b) => distance(unit, a) - distance(unit, b) || a.id - b.id);
    const target = enemies[0] ?? match.players[1 - unit.side].base;
    if (distance(unit, target) <= stats.range) {
      if (match.elapsedMs >= unit.nextAttack) {
        damage.set(target, (damage.get(target) ?? 0) + stats.damage);
        unit.nextAttack = match.elapsedMs + 1000;
      }
    } else if (match.elapsedMs >= unit.nextMove) {
      const options = directions.map(([q, r]) => ({ q: unit.q + q, r: unit.r + r }))
        .filter((cell) => validCell(cell.q, cell.r))
        .sort((a, b) => distance(a, target) - distance(b, target));
      const cell = options[0];
      if (cell && distance(cell, target) < distance(unit, target)) moves.push([unit, cell]);
      unit.nextMove = match.elapsedMs + stats.moveMs;
    }
  }
  for (const [unit, cell] of moves) Object.assign(unit, cell);
  for (const [target, amount] of damage) target.hp = Math.max(0, target.hp - amount);
  match.units = match.units.filter((unit) => unit.hp > 0);
  const [a, b] = match.players.map((player) => player.base.hp);
  if (!a || !b || match.elapsedMs >= 180000) {
    match.result = { winner: a === b ? null : a > b ? 0 : 1,
      reason: !a || !b ? 'base-destroyed' : 'time-limit' };
  }
}
