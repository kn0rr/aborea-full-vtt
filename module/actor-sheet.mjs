import { ABOREA } from "./config.mjs";
import { rollAttack, rollInitiative, rollSkill } from "./dice.mjs";

function duplicateItemObject(item) {
  const obj = item.toObject();
  delete obj._id;
  return obj;
}

async function findPackDocumentByTypeAndName(type, name, preferredPack = null) {
  const matchingPacks = game.packs.filter(p => p.documentName === (type === "creature" ? "Actor" : "Item"));
  const orderedPacks = preferredPack ? [matchingPacks.find(p => p.collection === preferredPack), ...matchingPacks.filter(p => p.collection !== preferredPack)] : matchingPacks;
  for (const pack of orderedPacks.filter(Boolean)) {
    const index = await pack.getIndex({ fields: ["name", "type"] });
    const hit = index.find(e => e.name === name && (type === "creature" || e.type === type));
    if (hit) return pack.getDocument(hit._id);
  }
  return null;
}

function parsePackSelection(value) {
  const raw = String(value || "").trim();
  if (!raw) return { pack: null, name: "" };
  const [pack, name] = raw.split("||");
  return { pack: pack || null, name: name || raw };
}

async function resolveDroppedActorDocument(data) {
  if (!data || data.type !== "Actor") return null;
  try {
    return await Actor.implementation.fromDropData(data);
  } catch (err) {
    if (data.uuid) return await fromUuid(data.uuid);
    throw err;
  }
}


function currentDayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function nowStamp() {
  return new Date().toLocaleString(game.i18n.lang || undefined);
}

function makeHistoryEntry(type, action, label, details = {}) {
  return {
    timestamp: Date.now(),
    stamp: nowStamp(),
    type,
    action,
    label,
    ...details
  };
}

function normalizeWallet(wallet = {}) {
  const defaults = [
    { key: 'gf', label: 'GF', name: 'Goldfalken', amount: 0 },
    { key: 'tt', label: 'TT', name: 'Trionthaler', amount: 0 },
    { key: 'kl', label: 'KL', name: 'Kupferlinge', amount: 0 },
    { key: 'mu', label: 'MU', name: 'Münzen unbekannt', amount: 0 }
  ];
  const currencies = Array.isArray(wallet?.currencies) ? foundry.utils.deepClone(wallet.currencies) : [];
  for (const cur of defaults) {
    if (!currencies.find(c => String(c.key) === cur.key)) currencies.push(foundry.utils.deepClone(cur));
  }
  return {
    currencies,
    history: Array.isArray(wallet?.history) ? foundry.utils.deepClone(wallet.history) : []
  };
}

function logListPush(list = [], entry, max = 200) {
  const next = [entry, ...list];
  return next.slice(0, max);
}

function classFeatureBonusMap(classFeatures = {}) {
  return foundry.utils.deepClone(classFeatures?.bonuses || {});
}

function buildSkillDisplayRows(system) {
  const rows = [];
  const classBonuses = classFeatureBonusMap(system.classFeatures);
  for (const [key, skill] of Object.entries(system.skills || {})) {
    rows.push({
      key,
      label: skill.label,
      name: game.i18n.localize(skill.label || key),
      attribute: skill.attribute,
      rank: Number(skill.rank || 0),
      bonus: Number(classBonuses[key] || 0),
      source: 'base',
      isCustom: false
    });
  }
  for (const [index, skill] of (system.customSkills || []).entries()) {
    rows.push({
      key: skill.key,
      label: skill.name,
      name: skill.name,
      attribute: skill.attribute || 'in',
      rank: Number(skill.rank || 0),
      bonus: Number(skill.bonus || 0),
      source: 'custom',
      isCustom: true,
      customIndex: index
    });
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), game.i18n.lang || undefined));
}

function itemHistoryLabel(item) {
  return `${item.name}${item.type ? ` (${item.type})` : ''}`;
}

function isActivatableFeature(feature) {
  return ["dailyPower", "pool", "focusStorage", "resourceConversion", "companion", "sense", "castingBonus"].includes(String(feature?.type || ""));
}

function featureUsesLabel(feature, state = {}) {
  if (!feature?.usesPerDay) return "—";
  const used = Number(state.used || 0);
  const max = Number(feature.usesPerDay || 0);
  return `${Math.max(0, max - used)}/${max}`;
}

function featureReady(feature, state = {}) {
  if (!feature?.usesPerDay) return true;
  return Number(state.used || 0) < Number(feature.usesPerDay || 0);
}

function buildFeatureCard(actor, feature, state = {}) {
  const uses = feature?.usesPerDay ? `<p><strong>${game.i18n.localize("ABOREA.FeatureUses")}:</strong> ${featureUsesLabel(feature, state)}</p>` : "";
  const last = state?.lastActivated ? `<p><strong>${game.i18n.localize("ABOREA.LastActivated")}:</strong> ${state.lastActivated}</p>` : "";
  return `
    <section class="aborea-chat-card">
      <h2>${game.i18n.localize("ABOREA.FeatureActivation")}: ${feature.label}</h2>
      <p><strong>${actor.name}</strong> aktiviert eine Klassenfähigkeit.</p>
      <p>${feature.description || ""}</p>
      ${uses}
      ${last}
    </section>
  `;
}


function effectIcon(name) {
  const slug = String(name || '').toLowerCase();
  if (slug.includes('blind') || slug.includes('blend')) return 'icons/svg/blind.svg';
  if (slug.includes('unsicht') || slug.includes('invisible')) return 'icons/svg/invisible.svg';
  if (slug.includes('schlaf') || slug.includes('sleep')) return 'icons/svg/sleep.svg';
  if (slug.includes('segn') || slug.includes('beistand') || slug.includes('freundlich')) return 'icons/svg/aura.svg';
  if (slug.includes('fluch') || slug.includes('trüb')) return 'icons/svg/degen.svg';
  return 'icons/svg/mystery-man.svg';
}

async function chooseMpCost(item) {
  const options = Array.isArray(item.system?.costOptions) && item.system.costOptions.length ? item.system.costOptions : [Number(item.system?.cost || 1)];
  if (options.length === 1) return Number(options[0]);
  return await new Promise(resolve => {
    const optionHtml = options.map(o => `<option value="${o}">${o}</option>`).join('');
    new Dialog({
      title: game.i18n.localize('ABOREA.SelectMPCost'),
      content: `<form><div class="form-group"><label>${game.i18n.localize('ABOREA.MPCost')}</label><select name="mp">${optionHtml}</select></div></form>`,
      buttons: {
        ok: { label: 'OK', callback: html => resolve(Number(html.find('[name="mp"]').val())) },
        cancel: { label: 'Cancel', callback: () => resolve(null) }
      },
      default: 'ok',
      close: () => resolve(null)
    }).render(true);
  });
}

function parseSimpleDuration(item, mpCost) {
  const txt = String(item.system?.duration || '').toLowerCase();
  const roundsMatch = txt.match(/(\d+)\s*runde/);
  const minutesMatch = txt.match(/(\d+)\s*min/);
  const hoursMatch = txt.match(/(\d+)\s*stunde/);
  const daysMatch = txt.match(/(\d+)\s*tag/);
  if (txt.includes('/1 mp')) {
    if (txt.includes('runde')) return { rounds: Math.max(1, mpCost) };
    if (txt.includes('min')) return { seconds: 60 * Math.max(1, mpCost) };
    if (txt.includes('stunde')) return { seconds: 3600 * Math.max(1, mpCost) };
    if (txt.includes('tag')) return { seconds: 86400 * Math.max(1, mpCost) };
  }
  if (roundsMatch) return { rounds: Number(roundsMatch[1]) };
  if (minutesMatch) return { seconds: 60 * Number(minutesMatch[1]) };
  if (hoursMatch) return { seconds: 3600 * Number(hoursMatch[1]) };
  if (daysMatch) return { seconds: 86400 * Number(daysMatch[1]) };
  return {};
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function parseDurationMeta(item, mpCost) {
  const raw = String(item.system?.duration || '').trim();
  const base = parseSimpleDuration(item, mpCost);
  let seconds = Number(base.seconds || 0);
  let rounds = Number(base.rounds || 0);
  if (rounds && !seconds) seconds = rounds * 6;
  return {
    raw,
    label: raw || 'Permanent',
    seconds,
    rounds,
    permanent: !raw || (!seconds && !rounds)
  };
}

function formatExpiry(ts) {
  if (!ts) return 'Permanent';
  return new Date(ts).toLocaleString(game.i18n.lang || undefined);
}

function summarizeSummonRule(item, actor, mpCost) {
  const name = normalizeText(item.name);
  const list = normalizeText(item.system?.list);
  const actorLevel = Number(actor.system?.resources?.level || 1);
  if (name.includes('beschworung')) return { templateName: 'Beschworene Kreatur', summonType: 'conjured', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'helfer') return { templateName: 'Tierischer Helfer', summonType: 'animal-helper', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'animation') return { templateName: 'Animierte Pflanze', summonType: 'animated-plant', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'tierfreund') return { templateName: 'Tierfreund', summonType: 'animal-friend', level: Math.max(1, Math.floor(mpCost / 3)), duration: { label: 'Dauerhaft', seconds: 0, rounds: 0, permanent: true }, permanent: true };
  if (name == 'erde') return { templateName: 'Erdelementar', summonType: 'earth-elemental', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'elemente' && list.includes('wilde')) return { templateName: 'Elementar', summonType: 'elemental', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'elementar') return { templateName: 'Elementar', summonType: 'elemental', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'naturgeist') return { templateName: 'Naturgeist', summonType: 'nature-spirit', level: Math.max(1, Math.min(mpCost, Math.floor(actorLevel / 2) || 1)), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'belebung') return { templateName: 'Untoter Diener', summonType: 'undead', level: Math.max(1, mpCost), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name == 'dauerhafte belebung') return { templateName: 'Untoter Diener', summonType: 'undead', level: Math.max(1, Math.floor(mpCost / 2)), duration: { label: 'Dauerhaft', seconds: 0, rounds: 0, permanent: true }, permanent: true };
  return null;
}

function summonedBaseStats(kind, level) {
  const lvl = Math.max(1, Number(level || 1));
  const stats = {
    'conjured':       { st: 5 + lvl, ge: 4 + Math.ceil(lvl/2), ko: 5 + lvl, in: 3 + Math.floor(lvl/2), ch: 3 + Math.floor(lvl/3), armor: 5 + Math.floor(lvl/2), dmg: 1 + Math.ceil(lvl/2) },
    'animal-helper':  { st: 4 + lvl, ge: 5 + lvl, ko: 4 + lvl, in: 2 + Math.floor(lvl/3), ch: 3 + Math.floor(lvl/3), armor: 5 + Math.floor(lvl/3), dmg: 1 + Math.ceil(lvl/2) },
    'animated-plant': { st: 5 + lvl, ge: 2 + Math.floor(lvl/2), ko: 6 + lvl, in: 1 + Math.floor(lvl/4), ch: 1, armor: 6 + Math.floor(lvl/2), dmg: 1 + Math.ceil(lvl/2) },
    'animal-friend':  { st: 4 + lvl, ge: 5 + lvl, ko: 4 + lvl, in: 2 + Math.floor(lvl/3), ch: 4 + Math.floor(lvl/3), armor: 5 + Math.floor(lvl/3), dmg: 1 + Math.ceil(lvl/2) },
    'earth-elemental':{ st: 6 + lvl, ge: 2 + Math.floor(lvl/2), ko: 6 + lvl, in: 2 + Math.floor(lvl/3), ch: 2, armor: 6 + Math.floor(lvl/2), dmg: 2 + Math.ceil(lvl/2) },
    'elemental':      { st: 5 + lvl, ge: 4 + lvl, ko: 5 + lvl, in: 3 + Math.floor(lvl/3), ch: 2, armor: 5 + Math.floor(lvl/2), dmg: 2 + Math.ceil(lvl/2) },
    'nature-spirit':  { st: 3 + Math.floor(lvl/2), ge: 5 + lvl, ko: 4 + lvl, in: 4 + Math.floor(lvl/2), ch: 4 + Math.floor(lvl/2), armor: 5 + Math.floor(lvl/3), dmg: 1 + Math.ceil(lvl/2) },
    'undead':         { st: 5 + lvl, ge: 3 + Math.floor(lvl/2), ko: 6 + lvl, in: 1 + Math.floor(lvl/3), ch: 1, armor: 5 + Math.floor(lvl/2), dmg: 1 + Math.ceil(lvl/2) }
  };
  return stats[kind] || stats['conjured'];
}

function buildSummonedCreatureSource(owner, item, rule) {
  const lvl = Math.max(1, Number(rule.level || 1));
  const s = summonedBaseStats(rule.summonType, lvl);
  const hpMax = Math.max(1, 6 + lvl * 4 + ABOREA.attributeBonus(s.ko));
  const defBonus = ABOREA.attributeBonus(s.ge) + Math.max(0, Math.floor(lvl / 3));
  const actorName = `${rule.templateName} (${owner.name})`;
  return {
    name: actorName,
    type: 'creature',
    img: 'icons/svg/mystery-man.svg',
    prototypeToken: {
      name: actorName,
      actorLink: true,
      disposition: 1,
      bar1: { attribute: 'resources.hp' },
      displayName: 20,
      displayBars: 20
    },
    system: {
      attributes: {
        st: { value: s.st }, ge: { value: s.ge }, ko: { value: s.ko }, in: { value: s.in }, ch: { value: s.ch }
      },
      resources: { hp: { value: hpMax, max: hpMax }, mp: { value: 0, max: 0 }, level: lvl, xp: 0 },
      combat: {
        combatBonus: ABOREA.attributeBonus(s.st) + Math.max(0, Math.floor(lvl / 2)),
        offensiveBonus: ABOREA.attributeBonus(s.st) + Math.max(0, Math.floor(lvl / 2)),
        defensiveBonus: defBonus,
        armorValue: s.armor,
        totalArmorValue: s.armor,
        defenseValue: ABOREA.defenseValue(s.armor, defBonus),
        damageBonus: s.dmg,
        initiative: ABOREA.attributeBonus(s.ge)
      },
      details: { notes: item.system?.description || '' },
      creature: { kind: rule.templateName, size: lvl >= 8 ? 'groß' : (lvl >= 4 ? 'mittel' : 'klein'), threat: lvl },
      summon: {
        ownerActorId: owner.id,
        sourceItemId: item.id,
        sourceItemName: item.name,
        summonType: rule.summonType,
        summonLevel: lvl,
        mpCost: rule.mpCost,
        permanent: !!rule.permanent,
        durationLabel: rule.duration?.label || 'Permanent',
        expiresAt: rule.expiresAt || null,
        active: true
      }
    },
    flags: { aborea: { ownerActorId: owner.id, isCompanion: true, isSummon: true, summonType: rule.summonType } }
  };
}

function buildPowerCard(actor, item, mpCost, targets, extra='') {
  return `
    <section class="aborea-chat-card">
      <h2>${game.i18n.localize('ABOREA.SpellCast')}: ${item.name}</h2>
      <p><strong>${actor.name}</strong> wirkt ${item.type === 'miracle' ? game.i18n.localize('ABOREA.Miracle') : game.i18n.localize('ABOREA.Spell')}.</p>
      <p><strong>${game.i18n.localize('ABOREA.MPCost')}:</strong> ${mpCost}</p>
      <p><strong>${game.i18n.localize('ABOREA.Range')}:</strong> ${item.system?.range || '—'}</p>
      <p><strong>${game.i18n.localize('ABOREA.Duration')}:</strong> ${item.system?.duration || '—'}</p>
      <p><strong>${game.i18n.localize('ABOREA.Targets')}:</strong> ${targets.length ? targets.map(t => t.name).join(', ') : '—'}</p>
      <p>${item.system?.description || ''}</p>
      ${extra}
    </section>
  `;
}

async function applyEffectsToActor(actor, effects) {
  if (!effects.length) return;
  const existing = actor.effects.filter(e => effects.some(n => n.name === e.name));
  if (existing.length) await actor.deleteEmbeddedDocuments('ActiveEffect', existing.map(e => e.id));
  const docs = effects.map(e => ({
    name: e.name,
    icon: e.icon || effectIcon(e.name),
    statuses: e.statuses || [],
    disabled: false,
    duration: e.duration || {},
    origin: e.origin,
    description: e.description || '',
    changes: e.changes || []
  }));
  await actor.createEmbeddedDocuments('ActiveEffect', docs);
}

function inferEffects(item, mpCost) {
  const name = String(item.name || '').toLowerCase();
  const duration = parseSimpleDuration(item, mpCost);
  const effects = [];
  if (name.includes('blend')) effects.push({ name: item.name, statuses: ['blind'], duration, description: item.system?.description, changes: [] });
  if (name.includes('schlaf')) effects.push({ name: item.name, statuses: ['unconscious'], duration, description: item.system?.description, changes: [] });
  if (name.includes('unsicht')) effects.push({ name: item.name, statuses: ['invisible'], duration, description: item.system?.description, changes: [] });
  if (name.includes('segn')) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: 'system.traits.maneuverBonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 1 }] });
  if (name.includes('beistand')) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: 'system.traits.maneuverBonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: Math.min(3, Math.max(1, mpCost)) }] });
  if (name.includes('freundliche weise')) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: 'system.classFeatures.bonuses.influence', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 2 }] });
  if (name.includes('trüb')) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: 'system.traits.maneuverBonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1 }] });
  if (name == 'fluch' || name.includes('verfluchen')) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: 'system.traits.maneuverBonus', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1 }] });
  return effects;
}

function inferDirectHp(item, mpCost) {
  const name = String(item.name || '').toLowerCase();
  if (name.includes('heilung')) return { type: 'heal', amount: 4 * mpCost };
  if (name === 'heilen') return { type: 'heal', amount: 1 * mpCost };
  if (name.includes('feuerball')) return { type: 'damage', amount: Math.min(5, mpCost) };
  if (name == 'blitz') return { type: 'damage', amount: mpCost };
  if (name.includes('explosion')) return { type: 'damage', amount: mpCost };
  if (name.includes('stoßwelle') || name.includes('stoßwelle') || name.includes('sto-welle')) return { type: 'damage', amount: Math.min(5, Math.floor(mpCost / 2)) };
  if (name.includes('flammenschwert')) return { type: 'buffDamage', amount: Math.min(5, Math.floor(mpCost / 2)) };
  return null;
}

function emptyTraits() {
  return {
    racialArmorBonus: 0,
    maneuverBonus: 0,
    spellResistance: false,
    diseaseImmunity: false,
    secretDoorsBonus: false,
    mechanicsBonus: false,
    thermalVision: false
  };
}

export class AboreaActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aborea", "sheet", "actor"],
      width: 980,
      height: 820,
      resizable: true,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "creation" }]
    });
  }

  get template() { return "systems/aborea-v7/templates/actor/character-sheet.html"; }

  async getData(options = {}) {
    const context = await super.getData(options);
    const actor = context.actor;
    const system = foundry.utils.deepClone(actor.system);

    const attrSource = actor.type === "character" ? (system.finalAttributes || system.attributes || {}) : (system.attributes || {});
    const displayAttributes = {};
    for (const [key, data] of Object.entries(attrSource)) {
      displayAttributes[key] = {
        value: Number(data?.value ?? 5),
        bonus: ABOREA.attributeBonus(data?.value ?? 5),
        label: ABOREA.attributes[key]
      };
    }
    system.displayAttributes = displayAttributes;

    if (actor.type === "character") {
      system.skills = system.skills || {};
      for (const [key, cfg] of Object.entries(ABOREA.skills)) {
        const current = system.skills[key] ?? { rank: 0, attribute: cfg.attribute };
        current.key = key;
        current.label = cfg.label;
        current.attribute = current.attribute || cfg.attribute;
        system.skills[key] = current;
      }
      system.customSkills = Array.isArray(system.customSkills) ? system.customSkills : [];

      const armorItems = actor.items.filter(i => i.type === "armor" && i.system.equipped);
      const armorBonus = armorItems.reduce((sum, item) => sum + Number(item.system.armor ?? 0) - 5, 0);
      const baseArmorValue = Number(system.combat?.armorValue ?? 5) + Number(system.traits?.racialArmorBonus ?? 0) + Number(system.classFeatures?.armorBonus ?? 0);
      system.combat.totalArmorValue = baseArmorValue + armorBonus;
      system.combat.defenseValue = ABOREA.defenseValue(system.combat.totalArmorValue, system.combat?.defensiveBonus ?? 0);
      system.combat.initiative = ABOREA.initiativeBonus({ system: { attributes: system.displayAttributes } });

      const budget = Number(system.creation?.pointsBudget ?? ABOREA.attributeBudget);
      const spent = ABOREA.attributeCostTotal(system.baseAttributes || {});
      const remaining = budget - spent;
      const validationErrors = Array.isArray(system.creation?.validationErrors) ? system.creation.validationErrors : [];
      system.creation = system.creation || {};
      system.creation.attributeRows = Object.entries(system.baseAttributes || {}).map(([key, attr]) => {
        const value = Number(attr?.value ?? 5);
        const totalCost = ABOREA.attributeCost(value);
        const nextValue = Math.min(10, value + 1);
        const nextCost = value < 10 ? (ABOREA.attributeCost(nextValue) - totalCost) : null;
        return {
          key,
          label: ABOREA.attributes[key],
          value,
          totalCost,
          nextStepCost: nextCost,
          bonus: ABOREA.attributeBonus(value)
        };
      });
      system.creation.attributeCostTable = Array.from({ length: 10 }, (_, i) => {
        const value = i + 1;
        const totalCost = ABOREA.attributeCost(value);
        const nextValue = value < 10 ? value + 1 : null;
        return {
          value,
          bonus: ABOREA.attributeBonus(value),
          totalCost,
          stepCost: nextValue ? ABOREA.attributeCost(nextValue) - totalCost : null
        };
      });
      const classItem = actor.items.find(i => i.type === "class");
      const trainingBudget = Number(system.creation?.trainingBudget ?? system.resources?.trainingPoints ?? ABOREA.baseTrainingPoints);
      const trainingSpent = ABOREA.skillTrainingSpent(system.skills, classItem?.system);
      const trainingRemaining = trainingBudget - trainingSpent;
      system.activeClassFeatures = ABOREA.activeClassFeatures(classItem?.system || {}, system.resources?.level || 1);
      const activationState = system.classFeatures?.activations || {};
      system.activatableClassFeatures = system.activeClassFeatures
        .filter(isActivatableFeature)
        .map(feature => ({
          ...feature,
          state: activationState[feature.key] || {},
          ready: featureReady(feature, activationState[feature.key] || {}),
          usesLabel: featureUsesLabel(feature, activationState[feature.key] || {})
        }));
      system.creation.skillRows = ABOREA.getCreationSkills().map(({ key, label, attribute }) => {
        const skill = system.skills[key] || { rank: 0, attribute };
        return {
          key,
          label,
          rank: Number(skill.rank || 0),
          attribute: skill.attribute || attribute,
          cost: classItem?.system?.skillCosts?.[key] ?? "-",
          maxRank: ABOREA.skillMaxCreationRank(key, classItem?.system || {})
        };
      });
      system.creation.starterPackage = classItem?.system?.starterPackage || null;
      system.creation = {
        ...(system.creation || {}),
        pointsBudget: budget,
        pointsSpent: spent,
        pointsRemaining: remaining,
        trainingBudget,
        trainingSpent,
        trainingRemaining,
        valid: validationErrors.length === 0 && remaining === 0 && trainingRemaining >= 0 && !!system.details?.race && !!system.details?.class,
        validationErrors,
        canFinalize: validationErrors.length === 0 && remaining === 0 && trainingRemaining >= 0 && !!system.details?.race && !!system.details?.class
      };
      system.wallet = normalizeWallet(system.wallet);
      system.inventoryHistory = Array.isArray(system.inventoryHistory) ? foundry.utils.deepClone(system.inventoryHistory) : [];
      system.skillDisplayRows = buildSkillDisplayRows(system);
      system.companions = system.companions || { list: [] };
      system.companions.list = (system.companions.list || []).map(comp => ({
        ...comp,
        expiresLabel: formatExpiry(comp.expiresAt),
        levelLabel: comp.summonLevel ? `Stufe ${comp.summonLevel}` : '',
        expired: comp.expiresAt ? Number(comp.expiresAt) <= Date.now() : false
      }));
    } else {
      for (const [key, data] of Object.entries(system.attributes ?? {})) {
        data.bonus = ABOREA.attributeBonus(data.value);
        data.label = ABOREA.attributes[key];
      }
      const armorItems = actor.items.filter(i => i.type === "armor" && i.system.equipped);
      const armorBonus = armorItems.reduce((sum, item) => sum + Number(item.system.armor ?? 0) - 5, 0);
      const baseArmorValue = Number(system.combat?.armorValue ?? 5);
      system.combat.totalArmorValue = baseArmorValue + armorBonus;
      system.combat.defenseValue = ABOREA.defenseValue(system.combat.totalArmorValue, system.combat?.defensiveBonus ?? 0);
      system.combat.initiative = ABOREA.initiativeBonus(actor);
    }

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
      skills: actor.items.filter(i => i.type === "skill")
    };
    context.availablePacks = {
      races: await this._packChoices("race"),
      classes: await this._packChoices("class"),
      creatures: await this._packChoices("creature"),
      weapons: await this._packChoices("weapon"),
      armors: await this._packChoices("armor"),
      spells: await this._packChoices("spell"),
      miracles: await this._packChoices("miracle"),
      gear: await this._packChoices("gear")
    };
    return context;
  }

  async _packChoices(type) {
    const docs = [];
    const docName = type === "creature" ? "Actor" : "Item";
    for (const pack of game.packs.filter(p => p.documentName === docName)) {
      const index = await pack.getIndex({ fields: ["name", "type"] });
      docs.push(...index.filter(e => (type === "creature" || e.type === type)).map(e => ({ name: e.name, pack: pack.collection, label: `${e.name} — ${pack.metadata.label || pack.collection}` })));
    }
    const seen = new Set();
    return docs.filter(d => {
      const key = `${d.pack}:${d.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".roll-initiative").on("click", () => rollInitiative(this.actor));
    html.find(".roll-skill").on("click", ev => rollSkill(this.actor, ev.currentTarget.dataset.skill));
    html.find(".roll-attack").on("click", ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      const weapon = this.actor.items.get(itemId);
      rollAttack(this.actor, weapon, { targetDefense: this.actor.system.combat?.targetDefense ?? 5 });
    });

    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", ev => this.actor.items.get(ev.currentTarget.closest("[data-item-id]")?.dataset.itemId)?.sheet?.render(true));
    html.find(".item-delete").on("click", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (itemId) {
        const item = this.actor.items.get(itemId);
        if (item) await this._logInventoryEntry('item-remove', itemHistoryLabel(item), { itemType: item.type });
        await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
      }
      if (this.actor.type === "character") await this._recalculateCharacter();
    });

    html.find(".combat-balance").on("change", async ev => {
      const offensive = Number(ev.currentTarget.value ?? 0);
      const combatBonus = Number(this.actor.system.combat?.combatBonus ?? 0);
      await this.actor.update({ "system.combat.offensiveBonus": offensive, "system.combat.defensiveBonus": combatBonus - offensive });
    });

    html.find(".rest-heal").on("click", async () => {
      const conBonus = ABOREA.attributeBonus(this._attributeValue("ko"));
      const healed = Math.max(0, ABOREA.naturalHealingPerDay(conBonus));
      const current = Number(this.actor.system.resources.hp.value ?? 0);
      const max = Number(this.actor.system.resources.hp.max ?? current);
      await this.actor.update({ "system.resources.hp.value": Math.min(max, current + healed) });
      ui.notifications.info(`${this.actor.name}: +${healed} HP`);
    });

    html.find(".rest-mp").on("click", async () => {
      const cls = String(this.actor.system.details.class ?? "").toLowerCase();
      const attrKey = ["priester", "schamane", "barde"].includes(cls) ? "ch" : "in";
      const attrBonus = ABOREA.attributeBonus(this._attributeValue(attrKey));
      const regen = Math.max(0, ABOREA.mpRegenPerHour(attrBonus));
      const current = Number(this.actor.system.resources.mp.value ?? 0);
      const max = Number(this.actor.system.resources.mp.max ?? current);
      await this.actor.update({ "system.resources.mp.value": Math.min(max, current + regen) });
      ui.notifications.info(`${this.actor.name}: +${regen} MP`);
    });

    html.find(".apply-race").on("click", async () => {
      const selected = html.find('[name="selectedRace"]').val();
      if (!selected) return;
      const item = await findPackDocumentByTypeAndName("race", selected);
      if (item) await this._applyRace(item);
    });

    html.find(".apply-class").on("click", async () => {
      const selected = html.find('[name="selectedClass"]').val();
      if (!selected) return;
      const item = await findPackDocumentByTypeAndName("class", selected);
      if (item) await this._applyClass(item);
    });

    html.find(".class-feature-activate").on("click", async ev => {
      const featureKey = ev.currentTarget.dataset.featureKey;
      if (featureKey) await this._activateClassFeature(featureKey);
    });

    html.find(".class-feature-reset").on("click", async () => {
      await this._resetDailyClassFeatures();
    });

    html.find(".cast-power").on("click", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (itemId) await this._castPower(itemId);
    });

    html.find(".create-companion").on("click", async () => {
      const selected = html.find('[name="selectedCreature"]').val();
      if (selected) await this._createCompanion(selected);
    });
    html.find(".open-companion").on("click", async ev => {
      const actorId = ev.currentTarget.dataset.companionId;
      const actor = game.actors.get(actorId);
      if (actor) actor.sheet.render(true);
    });
    html.find(".remove-companion").on("click", async ev => {
      const actorId = ev.currentTarget.dataset.companionId;
      if (actorId) await this._removeCompanion(actorId);
    });
    html.find(".summon-companion").on("click", async ev => {
      const actorId = ev.currentTarget.dataset.companionId;
      if (actorId) await this._summonCompanion(actorId);
    });
    html.find(".dismiss-companion").on("click", async ev => {
      const actorId = ev.currentTarget.dataset.companionId;
      if (actorId) await this._dismissCompanion(actorId);
    });

    html.find(".creation-skill-adjust").on("click", async ev => {
      await this._adjustCreationSkill(ev.currentTarget.dataset.skill, Number(ev.currentTarget.dataset.delta || 0));
    });
    html.find(".add-custom-skill").on("click", async () => { await this._addCustomSkill(); });
    html.find(".remove-custom-skill").on("click", async ev => { await this._removeCustomSkill(ev.currentTarget.dataset.skillKey); });

    html.find(".wallet-adjust").on("click", async ev => {
      const key = ev.currentTarget.dataset.currencyKey;
      const mode = ev.currentTarget.dataset.mode;
      await this._adjustWalletCurrency(key, mode);
    });
    html.find(".wallet-add-currency").on("click", async () => { await this._addWalletCurrency(); });
    html.find(".wallet-remove-currency").on("click", async ev => { await this._removeWalletCurrency(ev.currentTarget.dataset.currencyKey); });

    html.find(".import-pack-item").on("click", async ev => {
      const type = ev.currentTarget.dataset.type;
      await this._importSelectedPackItem(html, type);
    });

    html.find(".apply-starter-package").on("click", async () => {
      await this._applyStarterPackage();
    });

    html.find(".recalc-character").on("click", async () => {
      await this._recalculateCharacter();
      ui.notifications.info("ABOREA: Charakterwerte neu berechnet.");
    });

    html.find(".finalize-character").on("click", async () => {
      const result = await this._recalculateCharacter();
      if (!result.valid) {
        ui.notifications.error("ABOREA: Charaktererstellung ist noch nicht gültig.");
        return;
      }
      await this.actor.update({ "system.creation.completed": true, "system.creation.status": "ready" });
      ui.notifications.info("ABOREA: Charakter abgeschlossen.");
    });

    html.find('input[name="system.resources.level"]').on("change", async () => {
      await this._applyLevelFeatures();
      ui.notifications.info("ABOREA: Stufenabhängige Berufsmerkmale aktualisiert.");
    });
  }

  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if (this.actor.type === "character" && data?.type === "Actor") {
      const dropTarget = event.target?.closest?.(".companion-dropzone, .tab[data-tab=companions]");
      if (dropTarget) {
        const actorDoc = await resolveDroppedActorDocument(data);
        if (actorDoc?.type === "creature") {
          await this._createCompanionFromActorDoc(actorDoc);
          return;
        }
      }
    }
    return super._onDrop(event);
  }

  async _onDropItem(event, data) {
    const item = await Item.implementation.fromDropData(data);
    if (!item) return super._onDropItem(event, data);

    if (item.type === "race") return this._applyRace(item);
    if (item.type === "class") return this._applyClass(item);

    const obj = duplicateItemObject(item);
    const created = await this.actor.createEmbeddedDocuments("Item", [obj]);
    await this._logInventoryEntry('item-add', itemHistoryLabel(obj), { itemType: obj.type, sourcePack: item.pack || item.compendium || '' });
    return created;
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
    const source = creatureDoc.toObject();
    delete source._id;
    source.folder = null;
    source.name = `${creatureDoc.name} (${this.actor.name})`;
    source.flags = foundry.utils.mergeObject(source.flags || {}, { aborea: { ownerActorId: this.actor.id, isCompanion: true, sourcePack: creatureDoc.pack || "", sourceId: creatureDoc.id } }, { inplace: false });
    const created = await Actor.create(source);
    const list = foundry.utils.deepClone(this.actor.system.companions?.list || []);
    list.push({ actorId: created.id, name: created.name, kind: created.system?.creature?.kind || created.type, sourceName: creatureDoc.name, sourcePack: creatureDoc.pack || "", permanent: true, status: 'created' });
    await this.actor.update({ "system.companions.list": list });
    ui.notifications.info("ABOREA: Begleiter erstellt.");
  }

  async _removeCompanion(actorId) {
    const actor = game.actors.get(actorId);
    if (actor) await actor.delete();
    const list = (this.actor.system.companions?.list || []).filter(c => c.actorId !== actorId);
    await this.actor.update({ "system.companions.list": list });
    ui.notifications.info("ABOREA: Begleiter entfernt.");
  }

  async _summonCompanion(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.error("ABOREA: Begleiter-Actor nicht gefunden.");
    const scene = game.scenes.current;
    if (!scene) return ui.notifications.error("ABOREA: Keine aktive Szene.");
    const existing = actor.getActiveTokens(true);
    if (existing.length) return existing[0].control();
    const td = actor.prototypeToken?.toObject ? actor.prototypeToken.toObject() : foundry.utils.deepClone(actor.prototypeToken || {});
    td.actorId = actor.id;
    td.actorLink = true;
    td.name = actor.name;
    td.x = Math.round((canvas?.stage?.pivot?.x || 0) + 200);
    td.y = Math.round((canvas?.stage?.pivot?.y || 0) + 200);
    await scene.createEmbeddedDocuments("Token", [td]);
    const list = foundry.utils.deepClone(this.actor.system.companions?.list || []);
    const idx = list.findIndex(c => c.actorId === actor.id);
    if (idx >= 0) { list[idx].status = 'summoned'; list[idx].lastSummonedAt = Date.now(); await this.actor.update({ 'system.companions.list': list }); }
    ui.notifications.info("ABOREA: Begleiter beschworen.");
  }

  async _dismissCompanion(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const scene = game.scenes.current;
    if (!scene) return;
    const tokens = actor.getActiveTokens(true).filter(t => t.scene?.id === scene.id);
    if (tokens.length) await scene.deleteEmbeddedDocuments("Token", tokens.map(t => t.id));
    const list = foundry.utils.deepClone(this.actor.system.companions?.list || []);
    const idx = list.findIndex(c => c.actorId === actor.id);
    if (idx >= 0) { list[idx].status = 'dismissed'; await this.actor.update({ 'system.companions.list': list }); }
    ui.notifications.info("ABOREA: Begleiter von der Szene entfernt.");
  }

  async _cleanupExpiredCompanions() {
    if (this.actor.type !== 'character') return;
    const now = Date.now();
    const list = foundry.utils.deepClone(this.actor.system.companions?.list || []);
    let changed = false;
    for (const comp of [...list]) {
      if (!comp?.expiresAt || comp.permanent) continue;
      if (Number(comp.expiresAt) > now) continue;
      const summoned = game.actors.get(comp.actorId);
      if (summoned) {
        for (const scene of game.scenes) {
          const ids = scene.tokens.filter(t => t.actorId === summoned.id).map(t => t.id);
          if (ids.length) await scene.deleteEmbeddedDocuments('Token', ids);
        }
        await summoned.delete();
      }
      const idx = list.findIndex(e => e.actorId === comp.actorId);
      if (idx >= 0) list.splice(idx, 1);
      changed = true;
    }
    if (changed) await this.actor.update({ 'system.companions.list': list });
  }

  async _automateSummon(item, mpCost) {
    const rule = summarizeSummonRule(item, this.actor, mpCost);
    if (!rule) return null;
    const now = Date.now();
    rule.mpCost = mpCost;
    rule.expiresAt = rule.permanent ? null : (rule.duration?.seconds ? now + rule.duration.seconds * 1000 : null);

    const list = foundry.utils.deepClone(this.actor.system.companions?.list || []);
    const sourceKey = `${item.id}:${rule.summonType}`;
    let entry = list.find(c => c.sourceKey === sourceKey);
    let summoned = entry ? game.actors.get(entry.actorId) : null;
    const source = buildSummonedCreatureSource(this.actor, item, rule);
    if (!summoned) {
      summoned = await Actor.create(source);
      entry = { actorId: summoned.id, sourceKey };
      list.push(entry);
    } else {
      await summoned.update(source);
    }
    Object.assign(entry, {
      actorId: summoned.id,
      name: summoned.name,
      kind: rule.templateName,
      sourceName: item.name,
      summonType: rule.summonType,
      summonLevel: rule.level,
      mpCost,
      permanent: !!rule.permanent,
      durationLabel: rule.duration?.label || 'Permanent',
      expiresAt: rule.expiresAt,
      status: 'summoned'
    });
    await this.actor.update({ 'system.companions.list': list });
    await this._summonCompanion(summoned.id);
    return { extra: `<p><strong>Beschwörung:</strong> ${rule.templateName}</p><p><strong>Stufe:</strong> ${rule.level}</p><p><strong>Dauer:</strong> ${rule.duration?.label || 'Permanent'}</p><p><strong>Läuft ab:</strong> ${formatExpiry(rule.expiresAt)}</p>` };
  }

  _attributeValue(key) {
    return Number(this.actor.system?.finalAttributes?.[key]?.value ?? this.actor.system?.attributes?.[key]?.value ?? 5);
  }

  async _applyRace(raceItem) {
    if (this.actor.type !== "character") return;
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
    const cls = duplicateItemObject(classItem);
    const race = this.actor.items.find(i => i.type === "race");
    if (race && !ABOREA.classAllowedForRace(race.system, cls.name)) {
      ui.notifications.error(`${race.name} darf den Beruf ${cls.name} nicht wählen.`);
      return;
    }
    const existing = this.actor.items.filter(i => i.type === "class");
    if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map(i => i.id));
    await this.actor.update({ "system.details.class": cls.name, "system.creation.completed": false, "system.creation.status": "draft" });
    await this.actor.createEmbeddedDocuments("Item", [cls]);
    const result = await this._recalculateCharacter();
    if (!result.valid && result.validationErrors.length) ui.notifications.warn(result.validationErrors.join(" | "));
    else ui.notifications.info(`${cls.name} auf ${this.actor.name} angewendet.`);
  }

  async _adjustCreationSkill(skillKey, delta) {
    if (this.actor.type !== "character") return;
    const cls = this.actor.items.find(i => i.type === "class");
    if (!cls) return ui.notifications.warn("ABOREA: Wähle zuerst einen Beruf.");
    const current = Number(this.actor.system.skills?.[skillKey]?.rank ?? 0);
    const maxRank = ABOREA.skillMaxCreationRank(skillKey, cls.system);
    const next = Math.max(0, Math.min(maxRank, current + Number(delta)));
    await this.actor.update({ [`system.skills.${skillKey}.rank`]: next, "system.creation.completed": false, "system.creation.status": "draft" });
    await this._recalculateCharacter();
  }

  async _applyStarterPackage() {
    if (this.actor.type !== "character") return;
    const cls = this.actor.items.find(i => i.type === "class");
    const starter = cls?.system?.starterPackage;
    if (!starter) return ui.notifications.warn("ABOREA: Kein Startpaket für diesen Beruf hinterlegt.");
    const updates = { "system.creation.appliedStarterPackage": starter.name || cls.name };
    for (const [key, rank] of Object.entries(starter.skills || {})) updates[`system.skills.${key}.rank`] = rank;
    await this.actor.update(updates);
    await this._recalculateCharacter();
    ui.notifications.info(game.i18n.localize("ABOREA.StartPackageApplied"));
  }

  async _recalculateCharacter() {
    if (this.actor.type !== "character") return { valid: true, validationErrors: [] };
    const actorSystem = this.actor.system;
    const base = foundry.utils.deepClone(actorSystem.baseAttributes || actorSystem.attributes || {});
    const race = this.actor.items.find(i => i.type === "race");
    const cls = this.actor.items.find(i => i.type === "class");
    const level = Number(actorSystem.resources?.level ?? 1) || 1;
    const errors = [];
    const finalAttrs = {};

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
    if (remaining !== 0) errors.push(`Attributbudget nicht erfüllt: ${remaining > 0 ? remaining + ' Punkte offen' : Math.abs(remaining) + ' Punkte zu viel'}.`);

    if (race && cls && !ABOREA.classAllowedForRace(race.system, cls.name)) {
      errors.push(`${race.name} darf den Beruf ${cls.name} nicht wählen.`);
    }

    const traits = emptyTraits();
    const classFeatures = ABOREA.activeClassFeatures(cls?.system || {}, level);
    const featureState = {
      list: classFeatures,
      labels: classFeatures.map(f => `[Stufe ${f.level}] ${f.label}`),
      notes: classFeatures.map(f => f.description).filter(Boolean),
      flags: {},
      bonuses: { information: 0, natur: 0, heilen: 0, heal: 0, einflussnahme: 0, influence: 0, list: 0, wahrnehmung: 0, heimlichkeit: 0, stealth: 0, gift: 0, poison: 0, fallen: 0, traps: 0, magieWahrnehmen: 0 },
      armorBonus: 0,
      weaponMinimums: {},
      followers: 0,
      activations: foundry.utils.deepClone(actorSystem.classFeatures?.activations || {}),
      lastResetDay: actorSystem.classFeatures?.lastResetDay || ""
    };
    for (const f of classFeatures) {
      featureState.flags[f.key] = true;
      if (f.type === 'armorBonus') featureState.armorBonus += Number(f.value || 0);
      if (f.type === 'followers') featureState.followers = Math.max(featureState.followers, Number(f.followers || 0));
      if (f.type === 'weaponMinimum') featureState.weaponMinimums[f.target || 'generic'] = Number(f.minimumRank ?? 0);
      const target = String(f.target || '').toLowerCase();
      if (target === 'information') featureState.bonuses.information += Number(f.value || 0);
      if (target === 'natur') featureState.bonuses.natur += Number(f.value || 0);
      if (target === 'heilen') { featureState.bonuses.heilen += Number(f.value || 0); featureState.bonuses.heal += Number(f.value || 0); }
      if (target === 'einflussnahme') { featureState.bonuses.einflussnahme += Number(f.value || 0); featureState.bonuses.influence += Number(f.value || 0); }
      if (target === 'list') featureState.bonuses.list += Number(f.value || 0);
      if (target === 'wahrnehmung') featureState.bonuses.wahrnehmung += Number(f.value || 0);
      if (target === 'stealth') { featureState.bonuses.heimlichkeit += Number(f.value || 0); featureState.bonuses.stealth += Number(f.value || 0); }
      if (target === 'gift') { featureState.bonuses.gift += Number(f.value || 0); featureState.bonuses.poison += Number(f.value || 0); }
      if (target === 'fallen') { featureState.bonuses.fallen += Number(f.value || 0); featureState.bonuses.traps += Number(f.value || 0); }
      if (target === 'senseMagic') featureState.bonuses.magieWahrnehmen += Number(f.value || 0);
    }
    if (['zwerg','halbling','gnom'].includes((race?.name || '').toLowerCase())) traits.racialArmorBonus = 1;
    if ((race?.name || '').toLowerCase() === 'zwerg') {
      traits.thermalVision = true;
      traits.secretDoorsBonus = true;
    }
    if ((race?.name || '').toLowerCase() === 'elf') {
      traits.diseaseImmunity = true;
      traits.maneuverBonus = 1;
    }
    if ((race?.name || '').toLowerCase() === 'halbling') traits.spellResistance = true;
    if ((race?.name || '').toLowerCase() === 'gnom') {
      traits.mechanicsBonus = true;
      traits.secretDoorsBonus = true;
    }

    // Training budget: 8 AP per level, +2 bonus for humans (once, at level 1 only)
    const humanBonus = (race?.name || '').toLowerCase() === 'mensch' ? 2 : 0;
    const trainingBudget = (ABOREA.baseTrainingPoints * level) + humanBonus;
    const trainingSpent = ABOREA.skillTrainingSpent(actorSystem.skills || {}, cls?.system);
    const trainingRemaining = trainingBudget - trainingSpent;
    if (trainingRemaining < 0) errors.push(game.i18n.localize("ABOREA.TrainingOverspent"));

    const hpBase = Number(cls?.system?.hitPointsBase ?? 5);
    // Zwerg gets +2 extra HP on level 1 (permanent bonus, counts once)
    const zwergBonus = (race?.name || '').toLowerCase() === 'zwerg' ? 2 : 0;
    let hpMax = Math.max(1, (hpBase + ABOREA.attributeBonus(finalAttrs.ko.value)) * level + zwergBonus);

    const magicAttribute = cls?.system?.magicAttribute || 'in';
    const magicDevelop = Number(actorSystem.skills?.magieEntwickeln?.rank ?? 0);
    const mpMax = Math.max(0, (ABOREA.attributeBonus(finalAttrs[magicAttribute].value) + 3) * magicDevelop);

    const derivedWeaponRank = Number(actorSystem.skills?.waffen?.rank ?? 0);
    const skillUpdates = {};
    for (const key of ABOREA.weaponSkillKeys) {
      const currentRank = Number(actorSystem.skills?.[key]?.rank ?? 0);
      skillUpdates[`system.skills.${key}.rank`] = Math.max(currentRank, derivedWeaponRank);
    }

    const updates = {
      "system.attributes": foundry.utils.deepClone(finalAttrs),
      "system.finalAttributes": finalAttrs,
      "system.resources.hp.max": hpMax,
      "system.resources.hp.value": Math.min(Number(actorSystem.resources?.hp?.value ?? hpMax), hpMax),
      "system.resources.mp.max": mpMax,
      "system.resources.mp.value": Math.min(Number(actorSystem.resources?.mp?.value ?? mpMax), mpMax),
      "system.resources.trainingPoints": trainingBudget,
      "system.traits": traits,
      "system.classFeatures": featureState,
      "system.creation.pointsBudget": budget,
      "system.creation.pointsSpent": spent,
      "system.creation.pointsRemaining": remaining,
      "system.creation.trainingBudget": trainingBudget,
      "system.creation.trainingSpent": trainingSpent,
      "system.creation.trainingRemaining": trainingRemaining,
      "system.creation.validationErrors": errors,
      "system.creation.status": errors.length ? "draft" : "ready",
      ...skillUpdates
    };
    await this.actor.update(updates);
    return { valid: errors.length === 0 && !!race && !!cls && remaining === 0, validationErrors: errors };
  }

  async _applyLevelFeatures() {
    if (this.actor.type !== "character") return;
    const result = await this._recalculateCharacter();
    const level = Number(this.actor.system?.resources?.level ?? 1);
    const cls = this.actor.items.find(i => i.type === "class");
    const race = this.actor.items.find(i => i.type === "race");
    const humanBonus = (race?.name || '').toLowerCase() === 'mensch' ? 2 : 0;
    const totalAP = (ABOREA.baseTrainingPoints * level) + humanBonus;
    const newFeatures = ABOREA.activeClassFeatures(cls?.system || {}, level).filter(f => Number(f.level) === level);
    let msg = `${this.actor.name}: Stufe ${level} — ${totalAP} AP Gesamt`;
    if (newFeatures.length) msg += ` | Neue Fähigkeiten: ${newFeatures.map(f => f.label).join(', ')}`;
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: `<p>${msg}</p>` });
    return result;
  }

  async _activateClassFeature(featureKey) {
    if (this.actor.type !== "character") return;
    const feature = (this.actor.system.classFeatures?.list || []).find(f => f.key === featureKey);
    if (!feature) return ui.notifications.warn(`ABOREA: Klassenfähigkeit ${featureKey} nicht gefunden.`);
    const path = `system.classFeatures.activations.${featureKey}`;
    const state = foundry.utils.deepClone(foundry.utils.getProperty(this.actor, path) || {});
    if (feature.usesPerDay && Number(state.used || 0) >= Number(feature.usesPerDay || 0)) {
      return ui.notifications.warn(`${feature.label} ist für heute verbraucht.`);
    }
    state.used = Number(state.used || 0) + (feature.usesPerDay ? 1 : 0);
    state.lastActivated = new Date().toLocaleString(game.i18n.lang || undefined);
    state.day = currentDayStamp();
    await this.actor.update({ [path]: state });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: buildFeatureCard(this.actor, feature, state)
    });
    ui.notifications.info(game.i18n.localize("ABOREA.FeatureActivated"));
  }

  async _resetDailyClassFeatures() {
    if (this.actor.type !== "character") return;
    const activations = foundry.utils.deepClone(this.actor.system.classFeatures?.activations || {});
    for (const key of Object.keys(activations)) {
      activations[key].used = 0;
      activations[key].day = currentDayStamp();
    }
    await this.actor.update({
      "system.classFeatures.activations": activations,
      "system.classFeatures.lastResetDay": currentDayStamp()
    });
    ui.notifications.info(game.i18n.localize("ABOREA.ResetDone"));
  }


  async _logInventoryEntry(action, label, extra = {}) {
    if (this.actor.type !== "character") return;
    const current = Array.isArray(this.actor.system.inventoryHistory) ? foundry.utils.deepClone(this.actor.system.inventoryHistory) : [];
    await this.actor.update({ "system.inventoryHistory": logListPush(current, makeHistoryEntry("inventory", action, label, extra)) });
  }

  async _logWalletEntry(action, label, amount, currency) {
    if (this.actor.type !== "character") return;
    const wallet = normalizeWallet(this.actor.system.wallet);
    wallet.history = logListPush(wallet.history, makeHistoryEntry("wallet", action, label, { amount, currency }));
    await this.actor.update({ "system.wallet": wallet });
  }

  async _addCustomSkill() {
    if (this.actor.type !== "character") return;
    const list = Array.isArray(this.actor.system.customSkills) ? foundry.utils.deepClone(this.actor.system.customSkills) : [];
    const idx = list.length;
    list.push(ABOREA.customSkillTemplate(idx));
    await this.actor.update({ "system.customSkills": list });
  }

  async _removeCustomSkill(skillKey) {
    if (this.actor.type !== "character") return;
    const list = (this.actor.system.customSkills || []).filter(s => s.key !== skillKey);
    await this.actor.update({ "system.customSkills": list });
  }

  async _adjustWalletCurrency(currencyKey, mode) {
    if (this.actor.type !== "character") return;
    const wallet = normalizeWallet(this.actor.system.wallet);
    const cur = wallet.currencies.find(c => c.key === currencyKey);
    if (!cur) return;
    const title = `${mode === 'deposit' ? game.i18n.localize('ABOREA.Deposit') : game.i18n.localize('ABOREA.Withdraw')} ${cur.label}`;
    const amount = await new Promise(resolve => {
      new Dialog({
        title,
        content: `<form><div class="form-group"><label>${game.i18n.localize('ABOREA.Amount')}</label><input type="number" name="amount" value="1" min="1" step="1"/></div></form>`,
        buttons: {
          ok: { label: "OK", callback: html => resolve(Number(html.find('[name="amount"]').val() || 0)) },
          cancel: { label: game.i18n.localize("Cancel"), callback: () => resolve(0) }
        },
        default: "ok",
        close: () => resolve(0)
      }).render(true);
    });
    if (!amount || amount < 0) return;
    const current = Number(cur.amount || 0);
    cur.amount = mode === 'withdraw' ? Math.max(0, current - amount) : current + amount;
    wallet.history = logListPush(wallet.history, makeHistoryEntry("wallet", mode, `${cur.label}`, { amount, currency: cur.label }));
    await this.actor.update({ "system.wallet": wallet });
  }

  async _addWalletCurrency() {
    if (this.actor.type !== "character") return;
    const result = await new Promise(resolve => {
      new Dialog({
        title: game.i18n.localize("ABOREA.AddCurrency"),
        content: `<form>
          <div class="form-group"><label>${game.i18n.localize('ABOREA.CurrencyCode')}</label><input type="text" name="key" maxlength="4"/></div>
          <div class="form-group"><label>${game.i18n.localize('ABOREA.CurrencyLabel')}</label><input type="text" name="label" maxlength="4"/></div>
          <div class="form-group"><label>${game.i18n.localize('ABOREA.CurrencyName')}</label><input type="text" name="name"/></div>
        </form>`,
        buttons: {
          ok: { label: "OK", callback: html => resolve({
            key: String(html.find('[name="key"]').val() || '').trim().toLowerCase(),
            label: String(html.find('[name="label"]').val() || '').trim().toUpperCase(),
            name: String(html.find('[name="name"]').val() || '').trim()
          }) },
          cancel: { label: game.i18n.localize("Cancel"), callback: () => resolve(null) }
        },
        default: "ok",
        close: () => resolve(null)
      }).render(true);
    });
    if (!result?.key || !result?.label || !result?.name) return;
    const wallet = normalizeWallet(this.actor.system.wallet);
    if (wallet.currencies.some(c => c.key === result.key || c.label === result.label)) return ui.notifications.warn("ABOREA: Zahlungsmittel existiert bereits.");
    wallet.currencies.push({ ...result, amount: 0 });
    await this.actor.update({ "system.wallet": wallet });
  }

  async _removeWalletCurrency(currencyKey) {
    if (this.actor.type !== "character") return;
    const wallet = normalizeWallet(this.actor.system.wallet);
    const base = ['gf','tt','kl','mu'];
    if (base.includes(String(currencyKey))) return ui.notifications.warn("ABOREA: Standard-Zahlungsmittel können nicht entfernt werden.");
    wallet.currencies = wallet.currencies.filter(c => c.key !== currencyKey);
    await this.actor.update({ "system.wallet": wallet });
  }

  async _importSelectedPackItem(html, type) {
    const selected = html.find(`[name="selectedPackItem-${type}"]`).val();
    if (!selected) return;
    const [packId, docName] = String(selected).split("||");
    const pack = game.packs.get(packId);
    if (!pack) return ui.notifications.error("ABOREA: Kompendium nicht gefunden.");
    const index = await pack.getIndex({ fields: ["name","type"] });
    const hit = index.find(e => e.name === docName && e.type === type);
    if (!hit) return ui.notifications.error("ABOREA: Eintrag im Kompendium nicht gefunden.");
    const doc = await pack.getDocument(hit._id);
    const obj = duplicateItemObject(doc);
    await this.actor.createEmbeddedDocuments("Item", [obj]);
    await this._logInventoryEntry('item-add', itemHistoryLabel(obj), { itemType: obj.type, sourcePack: packId });
  }

  async _castPower(itemId) {
    const item = this.actor.items.get(itemId);
    if (!item || !['spell', 'miracle'].includes(item.type)) return;
    const mpCost = await chooseMpCost(item);
    if (mpCost == null) return;
    const currentMp = Number(this.actor.system.resources?.mp?.value ?? 0);
    if (currentMp < mpCost) {
      ui.notifications.warn(game.i18n.localize('ABOREA.NotEnoughMP'));
      return;
    }

    const targets = Array.from(game.user.targets || []).map(t => t.actor).filter(Boolean);
    await this._cleanupExpiredCompanions();
    await this.actor.update({ 'system.resources.mp.value': Math.max(0, currentMp - mpCost) });

    const hp = inferDirectHp(item, mpCost);
    const effects = inferEffects(item, mpCost).map(e => ({ ...e, origin: item.uuid }));
    let extra = '';

    for (const target of targets) {
      if (hp?.type === 'heal') {
        const current = Number(target.system.resources?.hp?.value ?? 0);
        const max = Number(target.system.resources?.hp?.max ?? current);
        await target.update({ 'system.resources.hp.value': Math.min(max, current + hp.amount) });
        extra += `<p><strong>${target.name}</strong>: +${hp.amount} HP</p>`;
      }
      if (hp?.type === 'damage') {
        const current = Number(target.system.resources?.hp?.value ?? 0);
        await target.update({ 'system.resources.hp.value': Math.max(0, current - hp.amount) });
        extra += `<p><strong>${target.name}</strong>: -${hp.amount} HP</p>`;
      }
      if (effects.length) {
        await applyEffectsToActor(target, effects);
        extra += `<p><strong>${target.name}</strong>: ${game.i18n.localize('ABOREA.EffectApplied')}</p>`;
      }
    }

    if (hp?.type === 'buffDamage') {
      effects.push({
        name: item.name,
        origin: item.uuid,
        description: item.system?.description,
        duration: parseSimpleDuration(item, mpCost),
        changes: [{ key: 'flags.aborea.extraWeaponDamage', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: hp.amount }]
      });
      await applyEffectsToActor(this.actor, effects.slice(-1));
      extra += `<p><strong>${this.actor.name}</strong>: +${hp.amount} Waffenschaden</p>`;
    }

    const summon = await this._automateSummon(item, mpCost);
    if (summon?.extra) extra += summon.extra;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: buildPowerCard(this.actor, item, mpCost, targets, extra)
    });
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const name = game.i18n.format("ABOREA.NewItem", { type });
    const created = await this.actor.createEmbeddedDocuments("Item", [{ name, type, system: {} }]);
    await this._logInventoryEntry('item-add', itemHistoryLabel({ name, type }), { itemType: type, sourcePack: 'manual' });
    return created;
  }
}

export class AboreaCharacterSheet extends AboreaActorSheet {
  get template() { return "systems/aborea-v7/templates/actor/character-sheet.html"; }
}
export class AboreaNpcSheet extends AboreaActorSheet {
  get template() { return "systems/aborea-v7/templates/actor/npc-sheet.html"; }
}
export class AboreaCreatureSheet extends AboreaActorSheet {
  get template() { return "systems/aborea-v7/templates/actor/creature-sheet.html"; }
}
