// tests/dice.test.mjs — der offene W10
//
// Die Kernmechanik des Systems: jede Probe und jeder Angriff hängt daran.
// Die Würfel werden über einen deterministischen Roll-Stub vorgegeben.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";

/** Setzt die nächsten Würfelergebnisse fest und liefert den Rest-Zähler. */
function queueRolls(...values) {
  const queue = [...values];
  globalThis.Roll = class Roll {
    constructor(formula) { this.formula = formula; }
    async evaluate() {
      assert.ok(queue.length, "mehr Würfe angefordert als vorgegeben");
      this.total = queue.shift();
      return this;
    }
  };
  return () => queue.length;
}

const { rollOpenD10 } = await import("../module/dice.mjs");
const roll = () => rollOpenD10({ skipVisual: true });

test("gewöhnlicher Wurf", async t => {
  await t.test("Ergebnis 7", async () => {
    queueRolls(7);
    const r = await roll();
    assert.equal(r.total, 7);
    assert.equal(r.critical, false);
    assert.equal(r.naturalOne, false);
    assert.deepEqual(r.parts, [7]);
  });

  await t.test("Formel zeigt die Einzelwürfe", async () => {
    queueRolls(4);
    assert.equal((await roll()).formula, "4");
  });
});

test("die 10 ist offen und wird aufaddiert", async t => {
  await t.test("10 dann 7 ergibt 17", async () => {
    queueRolls(10, 7);
    const r = await roll();
    assert.equal(r.total, 17);
    assert.equal(r.critical, true);
    assert.deepEqual(r.parts, [10, 7]);
    assert.equal(r.formula, "10 + 7");
  });

  await t.test("mehrfach offen", async () => {
    queueRolls(10, 10, 3);
    const r = await roll();
    assert.equal(r.total, 23);
    assert.equal(r.critical, true);
    assert.deepEqual(r.parts, [10, 10, 3]);
  });

  await t.test("hört bei der ersten Nicht-10 auf", async () => {
    const rest = queueRolls(10, 2, 9);
    await roll();
    assert.equal(rest(), 1, "der Wurf nach der 2 hätte nicht stattfinden dürfen");
  });
});

test("die natürliche 1 ist ein Patzer", async t => {
  await t.test("1 im ersten Wurf", async () => {
    queueRolls(1);
    const r = await roll();
    assert.equal(r.naturalOne, true);
    assert.equal(r.total, 1);
  });

  await t.test("1 nach einer offenen 10 ist KEIN Patzer", async () => {
    // naturalOne gilt nur für den ersten Wurf — sonst würde ein guter
    // offener Wurf durch eine folgende 1 zum Fehlschlag.
    queueRolls(10, 1);
    const r = await roll();
    assert.equal(r.naturalOne, false);
    assert.equal(r.total, 11);
    assert.equal(r.critical, true);
  });
});

test("Rohwürfel werden für Dice-So-Nice durchgereicht", async () => {
  queueRolls(10, 10, 4);
  const r = await roll();
  assert.equal(r.rolls.length, 3, "jeder Einzelwurf muss im rolls-Array landen");
});
