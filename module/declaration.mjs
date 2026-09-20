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

  const offensive = Math.max(0, Math.min(pool, Number(decl.offensive ?? 0)));
  return { declared: true, locked: !!decl.locked, mode: "weapon", pool, offensive, defensive: pool - offensive };
}

/** Eine neue Erklärung für diese Runde — ungespeichert, nur der Wert. */
export function buildDeclaration(round, { mode = "weapon", offensive = 0, pool = 0, locked = false } = {}) {
  return {
    round: Number(round),
    mode:  mode === "spell" ? "spell" : "weapon",
    offensive: mode === "spell" ? Number(pool) : Math.max(0, Math.min(Number(pool), Number(offensive))),
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
