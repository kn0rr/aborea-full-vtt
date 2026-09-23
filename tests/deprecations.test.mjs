// tests/deprecations.test.mjs — veraltete Foundry-Globals
//
// Foundry v13 hat einen Teil der globalen Namen unter `foundry.*` einsortiert
// und lässt die alten nur noch mit einer Warnung durch; in v15 fallen sie
// weg. Eine Warnung in der Konsole fällt beim Entwickeln leicht durch, und
// wenn sie auffällt, ist die Stelle längst kalt.
//
// Geprüft wird deshalb der Quelltext selbst: keiner dieser Namen steht mehr
// als eigenständiger Bezeichner im Systemcode. Kommentare und Zeichenketten
// zählen nicht — "Token" und "Die" sind auch deutsche Wörter.
//
// Die Liste ist bewusst kurz: sie enthält, was hier tatsächlich einmal in
// Gebrauch war oder naheliegt. Die vollständige Zuordnung steht in Foundrys
// client/client.mjs unter addBackwardsCompatibilityReferences().

import test from "node:test";
import assert from "node:assert/strict";
import { moduleFiles, stripCommentsAndStrings, findIdentifier } from "./helpers/source.mjs";

/** Veralteter Name → wodurch er zu ersetzen ist. */
const ERSETZT = {
  renderTemplate: "foundry.applications.handlebars.renderTemplate",
  loadTemplates:  "foundry.applications.handlebars.loadTemplates",
  getTemplate:    "foundry.applications.handlebars.getTemplate",
  TextEditor:     "foundry.applications.ux.TextEditor.implementation",
  FilePicker:     "foundry.applications.apps.FilePicker.implementation",
  DragDrop:       "foundry.applications.ux.DragDrop.implementation",
  Tabs:           "foundry.applications.ux.Tabs",
  ContextMenu:    "foundry.applications.ux.ContextMenu.implementation",
  SearchFilter:   "foundry.applications.ux.SearchFilter",
  Actors:         "foundry.documents.collections.Actors",
  Items:          "foundry.documents.collections.Items",
  Playlists:      "foundry.documents.collections.Playlists",
  Journal:        "foundry.documents.collections.Journal",
  Macros:         "foundry.documents.collections.Macros",
  Scenes:         "foundry.documents.collections.Scenes",
  RollTables:     "foundry.documents.collections.RollTables",
  Messages:       "foundry.documents.collections.Messages",
  Folders:        "foundry.documents.collections.Folders",
  Users:          "foundry.documents.collections.Users",
  AudioHelper:    "foundry.audio.AudioHelper",
  Sound:          "foundry.audio.Sound",
  Token:          "foundry.canvas.placeables.Token",
  Canvas:         "foundry.canvas.Canvas",
  ImageHelper:    "foundry.helpers.media.ImageHelper",
  SortingHelpers: "foundry.utils.SortingHelpers",
};

/**
 * Hooks, auf die nicht registriert werden darf — samt Grund. Alle drei sind
 * an v13.351 nachgesehen, nicht vermutet.
 *
 * Achtung, die Namen sind nicht einheitlich: bei *Dokumenten* heisst der
 * neue Hook …HTML (renderChatMessageHTML), bei *Anwendungen* gerade nicht.
 * ApplicationV2 feuert render<Klassenname>, also renderCombatTracker — ein
 * renderCombatTrackerHTML gibt es nirgends. Wir hatten beides falsch herum.
 */
const HOOKS = {
  renderChatMessage:       { statt: "renderChatMessageHTML",
                             warum: "seit v13 veraltet, faellt in v15 weg" },
  renderCombatTrackerHTML: { statt: "renderCombatTracker",
                             warum: "gibt es nicht — der Tracker ist eine ApplicationV2" },
  getSceneControlButtonsV2: { statt: "getSceneControlButtons",
                             warum: "gibt es in v13 nicht, feuert also nie" },
};

test("stripCommentsAndStrings", async t => {
  await t.test("Zeilenkommentar faellt weg", () =>
    assert.equal(findIdentifier(stripCommentsAndStrings("// renderTemplate\nx"), "renderTemplate").length, 0));

  await t.test("Blockkommentar faellt weg", () =>
    assert.equal(findIdentifier(stripCommentsAndStrings("/* Token\n Token */\nx"), "Token").length, 0));

  await t.test("Zeichenkette faellt weg", () =>
    assert.equal(findIdentifier(stripCommentsAndStrings('const s = "Token";'), "Token").length, 0));

  await t.test("Vorlagenzeichenkette faellt weg", () =>
    assert.equal(findIdentifier(stripCommentsAndStrings("const s = `Token`;"), "Token").length, 0));

  await t.test("echter Aufruf bleibt", () =>
    assert.deepEqual(findIdentifier(stripCommentsAndStrings("await renderTemplate(x);"), "renderTemplate"), [1]));

  await t.test("die Zeilennummer stimmt nach einem Blockkommentar", () =>
    assert.deepEqual(findIdentifier(stripCommentsAndStrings("/* a\nb\nc */\nrenderTemplate(x)"), "renderTemplate"), [4]));

  await t.test("als Eigenschaft zaehlt es nicht", () =>
    // foundry.applications.handlebars.renderTemplate ist genau das Richtige.
    assert.equal(findIdentifier(stripCommentsAndStrings("foundry.applications.handlebars.renderTemplate(x)"),
      "renderTemplate").length, 0));

  await t.test("als Teil eines laengeren Namens zaehlt es nicht", () =>
    assert.equal(findIdentifier(stripCommentsAndStrings("myRenderTemplate(); renderTemplateX();"),
      "renderTemplate").length, 0));
});

test("kein veraltetes Foundry-Global im Systemcode", async t => {
  const dateien = moduleFiles();
  assert.ok(dateien.length > 0, "keine Module gefunden");

  for (const { name: datei, quelle: roh } of dateien) {
    await t.test(datei, () => {
      const quelle = stripCommentsAndStrings(roh);
      const fehler = [];
      for (const [alt, neu] of Object.entries(ERSETZT)) {
        for (const zeile of findIdentifier(quelle, alt)) {
          fehler.push(`Zeile ${zeile}: ${alt} → ${neu}`);
        }
      }
      assert.deepEqual(fehler, [], `${datei}:\n  ${fehler.join("\n  ")}`);
    });
  }
});

test("kein toter oder veralteter Hook im Systemcode", async t => {
  for (const { name: datei, quelle } of moduleFiles()) {
    await t.test(datei, () => {
      const fehler = [];
      for (const [alt, { statt, warum }] of Object.entries(HOOKS)) {
        // Hooknamen stehen in Zeichenketten — hier wird bewusst nicht
        // gestrippt, sondern auf Hooks.on("…") geprüft.
        const re = new RegExp(`Hooks\\.(?:on|once)\\(\\s*["'\`]${alt}["'\`]`, "g");
        if (re.test(quelle)) fehler.push(`${alt} → ${statt} (${warum})`);
      }
      assert.deepEqual(fehler, [], `${datei}:\n  ${fehler.join("\n  ")}`);
    });
  }
});
