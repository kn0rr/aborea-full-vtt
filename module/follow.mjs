// module/follow.mjs — Tokens folgen einem anderen Token
//
// Der Spielleiter wählt die Folgenden aus und markiert den Anführer (T).
// Bewegt sich der Anführer, ziehen die anderen im Gänsemarsch hinterher: jeder
// auf ein Feld der Spur, die der Anführer gerade gegangen ist — der erste
// direkt hinter ihn, der zweite eins dahinter, und so fort.
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
export const TRAIL_LENGTH = 60;

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
 * Plätze in der Spur, vom Anführer rückwärts: Platz 0 ist das letzte Feld
 * vor ihm, Platz 1 das davor. Jedes Feld nur einmal, das Feld des Anführers
 * nie. Ist die Spur kürzer, gibt es weniger Plätze.
 */
export function followSlots(trail = [], leaderCell, count) {
  const slots = [];
  const seen  = new Set(leaderCell ? [cellKey(leaderCell)] : []);
  for (let n = (trail?.length ?? 0) - 1; n >= 0 && slots.length < count; n--) {
    const k = cellKey(trail[n]);
    if (seen.has(k)) continue;
    seen.add(k);
    slots.push({ i: trail[n].i, j: trail[n].j });
  }
  return slots;
}

/**
 * Freie, erreichbare Felder rund um ein Feld, nächstgelegene zuerst
 * (Breitensuche). Ersatz, wenn die Spur nicht genug Plätze hergibt.
 */
export function nearbyCells(center, count, { neighbors, blocked = () => false, exclude = new Set(), maxNodes = MAX_SEARCH_NODES } = {}) {
  const out  = [];
  const seen = new Set([cellKey(center)]);
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
 * Plant die Bewegung aller Folgenden.
 *
 * Reihenfolge ist die Reihenfolge von `followers`. Jeder bekommt einen
 * eigenen Zielplatz — kein Feld doppelt, das des Anführers nie. Ist sein
 * Platz unerreichbar, geht er auf dem Weg zum Anführer so weit, wie es geht,
 * ohne auf einem belegten Feld zu enden. Ist auch das unmöglich, bleibt er.
 *
 * @param {object} p
 * @param {{i,j}} p.leaderCell
 * @param {Array<{i,j}>} p.trail
 * @param {Array<{id, cell}>} p.followers
 * @param {(id) => object} p.searchFor  liefert je Folgendem {neighbors, blocked, cost, heuristic}
 * @returns {Array<{id, path, stuck}>}  path beginnt beim aktuellen Feld; leer = bleibt stehen
 */
export function planFollow({ leaderCell, trail, followers = [], searchFor }) {
  const taken = new Set([cellKey(leaderCell)]);
  // Wo noch nicht eingeplante Folgende stehen, darf niemand hin — vielleicht
  // bleiben sie stehen. Gezählt, weil zwei auf einem Feld beginnen können.
  const waiting = new Map();
  for (const f of followers) waiting.set(cellKey(f.cell), (waiting.get(cellKey(f.cell)) ?? 0) + 1);
  const occupied = k => taken.has(k) || (waiting.get(k) ?? 0) > 0;

  // Mehr Plätze als Folgende: einige fallen weg, weil dort jemand wartet.
  const want  = followers.length * 2;
  const slots = followSlots(trail, leaderCell, want);
  if (followers.length && slots.length < want) {
    const s = searchFor(followers[0].id) ?? {};
    slots.push(...nearbyCells(leaderCell, want - slots.length, {
      ...s, exclude: new Set([...taken, ...slots.map(cellKey)]),
    }));
  }

  const plans = [];
  for (const f of followers) {
    const own = cellKey(f.cell);
    waiting.set(own, waiting.get(own) - 1);
    const search = searchFor(f.id) ?? {};

    // Der vorderste noch freie Platz. Steht er schon darauf, ist der Weg
    // nur sein eigenes Feld, und er bleibt.
    const wanted = slots.find(s => !occupied(cellKey(s)));
    let path = wanted ? findPath(f.cell, wanted, search) : null;

    if (!path) {
      // Sein Platz ist unerreichbar: Richtung Anführer, bis vor das erste
      // belegte Feld am Ende des Weges.
      const toLeader = findPath(f.cell, leaderCell, search);
      if (toLeader) {
        path = toLeader;
        while (path.length > 1 && occupied(cellKey(path.at(-1)))) path = path.slice(0, -1);
      }
    }

    const end = path?.at(-1) ?? f.cell;
    if (path && occupied(cellKey(end))) path = null;   // nur noch auf belegtem Feld möglich
    const finalCell = path?.at(-1) ?? f.cell;
    taken.add(cellKey(finalCell));
    plans.push({ id: f.id, path: path && path.length > 1 ? path : [], stuck: !path });
  }
  return plans;
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

/** Raster der aktuellen Szene; ohne Raster ein gedachtes Quadratraster. */
function gridAdapter() {
  const grid = canvas.grid;
  if (!grid.isGridless) {
    return {
      offset:    p => grid.getOffset(p),
      center:    c => grid.getCenterPoint(c),
      neighbors: c => grid.getAdjacentOffsets(c),
      line:      (a, b) => grid.getDirectPath([a, b]),
      cost:      grid.isSquare ? squareStepCost : () => 1,
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

/** Wegsuche für einen Folgenden: Wände über seine eigene Kollisionsprüfung. */
function searchOptions(doc, g) {
  const token = doc.object;
  const { width, height } = canvas.dimensions.sceneRect;
  const { x: sx, y: sy } = canvas.dimensions.sceneRect;
  const cache = new Map();
  const centerFor = cell => {
    const p = positionForCell(doc, cell, g);
    return doc.getCenterPoint({ ...p, elevation: doc.elevation, width: doc.width, height: doc.height, shape: doc.shape });
  };
  return {
    neighbors: g.neighbors,
    cost: g.cost,
    heuristic: (a, b) => {
      const pa = g.center(a), pb = g.center(b);
      return Math.hypot(pa.x - pb.x, pa.y - pb.y) / g.size;
    },
    blocked: (a, b) => {
      const k = `${cellKey(a)}>${cellKey(b)}`;
      if (cache.has(k)) return cache.get(k);
      const to = centerFor(b);
      const out = to.x < sx || to.y < sy || to.x > sx + width || to.y > sy + height
        || !!token?.checkCollision(to, { origin: centerFor(a), type: "move", mode: "any" });
      cache.set(k, out);
      return out;
    },
  };
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

/** Die Folgenden eines Anführers in ihrer Reihenfolge. */
function followersOf(leaderDoc) {
  return leaderDoc.parent.tokens
    .filter(t => followOf(t)?.leader === leaderDoc.id)
    .sort((a, b) => (followOf(a).order ?? 0) - (followOf(b).order ?? 0));
}

async function moveFollowers(leaderDoc, movement) {
  const followers = followersOf(leaderDoc);
  if (!followers.length) return;
  if (canvas.scene?.id !== leaderDoc.parent.id) return;   // Wände nur auf der eigenen Leinwand prüfbar

  const g = gridAdapter();
  const leaderCell = cellOfPosition(leaderDoc, leaderDoc, g);
  const trail = extendTrail(TRAILS.get(leaderDoc.id) ?? [], movementCells(leaderDoc, movement, g));
  TRAILS.set(leaderDoc.id, trail);

  const searches = new Map(followers.map(f => [f.id, searchOptions(f, g)]));
  const plans = planFollow({
    leaderCell, trail,
    followers: followers.map(f => ({ id: f.id, cell: cellOfPosition(f, f, g) })),
    searchFor: id => searches.get(id),
  });

  const stuck = [];
  await Promise.all(plans.map(async plan => {
    const doc = leaderDoc.parent.tokens.get(plan.id);
    if (!doc) return;
    if (plan.stuck) stuck.push(doc.name);
    if (!plan.path.length) return;
    const waypoints = plan.path.slice(1).map(c => ({ ...positionForCell(doc, c, g), snapped: true, explicit: false }));
    await doc.move(waypoints, { method: "api", autoRotate: true, showRuler: false });
  }));
  if (stuck.length) ui.notifications.warn(`ABOREA: Kein Weg für ${stuck.join(", ")} — bleibt stehen.`);
}

/** Folgen einrichten: ausgewählte Tokens folgen dem markierten. */
export async function startFollowing() {
  const targets = [...(game.user.targets ?? [])];
  if (targets.length !== 1) {
    ui.notifications.warn("ABOREA: Genau einen Anführer markieren (T), die Folgenden auswählen.");
    return;
  }
  const leader = targets[0].document;
  const chosen = canvas.tokens.controlled.map(t => t.document).filter(d => d.id !== leader.id);
  if (!chosen.length) {
    ui.notifications.warn("ABOREA: Keine Folgenden ausgewählt.");
    return;
  }

  const follows = new Map(leader.parent.tokens
    .filter(t => followOf(t)?.leader).map(t => [t.id, followOf(t).leader]));
  const already = followersOf(leader).length;
  const ok = [], refused = [];
  for (const [n, doc] of chosen.entries()) {
    if (wouldCycle(follows, doc.id, leader.id)) { refused.push(doc.name); continue; }
    await doc.setFlag(SYSTEM_ID, FOLLOW_FLAG, { leader: leader.id, order: already + n });
    follows.set(doc.id, leader.id);
    ok.push(doc.name);
  }
  TRAILS.set(leader.id, [cellOfPosition(leader, leader, gridAdapter())]);
  if (ok.length) ui.notifications.info(`ABOREA: ${ok.join(", ")} folgt ${leader.name}.`);
  if (refused.length) ui.notifications.warn(`ABOREA: ${refused.join(", ")} kann ${leader.name} nicht folgen — das ergäbe einen Kreis.`);
}

/** Folgen beenden — für die ausgewählten Tokens, ohne Auswahl für alle der Szene. */
export async function stopFollowing() {
  const chosen = canvas.tokens.controlled.map(t => t.document);
  const docs = (chosen.length ? chosen : [...canvas.scene.tokens]).filter(d => followOf(d));
  for (const doc of docs) await doc.unsetFlag(SYSTEM_ID, FOLLOW_FLAG);
  ui.notifications.info(docs.length
    ? `ABOREA: ${docs.map(d => d.name).join(", ")} folgt niemandem mehr.`
    : "ABOREA: Niemand folgte.");
}

export function registerFollow() {
  Hooks.on("moveToken", (doc, movement) => {
    // Nur ein Client führt aus — sonst zieht jeder Spielleiter die Folgenden.
    if (!game.users.activeGM?.isSelf) return;
    if (!movement?.passed?.waypoints?.length) return;
    const prev = QUEUES.get(doc.id) ?? Promise.resolve();
    const next = prev.then(() => moveFollowers(doc, movement)).catch(err => console.error("ABOREA | Folgen", err));
    QUEUES.set(doc.id, next);
  });

  // Ein gelöschter Anführer nimmt seine Folgenden nicht mit ins Nirgendwo.
  Hooks.on("deleteToken", async doc => {
    TRAILS.delete(doc.id);
    if (!game.users.activeGM?.isSelf) return;
    for (const f of followersOf(doc)) await f.unsetFlag(SYSTEM_ID, FOLLOW_FLAG);
  });

  registerSceneControlGroup({
    name:  "aborea-follow",
    title: "ABOREA Folgen",
    icon:  "fa-solid fa-people-line",
    order: 81,
    tools: [
      { name: "aborea-follow-start",
        title: "Folgen — ausgewählte Tokens folgen dem markierten (T)",
        icon: "fa-solid fa-person-walking-arrow-right",
        onClick: () => startFollowing() },
      { name: "aborea-follow-stop",
        title: "Folgen beenden — ausgewählte, ohne Auswahl alle der Szene",
        icon: "fa-solid fa-link-slash",
        onClick: () => stopFollowing() },
    ],
  });
}
