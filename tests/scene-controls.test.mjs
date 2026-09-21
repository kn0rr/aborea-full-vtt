// tests/scene-controls.test.mjs — eigene Werkzeuge in der Szenenleiste
//
// Zwei Fehlerklassen hängen hier zusammen:
//
//   1. Foundry v12 und v13 erwarten unterschiedliche Formen. Die
//      Registrierungen prüften nur auf Array und erschienen unter v13 gar
//      nicht.
//   2. Danach gingen die Fenster mehrfach auf. Foundry ruft die Rückmeldung
//      eines Werkzeugs in mehreren Lagen auf, und nur eine ist ein Klick
//      darauf.
//
// Die Aufruflagen stammen aus client/applications/ui/scene-controls.mjs der
// v13.351 und sind hier als Attrappe nachgebaut — nicht um Foundry
// nachzubilden, sondern um die Regel festzuhalten: ein Klick, ein Fenster.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTool, addControlTools, findControlGroup, isToolInvocation }
  from "../module/scene-controls.mjs";

const werkzeuge = (aufrufe = null) => [
  { name: "aborea-pult", title: "Pult", icon: "fas fa-a", order: 90,
    onClick: () => { aufrufe?.push("pult"); return "pult"; } },
  { name: "aborea-gruppe", title: "Gruppe", icon: "fas fa-b", order: 91,
    onClick: () => { aufrufe?.push("gruppe"); return "gruppe"; } },
];

/** So sieht die Token-Gruppe unter v13 aus: Werkzeuge als Objekt. */
const v13Controls = () => ({
  tokens: { name: "tokens", activeTool: "select", tools: { select: { name: "select" } } },
  sounds: { name: "sounds", activeTool: "sound",  tools: { sound:  { name: "sound"  } } },
});
/** Und unter v12: alles als Array. */
const v12Controls = () => ([
  { name: "tokens", activeTool: "select", tools: [{ name: "select" }] },
]);

/** Klickereignis auf einen Werkzeugknopf, so wie Foundry es weiterreicht. */
const toolClick    = name => ({ target: { dataset: { tool: name, action: "tool" } } });
/** Klickereignis auf das Gruppensymbol. */
const controlClick = name => ({ target: { dataset: { control: name, action: "control" } } });

test("isToolInvocation: nur der Klick auf den Knopf zaehlt", async t => {
  await t.test("Klick auf den Knopf", () =>
    assert.equal(isToolInvocation("aborea-pult", toolClick("aborea-pult"), true), true));

  await t.test("Klick auf das Gruppensymbol nicht", () =>
    // #postActivate ruft beim Aktivieren einer Gruppe deren activeTool auf.
    assert.equal(isToolInvocation("aborea-pult", controlClick("tokens"), true), false));

  await t.test("Klick auf ein anderes Werkzeug nicht", () =>
    assert.equal(isToolInvocation("aborea-pult", toolClick("aborea-gruppe"), true), false));

  await t.test("active = false nie", () => {
    // #preActivate ruft beim Verlassen einer Gruppe deren bisheriges Werkzeug
    // mit false auf. Das war der Fall "ich klicke das eine an und beide
    // gehen auf".
    assert.equal(isToolInvocation("aborea-pult", toolClick("aborea-pult"), false), false);
    assert.equal(isToolInvocation("aborea-pult", controlClick("x"), false), false);
    assert.equal(isToolInvocation("aborea-pult", null, false), false);
  });

  await t.test("ohne Ereignis wird ausgefuehrt", () => {
    // Foundry legt bei programmatischer Aktivierung ein leeres Ereignis an.
    // Lieber einmal zu viel als ein toter Knopf.
    assert.equal(isToolInvocation("aborea-pult", null, true), true);
    assert.equal(isToolInvocation("aborea-pult", undefined, true), true);
    assert.equal(isToolInvocation("aborea-pult", { target: null }, true), true);
    assert.equal(isToolInvocation("aborea-pult", {}, undefined), true);
  });
});

test("normalizeTool", async t => {
  await t.test("v13 setzt nur onChange, v12 nur onClick", () => {
    // Beide zu setzen war der Fehler: #onChange() ruft erst onChange und
    // danach auch onClick — jeder Anlass zaehlte doppelt.
    const neu = normalizeTool(werkzeuge()[0], { generation: 13 });
    assert.equal(typeof neu.onChange, "function");
    assert.equal(neu.onClick, undefined);

    const alt = normalizeTool(werkzeuge()[0], { generation: 12 });
    assert.equal(typeof alt.onClick, "function");
    assert.equal(alt.onChange, undefined);
  });

  await t.test("ein Klick fuehrt genau einmal aus", () => {
    const aufrufe = [];
    const t0 = normalizeTool(werkzeuge(aufrufe)[0]);
    t0.onChange(toolClick("aborea-pult"), true);
    assert.deepEqual(aufrufe, ["pult"]);
  });

  await t.test("das Aktivieren der Gruppe fuehrt nichts aus", () => {
    const aufrufe = [];
    normalizeTool(werkzeuge(aufrufe)[0]).onChange(controlClick("tokens"), true);
    assert.deepEqual(aufrufe, []);
  });

  await t.test("das Verlassen der Gruppe fuehrt nichts aus", () => {
    const aufrufe = [];
    normalizeTool(werkzeuge(aufrufe)[0]).onChange(controlClick("tokens"), false);
    assert.deepEqual(aufrufe, []);
  });

  await t.test("ein Klick loest nicht die Nachbarn aus", () => {
    const aufrufe = [];
    const tools = werkzeuge(aufrufe).map(w => normalizeTool(w));
    const ev = toolClick("aborea-gruppe");
    for (const tool of tools) tool.onChange(ev, true);
    assert.deepEqual(aufrufe, ["gruppe"]);
  });

  await t.test("v12: ein Klick fuehrt einmal aus", () => {
    const aufrufe = [];
    normalizeTool(werkzeuge(aufrufe)[0], { generation: 12 }).onClick(true);
    assert.deepEqual(aufrufe, ["pult"]);
  });

  await t.test("v12: das Verlassen fuehrt nichts aus", () => {
    const aufrufe = [];
    normalizeTool(werkzeuge(aufrufe)[0], { generation: 12 }).onClick(false);
    assert.deepEqual(aufrufe, []);
  });

  await t.test("ein Werkzeug, das nur onChange mitbringt", () => {
    let gelaufen = 0;
    const tool = normalizeTool({ name: "t", onChange: () => { gelaufen++; } });
    tool.onChange(toolClick("t"), true);
    assert.equal(gelaufen, 1);
  });

  await t.test("ein Werkzeug ganz ohne Rueckmeldung stuerzt nicht ab", () => {
    const tool = normalizeTool({ name: "t" });
    assert.doesNotThrow(() => tool.onChange(toolClick("t"), true));
  });

  await t.test("button ist voreingestellt an", () =>
    assert.equal(normalizeTool({ name: "t" }).button, true));

  await t.test("Reihenfolge steht hinter Foundrys eigenen", () =>
    // Foundrys Werkzeuge nummerieren ab 1; unsere sollen darunter stehen.
    assert.ok(normalizeTool({ name: "t" }).order >= 10));
});

test("findControlGroup", async t => {
  await t.test("v13: Objekt nach Namen", () =>
    assert.equal(findControlGroup(v13Controls(), "tokens").name, "tokens"));
  await t.test("v12: Array", () =>
    assert.equal(findControlGroup(v12Controls(), "tokens").name, "tokens"));
  await t.test("unbekannte Gruppe", () => {
    assert.equal(findControlGroup(v13Controls(), "gibtsnicht"), null);
    assert.equal(findControlGroup(v12Controls(), "gibtsnicht"), null);
  });
  await t.test("unbrauchbare Eingabe", () => {
    assert.equal(findControlGroup(null, "tokens"), null);
    assert.equal(findControlGroup("quatsch", "tokens"), null);
    assert.equal(findControlGroup(undefined, "tokens"), null);
  });
});

test("addControlTools", async t => {
  await t.test("v13: haengt sich in die vorhandene Gruppe", () => {
    const controls = v13Controls();
    assert.deepEqual(addControlTools(controls, "tokens", werkzeuge()),
      ["aborea-pult", "aborea-gruppe"]);
    assert.deepEqual(Object.keys(controls.tokens.tools),
      ["select", "aborea-pult", "aborea-gruppe"]);
  });

  await t.test("Foundrys activeTool bleibt unangetastet", () => {
    // Der springende Punkt: eine eigene Gruppe muesste eins unserer
    // Werkzeuge zum activeTool machen — und das feuert beim Umschalten mit
    // und ist als Knopf zugleich tot.
    const controls = v13Controls();
    addControlTools(controls, "tokens", werkzeuge());
    assert.equal(controls.tokens.activeTool, "select");
  });

  await t.test("v12: haengt sich an das Array", () => {
    const controls = v12Controls();
    addControlTools(controls, "tokens", werkzeuge(), { generation: 12 });
    assert.deepEqual(controls[0].tools.map(t => t.name),
      ["select", "aborea-pult", "aborea-gruppe"]);
    assert.equal(typeof controls[0].tools[1].onClick, "function");
  });

  await t.test("zweimal feuern verdoppelt nicht (Objekt)", () => {
    const controls = v13Controls();
    addControlTools(controls, "tokens", werkzeuge());
    assert.deepEqual(addControlTools(controls, "tokens", werkzeuge()), []);
    assert.equal(Object.keys(controls.tokens.tools).length, 3);
  });

  await t.test("zweimal feuern verdoppelt nicht (Array)", () => {
    const controls = v12Controls();
    addControlTools(controls, "tokens", werkzeuge(), { generation: 12 });
    assert.deepEqual(addControlTools(controls, "tokens", werkzeuge(), { generation: 12 }), []);
    assert.equal(controls[0].tools.length, 3);
  });

  await t.test("fehlende Gruppe ergaenzt nichts", () =>
    assert.deepEqual(addControlTools(v13Controls(), "gibtsnicht", werkzeuge()), []));

  await t.test("andere Gruppen bleiben unberuehrt", () => {
    const controls = v13Controls();
    addControlTools(controls, "tokens", werkzeuge());
    assert.deepEqual(Object.keys(controls.sounds.tools), ["sound"]);
  });

  await t.test("Gruppe ohne tools bekommt welche", () => {
    const controls = { tokens: { name: "tokens" } };
    addControlTools(controls, "tokens", werkzeuge());
    assert.deepEqual(Object.keys(controls.tokens.tools), ["aborea-pult", "aborea-gruppe"]);
  });

  await t.test("Werkzeuge ohne Namen fallen raus", () => {
    const controls = v13Controls();
    assert.deepEqual(addControlTools(controls, "tokens", [{ title: "namenlos" }, null]), []);
    assert.deepEqual(Object.keys(controls.tokens.tools), ["select"]);
  });

  await t.test("unbrauchbare Eingabe wird abgewiesen", () => {
    assert.deepEqual(addControlTools(null, "tokens", werkzeuge()), []);
    assert.deepEqual(addControlTools(undefined, "tokens", werkzeuge()), []);
    assert.deepEqual(addControlTools("quatsch", "tokens", werkzeuge()), []);
    assert.deepEqual(addControlTools(v13Controls(), "tokens"), []);
  });
});
