// module/declaration.mjs — Rundenerklärung
//
// Der Kampfbonus ist eine Ressource pro Runde: er wird auf Offensive und
// Defensive aufgeteilt, und beim Zaubern zählt er vollständig offensiv.
//
// Vorher war die Aufteilung eine stehende Zahl auf dem Charakterbogen, die
// niemand je wieder anfasste. Hier ist sie ein Beschluss je Runde — mit der
// Rundennummer daran, damit er von selbst verfällt und nichts aufgeräumt
// werden muss.
//
// Reine Funktionen: die Schreibseite steht in combat.mjs, die Anzeige im
// Tracker. Hier drin ist alles ohne Foundry prüfbar.

export const SYSTEM_FLAG = "aborea-v7";
export const DECLARATION = "declaration";

/** Die Erklärung eines Actors, falls sie für diese Runde gilt — sonst null. */
export function declarationFor(actor, round) {
  if (!round) return null;
  const d = actor?.flags?.[SYSTEM_FLAG]?.[DECLARATION];
  if (!d) return null;
  return Number(d.round) === Number(round) ? d : null;
}

/**
 * Offensiv/Defensiv-Aufteilung für die laufende Runde.
 *
 * Ohne Erklärung gilt die gespeicherte Aufteilung vom Bogen als Vorbelegung
 * (`declared: false`) — so ändert sich für niemanden etwas, der die neue
 * Mechanik nicht benutzt. Mit Erklärung wird aus dem Kampfbonus gerechnet.
 *
 * @returns {{declared, locked, mode, pool, offensive, defensive}}
 */
export function roundSplit(actor, round) {
  const combat = actor?.system?.combat ?? {};
  const pool   = Number(combat.combatBonus ?? 0);
  const decl   = declarationFor(actor, round);

  if (!decl) {
    return {
      declared: false, locked: false, mode: "weapon", pool,
      offensive: Number(combat.offensiveBonus ?? 0),
      defensive: Number(combat.defensiveBonus ?? 0),
      defenseAllocation: null,
    };
  }

  // Zaubern bindet den Kampfbonus vollständig offensiv.
  if (decl.mode === "spell") {
    return { declared: true, locked: !!decl.locked, mode: "spell", pool,
             offensive: pool, defensive: 0, defenseAllocation: null };
  }

  const offensive = clampOffensive(decl.offensive, pool);
  return {
    declared: true, locked: !!decl.locked, mode: "weapon", pool, offensive,
    defensive: pool - offensive,
    defenseAllocation: decl.defenseAllocation ?? null,
  };
}

/**
 * In welchem Bereich darf der Offensivanteil liegen?
 *
 * Regelwerk S. 33: *„Ein negativer Kampfbonus wirkt sich nicht auf den DB aus,
 * sondern ist vollständig dem OB zuzurechnen."*
 *
 * Ein negativer Bonus lässt sich also **nicht** verteilen — er geht ganz in
 * die Offensive, die Defensive bleibt bei 0. Weder darf der Defensivbonus
 * negativ werden, noch kann man einen Wert ins Minus drücken, um den anderen
 * zu erhöhen. Nur ein positiver Bonus wird zwischen 0 und dem vollen Wert
 * aufgeteilt.
 */
export function splitRange(pool) {
  const p = Number(pool) || 0;
  if (p < 0) return { min: p, max: p };   // keine Wahl: vollständig offensiv
  return { min: 0, max: p };
}

/** Hält den Offensivanteil im erlaubten Bereich — auch bei negativem Bonus. */
export function clampOffensive(offensive, pool) {
  const { min, max } = splitRange(pool);
  return Math.max(min, Math.min(max, Number(offensive) || 0));
}

/**
 * Überträgt eine bestehende Aufteilung auf einen neuen Kampfbonus, wenn der
 * sich ändert (Fertigkeit gesteigert, Waffe gewechselt, Stufe aufgestiegen).
 *
 * Das Verhältnis bleibt erhalten, soweit es eins gibt. Ohne brauchbare
 * Vorgeschichte — etwa wenn der alte Bonus 0 war — geht alles offensiv;
 * eine Division durch 0 hätte sonst NaN in den Actor geschrieben.
 */
export function carrySplit(previousOffensive, previousPool, newPool) {
  const prevPool = Number(previousPool) || 0;
  const prevOff  = Number(previousOffensive) || 0;
  const pool     = Number(newPool) || 0;
  const ratio    = prevPool !== 0 ? prevOff / prevPool : 1;
  return clampOffensive(Math.round(pool * ratio), pool);
}

/** Eine neue Erklärung für diese Runde — ungespeichert, nur der Wert. */
export function buildDeclaration(round, {
  mode = "weapon", offensive = 0, pool = 0, locked = false, defenseAllocation = null,
} = {}) {
  const decl = {
    round: Number(round),
    mode:  mode === "spell" ? "spell" : "weapon",
    offensive: mode === "spell" ? Number(pool) : clampOffensive(offensive, pool),
    locked: !!locked,
  };
  // Zaubern bindet den Kampfbonus offensiv — es bleibt nichts zu verteilen.
  if (decl.mode === "weapon" && defenseAllocation && Object.keys(defenseAllocation).length) {
    decl.defenseAllocation = defenseAllocation;
  }
  return decl;
}

/**
 * Verteilt den Defensivbonus auf die Angreifer.
 *
 * Regelwerk S. 33: der DB kann bei mehreren Angreifern aufgeteilt werden;
 * reicht er nicht für alle, wird er nur bei den zuerst bedachten Gegnern
 * abgezogen. „Zuerst" heißt hier Initiative-Reihenfolge.
 *
 * Ohne ausdrückliche Zuweisung bekommt der erste Angreifer den vollen Bonus
 * und die übrigen nichts — so greift er einmal statt gegen jeden.
 *
 * @param {number}   pool         Defensivbonus des Verteidigers
 * @param {string[]} attackerIds  Angreifer in Initiative-Reihenfolge
 * @param {object}   [allocation] ausdrückliche Zuweisung { id: Anteil }
 * @returns {object} vollständige Zuweisung; die Summe übersteigt nie den Pool
 */
export function allocateDefense(pool, attackerIds = [], allocation = null) {
  const total = Math.max(0, Number(pool) || 0);
  const ids   = Array.isArray(attackerIds) ? attackerIds : [];
  const explicit = allocation && Object.keys(allocation).length > 0;

  const out = {};
  let left = total;
  for (const id of ids) {
    const wanted = explicit ? Math.max(0, Number(allocation[id]) || 0) : left;
    const give   = Math.min(wanted, left);
    out[id] = give;
    left -= give;
  }
  return out;
}

/** Der Anteil, der gegen einen bestimmten Angreifer zählt. */
export function defenseAgainst(pool, attackerIds, allocation, attackerId) {
  return allocateDefense(pool, attackerIds, allocation)[attackerId] ?? 0;
}

/** Kurzform für den Combat Tracker: "⚔4 / 🛡2" oder "✨ Zauber". */
export function splitLabel(split) {
  if (split.mode === "spell") return "✨ Zauber";
  return `⚔${split.offensive} / 🛡${split.defensive}`;
}

/**
 * Darf die Erklärung noch geändert werden?
 * Bis zur ersten Handlung in dieser Runde ja — danach steht sie.
 */
export function canRedeclare(actor, round) {
  const decl = declarationFor(actor, round);
  return !decl?.locked;
}
