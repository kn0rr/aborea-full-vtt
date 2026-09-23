// tests/helpers/foundry-stub.mjs
//
// Minimale Foundry-Globals, damit die Systemmodule außerhalb von Foundry
// geladen werden können. MUSS vor jedem Modul-Import stehen: combat.mjs greift
// beim Laden auf foundry.applications.api und Combat zu.
//
// Die Stubs decken nur das ab, was beim Modulladen gebraucht wird — getestet
// werden ausschließlich reine Rechenfunktionen, keine Foundry-Interaktion.

globalThis.game ??= {
  i18n: { localize: key => String(key).replace(/^ABOREA\./, "") },
};

/**
 * Setzt den Kampfzustand, den `game` meldet.
 *
 * Absichtlich getrennt: `game.combat` ist der Kampf, den der *Kampfbericht
 * anzeigt* — und der ist leer, sobald dessen Reiter geschlossen ist. Die
 * Kämpfe selbst stehen davon unberührt in `game.combats`. Genau diese
 * Trennung hat lange einen Fehler versteckt, deshalb muss der Stub sie
 * abbilden können.
 *
 * @param {object} [state]
 * @param {object|null} [state.viewed]    was der Kampfbericht zeigt
 * @param {Array}  [state.combats]        [{id, scene:{id}, active}]
 * @param {string} [state.viewedSceneId]  betrachtete Szene
 */
export function setCombatState({ viewed = null, combats = [], viewedSceneId = "" } = {}) {
  const liste = [...combats];
  game.combat  = viewed;
  game.combats = Object.assign(liste, { get: id => liste.find(c => c.id === id) ?? null });
  game.scenes  = { viewed: viewedSceneId ? { id: viewedSceneId } : null };
  return game;
}

/** Bauhelfer für einen Kampf im Stub. */
export function combatDoc(id, { sceneId = "s1", active = false, round = 1, started = true } = {}) {
  return { id, scene: sceneId ? { id: sceneId, name: `Szene ${sceneId}` } : null,
           active, round, started, combatants: new Map() };
}

globalThis.Combat ??= class Combat {};

globalThis.CONST ??= {
  ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 },
};

globalThis.foundry ??= {
  applications: {
    api: {
      ApplicationV2: class ApplicationV2 {},
      HandlebarsApplicationMixin: Base => class extends Base {},
    },
  },
  utils: {
    deepClone: v => structuredClone(v),
    randomID: () => "0000000000000000",
    mergeObject: (a, b) => ({ ...a, ...b }),
  },
};

// ── Bauhelfer für Testdaten ────────────────────────────────────────────────

/** Item-Attrappe. */
export const item = (type, system = {}) => ({ type, system });

/** Ausgerüstete Waffe. */
export const weapon = (system = {}) => item("weapon", { equipped: true, ...system });

/** Ausgerüstete Rüstung. */
export const armor = (system = {}) => item("armor", { equipped: true, armor: 0, ...system });

/**
 * Charakter-Attrappe. Attribute absichtlich ungleich 5, damit ein versehentlich
 * wieder eingebauter finalAttributes-Fallback sofort auffällt.
 */
export const character = (over = {}) => ({
  type: "character",
  items: over.items ?? [],
  flags: over.flags ?? {},
  system: {
    attributes:      over.attributes ?? { st: { value: 13 }, ge: { value: 9 }, ko: { value: 5 }, in: { value: 7 }, ch: { value: 5 } },
    finalAttributes: { st: { value: 5 }, ge: { value: 5 }, ko: { value: 5 }, in: { value: 5 }, ch: { value: 5 } },
    skills:        over.skills ?? {},
    customSkills:  over.customSkills ?? [],
    talents:       over.talents ?? [],
    traits:        over.traits ?? {},
    resources:     over.resources ?? { level: 3 },
    classFeatures: over.classFeatures ?? { bonuses: {}, weaponMinimums: {} },
    combat:        over.combat ?? { combatBonus: 0, offensiveBonus: 0, defensiveBonus: 0, armorValue: 5 },
  },
});

/** Kreatur-Attrappe — Ränge liegen flach in weaponSkills/magicSkills. */
export const creature = (over = {}) => ({
  type: "creature",
  items: over.items ?? [],
  flags: over.flags ?? {},
  system: {
    attributes:      over.attributes ?? { st: { value: 7 }, ge: { value: 5 }, ko: { value: 5 }, in: { value: 9 }, ch: { value: 5 } },
    finalAttributes: { st: { value: 5 }, ge: { value: 5 }, ko: { value: 5 }, in: { value: 5 }, ch: { value: 5 } },
    weaponSkills:  over.weaponSkills ?? {},
    magicSkills:   over.magicSkills ?? {},
    traits:        over.traits ?? {},
    resources:     over.resources ?? { level: 1 },
    combat:        over.combat ?? { combatBonus: 0, offensiveBonus: 0, defensiveBonus: 0, armorValue: 5 },
  },
});
