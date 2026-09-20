// tests/settings.test.mjs — Weltoptionen des Spielleiters
//
// Die Entscheidungen hinter den Optionen, ohne Foundry: wann Schaden
// automatisch angewendet wird, wie der Situationsmodifikator geklemmt und
// zurückgesetzt wird, was ein Rückgängig-Schritt umfasst.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  SITU_PRESETS, SITU_MIN, SITU_MAX,
  clampSituMod, shouldAutoApplyDamage, shouldResetSituMod,
  buildUndoRecord, describeUndo,
} from "../module/settings.mjs";

test("shouldAutoApplyDamage", async t => {
  // Vorher war das nicht einstellbar, sondern zufällig verschieden: Waffen
  // brauchten einen Knopfdruck, Zauber wendeten sofort an.
  await t.test("off: nie, auch nicht für den Spielleiter", () => {
    assert.equal(shouldAutoApplyDamage("off", { isGM: true }), false);
    assert.equal(shouldAutoApplyDamage("off", { isGM: false }), false);
  });
  await t.test("gm: nur für den Spielleiter", () => {
    assert.equal(shouldAutoApplyDamage("gm", { isGM: true }), true);
    assert.equal(shouldAutoApplyDamage("gm", { isGM: false }), false);
  });
  await t.test("auto: immer", () => {
    assert.equal(shouldAutoApplyDamage("auto", { isGM: true }), true);
    assert.equal(shouldAutoApplyDamage("auto", { isGM: false }), true);
  });
  await t.test("unbekannter Wert wendet nichts an", () =>
    assert.equal(shouldAutoApplyDamage("quatsch", { isGM: true }), false));
  await t.test("ohne Angabe wendet nichts an", () =>
    assert.equal(shouldAutoApplyDamage(undefined), false));
});

test("clampSituMod", async t => {
  await t.test("im Bereich unverändert", () => assert.equal(clampSituMod(-4), -4));
  await t.test("nach oben geklemmt", () => assert.equal(clampSituMod(99), SITU_MAX));
  await t.test("nach unten geklemmt", () => assert.equal(clampSituMod(-99), SITU_MIN));
  await t.test("Text wird zu 0", () => assert.equal(clampSituMod("abc"), 0));
  await t.test("leer wird zu 0", () => assert.equal(clampSituMod(undefined), 0));
  await t.test("Zahlen als Text werden gelesen", () => assert.equal(clampSituMod("-3"), -3));
});

test("shouldResetSituMod: nur bei echtem Rundenwechsel", async t => {
  await t.test("abgeschaltet", () =>
    assert.equal(shouldResetSituMod(false, { previousRound: 1, currentRound: 2 }), false));
  await t.test("neue Runde", () =>
    assert.equal(shouldResetSituMod(true, { previousRound: 1, currentRound: 2 }), true));
  await t.test("Zugwechsel in derselben Runde räumt nicht weg", () =>
    assert.equal(shouldResetSituMod(true, { previousRound: 2, currentRound: 2 }), false));
  await t.test("Rückwärts (Runde zurück) räumt nicht weg", () =>
    assert.equal(shouldResetSituMod(true, { previousRound: 3, currentRound: 2 }), false));
  await t.test("Kampfstart auf Runde 1", () =>
    assert.equal(shouldResetSituMod(true, { previousRound: 0, currentRound: 1 }), true));
});

test("SITU_PRESETS", async t => {
  await t.test("alle im erlaubten Bereich", () => {
    for (const p of SITU_PRESETS) {
      assert.equal(clampSituMod(p.value), p.value, `${p.label} liegt ausserhalb der Grenzen`);
    }
  });
  await t.test("eindeutige Schlüssel", () =>
    assert.equal(new Set(SITU_PRESETS.map(p => p.key)).size, SITU_PRESETS.length));
  await t.test("keiner ist 0", () => {
    // Ein Preset mit 0 wäre nicht vom Zurücksetzen zu unterscheiden.
    for (const p of SITU_PRESETS) assert.notEqual(p.value, 0, `${p.label} ist 0`);
  });
});

test("buildUndoRecord", async t => {
  await t.test("HP allein", () =>
    assert.deepEqual(buildUndoRecord([{ actorId: "a1", name: "Ascario", hp: 6 }]),
      { entries: [{ actorId: "a1", name: "Ascario", hp: 6 }] }));

  await t.test("HP, MP und Effekte zusammen", () => {
    const r = buildUndoRecord([{ actorId: "a1", name: "Grik", hp: 6, mp: 12, effectIds: ["e1", "e2"] }]);
    assert.deepEqual(r.entries[0], { actorId: "a1", name: "Grik", hp: 6, mp: 12, effectIds: ["e1", "e2"] });
  });

  await t.test("Eintrag ohne Änderung fällt raus", () =>
    assert.equal(buildUndoRecord([{ actorId: "a1", name: "X" }]), null));

  await t.test("Eintrag ohne actorId fällt raus", () =>
    assert.equal(buildUndoRecord([{ hp: 4 }]), null));

  await t.test("leere Effektliste zählt nicht als Änderung", () =>
    assert.equal(buildUndoRecord([{ actorId: "a1", effectIds: [] }]), null));

  await t.test("HP 0 ist eine gültige Änderung", () => {
    // Wer auf 0 fällt, muss zurückgesetzt werden können — ein falsches
    // Falsy-Prüfen würde genau diesen Fall verschlucken.
    assert.equal(buildUndoRecord([{ actorId: "a1", hp: 0 }]).entries[0].hp, 0);
  });

  await t.test("mehrere Ziele", () =>
    assert.equal(buildUndoRecord([
      { actorId: "a1", hp: 6 }, { actorId: "a2", hp: 3 }, { actorId: "a3" },
    ]).entries.length, 2));

  await t.test("leere Eingabe", () => {
    assert.equal(buildUndoRecord([]), null);
    assert.equal(buildUndoRecord(), null);
  });

  await t.test("Effektliste wird kopiert, nicht verlinkt", () => {
    const ids = ["e1"];
    const r = buildUndoRecord([{ actorId: "a1", effectIds: ids }]);
    ids.push("e2");
    assert.deepEqual(r.entries[0].effectIds, ["e1"]);
  });
});

test("describeUndo", async t => {
  await t.test("nur HP", () =>
    assert.equal(describeUndo(buildUndoRecord([{ actorId: "a", hp: 5 }])), "1× HP"));
  await t.test("HP und MP", () =>
    assert.equal(describeUndo(buildUndoRecord([{ actorId: "a", hp: 5, mp: 9 }])), "1× HP, 1× MP"));
  await t.test("Effekte im Plural", () =>
    assert.equal(describeUndo(buildUndoRecord([{ actorId: "a", effectIds: ["1", "2"] }])), "2 Effekte"));
  await t.test("ein Effekt im Singular", () =>
    assert.equal(describeUndo(buildUndoRecord([{ actorId: "a", effectIds: ["1"] }])), "1 Effekt"));
  await t.test("mehrere Ziele werden gezählt", () =>
    assert.equal(describeUndo(buildUndoRecord([
      { actorId: "a", hp: 5 }, { actorId: "b", hp: 3 },
    ])), "2× HP"));
  await t.test("ohne Eintrag leer", () => {
    assert.equal(describeUndo(null), "");
    assert.equal(describeUndo({ entries: [] }), "");
  });
});
