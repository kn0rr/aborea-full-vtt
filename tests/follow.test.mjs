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
  extendTrail, followSlots, nearbyCells, planFollow, wouldCycle, cellKey,
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

test("Plätze hinter dem Anführer", async t => {
  const spur = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 0, j: 3 }];
  const anfuehrer = { i: 0, j: 3 };

  await t.test("rückwärts, ohne das Feld des Anführers", () =>
    assert.deepEqual(followSlots(spur, anfuehrer, 2), [{ i: 0, j: 2 }, { i: 0, j: 1 }]));
  await t.test("kurze Spur gibt weniger Plätze", () =>
    assert.equal(followSlots(spur, anfuehrer, 9).length, 3));
  await t.test("kein Feld doppelt, auch wenn der Anführer im Kreis geht", () => {
    const kreis = [...spur, { i: 1, j: 3 }, { i: 1, j: 2 }, { i: 0, j: 2 }, { i: 0, j: 3 }];
    const s = followSlots(kreis, anfuehrer, 9);
    assert.equal(new Set(s.map(cellKey)).size, s.length);
    assert.ok(!s.some(c => cellKey(c) === cellKey(anfuehrer)));
  });
  await t.test("null Folgende: keine Plätze", () => assert.deepEqual(followSlots(spur, anfuehrer, 0), []));
});

test("nearbyCells: nächste freie, erreichbare Felder", async t => {
  const w = karte(
    ".....",
    ".###.",
    ".#.#.",
    ".###.",
  );
  await t.test("nicht hinter die Wand", () => {
    const c = nearbyCells({ i: 0, j: 2 }, 20, w);
    assert.ok(!c.some(x => x.i === 2 && x.j === 2), "Innenraum ist unerreichbar");
    assert.ok(!c.some(x => w.wand(x.i, x.j)));
  });
  await t.test("ausgeschlossene Felder fehlen", () => {
    const c = nearbyCells({ i: 0, j: 2 }, 3, { ...w, exclude: new Set(["0,1"]) });
    assert.ok(!c.some(x => cellKey(x) === "0,1"));
    assert.equal(c.length, 3);
  });
  await t.test("das Startfeld selbst nie", () =>
    assert.ok(!nearbyCells({ i: 0, j: 2 }, 5, w).some(x => cellKey(x) === "0,2")));
});

test("planFollow: Gänsemarsch um Hindernisse", async t => {
  /** Was jeder Plan erfüllen muss — unabhängig vom Szenario. */
  function invarianten(plaene, folgende, anfuehrer, welt) {
    const enden = plaene.map((p, n) => p.path.length ? p.path.at(-1) : folgende[n].cell);
    assert.equal(new Set(enden.map(cellKey)).size, enden.length, "kein Feld doppelt belegt");
    assert.ok(!enden.some(e => cellKey(e) === cellKey(anfuehrer)), "niemand auf dem Anführer");
    for (const [n, p] of plaene.entries()) {
      if (p.path.length) gueltig(p.path, welt, folgende[n].cell);
    }
  }

  await t.test("in einer Reihe hinter dem Anführer", () => {
    const w = karte("..........");
    const anfuehrer = { i: 0, j: 9 };
    const spur = Array.from({ length: 10 }, (_, j) => ({ i: 0, j }));
    const folgende = [{ id: "a", cell: { i: 0, j: 0 } }, { id: "b", cell: { i: 0, j: 1 } }];
    const plaene = planFollow({ leaderCell: anfuehrer, trail: spur, followers: folgende, searchFor: () => w });
    invarianten(plaene, folgende, anfuehrer, w);
    assert.deepEqual(plaene[0].path.at(-1), { i: 0, j: 8 });
    assert.deepEqual(plaene[1].path.at(-1), { i: 0, j: 7 });
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
    const [p] = planFollow({ leaderCell: anfuehrer, trail: spur, followers: folgende, searchFor: () => w });
    invarianten([p], folgende, anfuehrer, w);
    assert.deepEqual(p.path.at(-1), { i: 0, j: 2 });
    assert.equal(p.stuck, false);
  });

  await t.test("eingeschlossener Folgender bleibt stehen und meldet es", () => {
    const w = karte(
      ".....",
      ".###.",
      ".#.#.",
      ".###.",
    );
    const folgende = [{ id: "a", cell: { i: 2, j: 2 } }];
    const [p] = planFollow({ leaderCell: { i: 0, j: 4 }, trail: [{ i: 0, j: 3 }, { i: 0, j: 4 }],
                             followers: folgende, searchFor: () => w });
    assert.deepEqual(p.path, []);
    assert.equal(p.stuck, true);
  });

  await t.test("wer schon auf seinem Platz steht, bleibt — ohne Meldung", () => {
    const w = karte("....");
    const [p] = planFollow({ leaderCell: { i: 0, j: 3 }, trail: [{ i: 0, j: 2 }, { i: 0, j: 3 }],
                             followers: [{ id: "a", cell: { i: 0, j: 2 } }], searchFor: () => w });
    assert.deepEqual(p.path, []);
    assert.equal(p.stuck, false);
  });

  await t.test("Platz unerreichbar: so nah heran, wie es geht", () => {
    // Der Platz hinter dem Anführer liegt in einer Nische, die nur von oben
    // offen ist — der Folgende kommt von unten nicht hinein.
    const w = karte(
      "#.#..",
      "#.#..",
      "###..",
      ".....",
    );
    const anfuehrer = { i: 0, j: 3 };
    const spur = [{ i: 0, j: 1 }, { i: 0, j: 3 }];   // Anführer kam durch eine Tür, die jetzt zu ist
    const folgende = [{ id: "a", cell: { i: 3, j: 0 } }];
    const [p] = planFollow({ leaderCell: anfuehrer, trail: spur, followers: folgende, searchFor: () => w });
    invarianten([p], folgende, anfuehrer, w);
    assert.equal(p.stuck, false);
    assert.ok(nachbarn(p.path.at(-1), anfuehrer), "steht direkt neben dem Anführer");
  });

  await t.test("kurze Spur: die übrigen stellen sich daneben", () => {
    const w = karte(".....", ".....", ".....");
    const anfuehrer = { i: 1, j: 2 };
    const folgende = ["a", "b", "c", "d"].map((id, j) => ({ id, cell: { i: 2, j } }));
    const plaene = planFollow({ leaderCell: anfuehrer, trail: [anfuehrer], followers: folgende, searchFor: () => w });
    invarianten(plaene, folgende, anfuehrer, w);
    assert.ok(plaene.every(p => !p.stuck));
  });

  await t.test("viele Folgende, enge Gänge, zufällige Karten: Invarianten halten", () => {
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
      const plaene = planFollow({ leaderCell: anfuehrer, trail: spur, followers: folgende, searchFor: () => w });
      invarianten(plaene, folgende, anfuehrer, w);
    }
  });

  await t.test("ohne Folgende: nichts zu tun", () =>
    assert.deepEqual(planFollow({ leaderCell: { i: 0, j: 0 }, trail: [], followers: [], searchFor: () => karte(".") }), []));
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
