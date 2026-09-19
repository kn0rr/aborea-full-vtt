// tests/pack-builder.test.mjs — Schutz manueller Kompendium-Änderungen
//
// Eine Regression hier löscht oder überschreibt Arbeit des Spielleiters im
// Kompendium, ohne dass es auffällt. Genau das ist in cff130d und aa5fd0b
// schon einmal passiert.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { sourceFlag, normalizeDocs, protectManualImg } from "../module/system-pack-builder.mjs";

test("sourceFlag identifiziert einen Eintrag stabil", async t => {
  await t.test("bestehendes Flag gewinnt", () =>
    assert.equal(sourceFlag({ flags: { "aborea-v7": { sourceId: "x" } }, _id: "y", name: "z" }), "x"));
  await t.test("sonst externalId", () =>
    assert.equal(sourceFlag({ system: { externalId: "e" }, _id: "y", name: "z" }), "e"));
  await t.test("sonst _id", () => assert.equal(sourceFlag({ _id: "y", name: "z" }), "y"));
  await t.test("zuletzt der Name", () => assert.equal(sourceFlag({ name: "z" }), "z"));
});

test("normalizeDocs merkt sich das Quellbild", async t => {
  await t.test("sourceId und sourceImg werden gesetzt", () => {
    const [doc] = normalizeDocs([{ name: "Dolch", img: "a.webp", system: { externalId: "dolch" } }]);
    assert.equal(doc.flags["aborea-v7"].sourceId, "dolch");
    assert.equal(doc.flags["aborea-v7"].sourceImg, "a.webp");
  });
  await t.test("ohne Bild ist sourceImg null, nicht undefined", () => {
    // Der Unterschied zählt: protectManualImg unterscheidet "nie importiert"
    // (undefined) von "importiert, hatte kein Bild" (null).
    const [doc] = normalizeDocs([{ name: "X" }]);
    assert.equal(doc.flags["aborea-v7"].sourceImg, null);
  });
  await t.test("Eingabe wird nicht verändert", () => {
    const eingabe = { name: "X", img: "a.webp" };
    normalizeDocs([eingabe]);
    assert.equal(eingabe.flags, undefined);
  });
  await t.test("sort wird vergeben, vorhandenes bleibt", () => {
    const docs = normalizeDocs([{ name: "A" }, { name: "B" }, { name: "C", sort: 42 }]);
    assert.equal(docs[0].sort, 1000);
    assert.equal(docs[1].sort, 2000);
    assert.equal(docs[2].sort, 42);
  });
});

test("protectManualImg", async t => {
  const vorhanden = (img, sourceImg) => ({
    img,
    flags: sourceImg === undefined ? {} : { "aborea-v7": { sourceImg } },
  });

  await t.test("manuell gesetztes Bild überlebt den Re-Import", () => {
    // Quelle sagt neu.webp, im Pack steht eigenes.webp, zuletzt importiert
    // war alt.webp -> der Spielleiter hat es geändert.
    const payload = protectManualImg({ img: "neu.webp" }, vorhanden("eigenes.webp", "alt.webp"));
    assert.equal(payload.img, "eigenes.webp");
  });

  await t.test("unverändertes Bild wird aktualisiert", () => {
    const payload = protectManualImg({ img: "neu.webp" }, vorhanden("alt.webp", "alt.webp"));
    assert.equal(payload.img, "neu.webp");
  });

  await t.test("Alt-Bestand ohne Flag bekommt das Quellbild", () => {
    const payload = protectManualImg({ img: "neu.webp" }, vorhanden("irgendwas.webp", undefined));
    assert.equal(payload.img, "neu.webp");
  });

  await t.test("Eintrag ganz ohne Bild bekommt das Quellbild", () => {
    const payload = protectManualImg({ img: "neu.webp" }, vorhanden("", null));
    assert.equal(payload.img, "neu.webp");
  });

  await t.test("zweiter Re-Import hält das manuelle Bild weiterhin", () => {
    // Nach dem ersten Schutzlauf steht im Pack eigenes.webp mit sourceImg
    // neu.webp; auch eine erneut geänderte Quelle darf es nicht ersetzen.
    const payload = protectManualImg({ img: "noch_neuer.webp" }, vorhanden("eigenes.webp", "neu.webp"));
    assert.equal(payload.img, "eigenes.webp");
  });
});
