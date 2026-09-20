// tests/scene-controls.test.mjs — Werkzeuggruppen in der Szenenleiste
//
// Foundry v12 und v13 erwarten unterschiedliche Formen. Alle drei
// Registrierungen im System prüften nur auf Array und erschienen unter v13
// deshalb gar nicht. Diese Tests halten beide Formen fest.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeControlGroup, addControlGroup } from "../module/scene-controls.mjs";

const spec = () => ({
  name: "aborea-combat", title: "ABOREA Kampf", icon: "fas fa-chess-board", layer: "tokens",
  tools: [
    { name: "console", title: "Pult", icon: "fas fa-a", onClick: () => "pult" },
    { name: "group",   title: "Gruppe", icon: "fas fa-b", onClick: () => "gruppe" },
  ],
});

test("normalizeControlGroup", async t => {
  await t.test("v12: tools als Array", () => {
    const g = normalizeControlGroup(spec(), "array");
    assert.ok(Array.isArray(g.tools));
    assert.deepEqual(g.tools.map(x => x.name), ["console", "group"]);
  });

  await t.test("v13: tools als Objekt nach Namen", () => {
    const g = normalizeControlGroup(spec(), "record");
    assert.ok(!Array.isArray(g.tools));
    assert.deepEqual(Object.keys(g.tools), ["console", "group"]);
    assert.equal(g.tools.console.title, "Pult");
  });

  await t.test("onClick und onChange zeigen auf dieselbe Funktion", () => {
    // v13 ruft onChange, v12 onClick. Wer nur eins setzt, hat in der anderen
    // Version einen toten Knopf.
    const g = normalizeControlGroup(spec(), "record");
    assert.equal(typeof g.tools.console.onClick, "function");
    assert.equal(typeof g.tools.console.onChange, "function");
    assert.equal(g.tools.console.onClick(), "pult");
    assert.equal(g.tools.console.onChange(), "pult");
  });

  await t.test("nur onChange gesetzt wird auf onClick gespiegelt", () => {
    const g = normalizeControlGroup({
      name: "x", tools: [{ name: "t", onChange: () => "ok" }],
    }, "array");
    assert.equal(g.tools[0].onClick(), "ok");
  });

  await t.test("erstes Werkzeug wird aktiv", () =>
    assert.equal(normalizeControlGroup(spec(), "array").activeTool, "console"));

  await t.test("vorgegebenes activeTool gewinnt", () =>
    assert.equal(normalizeControlGroup({ ...spec(), activeTool: "group" }, "array").activeTool, "group"));

  await t.test("button ist voreingestellt an", () =>
    assert.equal(normalizeControlGroup(spec(), "array").tools[0].button, true));

  await t.test("Reihenfolge wird vergeben", () => {
    const g = normalizeControlGroup(spec(), "array");
    assert.deepEqual(g.tools.map(x => x.order), [0, 1]);
  });

  await t.test("ohne Werkzeuge kein Absturz", () => {
    const g = normalizeControlGroup({ name: "leer" }, "record");
    assert.deepEqual(g.tools, {});
    assert.equal(g.activeTool, undefined);
  });
});

test("addControlGroup", async t => {
  await t.test("v12: haengt sich an das Array", () => {
    const controls = [{ name: "token", tools: [] }];
    assert.equal(addControlGroup(controls, spec()), true);
    assert.equal(controls.length, 2);
    assert.ok(Array.isArray(controls[1].tools));
  });

  await t.test("v13: haengt sich in das Objekt", () => {
    const controls = { tokens: { name: "tokens", tools: {} } };
    assert.equal(addControlGroup(controls, spec()), true);
    assert.ok(controls["aborea-combat"]);
    assert.ok(!Array.isArray(controls["aborea-combat"].tools));
  });

  await t.test("zweimal feuern verdoppelt nicht (Array)", () => {
    const controls = [];
    addControlGroup(controls, spec());
    assert.equal(addControlGroup(controls, spec()), false);
    assert.equal(controls.length, 1);
  });

  await t.test("zweimal feuern verdoppelt nicht (Objekt)", () => {
    const controls = {};
    addControlGroup(controls, spec());
    assert.equal(addControlGroup(controls, spec()), false);
    assert.equal(Object.keys(controls).length, 1);
  });

  await t.test("unbrauchbare Eingabe wird abgewiesen", () => {
    assert.equal(addControlGroup(null, spec()), false);
    assert.equal(addControlGroup(undefined, spec()), false);
    assert.equal(addControlGroup("quatsch", spec()), false);
  });
});
