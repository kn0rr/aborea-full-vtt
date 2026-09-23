// tests/source-rules.test.mjs — Fallen, die nicht zurückkommen dürfen
//
// Zwei Regeln über den eigenen Quelltext. Beide halten denselben Fehler fest,
// der lange nicht zu finden war und gleich vier Symptome hatte: das Kampfpult
// zeigte nur noch die Auswahlliste, der Klick darin blieb folgenlos, Fliehen
// tat nichts, und im Kampfbericht erschien keine ABOREA-Zeile.
//
// Ursache war, dass `game.combat` nicht der laufende Kampf ist, sondern der,
// den der Kampfbericht *anzeigt* — und dass ein `render()` ohne `force` bei
// geschlossenem Reiter aussteigt, bevor dieser Wert gesetzt wird.
//
// Am Verhalten lässt sich das nicht prüfen: dafür bräuchte es Foundrys
// Seitenleiste. Der Aufruf aber steht bei uns, und Text kann man lesen.

import test from "node:test";
import assert from "node:assert/strict";
import { moduleFiles, stripCommentsAndStrings, findIdentifier, findPattern } from "./helpers/source.mjs";

/** In welcher Funktion steht diese Zeile? Die nächste Deklaration darüber. */
function enclosingFunction(quelle, zeile) {
  const zeilen = quelle.split("\n").slice(0, zeile);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const m = zeilen[i].match(/^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/);
    if (m) return m[1];
  }
  return "";
}

test("game.combat wird nur dort gelesen, wo es gekapselt ist", async t => {
  // `game.combat` ist der Kampf des Kampfberichts. Steht dessen Reiter auf
  // CLOSED, ist er null, obwohl der Kampf läuft — und Foundrys eigener Code
  // legt dann bei jedem "in den Kampf" einen neuen Kampf an, weil seine
  // Doppelungssperre denselben Wert liest.
  //
  // Zwei Funktionen dürfen hineinschauen: currentCombat() leitet den Kampf
  // her, ensureViewedCombat() trägt ihn nach. Alles andere geht über sie.
  const ERLAUBT = ["currentCombat", "ensureViewedCombat"];

  const treffer = moduleFiles().flatMap(({ name, quelle }) => {
    const rein = stripCommentsAndStrings(quelle);
    return findIdentifier(rein, "game\\.combat").map(zeile => ({
      ort: `${name}:${zeile}`, name, fn: enclosingFunction(rein, zeile),
    }));
  });

  await t.test("kein Zugriff ausserhalb von combat.mjs", () => {
    const fremd = treffer.filter(t => t.name !== "combat.mjs").map(t => t.ort);
    assert.deepEqual(fremd, [], `gefunden: ${fremd.join(", ")}`);
  });

  await t.test("und dort nur in den kapselnden Funktionen", () => {
    const daneben = treffer.filter(t => !ERLAUBT.includes(t.fn))
      .map(t => `${t.ort} (in ${t.fn || "—"})`);
    assert.deepEqual(daneben, [], `gefunden: ${daneben.join(", ")}`);
  });

  await t.test("es gibt sie ueberhaupt", () =>
    // Ein Waechter, der nichts findet, weil sein Muster nicht passt, ist
    // keiner.
    assert.ok(treffer.length > 0, "kein einziger Zugriff gefunden — Muster kaputt?"));
});

test("ui.combat.render muss force mitgeben, wenn es den Kampf setzt", async t => {
  // ApplicationV2.#render:
  //     options.isFirstRender = this.#state <= states.NONE;   // CLOSED ist -1
  //     if ( options.isFirstRender && !options.force ) return this;
  //
  // Ein Kampfbericht, dessen Reiter der Spielleiter einmal verlassen hat,
  // steht auf CLOSED. Ein render({combat}) ohne force steigt dort aus, bevor
  // viewed gesetzt wird — der Aufruf sieht richtig aus und tut nichts.
  const fehler = [];
  for (const { name, quelle } of moduleFiles()) {
    const rein = stripCommentsAndStrings(quelle);
    for (const { zeile, gruppen } of findPattern(rein, /ui\.combat\??\.render\(\s*\{([^}]*)\}/)) {
      const args = gruppen[0] ?? "";
      if (/\bcombat\s*:/.test(args) && !/\bforce\s*:\s*true/.test(args)) {
        fehler.push(`${name}:${zeile} — setzt combat, aber kein force: true`);
      }
    }
  }

  await t.test("kein Aufruf ohne force", () =>
    assert.deepEqual(fehler, [], fehler.join("\n  ")));

  await t.test("die Prüfung greift überhaupt", () => {
    // Ein Test, der nichts findet, weil sein Muster nicht passt, ist kein
    // Test. Also an einer erfundenen Zeile nachweisen, dass er anschlägt.
    const schlecht = 'await ui.combat?.render({ combat: chosen });';
    const gut      = 'await ui.combat?.render({ force: true, combat: chosen });';
    const trifft = q => findPattern(q, /ui\.combat\??\.render\(\s*\{([^}]*)\}/)
      .some(({ gruppen }) => /\bcombat\s*:/.test(gruppen[0]) && !/\bforce\s*:\s*true/.test(gruppen[0]));
    assert.equal(trifft(schlecht), true,  "die Pruefung uebersieht den Fehlerfall");
    assert.equal(trifft(gut), false, "die Pruefung meldet den richtigen Fall");
  });
});
