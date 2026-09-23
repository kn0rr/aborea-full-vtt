// tests/scene-controls.test.mjs — eigene Werkzeuggruppen in der Szenenleiste
//
// Vier Anläufe, vier Fehlerklassen — alle vier halten hier Tests fest:
//
//   1. Form. v12 übergab Arrays, v13 ein Objekt nach Gruppennamen. Die
//      Registrierungen prüften nur auf Array und erschienen unter v13 nicht.
//   2. Mehrfaches Feuern. Foundry ruft die Rückmeldung eines Werkzeugs in
//      mehreren Lagen auf, und nur eine ist ein Klick darauf.
//   3. Sichtbarkeit. Gerendert werden nur die Werkzeuge der *aktiven* Gruppe.
//      Der Versuch, die Knöpfe in Foundrys Token-Gruppe zu hängen, liess sie
//      beim Reiterwechsel verschwinden.
//   4. Keine Ebenenaktivierung. Eine eigene Gruppe, die beim Öffnen
//      canvas.tokens.activate() ruft, wirft sich selbst hinaus — Foundry
//      schaltet zurück auf die Gruppe, die so heisst wie die Ebene.
//
// Die Aufruflagen stammen aus client/applications/ui/scene-controls.mjs der
// v13.351 und sind hier als Attrappe nachgebaut — nicht um Foundry
// nachzubilden, sondern um die Regeln festzuhalten: ein Klick, ein Fenster,
// und kein Werkzeug, das sich selbst auslöst.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeControlGroup, addControlGroup, normalizeTool, buildAnchorTool,
         isToolInvocation, ANCHOR_SUFFIX } from "../module/scene-controls.mjs";

const spec = (aufrufe = null) => ({
  name: "aborea-combat", title: "ABOREA Kampf", icon: "fa-solid fa-chess-board", order: 80,
  tools: [
    { name: "pult", title: "Pult", icon: "fa-solid fa-a",
      onClick: () => { aufrufe?.push("pult"); return "pult"; } },
    { name: "gruppe", title: "Gruppe", icon: "fa-solid fa-b",
      onClick: () => { aufrufe?.push("gruppe"); return "gruppe"; } },
  ],
});

const ANKER = `aborea-combat${ANCHOR_SUFFIX}`;

/** Klickereignis auf einen Werkzeugknopf, so wie Foundry es weiterreicht. */
const toolClick    = name => ({ target: { dataset: { tool: name, action: "tool" } } });
/** Klickereignis auf das Gruppensymbol. */
const controlClick = name => ({ target: { dataset: { control: name, action: "control" } } });

test("isToolInvocation: nur der Klick auf den Knopf zaehlt", async t => {
  await t.test("Klick auf den Knopf", () =>
    assert.equal(isToolInvocation("pult", toolClick("pult"), true), true));

  await t.test("Klick auf das Gruppensymbol nicht", () =>
    // #postActivate ruft beim Aktivieren einer Gruppe deren activeTool auf.
    assert.equal(isToolInvocation("pult", controlClick("aborea-combat"), true), false));

  await t.test("Klick auf ein anderes Werkzeug nicht", () =>
    assert.equal(isToolInvocation("pult", toolClick("gruppe"), true), false));

  await t.test("active = false nie", () => {
    // #preActivate ruft beim Verlassen einer Gruppe deren bisheriges Werkzeug
    // mit false auf. Das war der Fall "ich klicke das eine an und beide
    // gehen auf".
    assert.equal(isToolInvocation("pult", toolClick("pult"), false), false);
    assert.equal(isToolInvocation("pult", controlClick("x"), false), false);
    assert.equal(isToolInvocation("pult", null, false), false);
  });

  await t.test("ohne Ereignis wird ausgefuehrt", () => {
    // Foundry legt bei programmatischer Aktivierung ein leeres Ereignis an.
    // Lieber einmal zu viel als ein toter Knopf.
    assert.equal(isToolInvocation("pult", null, true), true);
    assert.equal(isToolInvocation("pult", undefined, true), true);
    assert.equal(isToolInvocation("pult", { target: null }, true), true);
    assert.equal(isToolInvocation("pult", {}, undefined), true);
  });
});

test("buildAnchorTool: der Ruhezustand einer Gruppe", async t => {
  const anker = buildAnchorTool("aborea-combat");

  await t.test("traegt keine Rueckmeldung", () => {
    // Genau darin liegt sein Sinn. Das activeTool wird beim Betreten und
    // Verlassen der Gruppe aufgerufen — ein Werkzeug mit Wirkung wuerde dort
    // ungefragt feuern.
    assert.equal(normalizeTool(anker).onChange, undefined);
    assert.equal(normalizeTool(anker).onClick, undefined);
  });

  await t.test("ist kein Knopf", () =>
    assert.equal(anker.button, false));

  await t.test("steht an erster Stelle", () =>
    assert.equal(anker.order, 0));

  await t.test("sein Name leitet sich von der Gruppe ab", () =>
    assert.equal(buildAnchorTool("xyz").name, `xyz${ANCHOR_SUFFIX}`));
});

test("normalizeTool", async t => {
  await t.test("v13 setzt nur onChange, v12 nur onClick", () => {
    // Beide zu setzen war der Fehler: #onChange() ruft erst onChange und
    // danach auch onClick — jeder Anlass zaehlte doppelt.
    const neu = normalizeTool(spec().tools[0], { generation: 13 });
    assert.equal(typeof neu.onChange, "function");
    assert.equal(neu.onClick, undefined);

    const alt = normalizeTool(spec().tools[0], { generation: 12 });
    assert.equal(typeof alt.onClick, "function");
    assert.equal(alt.onChange, undefined);
  });

  await t.test("ein Klick fuehrt genau einmal aus", () => {
    const aufrufe = [];
    normalizeTool(spec(aufrufe).tools[0]).onChange(toolClick("pult"), true);
    assert.deepEqual(aufrufe, ["pult"]);
  });

  await t.test("v12: ein Klick fuehrt einmal aus, das Verlassen nicht", () => {
    const aufrufe = [];
    const tool = normalizeTool(spec(aufrufe).tools[0], { generation: 12 });
    tool.onClick(true);
    tool.onClick(false);
    assert.deepEqual(aufrufe, ["pult"]);
  });

  await t.test("button ist voreingestellt an", () =>
    assert.equal(normalizeTool({ name: "t", onClick: () => {} }).button, true));

  await t.test("button: false bleibt erhalten", () =>
    assert.equal(normalizeTool({ name: "t", button: false, onClick: () => {} }).button, false));
});

test("normalizeControlGroup", async t => {
  await t.test("v13: Werkzeuge als Objekt nach Namen", () => {
    const g = normalizeControlGroup(spec(), "record");
    assert.ok(!Array.isArray(g.tools));
    assert.deepEqual(Object.keys(g.tools), [ANKER, "pult", "gruppe"]);
  });

  await t.test("v12: Werkzeuge als Array", () => {
    const g = normalizeControlGroup(spec(), "array", { generation: 12 });
    assert.ok(Array.isArray(g.tools));
    assert.deepEqual(g.tools.map(t => t.name), [ANKER, "pult", "gruppe"]);
  });

  await t.test("die Gruppe ist nie leer", () =>
    // isEmpty(control.tools) → Foundry loescht die Gruppe. Der Anker sorgt
    // dafuer, dass das nicht passiert.
    assert.equal(Object.keys(normalizeControlGroup({ name: "leer" }, "record").tools).length, 1));

  await t.test("activeTool zeigt auf den Anker", () => {
    // Es muss auf ein *vorhandenes* Werkzeug zeigen: beim Verlassen liest
    // Foundry this.tool und reicht das Ergebnis ungeprueft weiter.
    const g = normalizeControlGroup(spec(), "record");
    assert.equal(g.activeTool, ANKER);
    assert.ok(g.tools[g.activeTool], "activeTool zeigt ins Leere");
  });

  await t.test("kein Knopf ist das activeTool", () => {
    // #onChangeTool steigt bei tool === this.tool aus — ein Knopf als
    // activeTool waere tot und wuerde beim Aktivieren der Gruppe feuern.
    const g = normalizeControlGroup(spec(), "record");
    assert.equal(g.tools[g.activeTool].button, false);
    for (const [name, tool] of Object.entries(g.tools)) {
      if (tool.button) assert.notEqual(name, g.activeTool);
    }
  });

  await t.test("die Gruppe aktiviert keine Leinwandebene", () => {
    // InteractionLayer#activate() endet mit
    //   if ( control !== ui.controls.control.name ) ui.controls.activate({control});
    // Die Ebene heisst "tokens", unsere Gruppe nicht — Foundry schaltet also
    // augenblicklich auf den Token-Reiter zurueck. Eine eigene Gruppe, die
    // beim Oeffnen eine Ebene aktiviert, wirft sich selbst hinaus: der Klick
    // auf ihren Reiter sah folgenlos aus.
    assert.equal(normalizeControlGroup(spec(), "record").onChange, undefined);
    assert.equal(normalizeControlGroup(spec(), "array").onChange, undefined);
  });

  await t.test("das Aktivieren der Gruppe loest kein Werkzeug aus", () => {
    const aufrufe = [];
    const g = normalizeControlGroup(spec(aufrufe), "record");
    const ev = controlClick("aborea-combat");
    for (const tool of Object.values(g.tools)) tool.onChange?.(ev, true);
    assert.deepEqual(aufrufe, []);
  });

  await t.test("das Verlassen der Gruppe loest nichts aus", () => {
    const aufrufe = [];
    const g = normalizeControlGroup(spec(aufrufe), "record");
    const ev = controlClick("tokens");
    for (const tool of Object.values(g.tools)) tool.onChange?.(ev, false);
    assert.deepEqual(aufrufe, []);
  });

  await t.test("ein Klick loest nicht die Nachbarn aus", () => {
    const aufrufe = [];
    const g = normalizeControlGroup(spec(aufrufe), "record");
    const ev = toolClick("gruppe");
    for (const tool of Object.values(g.tools)) tool.onChange?.(ev, true);
    assert.deepEqual(aufrufe, ["gruppe"]);
  });

  await t.test("Reihenfolge wird vergeben", () => {
    const g = normalizeControlGroup(spec(), "array");
    assert.deepEqual(g.tools.map(t => t.order), [0, 1, 2]);
  });

  await t.test("die Gruppe bekommt eine Ordnung hinter Foundrys eigenen", () =>
    assert.ok(normalizeControlGroup({ name: "x" }, "record").order >= 10));

  await t.test("Werkzeuge ohne Namen fallen raus", () => {
    const g = normalizeControlGroup({ name: "x", tools: [{ title: "namenlos" }, null] }, "record");
    assert.deepEqual(Object.keys(g.tools), [`x${ANCHOR_SUFFIX}`]);
  });
});

test("addControlGroup", async t => {
  await t.test("v13: haengt sich in das Objekt", () => {
    const controls = { tokens: { name: "tokens", tools: {} } };
    assert.equal(addControlGroup(controls, spec()), true);
    assert.ok(controls["aborea-combat"]);
    assert.ok(!Array.isArray(controls["aborea-combat"].tools));
  });

  await t.test("v12: haengt sich an das Array", () => {
    const controls = [{ name: "tokens", tools: [] }];
    assert.equal(addControlGroup(controls, spec(), { generation: 12 }), true);
    assert.equal(controls.length, 2);
    assert.ok(Array.isArray(controls[1].tools));
  });

  await t.test("fremde Gruppen bleiben unberuehrt", () => {
    // Der vorige Versuch hat Foundrys Token-Gruppe veraendert — und damit die
    // Knoepfe an deren Reiter gebunden.
    const controls = { tokens: { name: "tokens", activeTool: "select", tools: { select: {} } } };
    addControlGroup(controls, spec());
    assert.deepEqual(Object.keys(controls.tokens.tools), ["select"]);
    assert.equal(controls.tokens.activeTool, "select");
  });

  await t.test("zweimal feuern verdoppelt nicht (Objekt)", () => {
    const controls = {};
    addControlGroup(controls, spec());
    assert.equal(addControlGroup(controls, spec()), false);
    assert.equal(Object.keys(controls).length, 1);
  });

  await t.test("zweimal feuern verdoppelt nicht (Array)", () => {
    const controls = [];
    addControlGroup(controls, spec());
    assert.equal(addControlGroup(controls, spec()), false);
    assert.equal(controls.length, 1);
  });

  await t.test("unbrauchbare Eingabe wird abgewiesen", () => {
    assert.equal(addControlGroup(null, spec()), false);
    assert.equal(addControlGroup(undefined, spec()), false);
    assert.equal(addControlGroup("quatsch", spec()), false);
    assert.equal(addControlGroup({}, { title: "ohne Namen" }), false);
  });
});
