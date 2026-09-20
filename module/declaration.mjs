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
    };
  }

  // Zaubern bindet den Kampfbonus vollständig offensiv.
  if (decl.mode === "spell") {
    return { declared: true, locked: !!decl.locked, mode: "spell", pool, offensive: pool, defensive: 0 };
  }

  const offensive = clampOffensive(decl.offensive, pool);
  return { declared: true, locked: !!decl.locked, mode: "weapon", pool, offensive, defensive: pool - offensive };
}

/**
 * In welchem Bereich darf der Offensivanteil liegen?
 *
 * Die einzige feste Regel ist `offensiv + defensiv = Kampfbonus`. Bei einem
 * positiven Bonus verteilt man ihn zwischen 0 und dem vollen Wert. Bei einem
 * **negativen** Bonus ist es ein Malus, den man verschieben kann: wer bei −1
 * die Offensive mit −2 belastet, bekommt dafür +1 auf die Defensive. Eine
 * Klemmung auf [0, Kampfbonus] hätte das unmöglich gemacht und jeden
 * negativen Bonus auf 0/−1 festgenagelt.
 */
export function splitRange(pool) {
  const p = Number(pool) || 0;
  return { min: Math.min(0, p * 2), max: Math.max(0, p) };
}

/** Hält den Offensivanteil im erlaubten Bereich — auch bei negativem Bonus. */
export function clampOffensive(offensive, pool) {
  const { min, max } = splitRange(pool);
  return Math.max(min, Math.min(max, Number(offensive) || 0));
}

/** Eine neue Erklärung für diese Runde — ungespeichert, nur der Wert. */
export function buildDeclaration(round, { mode = "weapon", offensive = 0, pool = 0, locked = false } = {}) {
  return {
    round: Number(round),
    mode:  mode === "spell" ? "spell" : "weapon",
    offensive: mode === "spell" ? Number(pool) : clampOffensive(offensive, pool),
    locked: !!locked,
  };
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
