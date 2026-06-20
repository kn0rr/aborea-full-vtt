/**
 * actor-sheet.mjs — Aborea Actor Sheet
 * Alle Hilfsfunktionen → actor-helpers.mjs ausgelagert.
 */
import { ABOREA } from "./config.mjs";
import { ABOREA_CONDITIONS } from "./conditions.mjs";
import { openCheckDialog } from "./checks.mjs";
import { rollAttack, rollSkill, rollAttribute } from "./dice.mjs";
import { openAttackDialog, openSpellAttackDialog } from "./combat.mjs";
import {
  currentDayStamp, nowStamp, formatExpiry,
  makeHistoryEntry, logListPush,
  normalizeWallet,
  emptyTraits,
  isActivatableFeature, featureUsesLabel, featureReady, buildFeatureCard,
  buildSkillDisplayRows, itemHistoryLabel,
  applyEffectsToActor, chooseMpCost,
  parseSimpleDuration, inferEffects, inferDirectHp, buildPowerCard,
  spellManeuverDifficulty,
  summarizeSummonRule, buildSummonedCreatureSource,
  findPackDocumentByTypeAndName, openCompendiumPickerDialog,
  parsePackSelection, resolveDroppedActorDocument,
  levelForXp, xpForNextLevel,
  normalizeCustomSkills
} from "./actor-helpers.mjs";

let _namesCache = null;
async function _randomName(actor) {
  if (!_namesCache) {
    try {
      const res = await fetch("systems/aborea-v7/data/names.json");
      _namesCache = await res.json();
    } catch (e) {
      console.warn("ABOREA | names.json konnte nicht geladen werden:", e);
      return null;
    }
  }
  const race = String(actor?.system?.details?.race ?? actor?.system?.creature?.kind ?? "").toLowerCase();
  let pool = _namesCache.allgemein ?? [];
  if (race.includes("elf")) pool = _namesCache.elfen ?? pool;
  else if (race.includes("zwerg") || race.includes("dwarf")) pool = _namesCache.zwerge ?? pool;
  else if (race.includes("mensch") || race.includes("human")) pool = _namesCache.menschen ?? pool;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function duplicateItemObject(item) {
  const obj = item.toObject(); delete obj._id; return obj;
}

export class AboreaActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["aborea", "sheet", "actor"],
    position: { width: 980, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false }
  };

  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    context.actor = actor;
    context.cssClass = this.isEditable ? "editable" : "locked";
    const system = foundry.utils.deepClone(actor.system);
    // Während der Charaktererschaffung (nicht abgeschlossen, kein Levelaufstieg):
    // baseAttributes zeigen — finalAttributes enthält bereits Rassenmod und
    // würde den gesetzten Basiswert verschleiern.
    const isCreationPhase = actor.type === "character"
      && !system.creation?.completed
      && system.creation?.status !== "leveling";
    const attrSource = actor.type === "character"
      ? (isCreationPhase
          ? system.baseAttributes || system.attributes || {}
          : system.finalAttributes || system.baseAttributes || system.attributes || {})
      : (system.attributes || {});
    const displayAttributes = {};
    for (const [key, data] of Object.entries(attrSource)) {
      displayAttributes[key] = { value: Number(data?.value ?? 5), bonus: ABOREA.attributeBonus(data?.value ?? 5), label: ABOREA.attributes[key] };
    }
    system.displayAttributes = displayAttributes;
    if (actor.type === "character") {
      try {
        await this._prepareCharacterData(actor, system);
      } catch (err) {
        console.error("ABOREA | _prepareCharacterData fehlgeschlagen:", err);
      }
    } else if (actor.type !== "loot") this._prepareNpcData(actor, system);
    context.system = system;
    context.config = ABOREA;
    context.itemLists = {
      races: actor.items.filter(i => i.type === "race"),
      classes: actor.items.filter(i => i.type === "class"),
      weapons: actor.items.filter(i => i.type === "weapon"),
      armors: actor.items.filter(i => i.type === "armor"),
      spells: actor.items.filter(i => i.type === "spell"),
      miracles: actor.items.filter(i => i.type === "miracle"),
      gear: actor.items.filter(i => i.type === "gear"),
      skills: actor.items.filter(i => i.type === "skill"),
      magics: actor.items.filter(i => i.type === "magic")
    };
    context.spellsByList = this._groupByList(actor.items.filter(i => i.type === "spell"));
    context.miraclesByList = this._groupByList(actor.items.filter(i => i.type === "miracle"));
    context.isGM = game.user.isGM;
    // "Besonderes"-Reiter: für NSC/Kreatur nur GM; für Charakter GM oder Besitzer
    context.canViewSpecial = game.user.isGM
      || (actor.type === "character" && actor.isOwner);

    // Kampfzustände — aktive Effekte als Set, alle Conditions mit active-Flag
    try {
      const activeStatuses = new Set(
        Array.from(actor.effects).flatMap(e => [...(e.statuses ?? [])])
      );
      context.conditions = ABOREA_CONDITIONS.map(c => ({ ...c, active: activeStatuses.has(c.id) }));
    } catch (err) {
      console.error("ABOREA | Conditions-Kontext fehlgeschlagen:", err);
      context.conditions = ABOREA_CONDITIONS.map(c => ({ ...c, active: false }));
    }

    // Inventar-Totals
    const weightItems = actor.items.filter(i => ["weapon","armor","gear","magic"].includes(i.type));
    context.inventoryTotals = {
      weight: Math.round(weightItems.reduce((s, i) => s + Number(i.system.weight ?? 0) * Number(i.system.quantity ?? 1), 0) * 10) / 10
    };
    context.availablePacks = {
      races: await this._packChoices("race"),
      classes: await this._packChoices("class"),
      creatures: await this._packChoices("creature"),
      weapons: await this._packChoices("weapon"),
      armors: await this._packChoices("armor"),
      spells: await this._packChoices("spell"),
      miracles: await this._packChoices("miracle"),
      gear: await this._packChoices("gear"),
      gods: await this._packChoices("god")
    };
    return context;
  }

  /** Minimaler jQuery-Shim für die Migration. Gibt ein Objekt zurück das html.find(sel) nachbildet. */
  _html() {
    const root = this.element;
    const wrap = (sel) => {
      const els = Array.from(root.querySelectorAll(sel));
      const obj = {
        on: (evt, fn) => { els.forEach(e => e.addEventListener(evt, fn)); return obj; },
        val: () => els[0]?.value ?? "",
        get length() { return els.length; },
        get 0() { return els[0]; },
      };
      return obj;
    };
    return { find: wrap };
  }

  async _prepareCharacterData(actor, system) {
    system.skills = system.skills || {};
    for (const [key, cfg] of Object.entries(ABOREA.skills)) {
      const c = system.skills[key] ?? { rank: 0, attribute: cfg.attribute };
      c.key = key; c.label = cfg.label; c.attribute = c.attribute || cfg.attribute;
      system.skills[key] = c;
    }
    system.customSkills = normalizeCustomSkills(system.customSkills);
    const armorItems = actor.items.filter(i => i.type === "armor" && i.system.equipped);
    const armorFromItems = armorItems.reduce((s, i) => s + Number(i.system.armor ?? 0), 0);
    const baseArmor = Number(system.combat?.armorValue ?? 0) + Number(system.traits?.racialArmorBonus ?? 0) + Number(system.classFeatures?.armorBonus ?? 0);
    system.combat.totalArmorValue = baseArmor + armorFromItems;
    system.combat.defenseValue = ABOREA.defenseValue(system.combat.totalArmorValue, system.combat?.defensiveBonus ?? 0);
    system.combat.initiative = ABOREA.initiativeBonus({ system: { attributes: system.displayAttributes } });

    // Kampfbonus-Tooltip: beste Waffenfertigkeit mit vollständiger Aufschlüsselung
    {
      const baseWR = Number(system.skills?.waffen?.rank ?? 0);
      let best = { cb: -99, label: "", attrKey: "st", rank: 0, attrBonus: 0 };
      for (const key of ABOREA.weaponSkillKeys) {
        const rank     = Math.max(Number(system.skills?.[key]?.rank ?? 0), baseWR);
        const attrKey  = ABOREA.skills?.[key]?.attribute ?? "st";
        const attrBonus = ABOREA.attributeBonus(system.displayAttributes?.[attrKey]?.value ?? 5);
        const cb = ABOREA.combatBonus(attrBonus, rank);
        if (cb > best.cb) best = { cb, label: game.i18n.localize(ABOREA.skills[key]?.label ?? key), attrKey, rank, attrBonus };
      }
      const sign = n => n >= 0 ? `+${n}` : `${n}`;
      const penalty = best.rank > 0 ? "" : " − 2 (ungelernt)";
      system.combat.combatBonusTooltip = best.label
        ? `${best.label}: ${sign(best.attrBonus)} (${best.attrKey.toUpperCase()}) + ${best.rank} (Rang)${penalty} = ${best.cb}`
        : "";
    }
    // HP/MP Prozent für Fortschrittsbalken
    const _hpMax = Number(system.resources?.hp?.max || 1);
    const _mpMax = Number(system.resources?.mp?.max || 1);
    system.resources.hp.pct = Math.round(Math.min(100, Math.max(0, (Number(system.resources.hp.value) / _hpMax) * 100)));
    system.resources.mp.pct = Math.round(Math.min(100, Math.max(0, (Number(system.resources.mp.value) / _mpMax) * 100)));
    const budget = Number(system.creation?.pointsBudget ?? ABOREA.attributeBudget);
    const spent = ABOREA.attributeCostTotal(system.baseAttributes || {});
    const remaining = budget - spent;
    system.creation = system.creation || {};
    const _raceItemForMods = actor.items.find(i => i.type === "race");
    const _raceMods = _raceItemForMods?.system?.mods ?? {};
    system.creation.attributeRows = Object.entries(system.baseAttributes || {}).map(([key, attr]) => {
      const value = Number(attr?.value ?? 5);
      const totalCost = ABOREA.attributeCost(value);
      const nextValue = Math.min(10, value + 1);
      const nextCost = value < 10 ? (ABOREA.attributeCost(nextValue) - totalCost) : null;
      const raceMod = Number(_raceMods[key] ?? 0);
      return { key, label: ABOREA.attributes[key], value, totalCost, nextStepCost: nextCost, bonus: ABOREA.attributeBonus(value), raceMod, final: value + raceMod };
    });
    system.attributeBreakdown = ["st","ge","ko","in","ch"].map(key => {
      const base = Number(system.baseAttributes?.[key]?.value ?? 5);
      const raceMod = Number(_raceMods[key] ?? 0);
      const final = base + raceMod;
      return { key, label: ABOREA.attributes[key], base, raceMod, final, bonus: ABOREA.attributeBonus(final) };
    });
    system.creation.attributeCostTable = Array.from({ length: 10 }, (_, i) => {
      const v = i + 1; const total = ABOREA.attributeCost(v); const nv = v < 10 ? v + 1 : null;
      return { value: v, bonus: ABOREA.attributeBonus(v), totalCost: total, stepCost: nv ? ABOREA.attributeCost(nv) - total : null };
    });
    const classItem = actor.items.find(i => i.type === "class");
    system.isLeitmagieClass = !!(classItem?.system?.description ?? "").includes("Leitmagie");
    const spellListRank = Number(system.skills?.spruchlisten?.rank ?? 0);
    const knownSpellLists = [...new Set(actor.items.filter(i => i.type === "spell").map(i => i.system.list).filter(Boolean))];
    system.spellLists = { capacity: spellListRank, known: knownSpellLists, count: knownSpellLists.length, overflow: knownSpellLists.length > spellListRank && spellListRank > 0 };
    const level = Number(system.resources?.level ?? 1);
    const raceName = (system.details?.race || "").toLowerCase();
    const humanBonus = raceName === "mensch" ? 2 : 0;
    const trainingBudget = ABOREA.baseTrainingPoints * level + humanBonus;
    const trainingSpent = ABOREA.skillTrainingSpent(system.skills, classItem?.system, system.customSkills);
    const trainingRemaining = trainingBudget - trainingSpent;
    system.activeClassFeatures = ABOREA.activeClassFeatures(classItem?.system || {}, level);
    const activationState = system.classFeatures?.activations || {};
    system.activatableClassFeatures = system.activeClassFeatures.filter(isActivatableFeature).map(f => ({
      ...f, state: activationState[f.key] || {}, ready: featureReady(f, activationState[f.key] || {}), usesLabel: featureUsesLabel(f, activationState[f.key] || {})
    }));

    // Compute skill bonus map fresh from active class features so the display
    // is always correct even if _recalculateCharacter hasn't run yet.
    const liveSkillBonuses = {};
    for (const f of system.activeClassFeatures) {
      const tgt = String(f.target || "").toLowerCase();
      if (tgt && Number(f.value)) liveSkillBonuses[tgt] = (liveSkillBonuses[tgt] || 0) + Number(f.value);
    }
    system.classFeatures = system.classFeatures || {};

    // Talente: Skill-Boni einmergen
    for (const talent of (system.talents ?? [])) {
      for (const [key, val] of Object.entries(talent.skillBonuses ?? {})) {
        if (val) liveSkillBonuses[key] = (liveSkillBonuses[key] || 0) + Number(val);
      }
    }

    // Magische Ausrüstung: Skill-Boni + passive Traits einmergen
    const equippedMagicItems = actor.items.filter(i => i.type === "magic" && i.system.equipped);
    for (const mItem of equippedMagicItems) {
      for (const [key, val] of Object.entries(mItem.system.skillBonuses ?? {})) {
        if (val) liveSkillBonuses[key] = (liveSkillBonuses[key] || 0) + Number(val);
      }
      for (const [key, val] of Object.entries(mItem.system.passiveTraits ?? {})) {
        if (key === "regeneration" && val) system.traits.regeneration = (Number(system.traits?.regeneration) || 0) + Number(val);
        else if (val) system.traits[key] = true;
      }
    }
    system.classFeatures.bonuses = liveSkillBonuses;

    // Talente für Template aufbereiten
    system.talentList = (system.talents ?? []).map(t => ({
      ...t,
      bonusSummary: [
        ...Object.entries(t.skillBonuses ?? {}).filter(([,v]) => v).map(([k,v]) => `${k} +${v}`),
        ...Object.entries(t.attributeMods ?? {}).filter(([,v]) => v).map(([k,v]) => `${k.toUpperCase()} +${v}`),
        t.hpBonus ? `HP +${t.hpBonus}` : null,
        t.mpBonus ? `MP +${t.mpBonus}` : null
      ].filter(Boolean).join(", ")
    }));

    // Attribut-Modifikatoren aus magischen Items (nur Anzeige)
    system.magicAttributeMods = { st: 0, ge: 0, ko: 0, in: 0, ch: 0 };
    for (const mItem of equippedMagicItems) {
      for (const [attr, val] of Object.entries(mItem.system.attributeMods ?? {})) {
        if (attr in system.magicAttributeMods) system.magicAttributeMods[attr] += Number(val ?? 0);
      }
    }

    // Granted Spells mit Use-Tracking für Template aufbereiten
    system.magicGrantedSpells = [];
    for (const mItem of equippedMagicItems) {
      const activations = mItem.system.activations ?? {};
      for (const s of (mItem.system.grantedSpells ?? [])) {
        const state   = activations[s.key] ?? {};
        const newDay  = state.day && state.day !== currentDayStamp();
        const used    = newDay ? 0 : Number(state.used ?? 0);
        const ready   = s.usesPerDay == null || used < s.usesPerDay;
        const usesLabel = s.usesPerDay == null ? "∞" : `${Math.max(0, s.usesPerDay - used)}/${s.usesPerDay}`;
        system.magicGrantedSpells.push({ ...s, magicItemId: mItem.id, ready, usesLabel });
      }
    }

    system.creation.skillRows = ABOREA.getCreationSkills().map(({ key, label, attribute }) => {
      const skill = system.skills[key] || { rank: 0, attribute };
      return { key, label, rank: Number(skill.rank || 0), attribute: skill.attribute || attribute, cost: classItem?.system?.skillCosts?.[key] ?? "—", maxRank: ABOREA.skillMaxCreationRank(key, classItem?.system || {}) };
    });
    const validationErrors = Array.isArray(system.creation?.validationErrors) ? system.creation.validationErrors : [];
    const xp = Number(system.resources?.xp ?? 0);
    const targetLevel = ABOREA.levelForXp(xp);
    const levelUpPending = targetLevel > level;
    const xpNext = xpForNextLevel(level);
    system.levelUp = { pending: levelUpPending, targetLevel, xpNext, atMax: xpNext === null };
    // XP-Fortschritt für Leiste (0-100%)
    const prevLevelXp = ABOREA.xpTable[level - 1] ?? 0;
    const nextLevelXp = xpNext ?? (prevLevelXp + 1);
    system.resources.xpPct = xpNext === null ? 100
      : Math.round(Math.min(100, Math.max(0, (xp - prevLevelXp) / (nextLevelXp - prevLevelXp) * 100)));

    // Rassentraits als beschriftete Badge-Liste für das Template aufbereiten
    const traitLabelMap = {
      thermalVision:   "ABOREA.TraitThermalVision",
      diseaseImmunity: "ABOREA.TraitDiseaseImmunity",
      spellResistance: "ABOREA.TraitSpellResistance"
    };
    // Traits direkt vom Race-Item lesen (zuverlässiger als gecachtes system.traits)
    const raceItemForTraits = actor.items.find(i => i.type === "race");
    const liveRaceTraits    = raceItemForTraits?.system?.traits ?? {};
    const traits = { ...system.traits, ...liveRaceTraits };
    system.racialTraits = Object.entries(traitLabelMap)
      .filter(([key]) => !!traits[key])
      .map(([key, locKey]) => ({ key, label: game.i18n.localize(locKey) }));
    if (Number(traits.maneuverBonus ?? 0) !== 0) {
      system.racialTraits.push({ key: "maneuverBonus", label: `${game.i18n.localize("ABOREA.TraitManeuverBonus")} ${traits.maneuverBonus > 0 ? "+" : ""}${traits.maneuverBonus}` });
    }
    for (const [skillKey, bonus] of Object.entries(traits.skillBonuses ?? {})) {
      if (!bonus) continue;
      const skillLabel = ABOREA.skills?.[skillKey]?.label ? game.i18n.localize(ABOREA.skills[skillKey].label) : skillKey;
      system.racialTraits.push({ key: `skill-${skillKey}`, label: `${skillLabel} ${bonus > 0 ? "+" : ""}${bonus}` });
    }
    const creationDone = !!system.creation?.completed;
    system.skillsLocked = creationDone && !levelUpPending;
    system.creation = {
      ...system.creation, pointsBudget: budget, pointsSpent: spent, pointsRemaining: remaining,
      trainingBudget, trainingSpent, trainingRemaining,
      valid: validationErrors.length === 0 && remaining === 0 && trainingRemaining >= 0 && !!system.details?.race && !!system.details?.class,
      validationErrors, canFinalize: validationErrors.length === 0 && remaining === 0 && trainingRemaining >= 0 && !!system.details?.race && !!system.details?.class
    };
    system.wallet = normalizeWallet(system.wallet);
    // Kurzanzeige Geldbeutel für den Header
    const _currencies = system.wallet?.currencies ?? [];
    system.wallet.summary = _currencies
      .filter(c => Number(c.amount) > 0)
      .map(c => `${c.amount} ${c.label}`)
      .join(" · ") || "—";

    system.inventoryHistory = Array.isArray(system.inventoryHistory) ? foundry.utils.deepClone(system.inventoryHistory) : [];

    // Skill-Zeilen mit Rassenbonus ergänzen
    // Direkt vom Race-Item lesen — system.traits kann durch Foundry-Merge veraltet sein
    const _raceItem = actor.items.find(i => i.type === "race");
    const _skillBonuses = _raceItem?.system?.traits?.skillBonuses ?? system.traits?.skillBonuses ?? {};
    system.skillDisplayRows = buildSkillDisplayRows(system).map(row => ({
      ...row,
      traitBonus: Number(_skillBonuses[row.key] ?? 0),
      totalBonus: row.rank + Number(row.bonus ?? 0) + Number(_skillBonuses[row.key] ?? 0)
    }));
    // Fertigkeiten nach Gruppe sortieren
    const KAMPF_KEYS = new Set(["waffenlos","boegen","aexte","langeKlingenwaffe","kurzeKlingenwaffe","stangenwaffe","wurfwaffe","waffen"]);
    const MAGIE_KEYS = new Set(["magieEntwickeln","spruchlisten","gezielteSprueche","magieWahrnehmen"]);
    system.skillGroups = [
      { key: "kampf",     label: "Kampf",     icon: "⚔",
        rows: system.skillDisplayRows.filter(r => !r.isCustom && KAMPF_KEYS.has(r.key)) },
      { key: "magie",     label: "Magie",     icon: "✨",
        rows: system.skillDisplayRows.filter(r => !r.isCustom && MAGIE_KEYS.has(r.key)) },
      { key: "allgemein", label: "Allgemein", icon: "📖",
        rows: system.skillDisplayRows.filter(r => !r.isCustom && !KAMPF_KEYS.has(r.key) && !MAGIE_KEYS.has(r.key)) },
      { key: "custom",    label: "Eigene",    icon: "⭐",
        rows: system.skillDisplayRows.filter(r => r.isCustom) }
    ].filter(g => g.rows.length > 0);

    system.companions = system.companions || { list: [] };
    system.companions.list = (system.companions.list || []).map(comp => ({
      ...comp, expiresLabel: formatExpiry(comp.expiresAt), levelLabel: comp.summonLevel ? `Stufe ${comp.summonLevel}` : "",
      expired: comp.expiresAt ? Number(comp.expiresAt) <= Date.now() : false
    }));
  }

  _prepareNpcData(actor, system) {
    for (const [key, data] of Object.entries(system.attributes ?? {})) { data.bonus = ABOREA.attributeBonus(data.value); data.label = ABOREA.attributes[key]; }
    const armorItems = actor.items.filter(i => i.type === "armor" && i.system.equipped);
    const armorFromItems = armorItems.reduce((s, i) => s + Number(i.system.armor ?? 0), 0);
    const baseArmorValue = Number(system.combat?.armorValue ?? 0);
    system.combat.totalArmorValue = baseArmorValue + armorFromItems;
    system.combat.armorFromItems  = armorFromItems;

    // Trait-Boni aus Active Effects (z.B. Beistand, Fluch, Trübung)
    const maneuverBonus = Number(system.traits?.maneuverBonus ?? 0);
    system.combat.maneuverBonus          = maneuverBonus;
    system.combat.effectiveOffensiveBonus = Number(system.combat?.offensiveBonus ?? 0) + maneuverBonus;

    // Verteidigungswert inklusive Manöverbonus
    system.combat.defenseValue = ABOREA.defenseValue(
      system.combat.totalArmorValue,
      Number(system.combat?.defensiveBonus ?? 0) + maneuverBonus
    );
    system.combat.initiative = ABOREA.initiativeBonus(actor);

    // Waffenfähigkeiten aufbereiten + besten Kampfbonus berechnen
    const sign = n => n >= 0 ? `+${n}` : `${n}`;
    let bestCB = null; let bestCBLabel = ""; let bestCBDetail = "";
    system.weaponSkillRows = ABOREA.weaponSkillKeys.map(key => {
      const rank      = Number(system.weaponSkills?.[key] ?? 0);
      const attrKey   = ABOREA.skills?.[key]?.attribute ?? "st";
      const attrBonus = ABOREA.attributeBonus(Number(system.attributes?.[attrKey]?.value ?? 5));
      const cb        = ABOREA.combatBonus(attrBonus, rank);
      const penalty   = rank > 0 ? "" : " − 2";
      // Besten Kampfbonus tracken (nur ausgebildete Fertigkeiten bevorzugen)
      if (rank > 0 && (bestCB === null || cb > bestCB)) {
        bestCB = cb; bestCBLabel = ABOREA.skills[key]?.label ?? key;
        bestCBDetail = `${attrKey.toUpperCase()} ${sign(attrBonus)} + Rang ${rank} = ${sign(cb)}`;
      }
      return {
        key,
        label:    ABOREA.skills[key]?.label ?? key,
        rank, attrKey, attrBonus, cb,
        tooltip: `${attrKey.toUpperCase()} ${sign(attrBonus)} + Rang ${rank}${penalty} = ${sign(cb)}`
      };
    });

    // Kampfbonus: wenn weaponSkills vorhanden → berechneten Wert anzeigen
    const hasWeaponSkills = bestCB !== null;
    if (hasWeaponSkills) {
      system.combat.computedCombatBonus = bestCB;
      system.combat.combatBonusTooltip  = `${bestCBLabel}: ${bestCBDetail}`;
      // Für Anzeige: berechneten Wert in combatBonus übernehmen
      system.combat.combatBonus = bestCB;
    } else {
      system.combat.computedCombatBonus = null;
      system.combat.combatBonusTooltip  = "Kein Waffenfertigkeits-Rang gesetzt — manuell gepflegt";
    }

    // Magische Fähigkeiten aufbereiten
    const MAGIC_SKILL_KEYS = ["magieEntwickeln", "spruchlisten", "gezielteSprueche", "magieWahrnehmen"];
    system.magicSkillRows = MAGIC_SKILL_KEYS.map(key => {
      const rank      = Number(system.magicSkills?.[key] ?? 0);
      const attrKey   = ABOREA.skills?.[key]?.attribute ?? "in";
      const attrBonus = ABOREA.attributeBonus(Number(system.attributes?.[attrKey]?.value ?? 5));
      const bonus     = rank > 0 ? attrBonus + rank : 0; // kein Bonus bei Rang 0
      // Für magieEntwickeln: MP-Pool = (attrBonus + 3) × Rang
      const mpPool    = key === "magieEntwickeln" && rank > 0
        ? `MP ${(attrBonus + 3) * rank}` : null;
      const listInfo  = key === "spruchlisten" && rank > 0
        ? `${rank} Liste${rank !== 1 ? "n" : ""}` : null;
      return {
        key,
        label:   ABOREA.skills[key]?.label ?? key,
        rank, attrKey, attrBonus, bonus,
        extraInfo: mpPool ?? listInfo ?? null,
        tooltip: key === "magieEntwickeln" && rank > 0
          ? `MP-Pool = (${attrKey.toUpperCase()} ${sign(attrBonus)} + 3) × ${rank} = ${(attrBonus + 3) * rank}`
          : `${attrKey.toUpperCase()} ${sign(attrBonus)} + Rang ${rank} = ${sign(bonus)}`
      };
    });
  }

  async _recomputeNpcCombatBonus() {
    const system = this.actor.system;
    const attributes = system.attributes ?? {};
    let bestCB = null;
    for (const key of ABOREA.weaponSkillKeys) {
      const rank = Number(system.weaponSkills?.[key] ?? 0);
      if (rank === 0) continue;
      const attrKey   = ABOREA.skills?.[key]?.attribute ?? "st";
      const attrBonus = ABOREA.attributeBonus(Number(attributes[attrKey]?.value ?? 5));
      const cb        = ABOREA.combatBonus(attrBonus, rank);
      if (bestCB === null || cb > bestCB) bestCB = cb;
    }
    if (bestCB === null) return; // keine ausgebildeten Fertigkeiten → manuell belassen
    // Bestehende Off/Def-Aufteilung proportional beibehalten
    const prevCB  = Number(system.combat?.combatBonus ?? bestCB) || bestCB;
    const prevOff = Number(system.combat?.offensiveBonus ?? prevCB);
    const ratio   = prevOff / prevCB;
    const newOff  = Math.round(bestCB * ratio);
    const newDef  = bestCB - newOff;
    await this.actor.update({
      "system.combat.combatBonus":    bestCB,
      "system.combat.offensiveBonus": Math.max(0, Math.min(bestCB, newOff)),
      "system.combat.defensiveBonus": Math.max(0, newDef)
    });
  }

  async _packChoices(type) {
    const docName = type === "creature" ? "Actor" : "Item";
    const docs = [];
    for (const pack of game.packs.filter(p => p.documentName === docName)) {
      const index = await pack.getIndex({ fields: ["name","type"] });
      docs.push(...index.filter(e => type === "creature" || e.type === type).map(e => ({ name: e.name, pack: pack.collection, label: `${e.name} — ${pack.metadata.label || pack.collection}` })));
    }
    const seen = new Set();
    return docs.filter(d => { const k = `${d.pack}:${d.name}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Robuster Form-Change-Handler: bei jedem Re-Render neu binden.
    // Den alten Handler zuerst entfernen, damit kein Duplikat entsteht.
    // NICHT per _submitChangeHandlerBound einmalig binden — falls Foundry
    // this.element intern austauscht (z.B. bei Force-Re-Renders), wäre der
    // Handler verloren und _submitChangeHandlerBound würde einen Neubind verhindern.
    if (this._changeHandler) {
      this.element.removeEventListener("change", this._changeHandler);
    }
    this._changeHandler = async (ev) => {
      if (!this.isEditable) return;
      const field = ev.target;
      if (!field?.name) return;
      const n = field.name;
      if (!n.startsWith("system.") && n !== "name" && n !== "img") return;
      if (field.classList.contains("item-notes-input")) return;
      if (field.classList.contains("item-equip-toggle") || field.classList.contains("magic-item-equip")) return;
      if (field.classList.contains("combat-balance")) return;
      if (field.classList.contains("custom-skill-field")) return;
      if (!field.closest("form")) return;
      let val = field.type === "checkbox" ? field.checked
              : field.type === "number"   ? (Number(field.value) || 0)
              : field.value;
      // Race-condition guard: HP/MP werden direkt per actor.update() verwaltet.
      // Wenn der DOM-Wert älter als der Actor-Wert ist (z.B. nach Zauber-Abzug),
      // den Actor-Wert gewinnen lassen.
      if (n === "system.resources.mp.value" || n === "system.resources.hp.value") {
        const key    = n === "system.resources.mp.value" ? "mp" : "hp";
        const stored = Number(this.document.system?.resources?.[key]?.value ?? 0);
        if (val === stored) return; // keine echte Änderung
      }
      await this.document.update({ [n]: val });
    };
    this.element.addEventListener("change", this._changeHandler);

    // Bild-Picker: data-edit="img" in ApplicationV2 manuell verdrahten
    this.element.querySelectorAll("img[data-edit]").forEach(img => {
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        if (!this.isEditable) return;
        new FilePicker({
          type: "image",
          current: this.document.img,
          callback: path => this.document.update({ img: path }),
        }).render(true);
      });
    });
    const html = this._html();
    // Tabs: aktiven Tab merken und beim Re-Render wiederherstellen
    const tabConfig = this.constructor.DEFAULT_OPTIONS?.tabs?.[0];
    if (tabConfig) {
      const initial = this._activeTab ?? tabConfig.initial;
      const tabs = new foundry.applications.ux.Tabs({
        ...tabConfig,
        initial,
        callback: (_event, _tabs, tabName) => { this._activeTab = tabName; }
      });
      tabs.bind(this.element);
    }
    if (!this.isEditable) return;
    html.find(".roll-skill").on("click", ev => rollSkill(this.actor, ev.currentTarget.dataset.skill));

    // Dropdowns für Volk/Beruf/Gott vorauswählen
    const details = this.actor.system.details ?? {};
    const setSelected = (name, val) => {
      const sel = html.find(`[name="${name}"]`)[0];
      if (!sel || !val) return;
      const opt = Array.from(sel.options).find(o => o.value === val);
      if (opt) opt.selected = true;
    };
    setSelected("selectedRace",  details.race);
    setSelected("selectedClass", details.class);
    setSelected("selectedGod",   details.god);
    html.find(".roll-attribute").on("click", ev => rollAttribute(this.actor, ev.currentTarget.dataset.attribute));
    html.find(".toggle-zero-skills").on("click", ev => {
      const list = ev.currentTarget.closest(".tab").querySelector(".skill-groups");
      if (list) list.classList.toggle("hide-zero");
      ev.currentTarget.classList.toggle("active");
    });
    if (game.user.isGM) {
      html.find(".add-talent").on("click", () => this._addTalentDialog());
      html.find(".remove-talent").on("click", async ev => {
        const key = ev.currentTarget.dataset.talentKey;
        const talents = (this.actor.system.talents ?? []).filter(t => t.key !== key);
        await this.actor.update({ "system.talents": talents });
        await this._recalculateCharacter();
      });
    }
    html.find(".roll-attack").on("click", () => openAttackDialog(this.actor));
    html.find(".open-attack-dialog").on("click", () => openAttackDialog(this.actor));
    html.find(".open-check-dialog").on("click", () => openCheckDialog(this.actor));

    // Zufallsname-Generator (NSC/Kreatur)
    html.find(".random-name-btn").on("click", async () => {
      const name = await _randomName(this.actor);
      if (!name) return;
      const input = this.element.querySelector("input[name='name']");
      if (input) {
        input.value = name;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        await this.actor.update({ name });
      }
    });

    // Kampfzustände toggling
    html.find(".condition-toggle").on("click", async ev => {
      const condId = ev.currentTarget.dataset.conditionId;
      const existing = Array.from(this.actor.effects).find(e => e.statuses?.has(condId));
      if (existing) {
        await existing.delete();
      } else {
        const cond = ABOREA_CONDITIONS.find(c => c.id === condId);
        if (!cond) return;
        await this.actor.createEmbeddedDocuments("ActiveEffect", [{
          name:     cond.name,
          img:      cond.img,
          statuses: [condId],
        }]);
      }
    });

    // Heiltrank / Gear verwenden
    html.find(".gear-use").on("click", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (!itemId) return;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      const amount   = Number(item.system.healAmount ?? 0);
      const healType = item.system.healType ?? "hp";
      if (amount <= 0) return;
      const res      = this.actor.system.resources?.[healType] ?? {};
      const curVal   = Number(res.value ?? 0);
      const maxVal   = Number(res.max ?? curVal);
      const newVal   = Math.min(maxVal, curVal + amount);
      const gained   = newVal - curVal;
      await this.actor.update({ [`system.resources.${healType}.value`]: newVal });
      const qty = Number(item.system.quantity ?? 1);
      if (qty > 1) {
        await item.update({ "system.quantity": qty - 1 });
      } else {
        await item.delete();
      }
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `<div class="aborea-chat-card">
          <p>🧪 <strong>${item.name}</strong> verwendet</p>
          <p>+${gained} ${healType.toUpperCase()} (${newVal}/${maxVal})</p>
        </div>`
      });
    });
    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", ev => this.actor.items.get(ev.currentTarget.closest("[data-item-id]")?.dataset.itemId)?.sheet?.render(true));
    html.find(".item-notes-input").on("change", async ev => {
      const itemId = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) await item.update({ "system.notes": ev.currentTarget.value });
    });
    html.find(".item-equip-toggle, .magic-item-equip").on("change", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]").dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) {
        await item.update({ "system.equipped": ev.currentTarget.checked });
        if (this.actor.type === "character") await this._recalculateCharacter();
      }
    });
    html.find(".cast-granted-spell").on("click", async ev => {
      const btn = ev.currentTarget;
      await this._castGrantedSpell(btn.dataset.magicItemId, btn.dataset.spellKey);
    });
    html.find(".item-delete").on("click", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (!itemId) return;
      const item = this.actor.items.get(itemId);
      if (item) {
        await this._logInventoryEntry("item-remove", itemHistoryLabel(item), { itemType: item.type });
      }
      await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
      if (this.actor.type === "character") await this._recalculateCharacter();
    });
    // Kompendium-Import per Dialog
    html.find(".import-pack-item").on("click", async ev => {
      const type = ev.currentTarget.dataset.type;
      const choices = await this._packChoices(type);
      const labels = { weapon:"Waffen", armor:"Rüstungen", spell:"Zauber", miracle:"Wunder", gear:"Ausrüstung", race:"Völker", class:"Berufe", creature:"Kreaturen" };
      const pick = await openCompendiumPickerDialog(type, choices, `${labels[type] || type} aus Kompendium`);
      if (!pick) return;
      const pack = game.packs.get(pick.pack); if (!pack) return;
      const index = await pack.getIndex({ fields: ["name","type"] });
      const hit = index.find(e => e.name === pick.name && e.type === type); if (!hit) return;
      const doc = await pack.getDocument(hit._id);
      const obj = duplicateItemObject(doc);
      this._checkSpellListCapacity(obj);
      await this.actor.createEmbeddedDocuments("Item", [obj]);
      await this._logInventoryEntry("item-add", itemHistoryLabel(obj), { itemType: obj.type, sourcePack: pick.pack });
    });
    html.find(".combat-balance").on("change", async ev => {
      const offensive = Number(ev.currentTarget.value ?? 0);
      const combatBonus = Number(this.actor.system.combat?.combatBonus ?? 0);
      await this.actor.update({ "system.combat.offensiveBonus": offensive, "system.combat.defensiveBonus": combatBonus - offensive });
    });

    // Waffenfertigkeit geändert → Kampfbonus automatisch neu berechnen und speichern
    if (["npc", "creature"].includes(this.actor.type)) {
      html.find("[name^='system.weaponSkills.']").on("change", async () => {
        // Kurz warten bis Foundry den Wert gespeichert hat, dann neu berechnen
        setTimeout(() => this._recomputeNpcCombatBonus(), 200);
      });
    }
    html.find(".rest-heal").on("click", async () => {
      const healed = Math.max(0, ABOREA.naturalHealingPerDay(ABOREA.attributeBonus(this._attributeValue("ko"))));
      const cur = Number(this.actor.system.resources.hp.value ?? 0);
      const max = Number(this.actor.system.resources.hp.max ?? cur);
      await this.actor.update({ "system.resources.hp.value": Math.min(max, cur + healed) });
      ui.notifications.info(`${this.actor.name}: +${healed} HP`);
    });
    html.find(".rest-mp").on("click", async () => {
      const cls = String(this.actor.system.details.class ?? "").toLowerCase();
      const key = ["priester","schamane","barde"].includes(cls) ? "ch" : "in";
      const regen = Math.max(0, ABOREA.mpRegenPerHour(ABOREA.attributeBonus(this._attributeValue(key))));
      const cur = Number(this.actor.system.resources.mp.value ?? 0);
      const max = Number(this.actor.system.resources.mp.max ?? cur);
      await this.actor.update({ "system.resources.mp.value": Math.min(max, cur + regen) });
      ui.notifications.info(`${this.actor.name}: +${regen} MP`);
    });
    html.find(".apply-race").on("click", async () => { const s = html.find("[name=selectedRace]").val(); if (s) { const i = await findPackDocumentByTypeAndName("race", s); if (i) await this._applyRace(i); } });
    html.find(".apply-class").on("click", async () => { const s = html.find("[name=selectedClass]").val(); if (s) { const i = await findPackDocumentByTypeAndName("class", s); if (i) await this._applyClass(i); } });
    html.find(".apply-god").on("click", async () => { const s = html.find("[name=selectedGod]").val(); if (s) { const i = await findPackDocumentByTypeAndName("god", s); if (i) await this._applyGod(i); } });
    html.find(".class-feature-activate").on("click", async ev => { await this._activateClassFeature(ev.currentTarget.dataset.featureKey); });
    html.find(".class-feature-reset").on("click", async () => { await this._resetDailyClassFeatures(); });
    html.find(".cast-power").on("click", async ev => { const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId; if (id) await this._castPower(id); });
    html.find(".create-companion").on("click", async () => { const v = html.find("[name=selectedCreature]").val(); if (v) await this._createCompanion(v); });
    html.find(".open-companion").on("click",    async ev => { const a = game.actors.get(ev.currentTarget.dataset.companionId); if (a) a.sheet.render(true); });
    html.find(".remove-companion").on("click",  async ev => { if (ev.currentTarget.dataset.companionId) await this._removeCompanion(ev.currentTarget.dataset.companionId); });
    html.find(".summon-companion").on("click",  async ev => { if (ev.currentTarget.dataset.companionId) await this._summonCompanion(ev.currentTarget.dataset.companionId); });
    html.find(".dismiss-companion").on("click", async ev => { if (ev.currentTarget.dataset.companionId) await this._dismissCompanion(ev.currentTarget.dataset.companionId); });
    html.find(".creation-skill-adjust").on("click", async ev => { await this._adjustCreationSkill(ev.currentTarget.dataset.skill, Number(ev.currentTarget.dataset.delta || 0)); });
    html.find(".add-custom-skill").on("click", async () => await this._addCustomSkillDialog());
    html.find(".remove-custom-skill").on("click", async ev => await this._removeCustomSkill(ev.currentTarget.dataset.skillKey));
    html.find(".custom-skill-field").on("change", async ev => await this._onCustomSkillFieldChange(ev));
    html.find(".wallet-adjust").on("click", async ev => { await this._adjustWalletCurrency(ev.currentTarget.dataset.currencyKey, ev.currentTarget.dataset.mode); });
    html.find(".wallet-add-currency").on("click", async () => await this._addWalletCurrency());
    html.find(".wallet-remove-currency").on("click", async ev => await this._removeWalletCurrency(ev.currentTarget.dataset.currencyKey));
    html.find(".recalc-character").on("click", async ev => {
      await this._flushBaseAttributes(ev.currentTarget.closest("form"));
      await this._recalculateCharacter();
      ui.notifications.info("ABOREA: Charakterwerte neu berechnet.");
    });
    html.find(".unlock-creation").on("click", async () => {
      if (!game.user.isGM) return;
      await this.actor.update({ "system.creation.completed": false, "system.creation.status": "draft" });
      ui.notifications.info(`ABOREA: Charaktererschaffung für ${this.actor.name} entsperrt.`);
    });
    html.find(".finalize-character").on("click", async ev => {
      // Ungespeicherte Attribut-Eingaben vor der Berechnung persistieren
      await this._flushBaseAttributes(ev.currentTarget.closest("form"));
      const result = await this._recalculateCharacter();
      if (!result.valid) { ui.notifications.error("ABOREA: Charaktererstellung ist noch nicht gültig."); return; }
      const hpMax = this.actor.system.resources.hp.max;
      const mpMax = this.actor.system.resources.mp.max;
      await this.actor.update({
        "system.creation.completed": true,
        "system.creation.status": "ready",
        "system.resources.hp.value": hpMax,
        "system.resources.mp.value": mpMax,
        "system.creation.levelingRankSnapshot": {}
      });
      ui.notifications.info("ABOREA: Charakter abgeschlossen.");
    });
    html.find(".do-level-up").on("click", async () => await this._doLevelUp());
    html.find("input[name=\'system.resources.level\']").on("change", async () => { await this._applyLevelFeatures(); });
    html.find("input[name=\'system.resources.xp\']").on("change", async ev => {
      const xp = Number(ev.target.value ?? 0);
      const level = Number(this.actor.system.resources?.level ?? 1);
      if (ABOREA.levelForXp(xp) > level) ui.notifications.info(`🎉 ${this.actor.name} hat genug EP für Stufe ${ABOREA.levelForXp(xp)}!`);
    });
    html.find(".spawn-loot-actor").on("click", async () => {
      if (!game.user.isGM) return;
      await this._spawnLootActor();
    });
  }

  async _spawnLootActor() {
    const src = this.actor;
    const hasItems = src.items.size > 0;
    const srcW = src.system.wallet ?? {};
    const hasCoins = ["gf","tt","kl","mu"].some(k => Number(srcW[k] ?? 0) > 0);

    if (!hasItems && !hasCoins) {
      ui.notifications.info("ABOREA: Dieser Aktor hat weder Items noch Geld — kein Beute-Container erstellt.");
      return;
    }

    // Position bestimmen: Token des Aktors auf aktiver Szene oder Mitte
    const scene = game.scenes?.active;
    let tx = (scene?.width  ?? 1000) / 2;
    let ty = (scene?.height ?? 1000) / 2;
    const token = scene?.tokens?.find(t => t.actorId === src.id);
    if (token) { tx = token.x; ty = token.y; }

    // Loot-Aktor erstellen
    const lootActor = await Actor.create({
      name: `Beute: ${src.name}`,
      type: "loot",
      img:  src.img,
      system: {
        wallet: { gf: Number(srcW.gf ?? 0), tt: Number(srcW.tt ?? 0), kl: Number(srcW.kl ?? 0), mu: Number(srcW.mu ?? 0) }
      }
    });
    if (!lootActor) { ui.notifications.error("ABOREA: Loot-Aktor konnte nicht erstellt werden."); return; }

    // Items kopieren
    if (hasItems) {
      const objs = src.items.map(i => { const o = i.toObject(); delete o._id; return o; });
      await lootActor.createEmbeddedDocuments("Item", objs);
    }

    // Token auf aktiver Szene platzieren
    if (scene) {
      const grid = scene.grid?.size ?? 100;
      await scene.createEmbeddedDocuments("Token", [{
        name:   lootActor.name,
        actorId: lootActor.id,
        img:    src.img,
        x: tx + grid,   // leicht versetzt damit er nicht exakt überlappt
        y: ty + grid,
        width:  1,
        height: 1,
      }]);
    }

    ui.notifications.info(`☠ Beute-Container „${lootActor.name}" wurde erstellt${scene ? " und auf der Karte platziert" : ""}.`);
  }

  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (this.actor.type === "character" && data?.type === "Actor") {
      const dropTarget = event.target?.closest?.(".companion-dropzone, .tab[data-tab=companions]");
      if (dropTarget) { const d = await resolveDroppedActorDocument(data); if (d?.type === "creature") { await this._createCompanionFromActorDoc(d); return; } }
    }
    return super._onDrop(event);
  }

  async _onDropItem(event, data) {
    const item = await Item.implementation.fromDropData(data);
    if (!item) {
      // V2: ActorSheetV2 hat kein _onDropItem — Item direkt anlegen
      const rawData = await Item.implementation.fromDropData(data);
      if (rawData) await this.actor.createEmbeddedDocuments("Item", [rawData.toObject?.() ?? rawData]);
      return;
    }
    if (item.type === "race")  return this._applyRace(item);
    if (item.type === "class") return this._applyClass(item);
    const obj = duplicateItemObject(item);
    this._checkSpellListCapacity(obj);
    const created = await this.actor.createEmbeddedDocuments("Item", [obj]);
    await this._logInventoryEntry("item-add", itemHistoryLabel(obj), { itemType: obj.type, sourcePack: item.pack || "" });
    return created;
  }

  async _applyRace(raceItem) {
    if (this.actor.type !== "character") return;
    if (this.actor.system.creation?.completed) { ui.notifications.warn("ABOREA: Rasse kann nach Abschluss der Charaktererstellung nicht mehr geändert werden."); return; }
    const race = duplicateItemObject(raceItem);
    const existing = this.actor.items.filter(i => i.type === "race");
    if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map(i => i.id));
    await this.actor.update({ "system.details.race": race.name, "system.creation.completed": false, "system.creation.status": "draft" });
    await this.actor.createEmbeddedDocuments("Item", [race]);
    const result = await this._recalculateCharacter();
    if (!result.valid && result.validationErrors.length) ui.notifications.warn(result.validationErrors.join(" | "));
    else ui.notifications.info(`${race.name} auf ${this.actor.name} angewendet.`);
  }

  async _applyClass(classItem) {
    if (this.actor.type !== "character") return;
    if (this.actor.system.creation?.completed) { ui.notifications.warn("ABOREA: Beruf kann nach Abschluss der Charaktererstellung nicht mehr geändert werden."); return; }
    const cls = duplicateItemObject(classItem);
    const race = this.actor.items.find(i => i.type === "race");
    if (race && !ABOREA.classAllowedForRace(race.system, cls.name)) { ui.notifications.error(`${race.name} darf den Beruf ${cls.name} nicht wählen.`); return; }
    const existing = this.actor.items.filter(i => i.type === "class");
    if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map(i => i.id));
    await this.actor.update({ "system.details.class": cls.name, "system.creation.completed": false, "system.creation.status": "draft" });
    await this.actor.createEmbeddedDocuments("Item", [cls]);
    const result = await this._recalculateCharacter();
    if (!result.valid && result.validationErrors.length) ui.notifications.warn(result.validationErrors.join(" | "));
    else ui.notifications.info(`${cls.name} auf ${this.actor.name} angewendet.`);
  }

  async _applyGod(godItem) {
    if (this.actor.type !== "character") return;
    const godName = godItem.name ?? godItem.system?.name ?? "";
    await this.actor.update({ "system.details.god": godName });
    ui.notifications.info(`${godName} als Gottheit für ${this.actor.name} gesetzt.`);
  }

  async _adjustCreationSkill(skillKey, delta) {
    if (this.actor.type !== "character") return;
    const system = this.actor.system;
    const creationDone   = !!system.creation?.completed;
    const isLeveling     = system.creation?.status === "leveling";
    const levelUpPending = ABOREA.levelForXp(Number(system.resources?.xp ?? 0)) > Number(system.resources?.level ?? 1);

    if (creationDone && !levelUpPending) {
      ui.notifications.warn("ABOREA: Fertigkeiten können erst nach einem Stufenaufstieg verbessert werden.");
      return;
    }
    const cls = this.actor.items.find(i => i.type === "class");
    if (!cls) return ui.notifications.warn("ABOREA: Wähle zuerst einen Beruf.");

    const creationCap  = ABOREA.skillMaxCreationRank(skillKey, cls.system);
    const snapshot     = system.creation?.levelingRankSnapshot ?? {};
    const rankAtLevelStart = Number(snapshot[skillKey] ?? 0);

    // Cap-Berechnung:
    // Erschaffung (draft): Erschaffungs-Cap
    // Leveln:              Erschaffungs-Cap + Rang bei Stufenaufstiegs-Beginn
    let maxRank;
    if (isLeveling) {
      maxRank = creationCap + rankAtLevelStart;
    } else if (!creationDone) {
      maxRank = creationCap;
    } else {
      maxRank = 99;
    }

    const customList = foundry.utils.deepClone(normalizeCustomSkills(system.customSkills));
    const customIdx  = customList.findIndex(s => s.key === skillKey);
    if (customIdx !== -1) {
      const costParts    = String(customList[customIdx].cost ?? "1").split("/").filter(Boolean);
      const maxRankCustom = isLeveling ? 99 : costParts.length;
      customList[customIdx].rank = Math.max(0, Math.min(maxRankCustom, Number(customList[customIdx].rank ?? 0) + Number(delta)));
      const newStatus = isLeveling ? "leveling" : "draft";
      await this.actor.update({ "system.customSkills": customList, "system.creation.completed": false, "system.creation.status": newStatus });
      await this._recalculateCharacter();
      return;
    }

    const current = Number(system.skills?.[skillKey]?.rank ?? 0);
    const next    = Math.max(0, Math.min(maxRank, current + Number(delta)));
    const newStatus = isLeveling ? "leveling" : "draft";
    await this.actor.update({ [`system.skills.${skillKey}.rank`]: next, "system.creation.completed": false, "system.creation.status": newStatus });
    await this._recalculateCharacter();
  }

  async _addCustomSkillDialog() {
    if (this.actor.type !== "character") return;
    const attrOptions = Object.entries(ABOREA.attributes).map(([k, l]) => `<option value="${k}">${game.i18n.localize(l)}</option>`).join("");
    const result = await new Promise(resolve => {
      new Dialog({
        title: game.i18n.localize("ABOREA.AddSkill"),
        content: `<form>
          <div class="form-group">
            <label>Name</label>
            <input type="text" name="name" placeholder="Fertigkeit" />
          </div>
          <div class="form-group">
            <label>Attribut</label>
            <select name="attr">${attrOptions}</select>
          </div>
          <div class="form-group">
            <label>AP-Kosten pro Rang (z.B. "2" oder "1/2")</label>
            <input type="text" name="cost" value="1" placeholder="1" />
          </div>
        </form>`,
        buttons: {
          ok: {
            label: "Hinzufügen",
            callback: html => {
              const name = html.find("[name=name]").val().trim();
              const attr = html.find("[name=attr]").val();
              const cost = html.find("[name=cost]").val().trim();
              if (!name) { ui.notifications.warn("ABOREA: Name darf nicht leer sein."); return resolve(null); }
              if (!attr) { ui.notifications.warn("ABOREA: Bitte ein Attribut wählen."); return resolve(null); }
              if (!cost || !/^[\d/]+$/.test(cost)) { ui.notifications.warn("ABOREA: Ungültige AP-Kosten (z.B. \"1\" oder \"1/2\")."); return resolve(null); }
              resolve({ name, attr, cost });
            }
          },
          cancel: { label: "Abbruch", callback: () => resolve(null) }
        },
        default: "ok", close: () => resolve(null)
      }).render(true);
    });
    if (!result) return;
    const list = foundry.utils.deepClone(normalizeCustomSkills(this.actor.system.customSkills));
    const uid = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    list.push({ key: uid, name: result.name, attribute: result.attr, rank: 0, cost: result.cost, source: "custom" });
    await this.actor.update({ "system.customSkills": list });
  }

  async _onCustomSkillFieldChange(ev) {
    if (this.actor.type !== "character") return;
    const el = ev.currentTarget;
    const skillKey = el.closest("[data-skill-key]")?.dataset.skillKey;
    const field = el.dataset.field;
    if (!skillKey || !field) return;
    const list = foundry.utils.deepClone(normalizeCustomSkills(this.actor.system.customSkills));
    const idx = list.findIndex(s => s.key === skillKey);
    if (idx === -1) return;
    // Validate cost field
    if (field === "cost") {
      const val = el.value.trim();
      if (!val || !/^[\d/]+$/.test(val)) { ui.notifications.warn("ABOREA: Ungültige AP-Kosten (z.B. \"1\" oder \"1/2\")."); el.value = list[idx].cost; return; }
      list[idx].cost = val;
    } else if (field === "name") {
      const val = el.value.trim();
      if (!val) { ui.notifications.warn("ABOREA: Name darf nicht leer sein."); el.value = list[idx].name; return; }
      list[idx].name = val;
    } else {
      list[idx][field] = el.value;
    }
    await this.actor.update({ "system.customSkills": list });
  }

  async _removeCustomSkill(skillKey) {
    if (this.actor.type !== "character") return;
    await this.actor.update({ "system.customSkills": normalizeCustomSkills(this.actor.system.customSkills).filter(s => s.key !== skillKey) });
  }

  async _doLevelUp() {
    if (this.actor.type !== "character") return;
    const system = this.actor.system;
    const xp = Number(system.resources?.xp ?? 0);
    const currentLvl = Number(system.resources?.level ?? 1);
    const targetLvl = ABOREA.levelForXp(xp);
    if (targetLvl <= currentLvl) { ui.notifications.warn("ABOREA: Kein Stufenaufstieg verfügbar."); return; }
    // Rang-Snapshot speichern bevor Spieler Fertigkeiten verteilt
    const rankSnapshot = {};
    for (const [key, skill] of Object.entries(system.skills ?? {})) rankSnapshot[key] = Number(skill.rank ?? 0);
    await this.actor.update({
      "system.resources.level": targetLvl,
      "system.creation.completed": false,
      "system.creation.status": "leveling",
      "system.creation.levelingRankSnapshot": rankSnapshot
    });
    const result = await this._recalculateCharacter();
    // Tagesnutzungen beim Stufenaufstieg zurücksetzen
    await this._resetDailyClassFeatures();
    const cls = this.actor.items.find(i => i.type === "class");
    const newFeatures = ABOREA.activeClassFeatures(cls?.system || {}, targetLvl).filter(f => Number(f.level) > currentLvl && Number(f.level) <= targetLvl);
    const humanBonus = (system.details?.race || "").toLowerCase() === "mensch" ? 2 : 0;
    const totalAP = ABOREA.baseTrainingPoints * targetLvl + humanBonus;
    const spentAP = ABOREA.skillTrainingSpent(this.actor.system.skills || {}, cls?.system, normalizeCustomSkills(this.actor.system.customSkills));
    const freeAP = totalAP - spentAP;
    const featureList = newFeatures.length ? `<ul>${newFeatures.map(f => `<li><strong>${f.label}</strong>: ${f.description || ""}</li>`).join("")}</ul>` : "<p>Keine neuen Klassenfähigkeiten.</p>";
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: `<section class="aborea-chat-card"><h2>🎉 Stufenaufstieg: Stufe ${targetLvl}</h2><p><strong>${this.actor.name}</strong> ist auf Stufe ${targetLvl} aufgestiegen!</p><p><strong>Freie AP:</strong> ${freeAP}</p><h3>Neue Klassenfähigkeiten</h3>${featureList}</section>` });
    ui.notifications.info(`${this.actor.name}: Stufe ${targetLvl}! ${freeAP} AP zum Verteilen.`);
  }

  async _applyLevelFeatures() { if (this.actor.type !== "character") return; return this._recalculateCharacter(); }

  async _recalculateCharacter() {
    if (this.actor.type !== "character") return { valid: true, validationErrors: [] };
    const actorSystem = this.actor.system;
    const base = foundry.utils.deepClone(actorSystem.baseAttributes || actorSystem.attributes || {});
    const race = this.actor.items.find(i => i.type === "race");
    const cls  = this.actor.items.find(i => i.type === "class");
    const level = Number(actorSystem.resources?.level ?? 1) || 1;
    const raceName = (race?.name || "").toLowerCase();
    const errors = []; const finalAttrs = {};
    for (const key of Object.keys(ABOREA.attributes)) {
      const baseValue = Number(base?.[key]?.value ?? 5);
      if (baseValue < 1 || baseValue > 10) errors.push(`${game.i18n.localize(ABOREA.attributes[key])}: Basiswert muss zwischen 1 und 10 liegen.`);
      const mod = Number(race?.system?.mods?.[key] ?? 0);
      const finalValue = baseValue + mod;
      if (finalValue < 1) errors.push(`${game.i18n.localize(ABOREA.attributes[key])}: Endwert darf nicht unter 1 fallen.`);
      finalAttrs[key] = { value: Math.max(1, finalValue) };
    }
    const spent = ABOREA.attributeCostTotal(base);
    const budget = Number(actorSystem.creation?.pointsBudget ?? ABOREA.attributeBudget);
    const remaining = budget - spent;
    if (remaining > 0) errors.push(`Noch ${remaining} Eigenschaftspunkte zu verteilen (von ${budget}).`);
    else if (remaining < 0) errors.push(`${Math.abs(remaining)} Eigenschaftspunkte zu viel vergeben (Budget: ${budget}).`);
    if (race && cls && !ABOREA.classAllowedForRace(race.system, cls.name)) errors.push(`${race.name} darf den Beruf ${cls.name} nicht wählen.`);
    const traits = emptyTraits();
    // Rassentraits aus dem Item lesen statt hard zu kodieren
    const raceTraits = race?.system?.traits ?? {};
    Object.assign(traits, raceTraits);
    const classFeatures = ABOREA.activeClassFeatures(cls?.system || {}, level);
    const featureState = {
      list: classFeatures, labels: classFeatures.map(f => `[Stufe ${f.level}] ${f.label}`),
      notes: classFeatures.map(f => f.description).filter(Boolean), flags: {},
      bonuses: {},
      armorBonus:0, weaponMinimums:{}, followers:0,
      activations: foundry.utils.deepClone(actorSystem.classFeatures?.activations || {}),
      lastResetDay: actorSystem.classFeatures?.lastResetDay || ""
    };
    for (const f of classFeatures) {
      featureState.flags[f.key] = true;
      if (f.type === "armorBonus")    featureState.armorBonus += Number(f.value || 0);
      if (f.type === "followers")     featureState.followers = Math.max(featureState.followers, Number(f.followers || 0));
      if (f.type === "weaponMinimum") featureState.weaponMinimums[f.target || "generic"] = Number(f.minimumRank ?? 0);
      const tgt = String(f.target || "").toLowerCase();
      if (tgt && Number(f.value)) featureState.bonuses[tgt] = (featureState.bonuses[tgt] || 0) + Number(f.value);
    }
    // Statische Klassen-Skillboni einmergen (zusätzlich zu Level-Features)
    for (const [skillKey, bonus] of Object.entries(cls?.system?.skillBonuses ?? {})) {
      if (bonus) featureState.bonuses[skillKey] = (featureState.bonuses[skillKey] || 0) + Number(bonus);
    }
    const humanBonus = raceName === "mensch" ? 2 : 0;
    const trainingBudget = ABOREA.baseTrainingPoints * level + humanBonus;
    const trainingSpent = ABOREA.skillTrainingSpent(actorSystem.skills || {}, cls?.system, normalizeCustomSkills(actorSystem.customSkills));
    const trainingRemaining = trainingBudget - trainingSpent;
    if (trainingRemaining < 0) errors.push(game.i18n.localize("ABOREA.TrainingOverspent"));
    const spruchlistenRank = Number(actorSystem.skills?.spruchlisten?.rank ?? 0);
    const knownLists = [...new Set(this.actor.items.filter(i => i.type === "spell").map(i => i.system.list).filter(Boolean))];
    if (knownLists.length > spruchlistenRank && knownLists.length > 0) errors.push(`Spruchlisten: ${knownLists.length} bekannt, Rang Spruchlisten erlaubt aber nur ${spruchlistenRank}.`);
    const hpBase = Number(cls?.system?.hitPointsBase ?? 5);
    const zwergBonus = raceName === "zwerg" ? 2 : 0;
    const talentHpBonus = (actorSystem.talents ?? []).reduce((s, t) => s + Number(t.hpBonus ?? 0), 0);
    const talentMpBonus = (actorSystem.talents ?? []).reduce((s, t) => s + Number(t.mpBonus ?? 0), 0);
    const hpMax = Math.max(1, (hpBase + ABOREA.attributeBonus(finalAttrs.ko.value)) * level + zwergBonus) + talentHpBonus;
    const magicAttr = cls?.system?.magicAttribute || "in";
    const magicDevelop = Number(actorSystem.skills?.magieEntwickeln?.rank ?? 0);
    const mpMax = Math.max(0, (ABOREA.attributeBonus(finalAttrs[magicAttr]?.value ?? 5) + 3) * magicDevelop) + talentMpBonus;
    const baseWeaponRank = Number(actorSystem.skills?.waffen?.rank ?? 0);
    const skillUpdates = {};
    for (const key of ABOREA.weaponSkillKeys) skillUpdates[`system.skills.${key}.rank`] = Math.max(Number(actorSystem.skills?.[key]?.rank ?? 0), baseWeaponRank);

    // Kampfbonus automatisch aus bester Waffenfertigkeit berechnen
    let bestCombatBonus = ABOREA.combatBonus(ABOREA.attributeBonus(finalAttrs.st?.value ?? 5), 0);
    for (const key of ABOREA.weaponSkillKeys) {
      const rank    = Math.max(Number(actorSystem.skills?.[key]?.rank ?? 0), baseWeaponRank);
      const attrKey = ABOREA.skills?.[key]?.attribute ?? "st";
      const attrVal = finalAttrs[attrKey]?.value ?? 5;
      const cb = ABOREA.combatBonus(ABOREA.attributeBonus(attrVal), rank);
      if (cb > bestCombatBonus) bestCombatBonus = cb;
    }
    // Bestehende Offensive/Defensive-Aufteilung beibehalten, aber auf neuen Total kappen
    const prevOff = Number(actorSystem.combat?.offensiveBonus ?? bestCombatBonus);
    const newOff  = Math.min(prevOff, bestCombatBonus);
    const newDef  = bestCombatBonus - newOff;

    await this.actor.update({
      "system.attributes": foundry.utils.deepClone(finalAttrs), "system.finalAttributes": finalAttrs,
      "system.resources.hp.max": hpMax, "system.resources.hp.value": Math.min(Number(actorSystem.resources?.hp?.value ?? hpMax), hpMax),
      "system.resources.mp.max": mpMax, "system.resources.mp.value": Math.min(Number(actorSystem.resources?.mp?.value ?? mpMax), mpMax),
      "system.resources.trainingPoints": trainingBudget,
      // Traits: erst skillBonuses löschen (verhindert Foundry-Deep-Merge des alten Volkes),
      // dann alle Felder explizit setzen
      "system.traits.-=skillBonuses":   null,
      "system.traits.racialArmorBonus": traits.racialArmorBonus,
      "system.traits.maneuverBonus":    traits.maneuverBonus,
      "system.traits.spellResistance":  traits.spellResistance,
      "system.traits.diseaseImmunity":  traits.diseaseImmunity,
      "system.traits.thermalVision":    traits.thermalVision,
      "system.traits.skillBonuses":     traits.skillBonuses,
      "system.classFeatures": featureState,
      "system.combat.combatBonus":    bestCombatBonus,
      "system.combat.offensiveBonus": newOff,
      "system.combat.defensiveBonus": newDef,
      "system.creation.pointsBudget": budget, "system.creation.pointsSpent": spent, "system.creation.pointsRemaining": remaining,
      "system.creation.trainingBudget": trainingBudget, "system.creation.trainingSpent": trainingSpent, "system.creation.trainingRemaining": trainingRemaining,
      "system.creation.validationErrors": errors, "system.creation.status": errors.length ? "draft" : "ready", ...skillUpdates
    });
    return { valid: errors.length === 0 && !!race && !!cls && remaining === 0, validationErrors: errors };
  }

  async _activateClassFeature(featureKey) {
    if (this.actor.type !== "character") return;
    const feature = (this.actor.system.classFeatures?.list || []).find(f => f.key === featureKey);
    if (!feature) return ui.notifications.warn(`ABOREA: Klassenfähigkeit ${featureKey} nicht gefunden.`);
    const path = `system.classFeatures.activations.${featureKey}`;
    const state = foundry.utils.deepClone(foundry.utils.getProperty(this.actor, path) || {});
    // Neuer Tag → Nutzungszähler zurücksetzen bevor weitergemacht wird
    if (state.day && state.day !== currentDayStamp()) { state.used = 0; }
    if (feature.usesPerDay && Number(state.used || 0) >= Number(feature.usesPerDay || 0)) return ui.notifications.warn(`${feature.label} ist für heute verbraucht.`);
    state.used = Number(state.used || 0) + (feature.usesPerDay ? 1 : 0);
    state.lastActivated = nowStamp(); state.day = currentDayStamp();
    await this.actor.update({ [path]: state });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: buildFeatureCard(this.actor, feature, state) });
    ui.notifications.info(game.i18n.localize("ABOREA.FeatureActivated"));
  }

  async _resetDailyClassFeatures() {
    if (this.actor.type !== "character") return;
    const activations = foundry.utils.deepClone(this.actor.system.classFeatures?.activations || {});
    for (const key of Object.keys(activations)) { activations[key].used = 0; activations[key].day = currentDayStamp(); }
    await this.actor.update({ "system.classFeatures.activations": activations, "system.classFeatures.lastResetDay": currentDayStamp() });
    ui.notifications.info(game.i18n.localize("ABOREA.ResetDone"));
  }

  async _adjustWalletCurrency(currencyKey, mode) {
    if (this.actor.type !== "character") return;
    const wallet = normalizeWallet(this.actor.system.wallet);
    const cur = wallet.currencies.find(c => c.key === currencyKey); if (!cur) return;
    const title = `${mode === "deposit" ? "Einzahlen" : "Auszahlen"}: ${cur.name} (${cur.label})`;
    const result = await new Promise(resolve => {
      new Dialog({ title, content: `<form><div class="form-group"><label>Betrag</label><input type="number" name="amount" value="1" min="1" step="1" /></div><div class="form-group"><label>Notiz (optional)</label><input type="text" name="note" placeholder="z.B. Belohnung vom Wirt" /></div></form>`,
        buttons: { ok: { label:"OK", callback: html => resolve({ amount: Number(html.find("[name=amount]").val()||0), note: html.find("[name=note]").val().trim() }) }, cancel: { label:"Abbruch", callback: ()=>resolve(null) } },
        default:"ok", close:()=>resolve(null) }).render(true);
    });
    if (!result || !result.amount || result.amount <= 0) return;
    const { amount, note } = result;
    cur.amount = mode === "withdraw" ? Math.max(0, Number(cur.amount||0) - amount) : Number(cur.amount||0) + amount;
    wallet.history = logListPush(wallet.history, makeHistoryEntry("wallet", mode, cur.label, { amount, currency: cur.label, note }));
    await this.actor.update({ "system.wallet": wallet });
  }

  async _addWalletCurrency() {
    if (this.actor.type !== "character") return;
    const result = await new Promise(resolve => {
      new Dialog({ title: "Zahlungsmittel hinzufügen",
        content: `<form><div class="form-group"><label>Code</label><input type="text" name="key" maxlength="4"/></div><div class="form-group"><label>Kürzel</label><input type="text" name="label" maxlength="4"/></div><div class="form-group"><label>Name</label><input type="text" name="name"/></div></form>`,
        buttons: { ok:{ label:"OK", callback: html=>resolve({key:html.find("[name=key]").val().trim().toLowerCase(), label:html.find("[name=label]").val().trim().toUpperCase(), name:html.find("[name=name]").val().trim()}) }, cancel:{label:"Abbruch",callback:()=>resolve(null)} },
        default:"ok", close:()=>resolve(null) }).render(true);
    });
    if (!result?.key || !result?.label || !result?.name) return;
    const wallet = normalizeWallet(this.actor.system.wallet);
    if (wallet.currencies.some(c => c.key===result.key||c.label===result.label)) return ui.notifications.warn("ABOREA: Zahlungsmittel existiert bereits.");
    wallet.currencies.push({...result, amount:0});
    await this.actor.update({ "system.wallet": wallet });
  }

  async _removeWalletCurrency(currencyKey) {
    if (this.actor.type !== "character") return;
    if (["gf","tt","kl","mu"].includes(String(currencyKey))) return ui.notifications.warn("ABOREA: Standard-Zahlungsmittel können nicht entfernt werden.");
    const wallet = normalizeWallet(this.actor.system.wallet);
    wallet.currencies = wallet.currencies.filter(c => c.key !== currencyKey);
    await this.actor.update({ "system.wallet": wallet });
  }

  async _logInventoryEntry(action, label, extra={}) {
    if (this.actor.type !== "character") return;
    const current = Array.isArray(this.actor.system.inventoryHistory) ? foundry.utils.deepClone(this.actor.system.inventoryHistory) : [];
    await this.actor.update({ "system.inventoryHistory": logListPush(current, makeHistoryEntry("inventory", action, label, extra)) });
  }

  async _createCompanion(selectionValue) {
    if (this.actor.type !== "character") return;
    const { pack, name: creatureName } = parsePackSelection(selectionValue);
    const creatureDoc = await findPackDocumentByTypeAndName("creature", creatureName, pack);
    if (!creatureDoc) return ui.notifications.error(`ABOREA: Kreatur ${creatureName} nicht gefunden.`);
    return this._createCompanionFromActorDoc(creatureDoc);
  }

  async _createCompanionFromActorDoc(creatureDoc) {
    if (this.actor.type !== "character" || !creatureDoc || creatureDoc.type !== "creature") return;
    const source = creatureDoc.toObject(); delete source._id; source.folder = null;
    source.name = `${creatureDoc.name} (${this.actor.name})`;
    source.flags = foundry.utils.mergeObject(source.flags||{}, { aborea:{ownerActorId:this.actor.id,isCompanion:true} }, {inplace:false});
    const created = await Actor.create(source);
    const list = foundry.utils.deepClone(this.actor.system.companions?.list||[]);
    list.push({ actorId:created.id, name:created.name, kind:created.system?.creature?.kind||created.type, sourceName:creatureDoc.name, permanent:true, status:"created" });
    await this.actor.update({ "system.companions.list": list });
    ui.notifications.info("ABOREA: Begleiter erstellt.");
  }

  async _removeCompanion(actorId) {
    const a = game.actors.get(actorId); if (a) await a.delete();
    await this.actor.update({ "system.companions.list": (this.actor.system.companions?.list||[]).filter(c=>c.actorId!==actorId) });
    ui.notifications.info("ABOREA: Begleiter entfernt.");
  }

  async _summonCompanion(actorId) {
    const a = game.actors.get(actorId); if (!a) return ui.notifications.error("ABOREA: Begleiter nicht gefunden.");
    const scene = game.scenes.current; if (!scene) return ui.notifications.error("ABOREA: Keine aktive Szene.");
    if (a.getActiveTokens(true).length) { a.getActiveTokens(true)[0].control(); return; }
    const td = foundry.utils.deepClone(a.prototypeToken?.toObject ? a.prototypeToken.toObject() : a.prototypeToken||{});
    td.actorId=a.id; td.actorLink=true; td.name=a.name; td.x=Math.round((canvas?.stage?.pivot?.x||0)+200); td.y=Math.round((canvas?.stage?.pivot?.y||0)+200);
    await scene.createEmbeddedDocuments("Token", [td]);
    const list = foundry.utils.deepClone(this.actor.system.companions?.list||[]);
    const idx = list.findIndex(c=>c.actorId===actorId); if (idx>=0) { list[idx].status="summoned"; await this.actor.update({"system.companions.list":list}); }
    ui.notifications.info("ABOREA: Begleiter beschworen.");
  }

  async _dismissCompanion(actorId) {
    const a = game.actors.get(actorId); if (!a) return;
    const scene = game.scenes.current; if (!scene) return;
    const tokens = a.getActiveTokens(true).filter(t=>t.scene?.id===scene.id);
    if (tokens.length) await scene.deleteEmbeddedDocuments("Token", tokens.map(t=>t.id));
    const list = foundry.utils.deepClone(this.actor.system.companions?.list||[]);
    const idx = list.findIndex(c=>c.actorId===actorId); if (idx>=0) { list[idx].status="dismissed"; await this.actor.update({"system.companions.list":list}); }
    ui.notifications.info("ABOREA: Begleiter von der Szene entfernt.");
  }

  async _cleanupExpiredCompanions() {
    if (this.actor.type !== "character") return;
    const now = Date.now(); const list = foundry.utils.deepClone(this.actor.system.companions?.list||[]); let changed=false;
    for (const comp of [...list]) {
      if (!comp?.expiresAt || comp.permanent || Number(comp.expiresAt)>now) continue;
      const s = game.actors.get(comp.actorId);
      if (s) { for (const scene of game.scenes) { const ids=scene.tokens.filter(t=>t.actorId===s.id).map(t=>t.id); if (ids.length) await scene.deleteEmbeddedDocuments("Token",ids); } await s.delete(); }
      list.splice(list.findIndex(e=>e.actorId===comp.actorId),1); changed=true;
    }
    if (changed) await this.actor.update({"system.companions.list":list});
  }

  async _automateSummon(item, mpCost) {
    const rule = summarizeSummonRule(item, this.actor, mpCost); if (!rule) return null;
    const now = Date.now(); rule.mpCost=mpCost; rule.expiresAt=rule.permanent?null:(rule.duration?.seconds?now+rule.duration.seconds*1000:null);
    const list = foundry.utils.deepClone(this.actor.system.companions?.list||[]);
    const sourceKey = `${item.id}:${rule.summonType}`;
    let entry = list.find(c=>c.sourceKey===sourceKey);
    let summoned = entry ? game.actors.get(entry.actorId) : null;
    const source = buildSummonedCreatureSource(this.actor, item, rule);
    if (!summoned) { summoned=await Actor.create(source); entry={actorId:summoned.id,sourceKey}; list.push(entry); } else await summoned.update(source);
    Object.assign(entry,{actorId:summoned.id,name:summoned.name,kind:rule.templateName,sourceName:item.name,summonType:rule.summonType,summonLevel:rule.level,mpCost,permanent:!!rule.permanent,durationLabel:rule.duration?.label||"Permanent",expiresAt:rule.expiresAt,status:"summoned"});
    await this.actor.update({"system.companions.list":list}); await this._summonCompanion(summoned.id);
    return { extra:`<p><strong>Beschwörung:</strong> ${rule.templateName}</p><p><strong>Stufe:</strong> ${rule.level}</p><p><strong>Dauer:</strong> ${rule.duration?.label||"Permanent"}</p><p><strong>Ablauf:</strong> ${formatExpiry(rule.expiresAt)}</p>` };
  }

  async _castGrantedSpell(magicItemId, spellKey) {
    const magicItem = this.actor.items.get(magicItemId);
    if (!magicItem) return;
    const entry = (magicItem.system.grantedSpells ?? []).find(s => s.key === spellKey);
    if (!entry) return;

    // Tageslimit prüfen
    const activations = foundry.utils.deepClone(magicItem.system.activations ?? {});
    const state = activations[spellKey] ?? {};
    if (state.day && state.day !== currentDayStamp()) state.used = 0;
    if (entry.usesPerDay != null && Number(state.used ?? 0) >= entry.usesPerDay) {
      return ui.notifications.warn(`${entry.spellName} ist für heute verbraucht.`);
    }

    // MP abziehen
    const mpCost = Number(entry.mpCost ?? 0);
    const currentMp = Number(this.actor.system.resources?.mp?.value ?? 0);
    if (mpCost > 0 && currentMp < mpCost) return ui.notifications.warn(game.i18n.localize("ABOREA.NotEnoughMP"));
    if (mpCost > 0) await this.actor.update({ "system.resources.mp.value": currentMp - mpCost });

    // Nutzung tracken
    if (entry.usesPerDay != null) {
      state.used = Number(state.used ?? 0) + 1;
      state.day  = currentDayStamp();
      activations[spellKey] = state;
      await magicItem.update({ "system.activations": activations });
    }

    // Proxy-Item für buildPowerCard
    const proxyItem = {
      name: entry.spellName, type: "spell", uuid: magicItem.uuid,
      system: {
        description: entry.description ?? "",
        range: entry.range ?? "—",
        duration: entry.duration ?? "—",
        rank: entry.rank ?? 1,
        effects: [], hpEffect: {}, summonRule: {}
      }
    };
    const targets = Array.from(game.user.targets ?? []).map(t => t.actor).filter(Boolean);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: buildPowerCard(this.actor, proxyItem, mpCost, targets,
        `<p><em>Quelle: ${magicItem.name}</em></p>`)
    });
  }

  async _castPower(itemId) {
    const item = this.actor.items.get(itemId); if (!item||!["spell","miracle"].includes(item.type)) return;

    // Gezielte Zauber: komplett durch den Angriffsdialog (MP-Wahl + Ziel + Treffer)
    if (item.system.targeted) {
      await this._cleanupExpiredCompanions();
      await openAttackDialog(this.actor, { preselectedSpellId: item.id });
      return;
    }

    // Nicht-gezielte Zauber: MP-Kosten wählen, dann direkt wirken
    const mpCost = await chooseMpCost(item); if (mpCost==null) return;
    const currentMp = Number(this.actor.system.resources?.mp?.value??0);
    if (currentMp<mpCost) { ui.notifications.warn(game.i18n.localize("ABOREA.NotEnoughMP")); return; }
    await this._cleanupExpiredCompanions();
    await this.actor.update({"system.resources.mp.value":Math.max(0,currentMp-mpCost)});

    const targets = Array.from(game.user.targets||[]).map(t=>t.actor).filter(Boolean);
    const hp = inferDirectHp(item,mpCost);
    const effects = inferEffects(item,mpCost).map(e=>({...e,origin:item.uuid}));
    let extra="";
    for (const target of targets) {
      if (hp?.type==="heal") { const cur=Number(target.system.resources?.hp?.value??0); const max=Number(target.system.resources?.hp?.max??cur); await target.update({"system.resources.hp.value":Math.min(max,cur+hp.amount)}); extra+=`<p><strong>${target.name}</strong>: +${hp.amount} HP</p>`; }
      if (hp?.type==="damage") { const cur=Number(target.system.resources?.hp?.value??0); await target.update({"system.resources.hp.value":Math.max(0,cur-hp.amount)}); extra+=`<p><strong>${target.name}</strong>: -${hp.amount} HP</p>`; }
      if (effects.length) { await applyEffectsToActor(target,effects); extra+=`<p><strong>${target.name}</strong>: ${game.i18n.localize("ABOREA.EffectApplied")}</p>`; }
    }
    if (hp?.type==="buffDamage") { effects.push({name:item.name,origin:item.uuid,description:item.system?.description,duration:parseSimpleDuration(item,mpCost),changes:[{key:"flags.aborea.extraWeaponDamage",mode:CONST.ACTIVE_EFFECT_MODES.ADD,value:hp.amount}]}); await applyEffectsToActor(this.actor,effects.slice(-1)); extra+=`<p><strong>${this.actor.name}</strong>: +${hp.amount} Waffenschaden</p>`; }
    const summon = await this._automateSummon(item,mpCost); if (summon?.extra) extra+=summon.extra;
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:this.actor}),content:buildPowerCard(this.actor,item,mpCost,targets,extra)});
    if (game.combat?.started) await game.combat.nextTurn();
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const name = game.i18n.format("ABOREA.NewItem", { type });
    const created = await this.actor.createEmbeddedDocuments("Item", [{ name, type, system: {} }]);
    await this._logInventoryEntry("item-add", itemHistoryLabel({ name, type }), { itemType: type, sourcePack: "manual" });
    // V2: Item-Sheet nach Erstellung öffnen (in V1 war das automatisch)
    created[0]?.sheet?.render(true);
    return created;
  }

  _groupByList(items) {
    const groups = {};
    for (const item of items) {
      const list = item.system?.list || "Unbekannt";
      if (!groups[list]) groups[list] = [];
      groups[list].push(item);
    }
    return Object.entries(groups)
      .map(([list, spells]) => ({ list, spells: spells.slice().sort((a, b) => Number(a.system?.rank ?? 0) - Number(b.system?.rank ?? 0)) }))
      .sort((a, b) => a.list.localeCompare(b.list));
  }

  _checkSpellListCapacity(itemObj) {
    if (itemObj.type !== "spell") return;
    const spellList = itemObj.system?.list;
    if (!spellList) return;
    const currentLists = [...new Set(this.actor.items.filter(i => i.type === "spell").map(i => i.system.list).filter(Boolean))];
    const rank = Number(this.actor.system.skills?.spruchlisten?.rank ?? 0);
    if (!currentLists.includes(spellList) && currentLists.length >= rank) {
      ui.notifications.warn(`ABOREA: Neue Spruchliste „${spellList}" überschreitet Kapazität (${currentLists.length}/${rank}). Rang Spruchlisten zu niedrig!`);
    }
  }

  async _promptNote(context = "") {
    return new Promise(resolve => {
      new Dialog({
        title: "Notiz hinzufügen",
        content: `<form><div class="form-group"><label>${context}</label><input type="text" name="note" placeholder="Notiz (optional)" style="width:100%" /></div></form>`,
        buttons: {
          ok: { label: "OK", callback: html => resolve(html.find("[name=note]").val().trim()) },
          skip: { label: "Ohne Notiz", callback: () => resolve("") }
        },
        default: "ok", close: () => resolve("")
      }).render(true);
    });
  }

  _attributeValue(key) { return Number(this.actor.system?.finalAttributes?.[key]?.value??this.actor.system?.attributes?.[key]?.value??5); }

  /** Liest Attribut-Inputs direkt aus dem DOM und speichert sie in baseAttributes,
   *  damit ungespeicherte Tippvorgänge vor _recalculateCharacter() persistiert werden. */
  async _flushBaseAttributes(formEl) {
    if (!formEl) return;
    const updates = {};
    for (const key of ["st","ge","ko","in","ch"]) {
      const input = formEl.querySelector(`[name="system.baseAttributes.${key}.value"]`);
      if (input) {
        const val = Math.max(1, Math.min(10, Number(input.value) || 5));
        updates[`system.baseAttributes.${key}.value`] = val;
      }
    }
    if (Object.keys(updates).length) await this.actor.update(updates);
  }

  async _addTalentDialog() {
    if (!game.user.isGM) return;

    // Fertigkeit-Dropdown aus config.mjs aufbauen
    const skillOptions = Object.entries(ABOREA.skills)
      .sort((a, b) => game.i18n.localize(a[1].label).localeCompare(game.i18n.localize(b[1].label), game.i18n.lang))
      .map(([key, cfg]) => `<option value="${key}">${game.i18n.localize(cfg.label)}</option>`)
      .join("");

    const result = await new Promise(resolve => {
      new Dialog({
        title: `Talent hinzufügen — ${this.actor.name}`,
        content: `<form style="display:grid;gap:8px;min-width:380px">
          <div class="form-group"><label>Name</label>
            <input type="text" name="name" style="width:100%" placeholder="Talentname" /></div>
          <div class="form-group"><label>Beschreibung</label>
            <input type="text" name="description" style="width:100%" placeholder="Kurzbeschreibung" /></div>

          <fieldset style="border:1px solid #ccc;border-radius:6px;padding:8px">
            <legend style="font-weight:600;padding:0 4px">Fertigkeits-Boni</legend>
            <div id="skill-bonus-list" style="display:flex;flex-direction:column;gap:3px;margin-bottom:6px"></div>
            <div style="display:flex;gap:4px;align-items:center">
              <select id="new-skill-key" style="flex:1">${skillOptions}</select>
              <input type="number" id="new-skill-val" value="1" min="1" max="10" style="width:4em;text-align:center" />
              <button type="button" id="add-skill-bonus" class="btn-primary" style="width:32px;height:28px;padding:0">+</button>
            </div>
          </fieldset>

          <fieldset style="border:1px solid #ccc;border-radius:6px;padding:8px">
            <legend style="font-weight:600;padding:0 4px">Attribut-Modifikatoren</legend>
            <div style="display:flex;gap:10px;justify-content:center">
              ${["st","ge","ko","in","ch"].map(a =>
                `<label style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.82rem">
                  <span style="font-weight:600">${a.toUpperCase()}</span>
                  <input type="number" name="attr_${a}" value="0" style="width:42px;text-align:center" />
                </label>`).join("")}
            </div>
          </fieldset>

          <div style="display:flex;gap:16px">
            <div class="form-group" style="flex:1"><label>HP-Bonus</label>
              <input type="number" name="hpBonus" value="0" style="width:100%" /></div>
            <div class="form-group" style="flex:1"><label>MP-Bonus</label>
              <input type="number" name="mpBonus" value="0" style="width:100%" /></div>
          </div>
        </form>`,
        buttons: {
          ok: {
            label: "Talent zuweisen",
            callback: html => {
              const root = html instanceof HTMLElement ? html : html[0];
              const f = n => root.querySelector(`[name="${n}"]`)?.value ?? "";
              const name = f("name").trim();
              if (!name) return resolve(null);

              // Fertigkeits-Boni aus den Zeilen lesen
              const skillBonuses = {};
              root.querySelectorAll(".talent-skill-row").forEach(row => {
                const key = row.dataset.skillKey;
                const val = Number(row.dataset.skillVal);
                if (key && val) skillBonuses[key] = (skillBonuses[key] || 0) + val;
              });

              const attributeMods = {};
              for (const a of ["st","ge","ko","in","ch"]) {
                const v = Number(f(`attr_${a}`));
                if (v) attributeMods[a] = v;
              }
              resolve({
                key: `talent-${Date.now()}`,
                name,
                description: f("description").trim(),
                skillBonuses,
                attributeMods,
                hpBonus: Number(f("hpBonus")) || 0,
                mpBonus: Number(f("mpBonus")) || 0
              });
            }
          },
          cancel: { label: "Abbrechen", callback: () => resolve(null) }
        },
        default: "ok",
        close: () => resolve(null),
        render: html => {
          const root   = html instanceof HTMLElement ? html : html[0];
          const list   = root.querySelector("#skill-bonus-list");
          const addBtn = root.querySelector("#add-skill-bonus");

          const addRow = (skillKey, skillLabel, val) => {
            const row = document.createElement("div");
            row.className = "talent-skill-row";
            row.dataset.skillKey = skillKey;
            row.dataset.skillVal = val;
            row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 6px;background:#f0fdf4;border-radius:4px;border:1px solid #86efac";
            row.innerHTML = `<span style="flex:1;font-size:.85rem">${skillLabel}</span>
              <span style="font-weight:700;color:#166534;min-width:24px;text-align:center">+${val}</span>
              <button type="button" style="width:22px;height:22px;padding:0;background:#fee2e2;border:1px solid #fca5a5;border-radius:4px;color:#b91c1c;cursor:pointer">×</button>`;
            row.querySelector("button").addEventListener("click", () => row.remove());
            list.appendChild(row);
          };

          addBtn.addEventListener("click", () => {
            const keyEl   = root.querySelector("#new-skill-key");
            const valEl   = root.querySelector("#new-skill-val");
            const key     = keyEl.value;
            const val     = Math.max(1, Number(valEl.value) || 1);
            const label   = keyEl.options[keyEl.selectedIndex]?.text ?? key;
            if (key) addRow(key, label, val);
          });
        }
      }).render(true);
    });

    if (!result) return;
    const talents = [...(this.actor.system.talents ?? []), result];
    await this.actor.update({ "system.talents": talents });
    await this._recalculateCharacter();
    ui.notifications.info(`Talent „${result.name}" zugewiesen.`);
  }
}

export class AboreaCharacterSheet extends AboreaActorSheet {
  static DEFAULT_OPTIONS = { tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "creation" }] };
  static PARTS = { main: { template: "systems/aborea-v7/templates/actor/character-sheet.html" } };
}
export class AboreaNpcSheet extends AboreaActorSheet {
  static DEFAULT_OPTIONS = { tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }] };
  static PARTS = { main: { template: "systems/aborea-v7/templates/actor/npc-sheet.html" } };
}
export class AboreaCreatureSheet extends AboreaActorSheet {
  static DEFAULT_OPTIONS = { tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }] };
  static PARTS = { main: { template: "systems/aborea-v7/templates/actor/creature-sheet.html" } };
}

// ══════════════════════════════════════════════════════════════════
//  AboreaLootSheet
// ══════════════════════════════════════════════════════════════════

export class AboreaLootSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["aborea", "sheet", "actor", "loot-sheet"],
    position: { width: 500, height: 580 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
  };

  static PARTS = {
    main: { template: "systems/aborea-v7/templates/actor/loot-sheet.html" },
  };

  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const actor   = this.actor;
    context.actor     = actor;
    context.system    = foundry.utils.deepClone(actor.system);
    context.isGM      = game.user.isGM;
    context.cssClass  = this.isEditable ? "editable" : "locked";
    context.itemLists = {
      weapons: actor.items.filter(i => i.type === "weapon"),
      armors:  actor.items.filter(i => i.type === "armor"),
      gear:    actor.items.filter(i => i.type === "gear"),
      magics:  actor.items.filter(i => i.type === "magic"),
    };
    const w = actor.system.wallet ?? {};
    context.wallet = [
      { key: "gf", label: "GF", name: "Goldfalken",       amount: Number(w.gf ?? 0) },
      { key: "tt", label: "TT", name: "Trionthaler",       amount: Number(w.tt ?? 0) },
      { key: "kl", label: "KL", name: "Kupferlinge",       amount: Number(w.kl ?? 0) },
      { key: "mu", label: "MU", name: "Münzen unbekannt",  amount: Number(w.mu ?? 0) },
    ];
    context.hasCoins = context.wallet.some(c => c.amount > 0);
    context.hasItems = actor.items.size > 0;
    context.hasContent = context.hasItems || context.hasCoins;
    // Inhalt nur sichtbar wenn: GM, ODER Container ist offen
    context.canViewContent = game.user.isGM || !actor.system.locked;
    context.canTake  = !!game.user.character && !actor.system.locked;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    // Change-Handler bei jedem Re-Render frisch binden (siehe AboreaActorSheet)
    if (this._changeHandler) this.element.removeEventListener("change", this._changeHandler);
    this._changeHandler = async (ev) => {
      if (!this.isEditable) return;
      const field = ev.target;
      if (!field?.name) return;
      const n = field.name;
      if (!n.startsWith("system.") && n !== "name" && n !== "img") return;
      if (!field.closest("form")) return;
      const val = field.type === "checkbox" ? field.checked
                : field.type === "number"   ? (Number(field.value) || 0)
                : field.value;
      await this.document.update({ [n]: val });
    };
    this.element.addEventListener("change", this._changeHandler);

    // Bild-Picker: data-edit="img" in ApplicationV2 manuell verdrahten
    html.querySelectorAll("img[data-edit]").forEach(img => {
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        if (!this.isEditable) return;
        new FilePicker({
          type: "image",
          current: this.document.img,
          callback: path => this.document.update({ img: path }),
        }).render(true);
      });
    });

    html.querySelectorAll(".item-edit").forEach(btn =>
      btn.addEventListener("click", ev => {
        const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        this.actor.items.get(id)?.sheet?.render(true);
      })
    );

    html.querySelectorAll(".item-delete").forEach(btn =>
      btn.addEventListener("click", async ev => {
        if (!game.user.isGM) return;
        const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        if (id) await this.actor.deleteEmbeddedDocuments("Item", [id]);
      })
    );

    html.querySelectorAll(".loot-take-item").forEach(btn =>
      btn.addEventListener("click", async ev => {
        const id = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        if (id) await this._takeItem(id);
      })
    );

    html.querySelector(".loot-take-all")
      ?.addEventListener("click", () => this._takeAll());

    html.querySelector(".loot-take-money")
      ?.addEventListener("click", () => this._takeMoney());

    html.querySelector(".loot-toggle-lock")
      ?.addEventListener("click", async () => {
        if (!game.user.isGM) return;
        await this.actor.update({ "system.locked": !this.actor.system.locked });
      });

    html.querySelector(".loot-open-picker")
      ?.addEventListener("click", () => {
        new AboreaLootItemPicker({ lootActor: this.actor }).render(true);
      });
  }

  async _onDropItem(event, data) {
    if (!this.isEditable) return;
    const item = await Item.implementation.fromDropData(data);
    if (!item) return;
    const obj = item.toObject();
    delete obj._id;
    await this.actor.createEmbeddedDocuments("Item", [obj]);
  }

  async _takeItem(itemId) {
    const character = game.user.character;
    if (!character) {
      ui.notifications.warn("ABOREA: Kein Charakter zugewiesen (Nutzereinstellungen → Charakter).");
      return;
    }
    if (this.actor.system.locked) {
      ui.notifications.warn("ABOREA: Der Container ist verschlossen.");
      return;
    }
    if (this.actor.isOwner) {
      // Direktzugriff (GM oder Besitzer)
      const item = this.actor.items.get(itemId);
      if (!item) return;
      const obj = item.toObject(); delete obj._id;
      await character.createEmbeddedDocuments("Item", [obj]);
      await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
      await this._logLootEntry(character, item.name, item.type, this.actor.name);
    } else {
      // Socket-Delegation an GM
      game.socket.emit("system.aborea-v7", {
        type: "lootRequest", action: "takeItem",
        lootActorId: this.actor.id, itemId, characterId: character.id,
      });
    }
  }

  async _takeAll() {
    const character = game.user.character;
    if (!character) {
      ui.notifications.warn("ABOREA: Kein Charakter zugewiesen.");
      return;
    }
    if (this.actor.system.locked) {
      ui.notifications.warn("ABOREA: Der Container ist verschlossen.");
      return;
    }
    const w = this.actor.system.wallet ?? {};
    const hasCoins = ["gf","tt","kl","mu"].some(k => Number(w[k] ?? 0) > 0);
    if (!this.actor.items.size && !hasCoins) {
      ui.notifications.info("ABOREA: Container ist leer.");
      return;
    }

    if (this.actor.isOwner) {
      // Direktzugriff (GM oder Besitzer)
      if (this.actor.items.size) {
        const items = this.actor.items.map(i => i);
        const objs  = items.map(i => { const o = i.toObject(); delete o._id; return o; });
        await character.createEmbeddedDocuments("Item", objs);
        await this.actor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
        const current = Array.isArray(character.system.inventoryHistory)
          ? foundry.utils.deepClone(character.system.inventoryHistory) : [];
        const scene = game.scenes?.active?.name ?? "";
        const entries = items.map(i =>
          makeHistoryEntry("inventory", "item-add", itemHistoryLabel(i), {
            itemType: i.type, note: `aus ${this.actor.name}`, scene
          })
        );
        const updated = entries.reduce((list, e) => logListPush(list, e), current);
        await character.update({ "system.inventoryHistory": updated });
      }
      if (hasCoins) await this._transferCoins(character);
      ui.notifications.info(`${character.name} nimmt alles aus ${this.actor.name}.`);
    } else {
      // Socket-Delegation an GM
      game.socket.emit("system.aborea-v7", {
        type: "lootRequest", action: "takeAll",
        lootActorId: this.actor.id, characterId: character.id,
      });
      ui.notifications.info(`${character.name} nimmt alles aus ${this.actor.name}.`);
    }
  }

  async _takeMoney() {
    const character = game.user.character;
    if (!character) { ui.notifications.warn("ABOREA: Kein Charakter zugewiesen."); return; }
    if (this.actor.system.locked) { ui.notifications.warn("ABOREA: Der Container ist verschlossen."); return; }
    const w = this.actor.system.wallet ?? {};
    if (!["gf","tt","kl","mu"].some(k => Number(w[k] ?? 0) > 0)) {
      ui.notifications.info("ABOREA: Kein Geld im Container."); return;
    }
    if (this.actor.isOwner) {
      await this._transferCoins(character);
      ui.notifications.info(`${character.name} nimmt das Geld aus ${this.actor.name}.`);
    } else {
      game.socket.emit("system.aborea-v7", {
        type: "lootRequest", action: "takeMoney",
        lootActorId: this.actor.id, characterId: character.id,
      });
      ui.notifications.info(`${character.name} nimmt das Geld aus ${this.actor.name}.`);
    }
  }

  async _transferCoins(character) {
    const lootW   = this.actor.system.wallet ?? {};
    const charWallet = normalizeWallet(character.system.wallet);
    const scene   = game.scenes?.active?.name ?? "";
    const source  = this.actor.name;

    for (const key of ["gf","tt","kl","mu"]) {
      const amount = Number(lootW[key] ?? 0);
      if (!amount) continue;
      const cur = charWallet.currencies.find(c => c.key === key);
      if (!cur) continue;
      cur.amount = (Number(cur.amount) || 0) + amount;
      charWallet.history = logListPush(
        charWallet.history,
        makeHistoryEntry("wallet", "add", cur.label, { amount, currency: cur.label, note: `aus ${source}`, scene })
      );
    }
    await character.update({ "system.wallet": charWallet });
    await this.actor.update({ "system.wallet": { gf: 0, tt: 0, kl: 0, mu: 0 } });
  }

  async _logLootEntry(character, itemName, itemType, containerName) {
    if (character.type !== "character") return;
    const current = Array.isArray(character.system.inventoryHistory)
      ? foundry.utils.deepClone(character.system.inventoryHistory) : [];
    const scene = game.scenes?.active?.name ?? "";
    const entry = makeHistoryEntry("inventory", "item-add", itemName, {
      itemType, note: `aus ${containerName}`, scene
    });
    await character.update({ "system.inventoryHistory": logListPush(current, entry) });
  }
}

// ══════════════════════════════════════════════════════════════════
//  AboreaLootItemPicker — ApplicationV2
// ══════════════════════════════════════════════════════════════════

const LOOT_ITEM_TYPES = [
  { value: "",       label: "Alle",        active: true },
  { value: "weapon", label: "⚔ Waffen",   active: false },
  { value: "armor",  label: "🛡 Rüstungen", active: false },
  { value: "gear",   label: "🎒 Ausrüstung", active: false },
  { value: "magic",  label: "✨ Magisches", active: false },
];

class AboreaLootItemPicker extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "aborea-loot-item-picker",
    classes:  ["aborea-loot-picker"],
    window:   { resizable: true },
    position: { width: 480, height: 520 },
  };

  static PARTS = {
    main: { template: "systems/aborea-v7/templates/loot/item-picker.html" },
  };

  constructor(options = {}) {
    super(options);
    this._lootActor  = options.lootActor;
    this._allItems   = null;   // null = not yet loaded
    this._activeType = "";
  }

  get title() { return `📦 Items hinzufügen — ${this._lootActor.name}`; }

  async _prepareContext() {
    return { types: LOOT_ITEM_TYPES.map(t => ({ ...t, active: t.value === this._activeType })) };
  }

  async _onRender(context, options) {
    const html = this.element;
    const searchInput  = html.querySelector(".picker-search");
    const resultsEl    = html.querySelector(".picker-results");
    const statusEl     = html.querySelector(".picker-status");

    // Load index once, show spinner meanwhile
    if (!this._allItems) {
      resultsEl.innerHTML = `<p class="picker-empty">⏳ Kompendien werden geladen…</p>`;
      this._allItems = await this._loadIndex();
      this._renderResults(resultsEl, statusEl, searchInput?.value ?? "");
    }

    // Type tab buttons
    html.querySelectorAll(".picker-type-btn").forEach(btn => {
      if (btn.dataset.type === this._activeType) btn.classList.add("active");
      btn.addEventListener("click", () => {
        this._activeType = btn.dataset.type;
        html.querySelectorAll(".picker-type-btn").forEach(b => b.classList.toggle("active", b.dataset.type === this._activeType));
        this._renderResults(resultsEl, statusEl, searchInput?.value ?? "");
      });
    });

    // Live search
    let debounce = null;
    searchInput?.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this._renderResults(resultsEl, statusEl, searchInput.value), 150);
    });

    searchInput?.focus();
    if (this._allItems) this._renderResults(resultsEl, statusEl, "");
  }

  _renderResults(resultsEl, statusEl, query) {
    const q = query.trim().toLowerCase();
    const filtered = this._allItems.filter(item => {
      if (this._activeType && item.type !== this._activeType) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });

    statusEl.textContent = filtered.length
      ? `${filtered.length} Einträge${filtered.length > 50 ? " (erste 50)" : ""}`
      : "";

    if (!filtered.length) {
      resultsEl.innerHTML = `<p class="picker-empty">Keine Einträge gefunden.</p>`;
      return;
    }

    resultsEl.innerHTML = filtered.slice(0, 50).map(item => `
      <div class="picker-item-row" data-pack="${item.pack}" data-item-id="${item.id}">
        <img class="picker-item-img" src="${item.img}" alt="" />
        <span class="picker-item-name">${item.name}</span>
        <span class="picker-type-badge picker-type-${item.type}">${item.typeLabel}</span>
        ${item.price ? `<span class="picker-item-price">${item.price}</span>` : ""}
        <button type="button" class="picker-add-btn" title="Hinzufügen">+</button>
      </div>
    `).join("");

    resultsEl.querySelectorAll(".picker-add-btn").forEach(btn => {
      btn.addEventListener("click", async ev => {
        const row = ev.currentTarget.closest(".picker-item-row");
        btn.disabled = true;
        btn.textContent = "…";
        await this._addItem(row.dataset.pack, row.dataset.itemId);
        btn.textContent = "✓";
        btn.classList.add("added");
      });
    });
  }

  async _loadIndex() {
    const TYPE_LABELS = {
      weapon: "Waffe", armor: "Rüstung", gear: "Ausrüstung", magic: "Magisches"
    };
    const relevant = new Set(["weapon", "armor", "gear", "magic"]);
    const items = [];

    for (const pack of game.packs.filter(p => p.documentName === "Item")) {
      const index = await pack.getIndex({ fields: ["name", "type", "img", "system.price"] });
      for (const e of index) {
        if (!relevant.has(e.type)) continue;
        items.push({
          id:        e._id,
          pack:      pack.collection,
          name:      e.name,
          type:      e.type,
          typeLabel: TYPE_LABELS[e.type] ?? e.type,
          img:       e.img ?? "icons/svg/item-bag.svg",
          price:     e.system?.price ?? "",
        });
      }
    }

    return items.sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  async _addItem(packCollection, itemId) {
    const pack = game.packs.get(packCollection);
    if (!pack) return;
    const item = await pack.getDocument(itemId);
    if (!item) return;
    const obj = item.toObject(); delete obj._id;
    await this._lootActor.createEmbeddedDocuments("Item", [obj]);
  }
}
