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
 * Der Angreifer fällt heraus. Ist sein Token bekannt, wird genau dieses
 * ausgelassen — drei Goblins aus derselben Kreatur dürfen einander angreifen.
 * Ist es nicht bekannt, fällt der ganze Actor heraus: lieber ein Ziel zu
 * wenig als sich selbst in der Liste.
 *
 * @param {Array}  tokens            [{id, name, actor}]
 * @param {string} [attackerTokenId] wird ausgelassen
 * @param {string} [attackerActorId] Rückfallebene, wenn das Token unbekannt ist
 * @param {Set|null} [combatTokenIds] null = kein laufender Kampf
 * @param {string[]} [excludeTypes]  Actor-Typen, die nie Ziel sind
 */
export function selectTargetTokens(tokens, {
  attackerTokenId = "", attackerActorId = "", combatTokenIds = null,
  excludeTypes = ["loot"], lang = "de",
} = {}) {
  return (tokens ?? [])
    .filter(t => t?.actor)
    .filter(t => attackerTokenId
      ? t.id !== attackerTokenId
      : !(attackerActorId && t.actor.id === attackerActorId))
    .filter(t => !excludeTypes.includes(t.actor.type))
    .filter(t => !combatTokenIds || combatTokenIds.has(t.id))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), lang));
}

/**
 * Von welchem Token geht der Angriff aus?
 *
 * Bisher wurde es über den Actor gesucht: `tokens.find(t => t.actor.id === …)`.
 * Bei unverknüpften Tokens teilen sich alle Exemplare die Actor-Kennung —
 * drei Goblins aus derselben Kreatur liefern also immer den ersten. Greift
 * Goblin 2 an, wurde damit Goblin 1 aus der Zielliste geworfen und Goblin 2
 * blieb darin stehen: man konnte sich selbst angreifen.
 *
 * Reihenfolge: ausdrücklich übergeben → ausgewählt → einziges Token des
 * Actors. Bleibt es mehrdeutig, wird nichts zurückgegeben; dann greift in
 * selectTargetTokens die Rückfallebene über den Actor.
 *
 * @returns {string} Token-Kennung oder ""
 */
export function resolveAttackerToken({ tokenId = "", controlled = [], tokens = [], actorId = "" } = {}) {
  if (tokenId) return tokenId;

  const mine = t => t?.actor?.id === actorId;
  const picked = (controlled ?? []).filter(mine);
  if (picked.length === 1) return picked[0].id;

  const all = (tokens ?? []).filter(mine);
  if (all.length === 1) return all[0].id;

  return "";
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
