// module/targeting.mjs — Zielauswahl und Angriffsplanung
//
// Reine Funktionen, damit die Auswahl ohne Foundry prüfbar ist: combat.mjs
// reicht die Tokens vom Canvas herein und rendert das Ergebnis.

import { roundSplit } from "./declaration.mjs";

/**
 * Welche Tokens kommen als Ziel infrage?
 *
 * Mit laufendem Kampf nur die Kombattanten — sonst würde die Liste bei großen
 * Szenen unbrauchbar lang. Ohne Kampf alle bespielbaren Tokens, damit ein
 * Hinterhalt oder ein Schlagabtausch außerhalb der Initiative nicht an einer
 * leeren Auswahl scheitert.
 *
 * @param {Array}  tokens            [{id, name, actor}]
 * @param {string} [attackerTokenId] wird ausgelassen
 * @param {Set|null} [combatTokenIds] null = kein laufender Kampf
 * @param {string[]} [excludeTypes]  Actor-Typen, die nie Ziel sind
 */
export function selectTargetTokens(tokens, {
  attackerTokenId = "", combatTokenIds = null, excludeTypes = ["loot"], lang = "de",
} = {}) {
  return (tokens ?? [])
    .filter(t => t?.actor)
    .filter(t => t.id !== attackerTokenId)
    .filter(t => !excludeTypes.includes(t.actor.type))
    .filter(t => !combatTokenIds || combatTokenIds.has(t.id))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), lang));
}

/**
 * Die Waffe, mit der ein Actor standardmäßig angreift: die ausgerüstete mit
 * dem höchsten Schaden. Kreaturen und NPCs ohne Waffen-Items greifen nativ an.
 */
export function defaultWeapon(actor) {
  const equipped = (actor?.items ?? []).filter(i => i.type === "weapon" && i.system?.equipped);
  if (!equipped.length) return null;
  return equipped.reduce((best, w) =>
    Number(w.system.damage ?? 0) > Number(best.system.damage ?? 0) ? w : best);
}

/**
 * Angriffsparameter eines Actors für eine Runde — dieselbe Rechnung für den
 * Einzel- und den Gruppenangriff, damit beide nicht auseinanderlaufen.
 *
 * Der Offensivbonus kommt aus der Rundenerklärung: wer Zaubern erklärt hat,
 * hat seinen Kampfbonus dort gebunden und schlägt mit 0 zu.
 */
export function attackPlan(actor, { round = null, weapon = undefined, situMod = 0 } = {}) {
  const split = roundSplit(actor, round);
  const chosen = weapon === undefined ? defaultWeapon(actor) : weapon;
  return {
    actor,
    weapon:   chosen,
    offBonus: split.mode === "spell" ? 0 : split.offensive,
    mode:     split.mode,
    declared: split.declared,
    situMod:  Number(situMod) || 0,
  };
}
