// tests/targeting.test.mjs — Zielauswahl und Angriffsplanung
//
// Beides steckte vorher im Dialog und war damit ungeprüft. Die Zielauswahl
// lieferte ohne laufenden Kampf gar nichts, der Angriffsplan existierte nur
// als Inline-Code in _prepareContext.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { selectTargetTokens, defaultWeapon, attackPlan, resolveAttackerToken } from "../module/targeting.mjs";

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

test("selectTargetTokens: niemand greift sich selbst an", async t => {
  // Drei Goblins aus derselben Kreatur: unverknüpfte Tokens teilen sich die
  // Actor-Kennung. Wird nur nach dem Actor gesucht, fällt immer das erste
  // Token heraus — greift Goblin 2 an, blieb er selbst in der Liste stehen.
  const goblin = id => ({ id, name: `Goblin ${id}`, actor: { id: "a-goblin", type: "creature" } });
  const drei   = [goblin("t1"), goblin("t2"), goblin("t3")];

  await t.test("mit bekanntem Token faellt genau dieses heraus", () =>
    assert.deepEqual(selectTargetTokens(drei, { attackerTokenId: "t2", attackerActorId: "a-goblin" })
      .map(x => x.id), ["t1", "t3"]));

  await t.test("jedes Exemplar wird richtig ausgelassen", () => {
    for (const id of ["t1", "t2", "t3"]) {
      const r = selectTargetTokens(drei, { attackerTokenId: id, attackerActorId: "a-goblin" });
      assert.equal(r.some(x => x.id === id), false, `${id} steht in seiner eigenen Liste`);
      assert.equal(r.length, 2);
    }
  });

  await t.test("ohne bekanntes Token faellt der ganze Actor heraus", () =>
    // Lieber ein Ziel zu wenig als sich selbst in der Auswahl.
    assert.deepEqual(selectTargetTokens(drei, { attackerActorId: "a-goblin" }), []));

  await t.test("fremde Tokens bleiben dabei stehen", () => {
    const gemischt = [...drei, { id: "t9", name: "Ascario", actor: { id: "a-asc", type: "character" } }];
    assert.deepEqual(selectTargetTokens(gemischt, { attackerActorId: "a-goblin" }).map(x => x.id), ["t9"]);
  });

  await t.test("ohne jede Angabe faellt niemand heraus", () =>
    assert.equal(selectTargetTokens(drei, {}).length, 3));
});

test("resolveAttackerToken", async t => {
  const tok = (id, actorId) => ({ id, actor: { id: actorId } });

  await t.test("ausdrueckliche Angabe gewinnt", () =>
    assert.equal(resolveAttackerToken({
      tokenId: "t7", controlled: [tok("t1", "a1")], tokens: [tok("t1", "a1")], actorId: "a1",
    }), "t7"));

  await t.test("das ausgewaehlte Token", () =>
    assert.equal(resolveAttackerToken({
      controlled: [tok("t2", "a1")],
      tokens: [tok("t1", "a1"), tok("t2", "a1")],
      actorId: "a1",
    }), "t2"));

  await t.test("das einzige Token des Actors", () =>
    assert.equal(resolveAttackerToken({ tokens: [tok("t1", "a1"), tok("t2", "a2")], actorId: "a1" }), "t1"));

  await t.test("mehrdeutig: lieber nichts als das falsche", () =>
    // Genau hier lag der Fehler — ein find() nahm einfach das erste.
    assert.equal(resolveAttackerToken({
      tokens: [tok("t1", "a1"), tok("t2", "a1"), tok("t3", "a1")], actorId: "a1",
    }), ""));

  await t.test("mehrere ausgewaehlte sind ebenso mehrdeutig", () =>
    assert.equal(resolveAttackerToken({
      controlled: [tok("t1", "a1"), tok("t2", "a1")],
      tokens: [tok("t1", "a1"), tok("t2", "a1")],
      actorId: "a1",
    }), ""));

  await t.test("Actor ohne Token auf der Szene", () =>
    assert.equal(resolveAttackerToken({ tokens: [tok("t1", "a2")], actorId: "a1" }), ""));

  await t.test("leere Eingabe", () => {
    assert.equal(resolveAttackerToken({}), "");
    assert.equal(resolveAttackerToken(), "");
  });

  await t.test("Tokens ohne Actor stoeren nicht", () =>
    assert.equal(resolveAttackerToken({
      tokens: [{ id: "x" }, tok("t1", "a1")], actorId: "a1",
    }), "t1"));
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
