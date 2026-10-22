import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, deploy, step, distance } from "../src/engine.mjs";

const advance = (match, ms) => {
  for (let i = 0; i < ms / 50; i++) step(match);
};

test("rejects malformed, out-of-board and enemy-zone commands without changing state", () => {
  const match = createMatch();
  const before = structuredClone(match);
  for (const args of [
    [2, "tank", -4, 0],
    [0, "constructor", -4, 0],
    [0, "tank", -4, -1],
    [0, "tank", 3, 0],
    [0, "tank", -3.5, 0],
  ]) {
    assert.equal(deploy(match, ...args).ok, false);
    assert.deepEqual(match, before);
  }
});

test("deployment consumes energy and regeneration stops at ten", () => {
  const match = createMatch();
  assert.equal(deploy(match, 0, "tank", -3, 0).ok, true);
  assert.equal(match.players[0].energy, 0);
  assert.equal(
    deploy(match, 0, "attacker", -3, 0).error,
    "insufficient-energy",
  );
  advance(match, 11000);
  assert.equal(match.players[0].energy, 10);
});

test("units wait for their movement interval and stay on the hex board", () => {
  const match = createMatch();
  deploy(match, 0, "attacker", -3, 0);
  advance(match, 450);
  assert.equal(match.units[0].q, -3);
  step(match);
  assert.equal(distance(match.units[0], match.players[1].base), 6);
  advance(match, 10000);
  for (const unit of match.units)
    assert.ok(distance(unit, { q: 0, r: 0 }) <= 4);
});

test("regenerated energy can be spent at the exact whole-second boundary", () => {
  const match = createMatch();
  deploy(match, 0, "tank", -3, 0);
  advance(match, 3000);
  assert.equal(match.players[0].energy, 3);
  assert.equal(deploy(match, 0, "attacker", -3, 0).ok, true);
});

test("damage is simultaneous, allowing mutual eliminations", () => {
  const match = createMatch();
  deploy(match, 0, "attacker", -3, 0);
  deploy(match, 1, "attacker", 3, 0);
  Object.assign(match.units[0], { q: 0, hp: 10 });
  Object.assign(match.units[1], { q: 1, hp: 10 });
  advance(match, 1000);
  assert.equal(match.units.length, 0);
});

test("base destruction ends a match and freezes subsequent commands and ticks", () => {
  const match = createMatch();
  deploy(match, 0, "attacker", -3, 0);
  match.players[1].base.hp = 10;
  advance(match, 10000);
  assert.deepEqual(match.result, { winner: 0, reason: "base-destroyed" });
  const before = structuredClone(match);
  assert.equal(deploy(match, 1, "tank", 3, 0).error, "match-ended");
  step(match);
  assert.deepEqual(match, before);
});

test("time limit resolves equal bases as a draw and unequal bases by health", () => {
  for (const hp of [100, 90]) {
    const match = createMatch();
    match.players[1].base.hp = hp;
    advance(match, 180000);
    assert.deepEqual(match.result, {
      winner: hp === 100 ? null : 0,
      reason: "time-limit",
    });
  }
});

test("identical commands produce identical simulations", () => {
  const run = () => {
    const match = createMatch();
    deploy(match, 0, "ranged", -3, 0);
    deploy(match, 1, "tank", 3, 0);
    advance(match, 20000);
    return match;
  };
  assert.deepEqual(run(), run());
});
