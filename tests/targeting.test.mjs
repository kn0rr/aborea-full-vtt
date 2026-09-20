// tests/targeting.test.mjs — Zielauswahl und Angriffsplanung
//
// Beides steckte vorher im Dialog und war damit ungeprüft. Die Zielauswahl
// lieferte ohne laufenden Kampf gar nichts, der Angriffsplan existierte nur
// als Inline-Code in _prepareContext.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { selectTargetTokens, defaultWeapon, attackPlan } from "../module/targeting.mjs";

const token = (id, name, type = "npc") => ({ id, name, actor: { id: `a-${id}`, type } });

test("selectTargetTokens", async t => {
  const tokens = [token("t3", "Ziska"), token("t1", "Ascario"), token("t2", "Borin")];

  await t.test("ohne laufenden Kampf zählt alles auf der Szene", () => {
    // Vorher kam hier eine leere Liste zurück und es blieb nur die manuelle
    // RW-Eingabe — ein Hinterhalt ausserhalb der Initiative war damit lästig.
    const r = selectTargetTokens(tokens, { combatTokenIds: null });
    assert.deepEqual(r.map(x => x.id), ["t1", "t2", "t3"]);
  });

  await t.test("alphabetisch sortiert", () =>
    assert.deepEqual(selectTargetTokens(tokens, {}).map(x => x.name), ["Ascario", "Borin", "Ziska"]));

  await t.test("mit Kampf nur die Kombattanten", () => {
    const r = selectTargetTokens(tokens, { combatTokenIds: new Set(["t1", "t3"]) });
    assert.deepEqual(r.map(x => x.id), ["t1", "t3"]);
  });

  await t.test("leerer Kampf schliesst alle aus", () =>
    assert.equal(selectTargetTokens(tokens, { combatTokenIds: new Set() }).length, 0));

  await t.test("der Angreifer ist kein Ziel", () =>
    assert.deepEqual(selectTargetTokens(tokens, { attackerTokenId: "t2" }).map(x => x.id), ["t1", "t3"]));

  await t.test("Loot-Behälter sind keine Ziele", () => {
    const mitTruhe = [...tokens, token("t4", "Truhe", "loot")];
    assert.equal(selectTargetTokens(mitTruhe, {}).some(x => x.name === "Truhe"), false);
  });

  await t.test("Tokens ohne Actor fallen raus", () =>
    assert.equal(selectTargetTokens([{ id: "x", name: "Leer" }], {}).length, 0));

  await t.test("leere Eingabe", () => {
    assert.deepEqual(selectTargetTokens([], {}), []);
    assert.deepEqual(selectTargetTokens(null, {}), []);
  });
});

test("defaultWeapon: die ausgerüstete mit dem höchsten Schaden", async t => {
  const w = (name, damage, equipped = true) => ({ type: "weapon", name, system: { equipped, damage } });

  await t.test("ohne Waffen null", () =>
    assert.equal(defaultWeapon({ items: [] }), null));
  await t.test("nicht ausgerüstete zählen nicht", () =>
    assert.equal(defaultWeapon({ items: [w("Dolch", 3, false)] }), null));
  await t.test("die stärkste gewinnt", () =>
    assert.equal(defaultWeapon({ items: [w("Dolch", -1), w("Axt", 2), w("Keule", 1)] }).name, "Axt"));
  await t.test("negativer Schaden ist besser als nichts", () =>
    assert.equal(defaultWeapon({ items: [w("Dolch", -1)] }).name, "Dolch"));
  await t.test("ohne Actor null", () => assert.equal(defaultWeapon(null), null));
});

test("attackPlan nimmt den Offensivbonus aus der Rundenerklärung", async t => {
  const kaempfer = (decl, items = []) => ({
    type: "character", items,
    flags: decl ? { "aborea-v7": { declaration: decl } } : {},
    system: { combat: { combatBonus: 6, offensiveBonus: 4, defensiveBonus: 2 } },
  });
  const axt = { type: "weapon", name: "Axt", system: { equipped: true, damage: 2 } };

  await t.test("ohne Erklärung die Vorbelegung vom Bogen", () =>
    assert.equal(attackPlan(kaempfer(null), { round: 3 }).offBonus, 4));

  await t.test("mit Waffenerklärung der erklärte Wert", () =>
    assert.equal(attackPlan(kaempfer({ round: 3, mode: "weapon", offensive: 6 }), { round: 3 }).offBonus, 6));

  await t.test("wer Zaubern erklärt hat, schlägt ohne Offensivbonus zu", () => {
    // Der Kampfbonus ist dort gebunden — er kann nicht zweimal ausgegeben
    // werden.
    const plan = attackPlan(kaempfer({ round: 3, mode: "spell" }), { round: 3 });
    assert.equal(plan.offBonus, 0);
    assert.equal(plan.mode, "spell");
  });

  await t.test("Erklärung aus einer anderen Runde zählt nicht", () =>
    assert.equal(attackPlan(kaempfer({ round: 2, mode: "spell" }), { round: 3 }).offBonus, 4));

  await t.test("Waffe wird automatisch gewählt", () =>
    assert.equal(attackPlan(kaempfer(null, [axt]), { round: 3 }).weapon.name, "Axt"));

  await t.test("vorgegebene Waffe gewinnt", () => {
    const dolch = { type: "weapon", name: "Dolch", system: { equipped: true, damage: -1 } };
    assert.equal(attackPlan(kaempfer(null, [axt]), { round: 3, weapon: dolch }).weapon.name, "Dolch");
  });

  await t.test("ausdrücklich waffenlos", () =>
    assert.equal(attackPlan(kaempfer(null, [axt]), { round: 3, weapon: null }).weapon, null));

  await t.test("Situationsmodifikator wird durchgereicht", () =>
    assert.equal(attackPlan(kaempfer(null), { round: 3, situMod: -2 }).situMod, -2));

  await t.test("unbrauchbarer Situationsmodifikator wird zu 0", () =>
    assert.equal(attackPlan(kaempfer(null), { round: 3, situMod: "x" }).situMod, 0));
});
