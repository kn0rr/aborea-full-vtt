// tests/combat-console.test.mjs — Kampfpult des Spielleiters
//
// Geprüft wird die Aufbereitung der Zeilen, nicht die Oberfläche. Wichtigster
// Punkt: ausgeschiedene Kombattanten dürfen nicht mehr als Ziel erscheinen.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildConsoleRows, assignableTargets, isDefeated, mayUseConsole } from "../module/combat-console.mjs";

const eintrag = (id, over = {}) => ({
  id, actorId: `a-${id}`, name: over.name ?? id,
  defeated: over.defeated ?? false,
  initiative: over.initiative ?? 5,
  hp: over.hp ?? { value: 10, max: 10 },
  split: over.split ?? {
    pool: 5, offensive: 3, defensive: 2, mode: "weapon",
    declared: true, locked: false, defenseSpent: null,
  },
});

test("isDefeated", async t => {
  await t.test("Markierung des Spielleiters", () =>
    assert.equal(isDefeated({ defeated: true, hp: { value: 9, max: 10 } }), true));
  await t.test("0 Lebenspunkte zaehlen auch", () =>
    // Sonst bliebe ein Gegner mit 0 HP als Ziel stehen, nur weil niemand den
    // Haken gesetzt hat.
    assert.equal(isDefeated({ defeated: false, hp: { value: 0, max: 10 } }), true));
  await t.test("negative Lebenspunkte", () =>
    assert.equal(isDefeated({ hp: { value: -3, max: 10 } }), true));
  await t.test("lebendig", () =>
    assert.equal(isDefeated({ defeated: false, hp: { value: 1, max: 10 } }), false));
  await t.test("ohne Angaben als lebendig behandeln", () =>
    assert.equal(isDefeated({}), false));
});

test("buildConsoleRows", async t => {
  const { rows, alive, defeated } = buildConsoleRows([
    eintrag("c1", { name: "Ascario" }),
    eintrag("c2", { name: "Goblin", hp: { value: 0, max: 6 } }),
    eintrag("c3", { name: "Grik", defeated: true }),
  ], { activeId: "c1" });

  await t.test("alle Zeilen", () => assert.equal(rows.length, 3));
  await t.test("lebendig und ausgeschieden getrennt", () => {
    assert.deepEqual(alive.map(r => r.name), ["Ascario"]);
    assert.deepEqual(defeated.map(r => r.name), ["Goblin", "Grik"]);
  });
  await t.test("aktiver Kombattant markiert", () =>
    assert.equal(rows.find(r => r.id === "c1").active, true));

  await t.test("Lebensbalken in Prozent", () => {
    assert.equal(rows[0].hpPct, 100);
    assert.equal(rows[1].hpPct, 0);
  });
  await t.test("Prozent bleibt zwischen 0 und 100", () => {
    const [r] = buildConsoleRows([eintrag("x", { hp: { value: 99, max: 10 } })]).rows;
    assert.equal(r.hpPct, 100);
  });
  await t.test("hpMax 0 ergibt keine Division durch null", () => {
    const [r] = buildConsoleRows([eintrag("x", { hp: { value: 0, max: 0 } })]).rows;
    assert.ok(Number.isFinite(r.hpPct));
  });

  await t.test("Defensivvorrat wird ausgewiesen", () => {
    const [r] = buildConsoleRows([eintrag("x", {
      split: { pool: 5, offensive: 2, defensive: 3, mode: "weapon", declared: true, locked: false,
               defenseSpent: { g1: 2 } },
    })]).rows;
    assert.equal(r.defensive, 3);
    assert.equal(r.defenseUsed, 2);
    assert.equal(r.defenseLeft, 1);
  });

  await t.test("negativer Kampfbonus laesst sich nicht aufteilen", () => {
    const [r] = buildConsoleRows([eintrag("x", {
      split: { pool: -1, offensive: -1, defensive: 0, mode: "weapon", declared: true, locked: false, defenseSpent: null },
    })]).rows;
    assert.equal(r.canSplit, false);
    assert.equal(r.splitMin, -1);
    assert.equal(r.splitMax, -1);
  });

  await t.test("ohne Erklaerung trotzdem eine Zeile", () => {
    const [r] = buildConsoleRows([{ id: "x", name: "X", hp: { value: 5, max: 5 } }]).rows;
    assert.equal(r.declared, false);
    assert.equal(r.pool, 0);
  });

  await t.test("persoenlicher Situationsmodifikator wird durchgereicht", () => {
    const [r] = buildConsoleRows([eintrag("x", {})].map(e => ({ ...e, situMod: -2 }))).rows;
    assert.equal(r.situMod, -2);
  });
  await t.test("ohne Angabe 0", () =>
    assert.equal(buildConsoleRows([eintrag("x")]).rows[0].situMod, 0));

  await t.test("leere Eingabe", () => {
    assert.deepEqual(buildConsoleRows([]).rows, []);
    assert.deepEqual(buildConsoleRows(null).rows, []);
  });
});

test("assignableTargets", async t => {
  const { rows } = buildConsoleRows([
    eintrag("c1", { name: "Ascario" }),
    eintrag("c2", { name: "Goblin" }),
    eintrag("c3", { name: "Toter", hp: { value: 0, max: 6 } }),
  ]);

  await t.test("sich selbst nicht angreifen", () =>
    assert.equal(assignableTargets(rows, "c1").some(r => r.id === "c1"), false));
  await t.test("Ausgeschiedene stehen nicht zur Wahl", () =>
    assert.equal(assignableTargets(rows, "c1").some(r => r.name === "Toter"), false));
  await t.test("der Rest bleibt", () =>
    assert.deepEqual(assignableTargets(rows, "c1").map(r => r.name), ["Goblin"]));
  await t.test("leere Eingabe", () =>
    assert.deepEqual(assignableTargets(null, "c1"), []));
});

test("mayUseConsole: das Pult ist dem Spielleiter vorbehalten", async t => {
  // Es zeigt jeden Kombattanten samt Lebenspunkten, auch die noch nicht
  // preisgegebenen Gegner. Der Knopf erscheint Spielern nicht, ueber die
  // Konsole waere das Fenster sonst aber trotzdem erreichbar.
  await t.test("Spielleiter", () => assert.equal(mayUseConsole({ isGM: true }), true));
  await t.test("Spieler", () => assert.equal(mayUseConsole({ isGM: false }), false));
  await t.test("vertrauter Spieler reicht nicht", () =>
    assert.equal(mayUseConsole({ isGM: false, isTrusted: true }), false));
  await t.test("ohne Benutzer", () => {
    assert.equal(mayUseConsole(null), false);
    assert.equal(mayUseConsole(undefined), false);
  });
});
