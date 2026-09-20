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
      defenseSpent: null,
    };
  }

  // Zaubern bindet den Kampfbonus vollständig offensiv.
  if (decl.mode === "spell") {
    return { declared: true, locked: !!decl.locked, mode: "spell", pool,
             offensive: pool, defensive: 0, defenseSpent: null };
  }

  // Flucht ist die einzige Handlung der Runde — es wird nicht angegriffen,
  // der Kampfbonus steht also vollständig der Verteidigung zur Verfügung.
  if (decl.mode === "flee") {
    return { declared: true, locked: !!decl.locked, mode: "flee", pool,
             offensive: 0, defensive: Math.max(0, pool),
             defenseSpent: decl.defenseSpent ?? null };
  }

  const offensive = clampOffensive(decl.offensive, pool);
  return {
    declared: true, locked: !!decl.locked, mode: "weapon", pool, offensive,
    defensive: pool - offensive,
    defenseSpent: decl.defenseSpent ?? null,
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
  mode = "weapon", offensive = 0, pool = 0, locked = false, defenseSpent = null,
} = {}) {
  const decl = {
    round: Number(round),
    mode:  ["spell", "flee"].includes(mode) ? mode : "weapon",
    offensive: mode === "spell" ? Number(pool)
             : mode === "flee"  ? 0
             : clampOffensive(offensive, pool),
    locked: !!locked,
  };
  // Beim Zaubern bleibt nichts zu verbrauchen; beim Fliehen und Kämpfen schon.
  if (decl.mode !== "spell" && defenseSpent && Object.keys(defenseSpent).length) {
    decl.defenseSpent = defenseSpent;
  }
  return decl;
}

// ── Defensivbonus als Vorrat ────────────────────────────────────────────────
//
// Regelwerk S. 33: der DB kann bei mehreren Angreifern aufgeteilt werden;
// reicht er nicht für alle, wird er nur bei den zuerst bedachten Gegnern
// abgezogen.
//
// Eine Verteilung zu Rundenbeginn wäre Raten: die Zugreihenfolge steht zwar
// fest, wer wen angreift aber nicht. Deshalb ist der DB ein **Vorrat**, der
// sich verbraucht, wenn die Angriffe tatsächlich eintreffen. „Zuerst bedacht"
// sind damit die, bei denen zuerst abgezogen wurde.

/** Wie viel des Defensivbonus bereits verbraucht ist. */
export function defenseSpentTotal(spent) {
  return Object.values(spent ?? {}).reduce((sum, v) => sum + (Math.max(0, Number(v)) || 0), 0);
}

/** Wie viel vom Defensivbonus noch übrig ist. */
export function defenseRemaining(defensive, spent) {
  return Math.max(0, (Math.max(0, Number(defensive)) || 0) - defenseSpentTotal(spent));
}

/**
 * Zieht einen Anteil des Defensivbonus für einen Angreifer ab.
 *
 * Gegen denselben Angreifer zählt in einer Runde derselbe Anteil — ein
 * zweiter Angriff desselben Gegners kostet nichts zusätzlich, sonst würde
 * der Vorrat bei mehreren Schlägen doppelt schmelzen.
 *
 * @param {number} defensive  Defensivbonus dieser Runde
 * @param {object} spent      bisher Verbrauchtes { angreiferId: Anteil }
 * @param {string} attackerId
 * @param {number} [wanted]   gewünschter Anteil; ohne Angabe alles Verbliebene
 * @returns {{applied, spent, remaining}} applied zählt gegen diesen Angreifer
 */
export function spendDefense(defensive, spent, attackerId, wanted = null) {
  const current = spent?.[attackerId];
  if (current != null) {
    // Schon gegen diesen Angreifer eingesetzt — gilt weiter, kostet nichts.
    const applied = Math.max(0, Number(current)) || 0;
    return { applied, spent: { ...spent }, remaining: defenseRemaining(defensive, spent) };
  }
  const left    = defenseRemaining(defensive, spent);
  const ask     = wanted == null ? left : Math.max(0, Number(wanted) || 0);
  const applied = Math.min(ask, left);
  const next    = { ...(spent ?? {}), [attackerId]: applied };
  return { applied, spent: next, remaining: defenseRemaining(defensive, next) };
}

/** Der Anteil, der gegen einen Angreifer zählt, ohne etwas zu verbrauchen. */
export function defenseAgainst(defensive, spent, attackerId) {
  const current = spent?.[attackerId];
  if (current != null) return Math.max(0, Number(current)) || 0;
  return defenseRemaining(defensive, spent);
}

/** Kurzform für den Combat Tracker: "⚔4 / 🛡2" oder "✨ Zauber". */
export function splitLabel(split) {
  if (split.mode === "spell") return "✨ Zauber";
  if (split.mode === "flee")  return `🏃 Flucht / 🛡${split.defensive}`;
  return `⚔${split.offensive} / 🛡${split.defensive}`;
}

// ── Flucht ───────────────────────────────────────────────────────
//
// Wer flieht, bekommt vom Gegner (fast) immer noch einen letzten Angriff ab.
// Nur die Initiative entscheidet, wie schwer der zu treffen ist.

/**
 * Bonus auf den Defensivbonus des Fliehenden gegen diesen einen Angreifer.
 *
 * Ist der Fliehende schneller, bekommt er die Initiative-Differenz auf den DB
 * gutgeschrieben: bei Flucht mit INI +2 gegen einen Gegner mit INI −1 sind
 * das 2 − (−1) = 3 Punkte. Ist er langsamer, gibt es keinen Abzug — der
 * Gegner schlägt schlicht noch einmal zu.
 */
export function fleeDefenseBonus(fleeingInitiative, attackerInitiative) {
  const diff = (Number(fleeingInitiative) || 0) - (Number(attackerInitiative) || 0);
  return Math.max(0, diff);
}

/** Flieht dieser Actor in der angegebenen Runde? */
export function isFleeing(actor, round) {
  return declarationFor(actor, round)?.mode === "flee";
}

/**
 * Darf die Erklärung noch geändert werden?
 * Bis zur ersten Handlung in dieser Runde ja — danach steht sie.
 */
export function canRedeclare(actor, round) {
  const decl = declarationFor(actor, round);
  return !decl?.locked;
}
