// tests/windows.test.mjs — Fenster, die es nur einmal geben darf
//
// Soundboard und Kreaturenauswahl gingen bei jedem Klick erneut auf. Geprüft
// wird die Regel, nicht die Oberfläche: bei einem offenen Fenster entsteht
// kein zweites, bei einem geschlossenen schon.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { windowState, focusWindow, openOnce, forgetWindow } from "../module/windows.mjs";

/** Fenster-Attrappe mit dem, woran die Registratur sich orientiert. */
const fakeWindow = (rendered = true) => {
  const app = { rendered, fronted: 0, topped: 0 };
  app.bringToFront = () => { app.fronted++; };
  app.bringToTop   = () => { app.topped++; };
  return app;
};

test("windowState", async t => {
  await t.test("leerer Platz", () => {
    assert.equal(windowState(undefined), "free");
    assert.equal(windowState(null), "free");
  });
  await t.test("im Aufbau", () =>
    assert.equal(windowState({ app: null, pending: true }), "pending"));
  await t.test("offen", () =>
    assert.equal(windowState({ app: fakeWindow(true) }), "open"));
  await t.test("geschlossen gibt die Kennung frei", () =>
    // Ein geschlossenes Fenster bleibt als Objekt bestehen. Würde es die
    // Kennung behalten, liesse es sich nie wieder öffnen.
    assert.equal(windowState({ app: fakeWindow(false) }), "free"));
});

test("focusWindow", async t => {
  await t.test("ruft beide Varianten", () => {
    const app = fakeWindow();
    assert.equal(focusWindow(app), true);
    assert.equal(app.fronted, 1);
    assert.equal(app.topped, 1);
  });
  await t.test("ohne Fenster kein Absturz", () => assert.equal(focusWindow(null), false));
  await t.test("Fenster ohne diese Methoden", () =>
    assert.equal(focusWindow({ rendered: true }), true));
});

test("openOnce", async t => {
  await t.test("erster Aufruf legt an", async () => {
    const reg = new Map();
    let gebaut = 0;
    const { created, app } = await openOnce("k", () => { gebaut++; return fakeWindow(); }, reg);
    assert.equal(created, true);
    assert.equal(gebaut, 1);
    assert.ok(app);
  });

  await t.test("zweiter Aufruf legt nichts an und holt nach vorn", async () => {
    const reg = new Map();
    let gebaut = 0;
    const factory = () => { gebaut++; return fakeWindow(); };
    const first = await openOnce("k", factory, reg);
    const second = await openOnce("k", factory, reg);
    assert.equal(gebaut, 1);
    assert.equal(second.created, false);
    assert.equal(second.app, first.app);
    assert.equal(first.app.fronted, 1);
  });

  await t.test("nach dem Schliessen geht es wieder auf", async () => {
    const reg = new Map();
    let gebaut = 0;
    const factory = () => { gebaut++; return fakeWindow(); };
    const { app } = await openOnce("k", factory, reg);
    app.rendered = false;                       // Benutzer schliesst es
    const again = await openOnce("k", factory, reg);
    assert.equal(again.created, true);
    assert.equal(gebaut, 2);
  });

  await t.test("zwei Klicks waehrend des Ladens ergeben ein Fenster", async () => {
    // Der eigentliche Fall: das Soundboard laedt erst Gruppen und
    // Voreinstellungen. Ein Test auf `rendered` allein sieht in dieser Zeit
    // kein offenes Fenster — und zieht ein zweites auf.
    const reg = new Map();
    let gebaut = 0;
    const langsam = async () => {
      await new Promise(r => setTimeout(r, 5));
      gebaut++;
      return fakeWindow();
    };
    const [a, b] = await Promise.all([
      openOnce("k", langsam, reg),
      openOnce("k", langsam, reg),
    ]);
    assert.equal(gebaut, 1);
    assert.equal([a.created, b.created].filter(Boolean).length, 1);
  });

  await t.test("verschiedene Kennungen stoeren sich nicht", async () => {
    const reg = new Map();
    const a = await openOnce("a", () => fakeWindow(), reg);
    const b = await openOnce("b", () => fakeWindow(), reg);
    assert.equal(a.created, true);
    assert.equal(b.created, true);
    assert.equal(reg.size, 2);
  });

  await t.test("Fabrik ohne Ergebnis belegt die Kennung nicht", async () => {
    // Der Kreaturen-Dialog gibt null zurueck, wenn das Kompendium fehlt.
    // Bliebe die Reservierung stehen, liesse er sich nie wieder oeffnen.
    const reg = new Map();
    const r = await openOnce("k", () => null, reg);
    assert.equal(r.created, true);
    assert.equal(r.app, null);
    assert.equal(reg.has("k"), false);
  });

  await t.test("Fehler in der Fabrik gibt die Kennung frei", async () => {
    const reg = new Map();
    await assert.rejects(() => openOnce("k", () => { throw new Error("kaputt"); }, reg));
    assert.equal(reg.has("k"), false);
    const zweiter = await openOnce("k", () => fakeWindow(), reg);
    assert.equal(zweiter.created, true);
  });
});

test("forgetWindow", async t => {
  await t.test("entfernt den Eintrag", async () => {
    const reg = new Map();
    await openOnce("k", () => fakeWindow(), reg);
    assert.equal(forgetWindow("k", reg), true);
    assert.equal(reg.has("k"), false);
  });
  await t.test("unbekannte Kennung", () =>
    assert.equal(forgetWindow("gibtsnicht", new Map()), false));
});
