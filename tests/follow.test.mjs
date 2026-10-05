// tests/follow.test.mjs — Folgen: Wegsuche um Wände, Plätze in der Spur
//
// Die Wände kommen hier aus einer Textkarte statt aus Foundrys
// checkCollision; die Wegsuche bekommt nur "ist der Schritt a → b versperrt?"
// zu sehen und weiss nicht, woher die Antwort stammt.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  findPath, squareNeighbors, squareStepCost, squareHeuristic, lineCells,
  extendTrail, planFollow, wouldCycle, cellKey, followChanges,
} from "../module/follow.mjs";

/**
 * Karte aus Text: "#" ist Wand, alles andere frei. Ausserhalb ist Wand.
 * Ein Diagonalschritt zwischen zwei Wandecken hindurch ist versperrt — so,
 * wie Foundrys Strahl an der Ecke hängen bleibt.
 */
function karte(...zeilen) {
  const wand = (i, j) => i < 0 || j < 0 || i >= zeilen.length || j >= zeilen[0].length || zeilen[i][j] === "#";
  const blocked = (a, b) => {
    if (wand(b.i, b.j)) return true;
    if (a.i !== b.i && a.j !== b.j) return wand(a.i, b.j) || wand(b.i, a.j);
    return false;
  };
  return { wand, blocked, neighbors: c => squareNeighbors(c), cost: squareStepCost, heuristic: squareHeuristic };
}

const nachbarn = (a, b) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j)) === 1;
const kosten = path => path.slice(1).reduce((s, c, n) => s + squareStepCost(path[n], c), 0);

/** Prüft, was jeder Weg erfüllen muss: zusammenhängend, nie durch eine Wand. */
function gueltig(path, welt, start, ziel) {
  assert.deepEqual(path[0], start, "beginnt am Start");
  if (ziel) assert.deepEqual(path.at(-1), ziel, "endet am Ziel");
  for (let n = 1; n < path.length; n++) {
    assert.ok(nachbarn(path[n - 1], path[n]), `Sprung bei ${cellKey(path[n])}`);
    assert.ok(!welt.blocked(path[n - 1], path[n]), `durch die Wand bei ${cellKey(path[n])}`);
  }
}

test("findPath: Weg um Wände", async t => {
  await t.test("Start ist Ziel", () =>
    assert.deepEqual(findPath({ i: 1, j: 1 }, { i: 1, j: 1 }, karte("...")), [{ i: 1, j: 1 }]));

  await t.test("freie Fläche: gerade Linie", () => {
    const w = karte("......");
    const p = findPath({ i: 0, j: 0 }, { i: 0, j: 5 }, w);
    gueltig(p, w, { i: 0, j: 0 }, { i: 0, j: 5 });
    assert.equal(p.length, 6);
  });

  await t.test("Wand mit Lücke: der Weg geht durch die Lücke", () => {
    const w = karte(
      "...#..",
      "...#..",
      "......",
    );
    const p = findPath({ i: 0, j: 0 }, { i: 0, j: 5 }, w);
    gueltig(p, w, { i: 0, j: 0 }, { i: 0, j: 5 });
    assert.ok(p.some(c => c.i === 2 && c.j === 3), "durch die Lücke");
  });

  await t.test("Gang mit Kehre", () => {
    const w = karte(
      "S.....#....",
      "#####.#.##.",
      "......#..#.",
      ".######..#.",
      "........#Z.",
    );
    const p = findPath({ i: 0, j: 0 }, { i: 4, j: 9 }, w);
    gueltig(p, w, { i: 0, j: 0 }, { i: 4, j: 9 });
  });

  await t.test("keine Abkürzung zwischen zwei Wandecken", () => {
    const w = karte(
      ".#",
      "#.",
    );
    assert.equal(findPath({ i: 0, j: 0 }, { i: 1, j: 1 }, w), null);
  });

  await t.test("eingeschlossenes Ziel: kein Weg", () => {
    const w = karte(
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
    );
    assert.equal(findPath({ i: 0, j: 0 }, { i: 2, j: 2 }, w), null);
  });

  await t.test("Suchgrenze bricht ab statt zu hängen", () => {
    const w = { neighbors: c => squareNeighbors(c) };   // unendliche Ebene
    assert.equal(findPath({ i: 0, j: 0 }, { i: 500, j: 500 }, { ...w, maxNodes: 200 }), null);
  });

  await t.test("leere Eingaben", () => {
    assert.equal(findPath(null, { i: 0, j: 0 }, karte(".")), null);
    assert.equal(findPath({ i: 0, j: 0 }, null, karte(".")), null);
    assert.equal(findPath({ i: 0, j: 0 }, { i: 0, j: 1 }, {}), null);
  });

  await t.test("unbrauchbare Kosten werden übergangen, nicht NaN", () => {
    const w = { ...karte("..."), cost: () => NaN };
    assert.equal(findPath({ i: 0, j: 0 }, { i: 0, j: 2 }, w), null);
  });

  await t.test("die Schätzung überschätzt nie: gleiche Kosten wie ohne sie", () => {
    // Zufällige Karten mit festem Startwert. Wäre squareHeuristic zu gross,
    // fände A* längere Wege als die blinde Suche.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let runde = 0; runde < 40; runde++) {
      const zeilen = Array.from({ length: 12 }, () =>
        Array.from({ length: 12 }, () => rnd() < 0.28 ? "#" : ".").join(""));
      zeilen[0] = "." + zeilen[0].slice(1);
      zeilen[11] = zeilen[11].slice(0, 11) + ".";
      const w = karte(...zeilen);
      const mit  = findPath({ i: 0, j: 0 }, { i: 11, j: 11 }, w);
      const ohne = findPath({ i: 0, j: 0 }, { i: 11, j: 11 }, { ...w, heuristic: () => 0 });
      assert.equal(!!mit, !!ohne, `Runde ${runde}: erreichbar oder nicht`);
      if (mit) {
        gueltig(mit, w, { i: 0, j: 0 }, { i: 11, j: 11 });
        assert.equal(kosten(mit), kosten(ohne), `Runde ${runde}`);
      }
    }
  });
});

test("Raster-Hilfen", async t => {
  await t.test("acht Nachbarn, ohne Diagonalen vier", () => {
    assert.equal(squareNeighbors({ i: 0, j: 0 }).length, 8);
    assert.equal(squareNeighbors({ i: 0, j: 0 }, { diagonals: false }).length, 4);
  });
  await t.test("Diagonale kostet mehr", () => {
    assert.equal(squareStepCost({ i: 0, j: 0 }, { i: 0, j: 1 }), 1);
    assert.equal(squareStepCost({ i: 0, j: 0 }, { i: 1, j: 1 }), 1.5);
  });
  await t.test("Schätzung 0 am Ziel", () => assert.equal(squareHeuristic({ i: 3, j: 4 }, { i: 3, j: 4 }), 0));

  for (const [a, b] of [[{ i: 0, j: 0 }, { i: 0, j: 7 }], [{ i: 0, j: 0 }, { i: 5, j: 5 }],
                        [{ i: 4, j: 1 }, { i: -2, j: 9 }], [{ i: 2, j: 2 }, { i: 2, j: 2 }]]) {
    await t.test(`Linie ${cellKey(a)} → ${cellKey(b)}: zusammenhängend, mit beiden Enden`, () => {
      const l = lineCells(a, b);
      assert.deepEqual(l[0], a);
      assert.deepEqual(l.at(-1), b);
      for (let n = 1; n < l.length; n++) assert.ok(nachbarn(l[n - 1], l[n]));
      assert.equal(l.length, Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j)) + 1);
    });
  }
});

test("Spur des Anführers", async t => {
  await t.test("Wiederholungen hintereinander fallen weg", () =>
    assert.deepEqual(extendTrail([{ i: 0, j: 0 }], [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 1 }]),
      [{ i: 0, j: 0 }, { i: 0, j: 1 }]));
  await t.test("Länge begrenzt, neueste bleiben", () => {
    const cells = Array.from({ length: 10 }, (_, j) => ({ i: 0, j }));
    assert.deepEqual(extendTrail([], cells, 3), cells.slice(-3));
  });
  await t.test("Unsinn wird übergangen", () =>
    assert.deepEqual(extendTrail([], [null, { i: NaN, j: 1 }, { i: 1, j: 1 }]), [{ i: 1, j: 1 }]));
  await t.test("verändert die alte Spur nicht", () => {
    const alt = [{ i: 0, j: 0 }];
    extendTrail(alt, [{ i: 0, j: 1 }]);
    assert.equal(alt.length, 1);
  });
  await t.test("leere Eingabe", () => assert.deepEqual(extendTrail(undefined, undefined), []));
});

test("planFollow: Schlange um Hindernisse", async t => {
  const offen = karte(...Array.from({ length: 7 }, () => "............"));
  const anwenden = (folgende, plaene) =>
    folgende.map((f, n) => ({ ...f, cell: plaene[n].path.at(-1) ?? f.cell }));
  const plan = (anfuehrer, spur, folgende, welt = offen) =>
    planFollow({ leaderCell: anfuehrer, trail: spur, followers: folgende, searchFor: () => welt });

  /** Was jeder Plan erfüllen muss — unabhängig vom Szenario. */
  function invarianten(plaene, folgende, anfuehrer, welt) {
    assert.deepEqual(plaene.map(p => p.id), folgende.map(f => f.id), "Reihenfolge der Eingabe");
    const enden = plaene.map((p, n) => p.path.length ? p.path.at(-1) : folgende[n].cell);
    assert.equal(new Set(enden.map(cellKey)).size, enden.length, "kein Feld doppelt belegt");
    assert.ok(!enden.some(e => cellKey(e) === cellKey(anfuehrer)), "niemand auf dem Anführer");
    for (const [n, p] of plaene.entries()) {
      if (p.path.length) gueltig(p.path, welt, folgende[n].cell);
    }
  }

  // Der gemeldete Fehler: wer schon richtig stand, zog trotzdem um.
  await t.test("wer Anschluss hat, bleibt stehen", () => {
    const folgende = [{ id: "a", cell: { i: 3, j: 4 } }, { id: "b", cell: { i: 3, j: 3 } }];
    const plaene = plan({ i: 3, j: 5 }, [{ i: 3, j: 5 }], folgende);
    assert.deepEqual(plaene.map(p => p.path), [[], []]);
    assert.ok(plaene.every(p => !p.stuck));
  });

  await t.test("ohne Bewegung des Anführers bewegt sich beim zweiten Mal niemand", () => {
    // Stabil heisst: einmal angewendet, ist der Plan erfüllt. Hier lag das
    // Hin und Her — jede Neuplanung verteilte die Plätze anders.
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let runde = 0; runde < 60; runde++) {
      const anfuehrer = { i: 3, j: 6 };
      const belegt = new Set([cellKey(anfuehrer)]);
      const folgende = [];
      while (folgende.length < 5) {
        const c = { i: Math.floor(rnd() * 7), j: Math.floor(rnd() * 12) };
        if (belegt.has(cellKey(c))) continue;
        belegt.add(cellKey(c));
        folgende.push({ id: `f${folgende.length}`, cell: c });
      }
      const spur = extendTrail([], [{ i: 3, j: 2 }, { i: 3, j: 3 }, { i: 3, j: 4 }, { i: 3, j: 5 }, anfuehrer]);
      const erst = plan(anfuehrer, spur, folgende);
      invarianten(erst, folgende, anfuehrer, offen);
      const danach = anwenden(folgende, erst);
      const zweit = plan(anfuehrer, spur, danach);
      assert.deepEqual(zweit.map(p => p.path), danach.map(() => []), `Runde ${runde}`);
    }
  });

  // Der gemeldete Fehler: die Folgenden liefen durcheinander durch.
  await t.test("Gänsemarsch in einer Reihe: niemand überholt, jeder rückt ein Feld nach", () => {
    // Absichtlich der hintere zuerst angehakt — die Reihenfolge im Dialog
    // darf nicht bestimmen, wer vorne läuft.
    let folgende = [{ id: "hinten", cell: { i: 0, j: 3 } }, { id: "vorn", cell: { i: 0, j: 4 } }];
    let spur = extendTrail([], [0, 1, 2, 3, 4, 5].map(j => ({ i: 0, j })));
    for (let j = 6; j <= 10; j++) {
      const anfuehrer = { i: 0, j };
      spur = extendTrail(spur, [anfuehrer]);
      const plaene = plan(anfuehrer, spur, folgende);
      invarianten(plaene, folgende, anfuehrer, offen);
      folgende = anwenden(folgende, plaene);
      assert.deepEqual(folgende.find(f => f.id === "vorn").cell,   { i: 0, j: j - 1 }, `Schritt ${j}`);
      assert.deepEqual(folgende.find(f => f.id === "hinten").cell, { i: 0, j: j - 2 }, `Schritt ${j}`);
    }
  });

  await t.test("kein Weg führt über das Feld eines Stehenbleibenden", () => {
    const folgende = [{ id: "hinten", cell: { i: 0, j: 1 } }, { id: "vorn", cell: { i: 0, j: 3 } }];
    const plaene = plan({ i: 0, j: 4 }, extendTrail([], [0, 1, 2, 3, 4].map(j => ({ i: 0, j }))), folgende);
    const bleibt = new Set(plaene.filter(p => !p.path.length).map(p => cellKey(folgende.find(f => f.id === p.id).cell)));
    assert.ok(bleibt.size > 0, "vorn bleibt stehen");
    for (const p of plaene) assert.ok(!p.path.slice(1).some(c => bleibt.has(cellKey(c))), p.id);
  });

  await t.test("der Anführer kehrt um: wer Anschluss hat, bleibt", () => {
    const folgende = [{ id: "a", cell: { i: 0, j: 7 } }, { id: "b", cell: { i: 0, j: 6 } }];
    const spur = extendTrail([], [5, 6, 7, 8, 9].map(j => ({ i: 0, j })));
    const plaene = plan({ i: 0, j: 8 }, extendTrail(spur, [{ i: 0, j: 8 }]), folgende);
    assert.deepEqual(plaene.map(p => p.path), [[], []]);
  });

  await t.test("tritt der Anführer auf einen Folgenden, weicht der aus", () => {
    const folgende = [{ id: "a", cell: { i: 0, j: 7 } }];
    const plaene = plan({ i: 0, j: 7 }, extendTrail([], [{ i: 0, j: 8 }, { i: 0, j: 7 }]), folgende);
    invarianten(plaene, folgende, { i: 0, j: 7 }, offen);
    assert.deepEqual(plaene[0].path.at(-1), { i: 0, j: 8 }, "dorthin, wo der Anführer herkam");
  });

  await t.test("Folgender hinter einer Wand sucht sich den Weg herum", () => {
    const w = karte(
      "......",
      ".####.",
      "......",
    );
    const anfuehrer = { i: 0, j: 3 };
    const spur = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 0, j: 3 }];
    const folgende = [{ id: "a", cell: { i: 2, j: 2 } }];
    const [p] = plan(anfuehrer, spur, folgende, w);
    invarianten([p], folgende, anfuehrer, w);
    assert.deepEqual(p.path.at(-1), { i: 0, j: 2 }, "auf die Spur des Anführers");
    assert.equal(p.stuck, false);
  });

  await t.test("Nachbar hinter einer Wand zählt nicht als Anschluss", () => {
    // Direkt unter dem Anführer, aber eine Wand dazwischen und kein Weg herum.
    const w = karte(
      "...",
      "###",
      "...",
    );
    const [p] = plan({ i: 0, j: 1 }, [{ i: 0, j: 1 }], [{ id: "a", cell: { i: 2, j: 1 } }], w);
    assert.equal(p.stuck, true);
  });

  await t.test("eingeschlossener Folgender bleibt stehen und meldet es", () => {
    const w = karte(
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
    );
    const [p] = plan({ i: 0, j: 4 }, [{ i: 0, j: 3 }, { i: 0, j: 4 }], [{ id: "a", cell: { i: 2, j: 2 } }], w);
    assert.deepEqual(p.path, []);
    assert.equal(p.stuck, true);
  });

  await t.test("Gang: die Schlange bleibt in der Spur", () => {
    const w = karte(
      "##########",
      "..........",
      "##########",
    );
    let folgende = [{ id: "a", cell: { i: 1, j: 1 } }, { id: "b", cell: { i: 1, j: 0 } }];
    let spur = extendTrail([], [{ i: 1, j: 0 }, { i: 1, j: 1 }, { i: 1, j: 2 }]);
    for (let j = 3; j <= 9; j++) {
      const anfuehrer = { i: 1, j };
      spur = extendTrail(spur, [anfuehrer]);
      const plaene = plan(anfuehrer, spur, folgende, w);
      invarianten(plaene, folgende, anfuehrer, w);
      folgende = anwenden(folgende, plaene);
    }
    assert.deepEqual(folgende.map(f => f.cell), [{ i: 1, j: 8 }, { i: 1, j: 7 }]);
  });

  await t.test("viele Folgende, zufällige Karten: Invarianten halten, zweiter Plan ist leer", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let runde = 0; runde < 80; runde++) {
      const zeilen = Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => rnd() < 0.2 ? "#" : ".").join(""));
      const w = karte(...zeilen);
      const frei = [];
      for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (!w.wand(i, j)) frei.push({ i, j });
      const anfuehrer = frei[Math.floor(rnd() * frei.length)];
      const rest = frei.filter(c => cellKey(c) !== cellKey(anfuehrer));
      const folgende = Array.from({ length: 6 }, (_, n) => ({ id: `f${n}`, cell: rest[(n * 7 + runde * 3) % rest.length] }));
      if (new Set(folgende.map(f => cellKey(f.cell))).size < folgende.length) continue;
      const spur = extendTrail([], [rest[0], rest[1], anfuehrer]);
      const erst = plan(anfuehrer, spur, folgende, w);
      invarianten(erst, folgende, anfuehrer, w);
      // Wer angekommen ist, ist danach zufrieden.
      const danach = anwenden(folgende, erst);
      const zweit = plan(anfuehrer, spur, danach, w);
      for (const [n, p] of zweit.entries()) {
        if (!erst[n].stuck && !zweit[n].stuck) assert.deepEqual(p.path, [], `Runde ${runde}, ${p.id}`);
      }
    }
  });

  await t.test("ohne Folgende: nichts zu tun", () =>
    assert.deepEqual(plan({ i: 0, j: 0 }, [], []), []));
});

test("wouldCycle: Ketten ja, Kreise nein", async t => {
  await t.test("sich selbst folgen", () => assert.equal(wouldCycle(new Map(), "a", "a"), true));
  await t.test("direkter Kreis", () => assert.equal(wouldCycle(new Map([["b", "a"]]), "a", "b"), true));
  await t.test("langer Kreis", () =>
    assert.equal(wouldCycle(new Map([["b", "c"], ["c", "d"], ["d", "a"]]), "a", "b"), true));
  await t.test("Kette ist erlaubt", () =>
    assert.equal(wouldCycle(new Map([["b", "c"]]), "a", "b"), false));
  await t.test("fremder Kreis hängt nicht", () =>
    assert.equal(wouldCycle(new Map([["x", "y"], ["y", "x"]]), "a", "x"), false));
  await t.test("als einfaches Objekt", () => assert.equal(wouldCycle({ b: "a" }, "a", "b"), true));
});

test("followChanges: was der Folgen-Dialog bewirkt", async t => {
  const szene = (...tokens) => tokens.map(([id, leader, order]) => ({ id, leader, order }));
  const ids = l => l.map(x => x.id ?? x);

  await t.test("neue Folgende kommen in der Reihenfolge der Szene", () => {
    const r = followChanges({ tokens: szene(["L"], ["a"], ["b"]), leaderId: "L", chosenIds: ["b", "a"] });
    assert.deepEqual(r.set, [{ id: "a", order: 0 }, { id: "b", order: 1 }]);
    assert.deepEqual(r.unset, []);
  });

  await t.test("hinten angehaengt, wer schon folgt bleibt unveraendert", () => {
    const r = followChanges({ tokens: szene(["L"], ["a", "L", 0], ["b", "L", 3], ["c"]),
                              leaderId: "L", chosenIds: ["a", "b", "c"] });
    assert.deepEqual(r.set, [{ id: "c", order: 4 }]);
    assert.deepEqual(r.unset, []);
  });

  await t.test("abgehakt heisst: folgt niemandem mehr", () => {
    const r = followChanges({ tokens: szene(["L"], ["a", "L", 0], ["b", "L", 1]), leaderId: "L", chosenIds: ["b"] });
    assert.deepEqual(r.unset, ["a"]);
    assert.deepEqual(r.set, []);
  });

  await t.test("nichts angehakt: alle los", () =>
    assert.deepEqual(followChanges({ tokens: szene(["L"], ["a", "L", 0]), leaderId: "L", chosenIds: [] }).unset, ["a"]));

  await t.test("wer einem anderen folgte, wechselt", () => {
    const r = followChanges({ tokens: szene(["L"], ["M"], ["a", "M", 0]), leaderId: "L", chosenIds: ["a"] });
    assert.deepEqual(ids(r.set), ["a"]);
  });

  await t.test("die Folgenden eines anderen Anfuehrers werden nicht angefasst", () => {
    const r = followChanges({ tokens: szene(["L"], ["M"], ["a", "M", 0]), leaderId: "L", chosenIds: [] });
    assert.deepEqual(r.unset, []);
  });

  await t.test("der Anfuehrer selbst ist nie dabei", () =>
    assert.deepEqual(followChanges({ tokens: szene(["L"], ["a"]), leaderId: "L", chosenIds: ["L", "a"] }).set,
      [{ id: "a", order: 0 }]));

  await t.test("Kreis wird abgelehnt: L folgt a, a soll L folgen", () => {
    const r = followChanges({ tokens: szene(["L", "a", 0], ["a"]), leaderId: "L", chosenIds: ["a"] });
    assert.deepEqual(r.refused, ["a"]);
    assert.deepEqual(r.set, []);
  });

  await t.test("Kette ist erlaubt: a folgt L, b folgt a", () => {
    const r = followChanges({ tokens: szene(["L"], ["a", "L", 0], ["b"]), leaderId: "a", chosenIds: ["b"] });
    assert.deepEqual(ids(r.set), ["b"]);
    assert.deepEqual(r.refused, []);
  });

  await t.test("Invariante: nach dem Anwenden folgen genau die Angehakten", () => {
    const tokens = szene(["L"], ["a", "L", 0], ["b", "M", 0], ["c"], ["M"], ["d", "L", 1]);
    for (const chosen of [[], ["a"], ["b", "c"], ["a", "b", "c", "d", "M"], ["d"]]) {
      const r = followChanges({ tokens, leaderId: "L", chosenIds: chosen });
      const nachher = new Map(tokens.filter(x => x.leader).map(x => [x.id, x.leader]));
      for (const id of r.unset) nachher.delete(id);
      for (const { id } of r.set) nachher.set(id, "L");
      const folgen = [...nachher].filter(([, l]) => l === "L").map(([id]) => id).sort();
      assert.deepEqual(folgen, chosen.filter(id => !r.refused.includes(id)).sort(), String(chosen));
    }
  });

  await t.test("leere Eingaben", () =>
    assert.deepEqual(followChanges({ leaderId: "L" }), { set: [], unset: [], refused: [] }));
});
