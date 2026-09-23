// tests/combat-console.test.mjs — Kampfpult des Spielleiters
//
// Geprüft wird die Aufbereitung der Zeilen, nicht die Oberfläche. Wichtigster
// Punkt: ausgeschiedene Kombattanten dürfen nicht mehr als Ziel erscheinen.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildConsoleRows, assignableTargets, isDefeated, mayUseConsole,
         combatPhase, combatantTarget, buildCombatChoices } from "../module/combat-console.mjs";

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

test("combatPhase", async t => {
  // "teilweise kommt kein kampf aktiv": ein angelegter Kampf steht auf Runde
  // 0. Er ist da, aber erklären lässt sich nichts — das Pult zeigte Knöpfe,
  // die stumm nichts taten.
  await t.test("kein Kampf", () =>
    assert.equal(combatPhase({ hasCombat: false, started: false, round: 0 }), "none"));
  await t.test("angelegt, nicht gestartet", () =>
    assert.equal(combatPhase({ hasCombat: true, started: false, round: 0 }), "prepared"));
  await t.test("gestartet", () =>
    assert.equal(combatPhase({ hasCombat: true, started: true, round: 1 }), "running"));
  await t.test("started gesetzt, Runde aber noch 0", () =>
    assert.equal(combatPhase({ hasCombat: true, started: true, round: 0 }), "prepared"));
  await t.test("Runde gesetzt, started aber nicht", () =>
    assert.equal(combatPhase({ hasCombat: true, started: false, round: 3 }), "prepared"));
  await t.test("spaetere Runden bleiben laufend", () => {
    for (const r of [1, 2, 7, 99]) {
      assert.equal(combatPhase({ hasCombat: true, started: true, round: r }), "running", `Runde ${r}`);
    }
  });
  await t.test("leere Eingabe", () => {
    assert.equal(combatPhase({}), "none");
    assert.equal(combatPhase(), "none");
  });
});

test("buildCombatChoices", async t => {
  // game.combat ist nicht "der laufende Kampf", sondern der, den der Tracker
  // zeigt — und der findet nur Kaempfe der *betrachteten* Szene. Wer woanders
  // steht, bekam "kein Kampf" zu sehen, obwohl einer lief. Aus dieser Liste
  // laesst sich einer auswaehlen.
  const kampf = (id, over = {}) => ({
    id, sceneId: over.sceneId ?? "s1", sceneName: over.sceneName ?? "Hoehle",
    active: over.active ?? false, started: over.started ?? true,
    round: over.round ?? 1, size: over.size ?? 3,
  });

  await t.test("hiesige Szene zuerst", () => {
    const r = buildCombatChoices(
      [kampf("k1", { sceneId: "s2" }), kampf("k2", { sceneId: "s1" })],
      { viewedSceneId: "s1" });
    assert.deepEqual(r.map(x => x.id), ["k2", "k1"]);
    assert.deepEqual(r.map(x => x.here), [true, false]);
  });

  await t.test("danach die aktivierten", () => {
    const r = buildCombatChoices(
      [kampf("k1", { sceneId: "s2" }), kampf("k2", { sceneId: "s2", active: true })],
      { viewedSceneId: "s1" });
    assert.deepEqual(r.map(x => x.id), ["k2", "k1"]);
  });

  await t.test("danach die weiteste Runde", () => {
    const r = buildCombatChoices(
      [kampf("k1", { sceneId: "s2", round: 2 }), kampf("k2", { sceneId: "s2", round: 7 })],
      { viewedSceneId: "s1" });
    assert.deepEqual(r.map(x => x.id), ["k2", "k1"]);
  });

  await t.test("die Reihenfolge ist bei Gleichstand stabil", () => {
    const zwei = [kampf("kb", { sceneId: "s2" }), kampf("ka", { sceneId: "s2" })];
    assert.deepEqual(buildCombatChoices(zwei, {}).map(x => x.id), ["ka", "kb"]);
  });

  await t.test("ein Kampf ohne Szene gilt als hiesig", () =>
    // #inferCombat() nimmt ihn genauso: !c.scene zaehlt als passend.
    assert.equal(buildCombatChoices([kampf("k1", { sceneId: "" })], { viewedSceneId: "s9" })[0].here, true));

  await t.test("die Beschriftung nennt Runde, Anzahl und Szene", () =>
    assert.equal(buildCombatChoices([kampf("k1", { round: 4, size: 5 })], {})[0].label,
      "Runde 4 · 5 Kombattanten · Szene: Hoehle"));

  await t.test("noch nicht gestartet statt Runde 0", () =>
    assert.match(buildCombatChoices([kampf("k1", { round: 0 })], {})[0].label, /^noch nicht gestartet/));

  await t.test("ein Kombattant im Singular", () =>
    assert.match(buildCombatChoices([kampf("k1", { size: 1 })], {})[0].label, /1 Kombattant ·/));

  await t.test("ohne Szene sagt es das", () =>
    assert.match(buildCombatChoices([kampf("k1", { sceneName: "" })], {})[0].label, /ohne Szene$/));

  await t.test("Kaempfe ohne Kennung fallen raus", () =>
    assert.deepEqual(buildCombatChoices([{ round: 1 }, null], {}), []));

  await t.test("leere Eingabe", () => {
    assert.deepEqual(buildCombatChoices([], {}), []);
    assert.deepEqual(buildCombatChoices(null, {}), []);
    assert.deepEqual(buildCombatChoices(), []);
  });
});

test("Zielzuweisung überlebt das Neuzeichnen", async t => {
  // Das Auswahlfeld war reiner DOM-Zustand. Jede Änderung zeichnet das Pult
  // neu — auch das Setzen eines Situationsmodifikators — und setzte die
  // Zuweisung damit auf "— Ziel wählen —" zurück.
  const rows = (over = {}) => buildConsoleRows([
    { ...eintrag("c1", { name: "Ascario" }), targetId: over.c1 ?? "" },
    { ...eintrag("c2", { name: "Goblin" }),  targetId: over.c2 ?? "" },
    { ...eintrag("c3", { name: "Grik" }),    targetId: over.c3 ?? "" },
  ]).rows;

  await t.test("das zugewiesene Ziel ist vorgewaehlt", () => {
    const r = rows({ c1: "c3" });
    assert.equal(r[0].target, "c3");
    assert.deepEqual(r[0].targets.filter(x => x.selected).map(x => x.name), ["Grik"]);
  });

  await t.test("ohne Zuweisung ist nichts vorgewaehlt", () => {
    const r = rows();
    assert.equal(r[0].target, "");
    assert.equal(r[0].targets.some(x => x.selected), false);
  });

  await t.test("sich selbst steht nicht zur Wahl", () => {
    for (const r of rows()) {
      assert.equal(r.targets.some(x => x.id === r.id), false, `${r.name} kann sich selbst waehlen`);
    }
  });

  await t.test("eine Zuweisung auf sich selbst wird verworfen", () =>
    assert.equal(rows({ c1: "c1" })[0].target, ""));

  await t.test("ein ausgeschiedenes Ziel wird verworfen", () => {
    const r = buildConsoleRows([
      { ...eintrag("c1"), targetId: "c2" },
      eintrag("c2", { hp: { value: 0, max: 6 } }),
    ]).rows;
    assert.equal(r[0].target, "");
    assert.equal(r[0].targets.length, 0);
  });

  await t.test("ein unbekanntes Ziel wird verworfen", () =>
    assert.equal(rows({ c1: "gibtsnicht" })[0].target, ""));

  await t.test("jede Zeile behaelt ihre eigene Zuweisung", () => {
    const r = rows({ c1: "c2", c2: "c3", c3: "c1" });
    assert.deepEqual(r.map(x => x.target), ["c2", "c3", "c1"]);
  });
});

test("combatantTarget: das Ziel steht am Kombattanten, nicht im DOM", async t => {
  await t.test("gesetztes Flag", () =>
    assert.equal(combatantTarget({ flags: { "aborea-v7": { target: "c2" } } }), "c2"));
  await t.test("ohne Flag leer", () =>
    assert.equal(combatantTarget({ flags: {} }), ""));
  await t.test("ohne Kombattant leer", () => {
    assert.equal(combatantTarget(null), "");
    assert.equal(combatantTarget(undefined), "");
  });
  await t.test("fremde Flags stoeren nicht", () =>
    assert.equal(combatantTarget({ flags: { andere: { target: "x" } } }), ""));
});

test("canDeclare und canAttack: was in welcher Phase geht", async t => {
  const rowOf = (phase, over = {}) => buildConsoleRows([eintrag("c1", over)], { phase }).rows[0];

  await t.test("im laufenden Kampf beides", () => {
    const r = rowOf("running");
    assert.equal(r.canDeclare, true);
    assert.equal(r.canAttack, true);
  });

  await t.test("vor dem Start weder erklaeren noch angreifen", () => {
    // Genau hier lief das Klicken bisher ins Leere: declareRound braucht eine
    // Rundennummer, und die ist in Runde 0 keine.
    const r = rowOf("prepared");
    assert.equal(r.canDeclare, false);
    assert.equal(r.canAttack, false);
  });

  await t.test("Ziele zuweisen geht schon vor dem Start", () => {
    // Die Angriffsreihenfolge festzulegen ist die Vorbereitung — dafür muss
    // der Kampf nicht laufen.
    assert.equal(rowOf("prepared").canAssign, true);
    assert.equal(rowOf("running").canAssign, true);
  });

  await t.test("Ausgeschiedene und Fliehende bekommen kein Ziel", () => {
    assert.equal(rowOf("running", { defeated: true }).canAssign, false);
    assert.equal(rowOf("running", {
      split: { pool: 5, offensive: 0, defensive: 5, mode: "flee", declared: true, locked: false, defenseSpent: null },
    }).canAssign, false);
  });

  await t.test("ausgeschieden erklaert und greift nicht mehr an", () => {
    const r = rowOf("running", { defeated: true });
    assert.equal(r.canDeclare, false);
    assert.equal(r.canAttack, false);
  });

  await t.test("wer gehandelt hat, erklaert nicht neu — greift aber an", () => {
    const r = rowOf("running", {
      split: { pool: 5, offensive: 3, defensive: 2, mode: "weapon", declared: true, locked: true, defenseSpent: null },
    });
    assert.equal(r.canDeclare, false);
    assert.equal(r.canAttack, true);
  });

  await t.test("wer flieht, greift nicht an — Flucht ist die einzige Handlung", () => {
    const r = rowOf("running", {
      split: { pool: 5, offensive: 0, defensive: 5, mode: "flee", declared: true, locked: false, defenseSpent: null },
    });
    assert.equal(r.fleeing, true);
    assert.equal(r.canAttack, false);
    assert.equal(r.canDeclare, true);   // umentscheiden darf er noch
  });

  await t.test("ohne Angabe wird der laufende Kampf angenommen", () =>
    assert.equal(buildConsoleRows([eintrag("c1")]).rows[0].canAttack, true));
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
