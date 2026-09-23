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

test("game.combat wird nur an einer Stelle gelesen", async t => {
  // `game.combat` ist der Kampf des Kampfberichts. Steht dessen Reiter auf
  // CLOSED, ist er null, obwohl der Kampf läuft. Wer direkt danach greift,
  // baut den Fehler wieder ein — deshalb geht alles über currentCombat(),
  // und das darf als einziges hineinschauen.
  const treffer = moduleFiles().flatMap(({ name, quelle }) =>
    findIdentifier(stripCommentsAndStrings(quelle), "game\\.combat")
      .map(zeile => `${name}:${zeile}`));

  await t.test("genau ein Zugriff im ganzen System", () =>
    assert.equal(treffer.length, 1, `gefunden: ${treffer.join(", ")}`));

  await t.test("und der steht in combat.mjs", () =>
    assert.match(treffer[0] ?? "", /^combat\.mjs:/));
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
