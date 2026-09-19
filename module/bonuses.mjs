// module/bonuses.mjs — ABOREA Bonusberechnung
//
// Einzige Quelle für Fertigkeitswürfe, Probendialog und Kampf. Vorher gab es
// drei Implementierungen (dice.mjs, checks.mjs, combat.mjs), die sich darin
// unterschieden, welche Boni sie überhaupt kannten.

import { ABOREA } from "./config.mjs";

/**
 * Attributwert eines Actors.
 *
 * Immer system.attributes — für Charaktere der Klon von finalAttributes (beide
 * werden in _recalculateCharacter in derselben Zeile geschrieben), für NPCs und
 * Kreaturen das einzige gefüllte Feld. finalAttributes ist ein SchemaField mit
 * initial 5 und deshalb auch ungeschrieben vorhanden: ein `finalAttributes ??
 * attributes` liefert bei NPCs immer 5 statt des echten Werts.
 */
export function attributeValue(actor, attrKey, attributes = null) {
  return Number((attributes ?? actor?.system?.attributes)?.[attrKey]?.value ?? 5);
}

/**
 * Fertigkeitsdefinition am Actor — eigene Fertigkeiten haben Vorrang.
 *
 * NPCs und Kreaturen besitzen kein skills-Objekt: ihre Ränge liegen flach in
 * weaponSkills/magicSkills. Ohne diesen Zweig wäre jeder NPC-Rang 0.
 */
export function getSkillDef(actor, skillKey) {
  const custom = (actor?.system?.customSkills ?? []).find(s => s.key === skillKey);
  if (custom) return { ...custom, isCustom: true };
  const own = actor?.system?.skills?.[skillKey];
  if (own) return { ...own, isCustom: false };
  const flat = actor?.system?.weaponSkills?.[skillKey] ?? actor?.system?.magicSkills?.[skillKey];
  if (flat != null) return { rank: Number(flat) || 0, isCustom: false };
  return { rank: 0, isCustom: false };
}

/** Magie-Fertigkeiten folgen dem magicAttribute der Klasse, nicht der Config. */
function isMagicSkill(skillKey) {
  return ABOREA.spellListSkillKeys?.includes(skillKey)
      || skillKey === "magieEntwickeln"
      || skillKey === "gezielteSprueche";
}

/** Löst das Attribut einer Fertigkeit auf. `override` gewinnt (Waffen mit attrChoices). */
export function resolveAttributeKey(actor, skillKey, skillDef = null, override = "") {
  if (override) return override;
  const def = skillDef ?? getSkillDef(actor, skillKey);
  if (isMagicSkill(skillKey)) {
    const magicAttr = actor?.items?.find(i => i.type === "class")?.system?.magicAttribute;
    if (magicAttr) return magicAttr;
  }
  return def.attribute || ABOREA.skills?.[skillKey]?.attribute || "in";
}

/**
 * Boni aus Klassenfähigkeiten (nach Stufe gefiltert), Talenten und
 * ausgerüsteten Magiegegenständen. situationalBonus bleibt außen vor — der
 * entscheidet der Spielleiter von Fall zu Fall.
 */
export function liveClassBonus(actor, skillKey) {
  let bonus = 0;
  const key       = String(skillKey).toLowerCase();
  const classItem = actor?.items?.find(i => i.type === "class");
  const level     = Number(actor?.system?.resources?.level ?? 1);
  for (const f of ABOREA.activeClassFeatures(classItem?.system ?? {}, level)) {
    const tgt = String(f.target || "").toLowerCase();
    if (tgt === key && Number(f.value) && f.type !== "situationalBonus") bonus += Number(f.value);
  }
  for (const talent of (actor?.system?.talents ?? [])) {
    bonus += Number(talent.skillBonuses?.[skillKey] ?? 0);
  }
  for (const mItem of (actor?.items?.filter(i => i.type === "magic" && i.system.equipped) ?? [])) {
    bonus += Number(mItem.system.skillBonuses?.[skillKey] ?? 0);
  }
  return bonus;
}

/** Rassenbonus — direkt vom Race-Item, system.traits kann veraltet sein. */
export function raceSkillBonus(actor, skillKey) {
  const raceItem = actor?.items?.find(i => i.type === "race");
  const bonuses  = raceItem?.system?.traits?.skillBonuses
                ?? actor?.system?.traits?.skillBonuses ?? {};
  return Number(bonuses[skillKey] ?? 0);
}

/**
 * Hebt eine Klassenfähigkeit den Ungelernt-Malus für diese Waffenfertigkeit auf?
 * weaponMinimums benennt ausschließlich Waffengruppen — auf Wissensfertigkeiten
 * wirkt die Befreiung deshalb nicht.
 */
export function untrainedWaived(actor, skillKey) {
  if (!ABOREA.weaponSkillKeys.includes(skillKey)) return false;
  const minimums = actor?.system?.classFeatures?.weaponMinimums ?? {};
  if ("all" in minimums) return true;
  if (["boegen", "armbrust"].includes(skillKey) && "bows-crossbows" in minimums) return true;

  // Götterwaffe: gespeicherte weaponMinimums ODER direkt aus dem Klassenitem
  // lesen (Fallback für Charaktere, deren Recalc noch nicht gelaufen ist).
  const level = Number(actor?.system?.resources?.level ?? 1);
  const hasDeityWeapon = "deityWeapon" in minimums
    || actor?.items?.find(i => i.type === "class")?.system?.levelFeatures
         ?.some(f => f.type === "weaponMinimum" && f.target === "deityWeapon" && Number(f.level ?? 1) <= level);
  if (!hasDeityWeapon) return false;
  const deitySkills = actor?.items?.find(i => i.type === "god")?.system?.weaponSkills ?? [];
  return deitySkills.includes(skillKey);
}

/**
 * Ungelernt-Malus bei Rang 0. Waffen- und Wissensfertigkeiten geben −2, normale
 * Fertigkeiten nichts (der Rang zählt schlicht als 0), Magie ebenfalls nichts —
 * die kann man entweder oder eben nicht.
 *
 * Der Malus steht als `untrained` an der Fertigkeitsdefinition in config.mjs;
 * eigene Fertigkeiten tragen ihn direkt am Eintrag.
 */
export function untrainedPenalty(actor, skillKey, skillDef = null) {
  const def = skillDef ?? getSkillDef(actor, skillKey);
  if (Number(def.rank ?? 0) > 0) return 0;
  const penalty = Number(def.isCustom ? (def.untrained ?? 0) : (ABOREA.skills?.[skillKey]?.untrained ?? 0));
  if (!penalty) return 0;
  return untrainedWaived(actor, skillKey) ? 0 : penalty;
}

/**
 * Mindeststärke-Malus: −2 je ausgerüstetem Gegenstand, dessen minStrength über
 * der Stärke des Actors liegt. Gilt auf Angriff sowie auf Stärke- und
 * Geschicklichkeitsproben.
 */
export function minStrengthPenalty(actor, attributes = null) {
  const st = attributeValue(actor, "st", attributes);
  const offending = (actor?.items ?? []).filter(i =>
    ["weapon", "armor"].includes(i.type) && i.system?.equipped
    && Number(i.system?.minStrength ?? 0) > st);
  return offending.length ? offending.length * -2 : 0;  // nicht -0
}

/**
 * Vollständiger Fertigkeitsbonus eines Actors.
 *
 * @param {Actor}  actor
 * @param {string} skillKey
 * @param {object} [opts]
 * @param {string} [opts.attrKey]      Attribut übersteuern (Waffen mit attrChoices).
 * @param {boolean|"auto"} [opts.minStrength="auto"]  "auto" = nur bei ST/GE.
 * @param {object} [opts.attributes]  Attributblock übersteuern — für den Recalc,
 *        der mit frisch berechneten, noch nicht persistierten Werten arbeitet.
 * @returns {{attrKey, attrBonus, rank, classBonus, raceBonus, untrained,
 *            minStrength, total, label, breakdown}}
 *          `breakdown` ist eine Liste aus {label, value} für Karten und Dialoge.
 */
export function skillBonus(actor, skillKey, { attrKey: attrOverride = "", minStrength = "auto", attributes = null } = {}) {
  const def       = getSkillDef(actor, skillKey);
  const attrKey   = resolveAttributeKey(actor, skillKey, def, attrOverride);
  const attrBonus = ABOREA.attributeBonus(attributeValue(actor, attrKey, attributes));
  const rank      = Number(def.rank ?? 0);
  const classBonus = liveClassBonus(actor, skillKey);
  const raceBonus  = raceSkillBonus(actor, skillKey);
  const untrained  = untrainedPenalty(actor, skillKey, def);

  const applyMinSt = minStrength === "auto" ? ["st", "ge"].includes(attrKey) : !!minStrength;
  const minSt      = applyMinSt ? minStrengthPenalty(actor, attributes) : 0;

  const breakdown = [{ label: game.i18n.localize(ABOREA.attributes[attrKey] ?? attrKey), value: attrBonus }];
  if (rank)       breakdown.push({ label: game.i18n.localize("ABOREA.Rank"),      value: rank });
  if (classBonus) breakdown.push({ label: game.i18n.localize("ABOREA.ClassBonus"), value: classBonus });
  if (raceBonus)  breakdown.push({ label: game.i18n.localize("ABOREA.RacialBonus"), value: raceBonus });
  if (untrained)  breakdown.push({ label: "Ungelernt",     value: untrained });
  if (minSt)      breakdown.push({ label: "Mindeststärke", value: minSt });

  return {
    attrKey, attrBonus, rank, classBonus, raceBonus,
    untrained, minStrength: minSt,
    total: attrBonus + rank + classBonus + raceBonus + untrained + minSt,
    label: def.label ?? def.name ?? game.i18n.localize(ABOREA.skills?.[skillKey]?.label ?? skillKey),
    breakdown,
  };
}

/** Waffenfertigkeiten einer Waffe. */
export function weaponSkillKeys(weapon) {
  const arr = weapon?.system?.skills;
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

/**
 * Kampfbonus = bester Fertigkeitsbonus über die infrage kommenden
 * Waffenfertigkeiten, inklusive Klassen-, Talent-, Magie- und Rassenboni sowie
 * dem Ungelernt-Malus.
 *
 * Der Mindeststärke-Malus steckt bewusst NICHT drin: er wirkt laut Regel auf
 * den Angriff, nicht auf den Kampfbonus — sonst würde er auch die defensive
 * Hälfte der Aufteilung drücken.
 *
 * @param {object}  [opts]
 * @param {Item}    [opts.weapon]        Waffe — liefert Fertigkeiten und Attribut.
 * @param {string[]}[opts.skillKeys]     Fertigkeiten direkt vorgeben.
 * @param {boolean} [opts.trainedOnly]   Nur Fertigkeiten mit Rang > 0 betrachten.
 * @returns {object|null} bestes skillBonus()-Ergebnis plus skillKey, oder null.
 */
export function weaponCombatBonus(actor, { weapon = null, skillKeys = null, trainedOnly = false, attributes = null } = {}) {
  const own        = skillKeys ?? weaponSkillKeys(weapon);
  const candidates = own.length ? own : ABOREA.weaponSkillKeys;
  let best = null;
  for (const key of candidates) {
    if (trainedOnly && Number(getSkillDef(actor, key).rank ?? 0) <= 0) continue;
    const b = skillBonus(actor, key, { attrKey: weapon?.system?.attr || "", minStrength: false, attributes });
    if (!best || b.total > best.total) best = { ...b, skillKey: key };
  }
  return best;
}

/** Formatiert eine breakdown-Liste als "+2" / "−1" Zeilen. */
export function formatBreakdown(breakdown) {
  return breakdown.map(b => `${b.label}: ${b.value >= 0 ? "+" : "−"}${Math.abs(b.value)}`);
}
