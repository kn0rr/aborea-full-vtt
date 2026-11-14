// tests/image-zoom.test.mjs — Bilder vergrössern ohne Rechte am Dokument
//
// Spieler konnten Tokens und Gegenstände, die ihnen nicht gehören, nicht
// gross ansehen. Geprüft wird, was gezeigt wird (nichts, was der Benutzer
// nicht ohnehin sehen darf) und wann ein Klick vergrössert.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tokenZoomImage, zoomTitle, shouldZoomOnClick, ZOOMABLE_SELECTOR } from "../module/image-zoom.mjs";
import { ABOREA } from "../module/config.mjs";

test("tokenZoomImage: nur, was man sehen darf", async t => {
  await t.test("ohne Recht am Akteur: das Tokenbild", () =>
    assert.equal(tokenZoomImage({ tokenSrc: "tok.webp", actorImg: "portrait.webp", canSeeActor: false }), "tok.webp"));
  await t.test("mit Recht: das Porträt", () =>
    assert.equal(tokenZoomImage({ tokenSrc: "tok.webp", actorImg: "portrait.webp", canSeeActor: true }), "portrait.webp"));
  await t.test("Platzhalter-Porträt: lieber das Tokenbild", () =>
    assert.equal(tokenZoomImage({ tokenSrc: "tok.webp", actorImg: "icons/svg/mystery-man.svg", canSeeActor: true }), "tok.webp"));
  await t.test("ohne Tokenbild: was da ist", () =>
    assert.equal(tokenZoomImage({ actorImg: "portrait.webp" }), "portrait.webp"));
  await t.test("leer", () => assert.equal(tokenZoomImage(), ""));
  await t.test("Invariante: mit Tokenbild nie das Porträt ohne Recht", () => {
    for (const actorImg of ["", "geheim.webp", "icons/svg/mystery-man.svg"]) {
      assert.equal(tokenZoomImage({ tokenSrc: "tok.webp", actorImg, canSeeActor: false }), "tok.webp", actorImg);
    }
  });
});

test("zoomTitle: der Name nur, wenn er sichtbar ist", async t => {
  await t.test("sichtbar", () => assert.equal(zoomTitle({ name: "Goblin", canSeeName: true }), "Goblin"));
  await t.test("verborgen", () => assert.equal(zoomTitle({ name: "Der Verräter", canSeeName: false }), ""));
  await t.test("leer", () => assert.equal(zoomTitle(), ""));
});

test("shouldZoomOnClick: wann ein Klick vergrössert", async t => {
  await t.test("Bild in Beute oder Chat", () =>
    assert.equal(shouldZoomOnClick({ matches: true, src: "a.webp" }), true));
  await t.test("eigener, bearbeitbarer Bogen: das Bild wird gewechselt, nicht vergrössert", () =>
    assert.equal(shouldZoomOnClick({ matches: true, hasEdit: true, editable: true, src: "a.webp" }), false));
  await t.test("fremder Bogen, nur lesbar: vergrössern", () =>
    assert.equal(shouldZoomOnClick({ matches: true, hasEdit: true, editable: false, src: "a.webp" }), true));
  await t.test("andere Bilder nicht", () =>
    assert.equal(shouldZoomOnClick({ matches: false, src: "a.webp" }), false));
  await t.test("ohne Quelle nicht", () =>
    assert.equal(shouldZoomOnClick({ matches: true, src: "" }), false));
});

test("Die Bildklassen der Vorlagen sind vergrösserbar", async t => {
  // Wer einer Vorlage ein neues Bild gibt und die Klasse hier vergisst, merkt
  // es erst am Spieltisch. Diese Klassen müssen im Selektor stehen.
  const erwartet = ["loot-item-img", "loot-portrait", "profile-img", "god-img", "coin-icon", "ac-portrait", "picker-item-img"];
  for (const k of erwartet) {
    await t.test(k, () => assert.ok(ZOOMABLE_SELECTOR.includes(`img.${k}`), k));
  }
});

test("Münzbilder", async t => {
  const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  await t.test("jede Münze hat ein Bild, und die Datei existiert", () => {
    assert.deepEqual(Object.keys(ABOREA.coinIcons).sort(), ["gf", "kl", "mu", "tt"]);
    for (const [k, p] of Object.entries(ABOREA.coinIcons)) {
      assert.ok(p.startsWith("systems/aborea-v7/"), k);
      assert.ok(statSync(join(root, p.replace("systems/aborea-v7/", ""))).size > 1000, `${k}: ${p}`);
    }
  });
  await t.test("die Vorlagen lesen sie aus dem Kontext, nicht aus festen Pfaden", () => {
    const tpl = dir => readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? tpl(join(dir, f)) : [join(dir, f)]);
    const hart = tpl(join(root, "templates")).filter(f => readFileSync(f, "utf8").includes("assets/images/muenzen/"));
    assert.deepEqual(hart, []);
  });
});
