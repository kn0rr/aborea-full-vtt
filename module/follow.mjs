// module/follow.mjs — Tokens folgen einem anderen Token
//
// Rechtsklick auf den Anführer, im Token-Menü "Folgen", und in der Liste die
// Folgenden anhaken (openFollowDialog). Bewegt sich der Anführer, gehen die
// anderen im Gänsemarsch seinen Weg nach, Feld für Feld (planFollow).
//
// Szenenwechsel: Läuft der Anführer in eine Teleport-Region, springen die
// Folgenden mit — in derselben Szene wie in eine andere. Wird ein verknüpfter
// Anführer in eine andere Szene gezogen, fragt das System, ob die Gruppe
// mitkommt; beim Aktivieren einer Szene bietet es an, Gruppen herzuholen.
//
// Wege können versperrt sein. Foundry hilft dabei nicht: Token#findMovementPath
// der v13.351 sucht keinen Weg, sondern beschneidet den geraden nur an der
// ersten Wand (constrainMovementPath). Deshalb hier eine eigene Wegsuche (A*)
// über die Rasterfelder, die jeden Schritt mit Token#checkCollision gegen die
// Wände prüft — derselben Prüfung, die Foundry beim Ziehen eines Tokens nutzt.
// Findet sich kein Weg zum Platz in der Spur, geht der Token so weit an den
// Anführer heran, wie es geht; findet sich gar keiner, bleibt er stehen.
//
// Die Rechnungen sind reine Funktionen und stehen oben; die Foundry-Anbindung
// (Hook, Werkzeuge, Flags) darunter.

import { registerSceneControlGroup } from "./scene-controls.mjs";

export const FOLLOW_FLAG = "follow";
const SYSTEM_ID = "aborea-v7";

/** Wie viele Felder sich die Spur merkt. Mehr Folgende als das ergibt keinen Sinn. */
export const TRAIL_LENGTH = 200;

/** Obergrenze der Wegsuche — ein eingeschlossener Token soll nicht die Sitzung einfrieren. */
export const MAX_SEARCH_NODES = 6000;

// ══════════════════════════════════════════════════════════════════
//  Reine Rechnungen
// ══════════════════════════════════════════════════════════════════

/** Schlüssel eines Rasterfelds {i, j}. */
export const cellKey = c => `${c.i},${c.j}`;

const sameCell = (a, b) => !!a && !!b && a.i === b.i && a.j === b.j;

/**
 * Kürzester Weg über Rasterfelder (A*).
 *
 * @param {{i,j}} start
 * @param {{i,j}} goal
 * @param {object} opts
 * @param {(c) => Array<{i,j}>} opts.neighbors   Nachbarfelder
 * @param {(a, b) => boolean} [opts.blocked]     Ist der Schritt a → b versperrt?
 * @param {(a, b) => number}  [opts.cost]        Kosten des Schritts, Vorgabe 1
 * @param {(a, b) => number}  [opts.heuristic]   Schätzung bis zum Ziel; darf nicht
 *        überschätzen, sonst ist der Weg nicht mehr der kürzeste. Vorgabe 0.
 * @param {number} [opts.maxNodes]               Abbruch nach so vielen Feldern
 * @returns {Array<{i,j}>|null}  Felder von start bis goal (beide enthalten),
 *          oder null, wenn es keinen Weg gibt.
 */
export function findPath(start, goal, {
  neighbors, blocked = () => false, cost = () => 1, heuristic = () => 0,
  maxNodes = MAX_SEARCH_NODES,
} = {}) {
  if (!start || !goal || typeof neighbors !== "function") return null;
  if (sameCell(start, goal)) return [{ i: start.i, j: start.j }];

  const startKey = cellKey(start);
  const goalKey  = cellKey(goal);
  const g    = new Map([[startKey, 0]]);
  const from = new Map();
  const cell = new Map([[startKey, start]]);
  const closed = new Set();
  // Offene Liste als binärer Heap über f = g + h.
  const heap = [];
  const push = (key, f) => {
    heap.push({ key, f });
    let n = heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heap[p].f <= heap[n].f) break;
      [heap[p], heap[n]] = [heap[n], heap[p]];
      n = p;
    }
  };
  const pop = () => {
    const top  = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let m = n;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]];
        n = m;
      }
    }
    return top;
  };

  push(startKey, heuristic(start, goal));
  while (heap.length) {
    const { key } = pop();
    if (closed.has(key)) continue;
    if (key === goalKey) {
      const path = [];
      for (let k = key; k !== undefined; k = from.get(k)) path.push(cell.get(k));
      return path.reverse().map(c => ({ i: c.i, j: c.j }));
    }
    closed.add(key);
    if (closed.size > maxNodes) return null;

    const here = cell.get(key);
    for (const next of neighbors(here) ?? []) {
      const nk = cellKey(next);
      if (closed.has(nk) || blocked(here, next)) continue;
      const step = Number(cost(here, next));
      if (!Number.isFinite(step) || step < 0) continue;
      const tentative = g.get(key) + step;
      if (tentative >= (g.get(nk) ?? Infinity)) continue;
      g.set(nk, tentative);
      from.set(nk, key);
      cell.set(nk, next);
      push(nk, tentative + heuristic(next, goal));
    }
  }
  return null;
}

/**
 * Die acht Nachbarn auf einem Quadratraster — und die Ersatzrasterung für
 * Szenen ohne Raster, wo Foundrys getAdjacentOffsets() leer zurückgibt.
 */
export function squareNeighbors(c, { diagonals = true } = {}) {
  const out = [
    { i: c.i - 1, j: c.j }, { i: c.i, j: c.j - 1 }, { i: c.i, j: c.j + 1 }, { i: c.i + 1, j: c.j },
  ];
  if (diagonals) out.push(
    { i: c.i - 1, j: c.j - 1 }, { i: c.i - 1, j: c.j + 1 },
    { i: c.i + 1, j: c.j - 1 }, { i: c.i + 1, j: c.j + 1 });
  return out;
}

/** Ein Diagonalschritt kostet mehr, sonst laufen Tokens Zickzack. */
export function squareStepCost(a, b) {
  return (a.i !== b.i && a.j !== b.j) ? 1.5 : 1;
}

/**
 * Schätzung für das Quadratraster: so viele Schritte, wie mindestens nötig
 * sind, mit denselben Kosten wie squareStepCost. Überschätzt nie.
 */
export function squareHeuristic(a, b) {
  const di = Math.abs(a.i - b.i), dj = Math.abs(a.j - b.j);
  return Math.max(di, dj) + 0.5 * Math.min(di, dj);
}

/**
 * Felder auf der geraden Linie von a nach b, beide enthalten — für Szenen
 * ohne Raster, wo Foundrys getDirectPath() keine Felder kennt.
 */
export function lineCells(a, b) {
  const out = [];
  let i = a.i, j = a.j;
  const di = Math.abs(b.i - a.i), dj = Math.abs(b.j - a.j);
  const si = a.i < b.i ? 1 : -1, sj = a.j < b.j ? 1 : -1;
  let err = dj - di;
  for (;;) {
    out.push({ i, j });
    if (i === b.i && j === b.j) return out;
    const e2 = 2 * err;
    if (e2 > -di) { err -= di; j += sj; }
    if (e2 <  dj) { err += dj; i += si; }
  }
}

/**
 * Hängt Felder an die Spur des Anführers. Wiederholungen direkt
 * hintereinander fallen weg; die Spur bleibt höchstens `max` Felder lang.
 */
export function extendTrail(trail = [], cells = [], max = TRAIL_LENGTH) {
  const out = [...(trail ?? [])];
  for (const c of cells ?? []) {
    if (!c || !Number.isFinite(c.i) || !Number.isFinite(c.j)) continue;
    if (sameCell(out.at(-1), c)) continue;
    out.push({ i: c.i, j: c.j });
  }
  return out.slice(-Math.max(1, max));
}

/**
 * Ein Weg ohne Schleifen: kommt ein Feld noch einmal vor, fällt alles
 * dazwischen weg. Der Anführer darf Kreise gehen; die Folgenden gehen sie
 * nicht nach.
 */
export function withoutLoops(cells = []) {
  const out = [];
  const at  = new Map();
  for (const c of cells ?? []) {
    const k = cellKey(c);
    if (at.has(k)) {
      out.length = at.get(k) + 1;
      for (const [key, n] of at) if (n >= out.length) at.delete(key);
      continue;
    }
    at.set(k, out.length);
    out.push({ i: c.i, j: c.j });
  }
  return out;
}

/**
 * Freie, erreichbare Felder rund um ein Feld, nächstgelegene zuerst
 * (Breitensuche). Für Plätze, die die Spur nicht hergibt, und für das
 * Aufstellen nach einem Szenenwechsel.
 */
export function placeAround(center, count, { neighbors, blocked = () => false, exclude = new Set(), maxNodes = MAX_SEARCH_NODES } = {}) {
  const out = [];
  if (!center || typeof neighbors !== "function" || count <= 0) return out;
  const seen  = new Set([cellKey(center)]);
  const queue = [center];
  while (queue.length && out.length < count && seen.size <= maxNodes) {
    const here = queue.shift();
    for (const next of neighbors(here) ?? []) {
      const k = cellKey(next);
      if (seen.has(k) || blocked(here, next)) continue;
      seen.add(k);
      queue.push(next);
      if (!exclude.has(k)) out.push({ i: next.i, j: next.j });
      if (out.length >= count) break;
    }
  }
  return out;
}

/**
 * Hängen alle Folgenden über eine Kette von Nachbarn (ohne Wand dazwischen)
 * am Anführer? Zwei auf einem Feld oder einer auf dem Anführer: nein.
 */
export function allConnected(leaderCell, followers = [], search = []) {
  const keys = followers.map(f => cellKey(f.cell));
  if (new Set([cellKey(leaderCell), ...keys]).size !== keys.length + 1) return false;
  const reached = new Set();
  const queue = [leaderCell];
  while (queue.length) {
    const here = queue.shift();
    for (const [n, f] of followers.entries()) {
      if (reached.has(n)) continue;
      const s = search[n] ?? {};
      const next = (s.neighbors?.(here) ?? []).some(x => sameCell(x, f.cell));
      if (!next || (s.blocked?.(here, f.cell) ?? false)) continue;
      reached.add(n);
      queue.push(f.cell);
    }
  }
  return reached.size === followers.length;
}

/**
 * Plant die Bewegung aller Folgenden — auf dem Weg des Anführers.
 *
 * Die Spur ist die Folge der Felder, über die der Anführer gegangen ist. Die
 * Plätze liegen rückwärts darauf: Platz 0 das letzte Feld vor ihm, Platz 1
 * das davor. Wer auf der Spur steht, geht auf ihr nach vorn bis zu seinem
 * Platz — genau den Weg, den der Anführer gegangen ist, ohne Abkürzung. Wer
 * neben der Spur steht, sucht sich den Weg dorthin (A*, um Wände herum).
 *
 * Solange jeder über Nachbarn am Anführer hängt (allConnected), bewegt sich
 * niemand — ein kleiner Schritt oder einer zurück reisst die Schlange nicht.
 * Erst wenn einer den Anschluss verliert, rückt sie nach.
 *
 * Die Reihenfolge ergibt sich aus der Lage, nicht aus dem Dialog: wer auf der
 * Spur weiter vorn steht, bekommt den vorderen Platz — der i-te den i-ten.
 * Jeder Platz gehört genau einem; so endet niemand auf dem Feld eines
 * anderen, und niemand überholt. Abseits der Spur behält einen Platz neben
 * dem Anführer, wer schon darauf steht.
 *
 * Vorgeschichte: Zuerst bekam jeder einen festen Platz in der Reihenfolge,
 * in der er angehakt war — wer hinten stand, aber zuerst kam, lief durch den
 * Vordermann hindurch. Danach hielt jeder nur Anschluss an die Gruppe — dann
 * blieb hängen, wer über andere noch verbunden war, und wer nachrückte, nahm
 * die kürzeste Linie statt des Wegs des Anführers.
 *
 * @param {object} p
 * @param {{i,j}} p.leaderCell
 * @param {Array<{i,j}>} p.trail      ältestes Feld zuerst
 * @param {Array<{id, cell}>} p.followers
 * @param {(id) => object} p.searchFor  je Folgendem {neighbors, blocked?, cost, heuristic}.
 *        Ohne `blocked` sind die Wände unbekannt (Szene nicht auf der Leinwand):
 *        dann geht nur, was auf der Spur liegt.
 * @param {Iterable<{i,j}>} [p.occupied]  Felder, auf denen schon jemand steht, der
 *        nicht mitgeplant wird — etwa Folgende, die mit dem Anführer zusammen
 *        gezogen wurden. Dort endet niemand.
 * @returns {Array<{id, path, stuck}>}  in der Reihenfolge von `followers`;
 *          path beginnt beim aktuellen Feld, leer heisst: bleibt stehen
 */
export function planFollow({ leaderCell, trail = [], followers = [], searchFor, occupied = [] }) {
  const result = new Array(followers.length);
  if (!followers.length) return [];
  const leaderKey = cellKey(leaderCell);
  const search = followers.map(f => searchFor(f.id) ?? {});
  const fixed = new Set([...(occupied ?? [])].map(cellKey));

  // Hat noch jeder Anschluss, bewegt sich niemand. Ein kleiner Schritt oder
  // ein Schritt zurück reisst die Schlange nicht auseinander — vorher rückte
  // sie dann hin und her.
  if (!followers.some(f => fixed.has(cellKey(f.cell))) && allConnected(leaderCell, followers, search)) {
    return followers.map(f => ({ id: f.id, path: [], stuck: false }));
  }

  // Die Spur endet beim Anführer, und gilt nur, soweit sie zusammenhängt:
  // nach einem Sprung (Teleport, Verschieben durch den Spielleiter) liegt
  // davor ein anderer Weg, dem niemand nachgehen kann.
  const full = extendTrail(trail, [leaderCell], Infinity);
  let from = full.length - 1;
  while (from > 0 && (search[0].neighbors?.(full[from]) ?? []).some(x => sameCell(x, full[from - 1]))) from--;
  const spur = full.slice(from);
  const L    = spur.length - 1;
  const lastIdx = new Map();
  spur.forEach((c, n) => lastIdx.set(cellKey(c), n));

  // Plätze rückwärts auf der Spur, jedes Feld nur einmal, nie das des Anführers.
  const slots = [];
  const inSlots = new Set([leaderKey, ...fixed]);
  for (let n = L - 1; n >= 0; n--) {
    const k = cellKey(spur[n]);
    if (inSlots.has(k)) continue;
    inSlots.add(k);
    slots.push({ cell: spur[n], idx: n });
  }
  // Plätze neben der Spur, rund um den Anführer — für eine zu kurze Spur
  // (frisch eingerichtet, nach dem Neuladen) und für wer abseits steht. Wer
  // schon auf einem davon steht, bleibt dort.
  const around = placeAround(leaderCell, followers.length * 2, {
    neighbors: search[0].neighbors, blocked: search[0].blocked ?? (() => false), exclude: inSlots,
  });
  for (const c of around) slots.push({ cell: c, idx: -1 });

  // Wer steht wo auf der Spur? Auf dem Anführer zählt als ganz vorn.
  const posOf = f => cellKey(f.cell) === leaderKey ? L : (lastIdx.get(cellKey(f.cell)) ?? -1);
  const ranked = followers.map((f, n) => ({ f, n, p: posOf(f) }));
  const onTrail  = ranked.filter(r => r.p >= 0).sort((a, b) => (b.p - a.p) || (a.n - b.n));
  const offTrail = ranked.filter(r => r.p < 0).sort((a, b) => {
    const h = search[a.n].heuristic ?? squareHeuristic;
    return (h(a.f.cell, leaderCell) - h(b.f.cell, leaderCell)) || (a.n - b.n);
  });

  // Zuordnung: der i-te auf der Spur bekommt den i-ten Platz. Jeder Platz
  // gehört genau einem — so kann niemand auf dem Feld eines anderen enden,
  // und niemand überholt, weil Plätze und Folgende dieselbe Reihenfolge haben.
  const target = new Array(followers.length);
  const used = new Set();
  let k = 0;
  const nextFree = () => { while (k < slots.length && used.has(k)) k++; return k < slots.length ? k : -1; };
  for (const r of onTrail) {
    const j = nextFree();
    if (j < 0) break;
    used.add(j);
    target[r.n] = slots[j];
  }
  // Abseits der Spur: wer schon auf einem freien Platz steht, behält ihn.
  const slotAt = new Map(slots.map((s, j) => [cellKey(s.cell), j]));
  const rest = [];
  for (const r of offTrail) {
    const j = slotAt.get(cellKey(r.f.cell));
    if (j !== undefined && !used.has(j)) { used.add(j); target[r.n] = slots[j]; }
    else rest.push(r);
  }
  for (const r of rest) {
    const j = nextFree();
    if (j < 0) break;
    used.add(j);
    target[r.n] = slots[j];
  }

  // Wege. Belegt ist, was ein anderer als Ziel hat, und wo schon jemand endet.
  const reserved = new Set([leaderKey, ...fixed, ...target.filter(Boolean).map(s => cellKey(s.cell))]);
  const ends = new Set(fixed);
  const isStep = (s, a, b) => (s.neighbors?.(a) ?? []).some(x => sameCell(x, b));
  // Ein Weg auf der Spur. Auch der wird gegen Wände geprüft: der Anführer
  // zieht eine gerade Linie, der Weg über die Feldmitten weicht davon bis zu
  // einem halben Feld ab und kann eine Wandecke streifen, die die Linie nicht
  // berührt hat. Foundry hielt den Folgenden dort an, bei jedem Zug an
  // derselben Stelle — er blieb dauerhaft zurück. Dann lieber außen herum.
  const walk = (s, cells) => {
    const w = withoutLoops(cells);
    for (let n = 1; n < w.length; n++) {
      if (!isStep(s, w[n - 1], w[n])) return null;
      if (s.blocked?.(w[n - 1], w[n])) return null;
    }
    return w;
  };

  for (const { f, n, p } of [...onTrail, ...offTrail]) {
    const s = search[n];
    const knowsWalls = typeof s.blocked === "function";
    const slot = target[n];
    const mine = slot ? cellKey(slot.cell) : "";

    let path = null;
    let unknown = false;
    if (slot && cellKey(f.cell) === mine) {
      path = [{ i: f.cell.i, j: f.cell.j }];                      // steht schon richtig
    } else if (slot) {
      if (p >= 0 && slot.idx > p) path = walk(s, spur.slice(p, slot.idx + 1));          // vorwärts auf der Spur
      if (!path && knowsWalls) path = findPath(f.cell, slot.cell, s);
      if (!path && p >= 0 && slot.idx >= 0 && slot.idx < p) {
        path = walk(s, spur.slice(slot.idx, p + 1).reverse());                         // zurück auf der Spur
      }
      if (!path && !knowsWalls) unknown = true;
    } else if (!knowsWalls) {
      unknown = true;
    }

    if (!path && knowsWalls && slot) {
      // Platz unerreichbar: auf den Anführer zu, so weit es geht, ohne auf
      // einem fremden Platz zu enden.
      const toward = findPath(f.cell, leaderCell, s);
      if (toward) {
        path = toward;
        const blockedEnd = c => { const k = cellKey(c); return (reserved.has(k) && k !== mine) || ends.has(k); };
        while (path.length > 1 && blockedEnd(path.at(-1))) path = path.slice(0, -1);
        if (path.length === 1 && cellKey(path[0]) === leaderKey) path = null;
      }
    }

    const finalCell = path?.at(-1) ?? f.cell;
    ends.add(cellKey(finalCell));
    result[n] = { id: f.id, path: path && path.length > 1 ? path : [], stuck: !path && !unknown };
  }
  return result;
}

/**
 * Alle, die einem Anführer folgen — auch über Ketten (A folgt B folgt ihm).
 * Für den Szenenwechsel: wer mitgeht, nimmt seine eigenen Folgenden mit.
 *
 * @param {Map<string,string>|object} follows  folgender → Anführer
 * @returns {string[]}  in Breitenreihenfolge, ohne den Anführer
 */
export function groupMembers(follows, leaderId) {
  const entries = follows instanceof Map ? [...follows] : Object.entries(follows ?? {});
  const out  = [];
  const seen = new Set([leaderId]);
  const queue = [leaderId];
  while (queue.length) {
    const cur = queue.shift();
    for (const [id, leader] of entries) {
      if (leader !== cur || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      queue.push(id);
    }
  }
  return out;
}

/**
 * Was bedeutet ein neuer Token in einer Szene für die Gruppe?
 *
 *  - "teleport": Foundrys Teleport-Region legt den Token mit derselben
 *    Kennung neu an und löscht danach den alten (RegionDocument#teleportToken,
 *    v13.351). Darum kümmert sich das Löschen — hier nichts tun.
 *  - "dragIn":   ein verknüpfter Akteur wurde in eine andere Szene gezogen,
 *    und sein Token dort drüben führt eine Gruppe. Dann fragen, ob sie mitkommt.
 *  - null:       hat mit keiner Gruppe zu tun.
 *
 * Unverknüpfte Akteure bleiben aussen vor: drei Goblins teilen sich einen
 * Akteur, welcher davon gemeint ist, lässt sich nicht sagen.
 *
 * @param {object} p
 * @param {{id, actorId, actorLink, sceneId}} p.token
 * @param {Array<{id, actorId, sceneId, hasFollowers}>} p.others  Tokens anderer Szenen
 */
export function classifyNewToken({ token, others = [] }) {
  if (!token) return null;
  if (others.some(o => o.id === token.id && o.sceneId !== token.sceneId)) return "teleport";
  if (!token.actorLink || !token.actorId) return null;
  const leader = others.find(o => o.actorId === token.actorId && o.sceneId !== token.sceneId && o.hasFollowers);
  return leader ? "dragIn" : null;
}

/**
 * Was eine Bewegung des Anführers für die Folgenden bedeutet.
 *
 *  - "ignore": nichts tun. Ein Rückgängig (Strg+Z) nimmt einen Zug zurück;
 *    folgten die anderen auch dem, liefen sie den Weg rückwärts nach — und
 *    beim nächsten Zug wieder vor. Ohne gegangene Wegpunkte gibt es nichts
 *    zu folgen.
 *  - "jump":   der Anführer ist gesprungen (Teleport, Verschieben mit
 *    gedrückter Taste, Position im Token-Fenster geändert). Es gibt keinen
 *    Weg, dem jemand folgen könnte; die Gruppe springt mit.
 *  - "walk":   gegangen — die Folgenden gehen seinen Weg nach.
 *
 * @param {object} movement  Foundrys Bewegungsdaten (TokenMovementOperation, v13.351)
 */
export function movementKind(movement) {
  const passed = movement?.passed?.waypoints ?? [];
  if (!passed.length || movement.method === "undo") return "ignore";
  if (movement.method === "config" || passed.some(w => w?.action === "displace")) return "jump";
  return "walk";
}

/**
 * Wo der Anführer nach einem Zug steht (Position oben links).
 *
 * Aus den Bewegungsdaten, nicht vom Token: gemeldet war, dass die Gruppe
 * immer zum Ziel des *vorigen* Zugs zieht — genau das Bild, wenn beim
 * Auswerten noch die alte Position am Token steht. Zuerst der letzte
 * gegangene Wegpunkt (dort steht er nach diesem Update, auch wenn Foundry
 * den Rest an einer Regionsgrenze später fortsetzt), dann das Zugziel,
 * zuletzt der Token selbst.
 */
export function leaderEndPosition(movement, doc = null) {
  return movement?.passed?.waypoints?.at(-1) ?? movement?.destination ?? doc;
}

/**
 * Würde `followerId` → `leaderId` einen Kreis schliessen? Folgen-Beziehungen
 * dürfen Ketten bilden (A folgt B, B folgt C), aber keine Schleife — sonst
 * stösst jede Bewegung die nächste an, ohne Ende.
 *
 * @param {Map<string,string>|object} follows  folgender → Anführer
 */
export function wouldCycle(follows, followerId, leaderId) {
  if (followerId === leaderId) return true;
  const get = id => follows instanceof Map ? follows.get(id) : follows?.[id];
  const seen = new Set();
  for (let cur = leaderId; cur; cur = get(cur)) {
    if (cur === followerId) return true;
    if (seen.has(cur)) return false;   // bestehender Kreis, nicht unserer
    seen.add(cur);
  }
  return false;
}

/**
 * Was sich ändert, wenn im Folgen-Dialog eines Anführers diese Tokens
 * angehakt sind.
 *
 * Angehakte, die ihm noch nicht folgen, kommen hinten an die Reihe — auch
 * wer bisher jemand anderem folgte, wechselt. Wer ihm folgte und nicht mehr
 * angehakt ist, folgt niemandem mehr. Wer einen Kreis schliessen würde, wird
 * abgelehnt; der Anführer selbst kann nicht angehakt werden.
 *
 * @param {object} p
 * @param {Array<{id, leader?, order?}>} p.tokens  alle Tokens der Szene mit ihrer Folgen-Angabe
 * @param {string} p.leaderId
 * @param {Iterable<string>} p.chosenIds          angehakte Tokens
 * @returns {{set: Array<{id, order}>, unset: string[], refused: string[]}}
 */
export function followChanges({ tokens = [], leaderId, chosenIds = [] }) {
  const chosen  = new Set(chosenIds);
  chosen.delete(leaderId);
  const follows = new Map(tokens.filter(t => t.leader).map(t => [t.id, t.leader]));
  const mine    = tokens.filter(t => t.leader === leaderId);
  let next = mine.reduce((m, t) => Math.max(m, Number(t.order) || 0), -1) + 1;

  const set = [], refused = [];
  for (const t of tokens) {
    if (!chosen.has(t.id) || t.leader === leaderId) continue;
    // Wer wechselt, hängt nicht mehr an seinem alten Anführer.
    follows.delete(t.id);
    if (wouldCycle(follows, t.id, leaderId)) {
      if (t.leader) follows.set(t.id, t.leader);
      refused.push(t.id);
      continue;
    }
    follows.set(t.id, leaderId);
    set.push({ id: t.id, order: next++ });
  }
  const unset = mine.filter(t => !chosen.has(t.id)).map(t => t.id);
  return { set, unset, refused };
}

// ══════════════════════════════════════════════════════════════════
//  Foundry-Anbindung
// ══════════════════════════════════════════════════════════════════

/** Spuren der Anführer — nur auf dem ausführenden Spielleiter-Client. */
const TRAILS = new Map();
/** Je Anführer eine Warteschlange, damit schnelle Züge sich nicht überholen. */
const QUEUES = new Map();

function followOf(doc) {
  return doc?.getFlag?.(SYSTEM_ID, FOLLOW_FLAG) ?? null;
}

/**
 * Raster einer Szene; ohne Raster ein gedachtes Quadratraster.
 *
 * Über scene.grid, nicht canvas.grid: die Szene des Anführers muss nicht die
 * sein, die der Spielleiter gerade ansieht (Scene#grid, v13.351).
 */
function gridAdapter(scene) {
  const grid = scene.grid;
  if (!grid.isGridless) {
    return {
      offset:    p => grid.getOffset(p),
      center:    c => grid.getCenterPoint(c),
      neighbors: c => grid.getAdjacentOffsets(c),
      line:      (a, b) => grid.getDirectPath([a, b]),
      cost:      grid.isSquare ? squareStepCost : () => 1,
      square:    grid.isSquare,
      size:      grid.size,
    };
  }
  const s = grid.size;
  return {
    offset:    p => ({ i: Math.floor(p.y / s), j: Math.floor(p.x / s) }),
    center:    c => ({ x: (c.j + 0.5) * s, y: (c.i + 0.5) * s }),
    neighbors: c => squareNeighbors(c),
    line:      lineCells,
    cost:      squareStepCost,
    square:    true,
    size:      s,
  };
}

/** Feld, auf dem der Token mit seiner Mitte steht. */
function cellOfPosition(doc, pos, g) {
  return g.offset(doc.getCenterPoint({
    x: pos.x, y: pos.y, elevation: pos.elevation ?? doc.elevation,
    width: pos.width ?? doc.width, height: pos.height ?? doc.height, shape: pos.shape ?? doc.shape,
  }));
}

/** Position (oben links), mit der die Mitte des Tokens auf diesem Feld steht. */
function positionForCell(doc, cell, g) {
  const c = g.center(cell);
  const pivot = doc.getCenterPoint({ x: 0, y: 0, elevation: doc.elevation, width: doc.width, height: doc.height, shape: doc.shape });
  return { x: Math.round(c.x - pivot.x), y: Math.round(c.y - pivot.y) };
}

/** Liegt der Punkt innerhalb der Szene? */
function inScene(scene, p) {
  const r = scene.dimensions.sceneRect;
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

/**
 * Wandprüfung für einen Schritt a → b, oder null, wenn die Wände unbekannt
 * sind: geprüft werden kann nur auf der Leinwand, und die zeigt nur die
 * Szene, die der Spielleiter gerade ansieht.
 *
 * Diagonal geht es auf dem Quadratraster nur, wenn auch beide Ecken frei
 * sind. Sonst schlüpfte die Wegsuche zwischen zwei Wandenden hindurch, die
 * Foundrys eigene Bewegungsprüfung danach doch abfängt — der Token blieb
 * mitten im Weg stehen, womöglich auf dem Feld eines anderen.
 */
function wallTest(scene, g, centerOf, test) {
  if (canvas.scene?.id !== scene.id) return null;
  const cache = new Map();
  const step = (a, b) => {
    const k = `${cellKey(a)}>${cellKey(b)}`;
    if (cache.has(k)) return cache.get(k);
    const to = centerOf(b);
    const out = !inScene(scene, to) || !!test(centerOf(a), to);
    cache.set(k, out);
    return out;
  };
  return (a, b) => {
    if (step(a, b)) return true;
    if (!g.square || a.i === b.i || a.j === b.j) return false;
    return step(a, { i: a.i, j: b.j }) || step(a, { i: b.i, j: a.j });
  };
}

/** Wegsuche für einen Folgenden: Wände über seine eigene Kollisionsprüfung. */
function searchOptions(doc, g) {
  const centerFor = cell => {
    const p = positionForCell(doc, cell, g);
    return doc.getCenterPoint({ ...p, elevation: doc.elevation, width: doc.width, height: doc.height, shape: doc.shape });
  };
  const token = doc.object;
  const blocked = token
    ? wallTest(doc.parent, g, centerFor, (from, to) => token.checkCollision(to, { origin: from, type: "move", mode: "any" }))
    : null;
  return {
    neighbors: g.neighbors,
    cost: g.cost,
    heuristic: (a, b) => {
      const pa = g.center(a), pb = g.center(b);
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) / g.size;
    },
    ...(blocked ? { blocked } : {}),
  };
}

/**
 * Feld des Anführers nach diesem Zug: der letzte gegangene Wegpunkt — dort
 * steht er nach diesem Update, auch wenn Foundry den Rest an einer
 * Regionsgrenze erst später fortsetzt. Sonst das Zugziel, zuletzt der Token.
 */
function leaderCellAfter(doc, movement, g) {
  return cellOfPosition(doc, leaderEndPosition(movement, doc), g);
}

/** Die Felder, die der Anführer in dieser Bewegung betreten hat. */
function movementCells(doc, movement, g) {
  const points = [movement.origin, ...(movement.passed?.waypoints ?? [])].filter(Boolean);
  const cells = points.map(p => cellOfPosition(doc, p, g));
  const out = [];
  for (let n = 0; n < cells.length; n++) {
    if (n === 0) { out.push(cells[0]); continue; }
    out.push(...g.line(cells[n - 1], cells[n]).slice(1));
  }
  return out;
}

/** Die Folgenden eines Anführers. */
function followersOf(leaderDoc) {
  return leaderDoc.parent.tokens
    .filter(t => followOf(t)?.leader === leaderDoc.id)
    .sort((a, b) => (followOf(a).order ?? 0) - (followOf(b).order ?? 0));
}

/** Felder, auf denen in dieser Szene schon jemand steht. */
function occupiedCells(scene, g, except = new Set()) {
  return new Set([...scene.tokens].filter(t => !except.has(t.id)).map(t => cellKey(cellOfPosition(t, t, g))));
}

/**
 * Stellt die Folgenden rund um den Anführer auf — nach einem Teleport, bei
 * dem es keinen Weg gibt, dem sie folgen könnten. Liefert je Folgendem das
 * Zielfeld, in der Reihenfolge von `docs`.
 */
function cellsAround(leaderDoc, docs, g, center = cellOfPosition(leaderDoc, leaderDoc, g)) {
  const centerOf = c => g.center(c);
  const backend = CONFIG.Canvas.polygonBackends?.move;
  const blocked = backend
    ? wallTest(leaderDoc.parent, g, centerOf, (a, b) => backend.testCollision(a, b, { type: "move", mode: "any" }))
    : null;
  const exclude = occupiedCells(leaderDoc.parent, g, new Set([leaderDoc.id, ...docs.map(d => d.id)]));
  return placeAround(center, docs.length, {
    neighbors: g.neighbors,
    blocked: blocked ?? ((a, b) => !inScene(leaderDoc.parent, g.center(b))),
    exclude,
  });
}

async function moveFollowers(leaderDoc, movement, together = new Set()) {
  // Mit dem Anführer zusammen gezogen (mehrere ausgewählt): sie stehen, wo der
  // Spielleiter sie hingelegt hat. Vorher setzte das Folgen sie gleich danach
  // wieder auf ihre Plätze — vor und zurück.
  const all = followersOf(leaderDoc);
  const followers = all.filter(f => !together.has(f.id));
  const draggedAlong = all.filter(f => together.has(f.id));
  if (draggedAlong.length) debug("mitgezogen, bleiben stehen:", draggedAlong.map(f => f.name).join(", "));
  if (!followers.length) return;
  const g = gridAdapter(leaderDoc.parent);
  // Wo der Anführer nach diesem Zug steht — aus den Bewegungsdaten, nicht vom
  // Token. Gemeldet war: die Gruppe zieht immer zum Ziel des *vorigen* Zugs.
  // Genau das geschieht, wenn der Token beim Auswerten noch die alte Position
  // trägt: beim Zug nach A sieht das Folgen ihn noch am Start (alle haben
  // Anschluss, keiner rührt sich), beim Zug nach B sieht es ihn bei A.
  const leaderCell = leaderCellAfter(leaderDoc, movement, g);
  debug("Anführer-Position: Token", `${leaderDoc.x},${leaderDoc.y}`, "Zugziel",
    movement?.destination ? `${movement.destination.x},${movement.destination.y}` : "—",
    "→ Feld", cellKey(leaderCell));

  // Teleport innerhalb der Szene (Region, Spielleiter verschiebt mit
  // gedrückter Taste): es gibt keinen Weg, dem jemand folgen könnte. Die
  // Folgenden springen mit und stellen sich um den Anführer.
  if (movementKind(movement) === "jump") {
    TRAILS.set(leaderDoc.id, [leaderCell]);
    const cells = cellsAround(leaderDoc, followers, g, leaderCell);
    await Promise.all(followers.map(async (doc, n) => {
      if (!cells[n]) return;
      await doc.move({ ...positionForCell(doc, cells[n], g), action: "displace" },
        { method: "api", autoRotate: false, showRuler: false });
    }));
    return;
  }

  const trail = extendTrail(TRAILS.get(leaderDoc.id) ?? [], movementCells(leaderDoc, movement, g));
  TRAILS.set(leaderDoc.id, trail);

  // Zwei Durchgänge: hat Foundry die Bewegung eines Folgenden abgebrochen —
  // seine Wandprüfung ist das letzte Wort, und eine Tür kann inzwischen zu
  // sein —, wird von dort aus gleich noch einmal geplant.
  //
  // Nur bei einem Abbruch ("stopped"). In v1.7.23 genügte, dass der Token
  // nicht am geplanten Feld stand. Foundry hält ihn aber auch absichtlich an
  // — an Regionsgrenzen — und setzt den Rest danach selbst fort ("pending").
  // Der zweite Plan zog dann gegen diese Fortsetzung: vor und zurück.
  debug("Spur", trail.slice(-12).map(cellKey).join(" "), "Anführer", cellKey(leaderCell));
  let stuck = [];
  for (let pass = 0; pass < 2; pass++) {
    const current = followersOf(leaderDoc).filter(f => !together.has(f.id));
    const searches = new Map(current.map(f => [f.id, searchOptions(f, g)]));
    const plans = planFollow({
      leaderCell, trail,
      followers: current.map(f => ({ id: f.id, cell: cellOfPosition(f, f, g) })),
      searchFor: id => searches.get(id),
      occupied: draggedAlong.map(f => cellOfPosition(f, f, g)),
    });
    debug(`Plan ${pass + 1}`, plans.map(pl => `${leaderDoc.parent.tokens.get(pl.id)?.name}: `
      + (pl.path.length ? pl.path.map(cellKey).join(">") : (pl.stuck ? "steckt" : "bleibt"))).join(" | "));

    stuck = [];
    const stopped = [];
    await Promise.all(plans.map(async plan => {
      const doc = leaderDoc.parent.tokens.get(plan.id);
      if (!doc) return;
      if (plan.stuck) stuck.push(doc.name);
      if (!plan.path.length) return;
      const waypoints = plan.path.slice(1).map(c => ({ ...positionForCell(doc, c, g), snapped: true, explicit: false }));
      await doc.move(waypoints, { method: "api", autoRotate: true, showRuler: false });
      const at = cellKey(cellOfPosition(doc, doc, g));
      debug("  ", doc.name, "steht auf", at, "geplant", cellKey(plan.path.at(-1)), "Zustand", doc.movement?.state);
      if (doc.movement?.state === "stopped" && at !== cellKey(plan.path.at(-1))) stopped.push(doc.id);
    }));
    if (!stopped.length) break;
  }
  if (stuck.length) ui.notifications.warn(`ABOREA: Kein Weg für ${stuck.join(", ")} — bleibt stehen.`);
}

// ── Szenenwechsel ──────────────────────────────────────────────────────

/** Diagnose: schreibt jede Folgen-Entscheidung in die Browser-Konsole (F12). */
export const DEBUG_SETTING = "followDebug";
function debug(...args) {
  try {
    if (game.settings.get(SYSTEM_ID, DEBUG_SETTING)) console.log("ABOREA Folgen |", ...args);
  } catch { /* vor der Registrierung */ }
}

/** Markiert eigene Anlege- und Löschvorgänge, damit die Hooks sie übergehen. */
const TRANSFER = "aboreaFollowTransfer";

/** Folgen-Beziehungen einer Szene: folgender → Anführer. */
function followsIn(scene) {
  return new Map([...scene.tokens].filter(t => followOf(t)?.leader).map(t => [t.id, followOf(t).leader]));
}

/**
 * Bringt die Gruppe eines Anführers in die Szene seines neuen Tokens: legt
 * dort Kopien an (mit derselben Kennung, wenn sie frei ist — wie Foundrys
 * Teleport), stellt sie um ihn auf und löscht die alten.
 *
 * Wer selbst Folgende hat, nimmt sie mit; die Beziehungen zeigen danach auf
 * die neuen Tokens.
 */
async function transferGroup(oldLeader, newLeader) {
  const origin = oldLeader.parent;
  const dest   = newLeader.parent;
  if (!origin || !dest || origin.id === dest.id) return;
  const members = groupMembers(followsIn(origin), oldLeader.id).map(id => origin.tokens.get(id)).filter(Boolean);
  if (!members.length) return;

  const ids = new Map([[oldLeader.id, newLeader.id]]);
  for (const m of members) ids.set(m.id, dest.tokens.has(m.id) ? foundry.utils.randomID() : m.id);

  // Aufstellen mit dem Raster der Zielszene; Platzhalter-Dokumente, damit
  // Grösse und Form der Tokens dort richtig gerechnet werden.
  const TokenDoc = foundry.documents.TokenDocument.implementation;
  const shadows = members.map(m => TokenDoc.fromSource({ ...m.toObject(), _id: ids.get(m.id) }, { parent: dest }));
  const g = gridAdapter(dest);
  const cells = cellsAround(newLeader, shadows, g);

  const data = members.map((m, n) => {
    const d = m.toObject();
    d._id = ids.get(m.id);
    const cell = cells[n];
    if (cell) Object.assign(d, positionForCell(shadows[n], cell, g));
    else Object.assign(d, { x: newLeader.x, y: newLeader.y });
    const f = followOf(m);
    foundry.utils.setProperty(d, `flags.${SYSTEM_ID}.${FOLLOW_FLAG}`, { ...f, leader: ids.get(f.leader) ?? f.leader });
    return d;
  });

  const created = await dest.createEmbeddedDocuments("Token", data, { keepId: true, [TRANSFER]: true });
  const replacements = Object.fromEntries(created.map(c => [[...ids].find(([, v]) => v === c.id)?.[0], c.uuid]));
  await origin.deleteEmbeddedDocuments("Token", members.map(m => m.id), { replacements, [TRANSFER]: true });
  TRAILS.set(newLeader.id, [cellOfPosition(newLeader, newLeader, g)]);
  ui.notifications.info(`ABOREA: ${members.map(m => m.name).join(", ")} folgt ${newLeader.name} nach „${dest.name}“.`);
}

/** Alle Tokens anderer Szenen, die eine Gruppe führen. */
function leadersElsewhere(scene) {
  const out = [];
  for (const s of game.scenes) {
    if (s.id === scene.id) continue;
    const follows = followsIn(s);
    const leaders = new Set(follows.values());
    for (const t of s.tokens) if (leaders.has(t.id) && !follows.has(t.id)) out.push(t);
  }
  return out;
}

/** Holt eine Gruppe samt Anführer in die angezeigte Szene. */
async function fetchGroup(oldLeader, scene, cell) {
  const g = gridAdapter(scene);
  const TokenDoc = foundry.documents.TokenDocument.implementation;
  const shadow = TokenDoc.fromSource(oldLeader.toObject(), { parent: scene });
  const d = oldLeader.toObject();
  d._id = scene.tokens.has(oldLeader.id) ? foundry.utils.randomID() : oldLeader.id;
  Object.assign(d, positionForCell(shadow, cell, g));
  const [leader] = await scene.createEmbeddedDocuments("Token", [d], { keepId: true, [TRANSFER]: true });
  if (!leader) return;
  await transferGroup(oldLeader, leader);
  await oldLeader.parent.deleteEmbeddedDocuments("Token", [oldLeader.id],
    { replacements: { [oldLeader.id]: leader.uuid }, [TRANSFER]: true });
}

/**
 * Angebot, Gruppen aus anderen Szenen hierher zu holen — für den Knopf und
 * wenn eine Szene aktiviert wird.
 */
export async function offerFetchGroups({ scene = canvas.scene, quiet = false } = {}) {
  if (!game.user.isGM || !scene) return;
  const leaders = leadersElsewhere(scene);
  if (!leaders.length) {
    if (!quiet) ui.notifications.info("ABOREA: In anderen Szenen führt niemand eine Gruppe.");
    return;
  }
  const rows = leaders.map(t => {
    const n = groupMembers(followsIn(t.parent), t.id).length;
    return `<label style="display:flex;align-items:center;gap:8px;margin:2px 0">
      <input type="checkbox" name="${t.parent.id}.${t.id}" ${quiet ? "" : "checked"} />
      <img src="${esc(t.texture?.src ?? "icons/svg/mystery-man.svg")}" width="28" height="28" style="border:none" />
      <span>${esc(t.name)} mit ${n} Folgenden <em class="hint">(aus „${esc(t.parent.name)}“)</em></span>
    </label>`;
  }).join("");
  const data = await foundry.applications.api.DialogV2.input({
    window:  { title: `Gruppen nach „${scene.name}“ holen?` },
    content: `<p class="hint">Angehakte Gruppen kommen samt Anführer in die Mitte des sichtbaren Ausschnitts.</p>${rows}`,
    ok: { label: "Hierher holen", icon: "fa-solid fa-people-arrows" },
    rejectClose: false,
  });
  if (!data) return;
  const chosen = Object.entries(foundry.utils.flattenObject(data)).filter(([, v]) => v === true).map(([k]) => k);
  if (!chosen.length) return;

  const g = gridAdapter(scene);
  const view = canvas.scene?.id === scene.id ? canvas.stage.pivot : { x: scene.dimensions.width / 2, y: scene.dimensions.height / 2 };
  let cell = g.offset(view);
  for (const key of chosen) {
    const [sceneId, tokenId] = key.split(".");
    const oldLeader = game.scenes.get(sceneId)?.tokens.get(tokenId);
    if (!oldLeader) continue;
    await fetchGroup(oldLeader, scene, cell);
    cell = { i: cell.i + 3, j: cell.j };   // die nächste Gruppe etwas daneben
  }
}

/** Ein verknüpfter Anführer wurde in eine andere Szene gezogen: Gruppe mitnehmen? */
async function onLeaderDraggedIn(newLeader) {
  const others = leadersElsewhere(newLeader.parent);
  const kind = classifyNewToken({
    token: { id: newLeader.id, actorId: newLeader.actorId, actorLink: newLeader.actorLink, sceneId: newLeader.parent.id },
    others: [
      ...others.map(t => ({ id: t.id, actorId: t.actorId, sceneId: t.parent.id, hasFollowers: true })),
      ...[...game.scenes].filter(s => s.id !== newLeader.parent.id && s.tokens.has(newLeader.id))
        .map(s => ({ id: newLeader.id, actorId: newLeader.actorId, sceneId: s.id, hasFollowers: false })),
    ],
  });
  if (kind !== "dragIn") return;
  const oldLeader = others.find(t => t.actorId === newLeader.actorId);
  const n = groupMembers(followsIn(oldLeader.parent), oldLeader.id).length;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window:  { title: "Gruppe mitnehmen?" },
    content: `<p>${esc(newLeader.name)} führt in „${esc(oldLeader.parent.name)}“ eine Gruppe mit ${n} Folgenden.
      Sollen sie mitkommen? Der alte Token von ${esc(newLeader.name)} dort wird dann entfernt.</p>`,
    rejectClose: false,
  });
  // Während der Frage kann die Gruppe schon anders umgezogen sein.
  if (!ok || !oldLeader.parent?.tokens.has(oldLeader.id) || !newLeader.parent?.tokens.has(newLeader.id)) return;
  await transferGroup(oldLeader, newLeader);
  await oldLeader.parent.deleteEmbeddedDocuments("Token", [oldLeader.id],
    { replacements: { [oldLeader.id]: newLeader.uuid }, [TRANSFER]: true });
}

/** HTML-sicher für Namen im Dialog. */
const esc = s => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/**
 * Folgen-Dialog eines Anführers: alle anderen Tokens der Szene zum Anhaken.
 *
 * Vorher musste man die Folgenden auswählen und den Anführer mit T markieren.
 * Das scheiterte schon am Auswählen: im eigenen Reiter bleibt die Leinwand auf
 * der Ebene stehen, die zuletzt aktiv war (siehe scene-controls.mjs, Lehre 4),
 * und war das nicht die Token-Ebene, liess sich gar nichts anklicken. Eine
 * Liste zum Anhaken braucht keine Auswahl.
 *
 * Vorab angehakt: wer schon folgt, und wer gerade ausgewählt ist.
 */
export async function openFollowDialog(leaderDoc) {
  if (!game.user.isGM || !leaderDoc) return;
  const scene    = leaderDoc.parent;
  const selected = new Set((canvas.tokens?.controlled ?? []).map(t => t.id));
  const others   = [...scene.tokens].filter(t => t.id !== leaderDoc.id && t.actor?.type !== "loot")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!others.length) {
    ui.notifications.warn("ABOREA: Auf dieser Szene gibt es keine anderen Tokens.");
    return;
  }

  const rows = others.map(t => {
    const f = followOf(t);
    const checked = f?.leader === leaderDoc.id || (!f && selected.has(t.id));
    const note = f?.leader && f.leader !== leaderDoc.id
      ? ` <em class="hint">(folgt ${esc(scene.tokens.get(f.leader)?.name ?? "?")})</em>` : "";
    return `<label class="aborea-follow-row" style="display:flex;align-items:center;gap:8px;margin:2px 0">
      <input type="checkbox" name="${t.id}" ${checked ? "checked" : ""} />
      <img src="${esc(t.texture?.src ?? "icons/svg/mystery-man.svg")}" width="28" height="28" style="border:none" />
      <span>${esc(t.name)}${note}</span>
    </label>`;
  }).join("");

  const data = await foundry.applications.api.DialogV2.input({
    window:  { title: `Wer folgt ${leaderDoc.name}?` },
    content: `<p class="hint">Angehakte Tokens laufen ${esc(leaderDoc.name)} hinterher, im Gänsemarsch und um Wände herum.</p>
      <div style="max-height:360px;overflow-y:auto">${rows}</div>`,
    ok: { label: "Übernehmen", icon: "fa-solid fa-person-walking-arrow-right" },
    rejectClose: false,
  });
  if (!data) return;

  const chosenIds = Object.entries(data).filter(([, v]) => v === true).map(([k]) => k);
  await applyFollow(leaderDoc, chosenIds);
}

/** Setzt die Folgen-Angaben für einen Anführer und meldet das Ergebnis. */
async function applyFollow(leaderDoc, chosenIds) {
  const scene = leaderDoc.parent;
  const { set, unset, refused } = followChanges({
    tokens: [...scene.tokens].map(t => ({ id: t.id, ...(followOf(t) ?? {}) })),
    leaderId: leaderDoc.id, chosenIds,
  });
  for (const { id, order } of set) await scene.tokens.get(id)?.setFlag(SYSTEM_ID, FOLLOW_FLAG, { leader: leaderDoc.id, order });
  for (const id of unset) await scene.tokens.get(id)?.unsetFlag(SYSTEM_ID, FOLLOW_FLAG);
  if (!TRAILS.has(leaderDoc.id)) TRAILS.set(leaderDoc.id, [cellOfPosition(leaderDoc, leaderDoc, gridAdapter(leaderDoc.parent))]);

  const name = id => scene.tokens.get(id)?.name ?? "?";
  const now  = followersOf(leaderDoc).map(t => t.name);
  ui.notifications.info(now.length
    ? `ABOREA: ${now.join(", ")} folgt ${leaderDoc.name}.`
    : `ABOREA: Niemand folgt ${leaderDoc.name}.`);
  if (refused.length) ui.notifications.warn(
    `ABOREA: ${refused.map(name).join(", ")} kann ${leaderDoc.name} nicht folgen — das ergäbe einen Kreis.`);
}

/**
 * Der Anführer für den Knopf in der Werkzeugleiste: der eine markierte
 * Token, sonst der eine ausgewählte.
 */
function leaderFromCanvas() {
  const targets = [...(game.user.targets ?? [])];
  if (targets.length === 1) return targets[0].document;
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length === 1) return controlled[0].document;
  return null;
}

/** Folgen beenden — für die ausgewählten Tokens, ohne Auswahl für alle der Szene. */
export async function stopFollowing() {
  const chosen = (canvas.tokens?.controlled ?? []).map(t => t.document);
  const docs = (chosen.length ? chosen : [...canvas.scene.tokens]).filter(d => followOf(d));
  for (const doc of docs) await doc.unsetFlag(SYSTEM_ID, FOLLOW_FLAG);
  ui.notifications.info(docs.length
    ? `ABOREA: ${docs.map(d => d.name).join(", ")} folgt niemandem mehr.`
    : "ABOREA: Niemand folgte.");
}

/** Knöpfe im Rechtsklick-Menü eines Tokens (nur Spielleiter). */
function addHudButtons(hud, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
  const doc  = hud?.object?.document;
  if (!root?.querySelector || !doc || doc.actor?.type === "loot") return;
  const column = root.querySelector(".col.left") ?? root.querySelector(".left");
  if (!column) return;

  const button = (icon, title, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon aborea-hud-follow";
    btn.title = title;
    btn.innerHTML = `<i class="${icon}"></i>`;
    btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); onClick(); });
    column.appendChild(btn);
  };

  const count = followersOf(doc).length;
  button("fa-solid fa-person-walking-arrow-right",
    count ? `Folgen: ${count} folgen diesem Token — ändern` : "Folgen: wer soll diesem Token folgen?",
    () => openFollowDialog(doc));

  const f = followOf(doc);
  if (f?.leader) button("fa-solid fa-link-slash",
    `Folgt ${doc.parent.tokens.get(f.leader)?.name ?? "?"} — nicht mehr folgen`,
    async () => {
      await doc.unsetFlag(SYSTEM_ID, FOLLOW_FLAG);
      ui.notifications.info(`ABOREA: ${doc.name} folgt niemandem mehr.`);
      hud.render?.();
    });
}

export function registerFollow() {
  game.settings.register(SYSTEM_ID, DEBUG_SETTING, {
    name: "Folgen: Diagnose in der Konsole",
    hint: "Schreibt bei jeder Bewegung eines Anführers Weg, Plan und Ergebnis in die Browser-Konsole (F12). Nur zur Fehlersuche.",
    scope: "client", config: true, type: Boolean, default: false,
  });

  Hooks.on("moveToken", (doc, movement, operation) => {
    // Nur ein Client führt aus — sonst zieht jeder Spielleiter die Folgenden.
    if (!game.users.activeGM?.isSelf) return;
    const kind = movementKind(movement);
    debug("Anführer bewegt", doc.name, kind, movement?.method,
      (movement?.passed?.waypoints ?? []).map(w => `${w.x},${w.y}${w.action === "displace" ? "!" : ""}`).join(" "));
    if (kind === "ignore") return;
    // Wer im selben Vorgang mitbewegt wurde (Foundry schickt alle gezogenen
    // Tokens in einem Update, Token#_onDragLeftDrop, v13.351).
    const together = new Set(Object.keys(operation?._movement ?? operation?.movement ?? {}));
    together.delete(doc.id);
    const prev = QUEUES.get(doc.id) ?? Promise.resolve();
    const next = prev.then(() => moveFollowers(doc, movement, together)).catch(err => console.error("ABOREA | Folgen", err));
    QUEUES.set(doc.id, next);
  });

  // Gelöschter Anführer. Mit `replacements` ist er nicht weg, sondern
  // umgezogen: so meldet Foundrys Teleport-Region den Wechsel in eine andere
  // Szene (RegionDocument#teleportToken, v13.351) — die Gruppe geht mit.
  // Ohne folgen die Folgenden niemandem mehr.
  Hooks.on("deleteToken", async (doc, options) => {
    TRAILS.delete(doc.id);
    if (!game.users.activeGM?.isSelf || options?.[TRANSFER]) return;
    try {
      const uuid = options?.replacements?.[doc.id];
      const moved = uuid ? await fromUuid(uuid) : null;
      if (moved && moved.parent?.id !== doc.parent?.id) return await transferGroup(doc, moved);
      for (const f of followersOf(doc)) await f.unsetFlag(SYSTEM_ID, FOLLOW_FLAG);
    } catch (err) { console.error("ABOREA | Folgen beim Löschen", err); }
  });

  // Ein verknüpfter Anführer wurde in eine andere Szene gezogen.
  // Foundrys Teleport legt mit keepId an und meldet sich gleich danach
  // beim Löschen — das übernimmt der Hook oben.
  Hooks.on("createToken", (doc, options) => {
    if (!game.users.activeGM?.isSelf || options?.[TRANSFER] || options?.keepId) return;
    onLeaderDraggedIn(doc).catch(err => console.error("ABOREA | Folgen beim Anlegen", err));
  });

  // Eine andere Szene wird aktiviert: Gruppen von anderswo herholen?
  Hooks.on("updateScene", (scene, changes) => {
    if (!changes?.active || !game.users.activeGM?.isSelf) return;
    offerFetchGroups({ scene, quiet: true }).catch(err => console.error("ABOREA | Gruppen holen", err));
  });

  Hooks.on("renderTokenHUD", addHudButtons);

  registerSceneControlGroup({
    name:  "aborea-follow",
    title: "ABOREA Folgen",
    icon:  "fa-solid fa-people-line",
    order: 81,
    tools: [
      { name: "aborea-follow-start",
        title: "Folgen — wer folgt dem ausgewählten Token? (einfacher: Rechtsklick auf den Anführer)",
        icon: "fa-solid fa-person-walking-arrow-right",
        onClick: () => {
          const leader = leaderFromCanvas();
          if (leader) return openFollowDialog(leader);
          ui.notifications.warn("ABOREA: Erst den Anführer anklicken — oder Rechtsklick auf ihn und dort „Folgen“.");
        } },
      { name: "aborea-follow-fetch",
        title: "Gruppe hierher holen — Anführer samt Folgenden aus einer anderen Szene",
        icon: "fa-solid fa-people-arrows",
        onClick: () => offerFetchGroups() },
      { name: "aborea-follow-stop",
        title: "Folgen beenden — ausgewählte, ohne Auswahl alle der Szene",
        icon: "fa-solid fa-link-slash",
        onClick: () => stopFollowing() },
    ],
  });
}
