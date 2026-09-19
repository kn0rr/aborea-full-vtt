// tests/effects.test.mjs — Zauberwirkung: Dauer, Active Effects, Manöver
//
// Diese Rechnungen scheitern still: eine nicht erkannte Dauer macht aus einem
// befristeten Effekt einen dauerhaften, ohne Fehlermeldung.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { parseSimpleDuration, inferEffects, spellManeuverDifficulty } from "../module/actor-helpers.mjs";

const mitDauer = txt => ({ system: { duration: txt } });

test("parseSimpleDuration: Formen, die im Kompendium vorkommen", async t => {
  await t.test("Runden pro MP", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("eine Runde/1 MP"), 5), { rounds: 5 }));
  await t.test("Stunden pro MP", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("eine Stunde/1 MP"), 5), { seconds: 5 * 3600 }));
  await t.test("Tage pro MP", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("einen Tag/1 MP"), 3), { seconds: 3 * 86400 }));
  await t.test("Minuten pro MP", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("1 Min./1 MP"), 4), { seconds: 4 * 60 }));

  await t.test("feste Rundenzahl", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("3 Runden"), 5), { rounds: 3 }));
  await t.test("feste Minutenzahl", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("10 Minuten"), 5), { seconds: 600 }));
  await t.test("feste Stundenzahl", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("2 Stunden"), 5), { seconds: 7200 }));
  await t.test("fester Tag", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("1 Tag pro Stufe"), 5), { seconds: 86400 }));

  await t.test("mindestens 1 MP, auch bei 0", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("eine Runde/1 MP"), 0), { rounds: 1 }));
  await t.test("leere Dauer ist dauerhaft", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer(""), 5), {}));
  await t.test("Groß-/Kleinschreibung egal", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("EINE RUNDE/1 MP"), 2), { rounds: 2 }));
});

test("parseSimpleDuration: ausgeschriebene Zahlen", { todo: "Parser erkennt nur Ziffern — siehe Befund" }, async t => {
  // Sieben von 36 Dauer-Texten im Kompendium ergeben heute {} und damit einen
  // dauerhaften Effekt, weil die Regexe eine Ziffer verlangen:
  //   "eine Stunde", "einen Tag", "eine Stunde/2 MP", "ein Jahr/1 MP …"
  await t.test("eine Stunde", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("eine Stunde"), 5), { seconds: 3600 }));
  await t.test("einen Tag", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("einen Tag"), 5), { seconds: 86400 }));
  await t.test("eine Stunde/2 MP", () =>
    assert.deepEqual(parseSimpleDuration(mitDauer("eine Stunde/2 MP"), 4), { seconds: 2 * 3600 }));
});

test("inferEffects", async t => {
  const zauber = (effects, duration = "") => ({ name: "Test", system: { effects, duration } });

  await t.test("ohne Effekte leere Liste", () =>
    assert.deepEqual(inferEffects(zauber([]), 5), []));

  await t.test("Status-Effekt", () => {
    const [e] = inferEffects(zauber([{ type: "status", status: "blind" }]), 5);
    assert.deepEqual(e.statuses, ["blind"]);
    assert.deepEqual(e.changes, []);
  });

  await t.test("fester Attributwert", () => {
    const [e] = inferEffects(zauber([{ type: "attribute", key: "system.traits.maneuverBonus", value: 2 }]), 5);
    assert.equal(e.changes[0].key, "system.traits.maneuverBonus");
    assert.equal(e.changes[0].value, 2);
  });

  await t.test("valuePerMp skaliert mit den MP", () => {
    const [e] = inferEffects(zauber([{ type: "attribute", key: "k", valuePerMp: 0.5 }]), 5);
    assert.equal(e.changes[0].value, 3); // 2.5 wird gerundet
  });

  await t.test("max deckelt nach oben", () => {
    const [e] = inferEffects(zauber([{ type: "attribute", key: "k", valuePerMp: 1, max: 3 }]), 10);
    assert.equal(e.changes[0].value, 3);
  });

  await t.test("min hält nach unten", () => {
    const [e] = inferEffects(zauber([{ type: "attribute", key: "k", value: -9, min: -3 }]), 5);
    assert.equal(e.changes[0].value, -3);
  });

  await t.test("Dauer wird mitgegeben", () => {
    const [e] = inferEffects(zauber([{ type: "status", status: "blind" }], "eine Runde/1 MP"), 3);
    assert.deepEqual(e.duration, { rounds: 3 });
  });
});

test("spellManeuverDifficulty", async t => {
  const probe = (zauberRang, entwickelnRang) => spellManeuverDifficulty(
    { system: { rank: zauberRang } },
    { system: { skills: { magieEntwickeln: { rank: entwickelnRang } } } });

  await t.test("Rang gleich Fertigkeit -> einfach (8)", () => {
    const r = probe(3, 3);
    assert.equal(r.diff, 0);
    assert.equal(r.value, 8);
  });
  await t.test("ein Rang darüber -> schwer (10)",      () => assert.equal(probe(4, 3).value, 10));
  await t.test("ein Rang darunter -> sehr einfach (7)", () => assert.equal(probe(2, 3).value, 7));
  await t.test("weit darunter klemmt bei Routine (5)",  () => assert.equal(probe(1, 20).value, 5));
  await t.test("weit darüber klemmt bei absurd (18)",   () => assert.equal(probe(20, 0).value, 18));
  await t.test("ohne Fertigkeit zählt Rang 0", () => {
    const r = spellManeuverDifficulty({ system: { rank: 2 } }, { system: {} });
    assert.equal(r.diff, 2);
  });
});
