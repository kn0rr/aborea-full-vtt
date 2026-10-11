// tests/actor-change.test.mjs — Änderungen an fremden Akteuren
//
// Spieler konnten bestimmte Kreaturen nicht angreifen: der Angriff schrieb
// den verbrauchten Defensivbonus direkt an den Akteur des Verteidigers, und
// der gehört dem Spieler nicht. Jetzt geht jede solche Änderung über
// changeActor() — selbst, oder über den Spielleiter. Getestet wird, wer
// schreibt, was überhaupt geschrieben werden darf, und die Rechnung.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { changeRoute, validateChange, shiftedHp, CHANGEABLE_FLAGS } from "../module/actor-change.mjs";
import { moduleFiles, stripCommentsAndStrings, findPattern } from "./helpers/source.mjs";

test("changeRoute: wer schreibt", async t => {
  await t.test("eigener Akteur: selbst", () =>
    assert.equal(changeRoute({ isOwner: true, gmActive: true }), "direct"));
  await t.test("Spielleiter: selbst", () =>
    assert.equal(changeRoute({ isGM: true }), "direct"));
  // Der gemeldete Fall: Spieler greift eine Kreatur an.
  await t.test("fremder Akteur, Spielleiter online: über den Spielleiter", () =>
    assert.equal(changeRoute({ isOwner: false, gmActive: true }), "gm"));
  await t.test("fremder Akteur, kein Spielleiter: niemand", () =>
    assert.equal(changeRoute({ isOwner: false, gmActive: false }), "none"));
  await t.test("ohne Angaben: niemand", () => assert.equal(changeRoute(), "none"));
});

test("validateChange: nur drei eng umrissene Änderungen", async t => {
  // Die Anfrage an den Spielleiter trägt keinen Absender. Was sie ausführt,
  // muss deshalb eng begrenzt sein.
  await t.test("Lebenspunkte: gerundet", () =>
    assert.deepEqual(validateChange({ type: "hpDelta", delta: -3.6 }), { type: "hpDelta", delta: -4 }));
  await t.test("Lebenspunkte: kein Betrag", () => {
    assert.throws(() => validateChange({ type: "hpDelta", delta: "viel" }));
    assert.throws(() => validateChange({ type: "hpDelta" }));
    assert.throws(() => validateChange({ type: "hpDelta", delta: Infinity }));
  });

  await t.test("Rundenerklärung ist erlaubt", () => {
    const v = { round: 3, mode: "weapon", defenseSpent: { a1: 2 } };
    assert.deepEqual(validateChange({ type: "flag", key: "declaration", value: v }), { type: "flag", key: "declaration", value: v });
  });
  await t.test("andere Flags nicht", () => {
    assert.throws(() => validateChange({ type: "flag", key: "undo", value: {} }));
    assert.throws(() => validateChange({ type: "flag", key: "__proto__", value: {} }));
    assert.equal(CHANGEABLE_FLAGS.size, 1);
  });
  await t.test("Flag ohne Objekt", () =>
    assert.throws(() => validateChange({ type: "flag", key: "declaration", value: 5 })));

  await t.test("Effekte: nur die bekannten Felder", () => {
    const [e] = validateChange({ type: "effects", effects: [{
      name: "Beistand", statuses: ["blessed"], duration: { rounds: 3, böse: "x" }, origin: "Item.abc",
      changes: [{ key: "system.traits.maneuverBonus", mode: 2, value: 2 }], unbekannt: "weg",
    }] }).effects;
    assert.equal(e.name, "Beistand");
    assert.deepEqual(e.duration, { rounds: 3 });
    assert.deepEqual(e.changes, [{ key: "system.traits.maneuverBonus", mode: 2, value: 2 }]);
    assert.ok(!("unbekannt" in e));
  });
  await t.test("Effekte: ohne Namen, leer oder zu viele", () => {
    assert.throws(() => validateChange({ type: "effects", effects: [{}] }));
    assert.throws(() => validateChange({ type: "effects", effects: [] }));
    assert.throws(() => validateChange({ type: "effects", effects: Array.from({ length: 21 }, (_, n) => ({ name: `e${n}` })) }));
  });

  await t.test("Unbekannte Art", () => {
    assert.throws(() => validateChange({ type: "delete" }));
    assert.throws(() => validateChange({ type: "update", data: { name: "x" } }));
  });
  await t.test("Unsinn", () => {
    assert.throws(() => validateChange(null));
    assert.throws(() => validateChange("hpDelta"));
    assert.throws(() => validateChange([]));
  });
});

test("shiftedHp: Lebenspunkte verschieben", async t => {
  await t.test("Schaden", () => assert.equal(shiftedHp(10, 12, -4), 6));
  await t.test("Schaden nie unter 0", () => assert.equal(shiftedHp(3, 12, -9), 0));
  await t.test("Heilung bis zum Maximum", () => assert.equal(shiftedHp(10, 12, 5), 12));
  await t.test("Heilung kürzt einen Überschuss nicht", () => assert.equal(shiftedHp(15, 12, 2), 15));
  await t.test("Schaden über dem Maximum zählt vom echten Wert", () => assert.equal(shiftedHp(15, 12, -2), 13));
  await t.test("ohne Maximum: Heilung bleibt beim Wert", () => assert.equal(shiftedHp(5, undefined, 3), 5));
  await t.test("Unsinn wird 0, nicht NaN", () => {
    assert.equal(shiftedHp("x", 10, -2), 0);
    assert.equal(shiftedHp(5, 10, "x"), 5);
  });
  await t.test("Invariante: Ergebnis endlich und nie negativ", () => {
    for (const cur of [0, 1, 7, 12, 20]) for (const max of [0, 10, 12]) for (const d of [-30, -1, 0, 1, 30]) {
      const r = shiftedHp(cur, max, d);
      assert.ok(Number.isFinite(r) && r >= 0, `${cur}/${max}/${d}`);
    }
  });
});

test("Ziele werden nicht direkt beschrieben", async t => {
  // Die Falle von hier: ein Aufruf wie targetActor.update(...) läuft auf dem
  // Client dessen, der angreift oder zaubert — und dem gehört das Ziel meist
  // nicht. Solche Schreibzugriffe gehen über changeActor().
  const muster = /\b(targetActor|defender|target)\.(update|setFlag|unsetFlag|createEmbeddedDocuments|deleteEmbeddedDocuments)\(/;
  const treffer = moduleFiles()
    .filter(({ name }) => name !== "actor-change.mjs")
    .flatMap(({ name, quelle }) => findPattern(stripCommentsAndStrings(quelle), muster).map(f => `${name}:${f.zeile} ${f.text}`));
  assert.deepEqual(treffer, []);
});
