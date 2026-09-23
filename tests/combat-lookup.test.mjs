// tests/combat-lookup.test.mjs — welchen Kampf das System benutzt
//
// Der Fehler, den diese Datei festhält, lag zwei Schichten tief.
//
// `game.combat` ist nicht "der laufende Kampf", sondern der, den der
// Kampfbericht *anzeigt*: `game.combats.viewed` liest `ui.combat?.viewed`,
// und der Wert wird ausschliesslich beim Rendern des Berichts gesetzt. Ein
// Seitenleisten-Reiter, den der Spielleiter einmal verlassen hat, steht in
// ApplicationV2 auf CLOSED, und dort steigt das Rendern vorher aus:
//
//     options.isFirstRender = this.#state <= states.NONE;   // CLOSED ist -1
//     if ( options.isFirstRender && !options.force ) return this;
//
// Danach war `game.combat` null, obwohl der Kampf lief: das Kampfpult zeigte
// nur noch die Auswahlliste, der Klick darin blieb folgenlos, und
// declareRound() lehnte jede Erklärung ab — auch die Flucht.
//
// Geprüft wird hier die Verdrahtung: currentCombat() findet den Kampf auch
// dann, wenn der Bericht keinen meldet. Die Regel selbst steht in
// pickCombatId() und ist in combat.test.mjs geprüft; dass niemand wieder an
// currentCombat() vorbeigreift, sichert deprecations.test.mjs.

import { setCombatState, combatDoc } from "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { currentCombat } from "../module/combat.mjs";

test("currentCombat: der Kampfbericht zeigt einen", async t => {
  await t.test("dann gilt dieser", () => {
    const gezeigt = combatDoc("k1");
    setCombatState({ viewed: gezeigt, combats: [gezeigt, combatDoc("k2")], viewedSceneId: "s1" });
    assert.equal(currentCombat(), gezeigt);
  });

  await t.test("auch wenn er auf einer anderen Szene liegt", () => {
    // Der Spielleiter hat ihn bewusst in den Bericht geholt.
    const fremd = combatDoc("k1", { sceneId: "s9" });
    setCombatState({ viewed: fremd, combats: [fremd], viewedSceneId: "s1" });
    assert.equal(currentCombat().id, "k1");
  });
});

test("currentCombat: der Kampfbericht zeigt keinen", async t => {
  await t.test("der Kampf dieser Szene wird trotzdem gefunden", () => {
    // Genau der gemeldete Fall: Kampf laeuft, Runde 1, richtige Szene — und
    // das Pult sah nichts, weil der Berichtsreiter geschlossen war.
    const k = combatDoc("k1", { sceneId: "s1", round: 1 });
    setCombatState({ viewed: null, combats: [k], viewedSceneId: "s1" });
    assert.equal(currentCombat().id, "k1");
  });

  await t.test("ein aktivierter hat Vorrang", () => {
    setCombatState({
      viewed: null,
      combats: [combatDoc("k1"), combatDoc("k2", { active: true })],
      viewedSceneId: "s1",
    });
    assert.equal(currentCombat().id, "k2");
  });

  await t.test("ein aktivierter auf fremder Szene zaehlt nicht", () => {
    // Combat#isActive prueft scene.isView — woanders aktiviert ist hier
    // nicht der laufende.
    setCombatState({
      viewed: null,
      combats: [combatDoc("k1", { sceneId: "s9", active: true }), combatDoc("k2", { sceneId: "s1" })],
      viewedSceneId: "s1",
    });
    assert.equal(currentCombat().id, "k2");
  });

  await t.test("ein Kampf ohne Szene zaehlt ueberall", () => {
    setCombatState({ viewed: null, combats: [combatDoc("k1", { sceneId: "" })], viewedSceneId: "s9" });
    assert.equal(currentCombat().id, "k1");
  });

  await t.test("nur Kaempfe fremder Szenen: keiner", () => {
    setCombatState({ viewed: null, combats: [combatDoc("k1", { sceneId: "s9" })], viewedSceneId: "s1" });
    assert.equal(currentCombat(), null);
  });

  await t.test("gar keine Kaempfe", () => {
    setCombatState({ viewed: null, combats: [], viewedSceneId: "s1" });
    assert.equal(currentCombat(), null);
  });

  await t.test("ohne betrachtete Szene kein Absturz", () => {
    setCombatState({ viewed: null, combats: [combatDoc("k1")], viewedSceneId: "" });
    assert.doesNotThrow(() => currentCombat());
  });
});
