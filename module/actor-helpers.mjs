import { ABOREA } from "./config.mjs";

// ── XP / Level ──────────────────────────────────────────────────────────────

export function levelForXp(xp) {
  return ABOREA.levelForXp(xp);
}

export function xpForNextLevel(level) {
  const idx = Math.max(0, Number(level));
  return ABOREA.xpTable[idx] ?? idx * 10000;
}

// ── Compendium helpers ───────────────────────────────────────────────────────

export async function findPackDocumentByTypeAndName(type, name, preferredPack = null) {
  const matchingPacks = game.packs.filter(p => p.documentName === (type === "creature" ? "Actor" : "Item"));
  const orderedPacks = preferredPack
    ? [matchingPacks.find(p => p.collection === preferredPack), ...matchingPacks.filter(p => p.collection !== preferredPack)]
    : matchingPacks;
  for (const pack of orderedPacks.filter(Boolean)) {
    const index = await pack.getIndex({ fields: ["name", "type"] });
    const hit = index.find(e => e.name === name && (type === "creature" || e.type === type));
    if (hit) return pack.getDocument(hit._id);
  }
  return null;
}

export async function openCompendiumPickerDialog(type, choices, title) {
  if (!choices.length) {
    ui.notifications?.warn(`ABOREA: Keine Einträge für "${title}" gefunden.`);
    return null;
  }
  const optionHtml = choices.map(c => `<option value="${c.pack}||${c.name}">${c.label}</option>`).join("");
  return new Promise(resolve => {
    new Dialog({
      title,
      content: `<form><div class="form-group"><label>Auswahl</label><select name="pick" style="width:100%">${optionHtml}</select></div></form>`,
      buttons: {
        ok: {
          label: "Hinzufügen",
          callback: html => {
            const raw = html.find("[name=pick]").val();
            if (!raw) return resolve(null);
            const [pack, name] = raw.split("||");
            resolve({ pack, name });
          }
        },
        cancel: { label: "Abbruch", callback: () => resolve(null) }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

export function parsePackSelection(value) {
  const raw = String(value || "").trim();
  if (!raw) return { pack: null, name: "" };
  const [pack, name] = raw.split("||");
  return { pack: pack || null, name: name || raw };
}

export async function resolveDroppedActorDocument(data) {
  if (!data || data.type !== "Actor") return null;
  try {
    return await Actor.implementation.fromDropData(data);
  } catch (err) {
    if (data.uuid) return await fromUuid(data.uuid);
    throw err;
  }
}

// ── Timestamps ───────────────────────────────────────────────────────────────

export function currentDayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function nowStamp() {
  return new Date().toLocaleString(game.i18n.lang || undefined);
}

export function formatExpiry(ts) {
  if (!ts) return "Permanent";
  return new Date(ts).toLocaleString(game.i18n.lang || undefined);
}

// ── History / Wallet ─────────────────────────────────────────────────────────

export function makeHistoryEntry(type, action, label, details = {}) {
  return { timestamp: Date.now(), stamp: nowStamp(), type, action, label, ...details };
}

export function logListPush(list = [], entry, max = 200) {
  return [entry, ...list].slice(0, max);
}

export function normalizeWallet(wallet = {}) {
  const defaults = [
    { key: "gf", label: "GF", name: "Goldfalken",  amount: 0 },
    { key: "tt", label: "TT", name: "Trionthaler", amount: 0 },
    { key: "kl", label: "KL", name: "Kupferlinge", amount: 0 },
    { key: "mu", label: "MU", name: "Muena",        amount: 0 }
  ];
  const currencies = Array.isArray(wallet?.currencies)
    ? foundry.utils.deepClone(wallet.currencies)
    : [];
  for (const cur of defaults) {
    if (!currencies.find(c => String(c.key) === cur.key)) currencies.push(foundry.utils.deepClone(cur));
  }
  return {
    currencies,
    history: Array.isArray(wallet?.history) ? foundry.utils.deepClone(wallet.history) : []
  };
}

// ── Traits ───────────────────────────────────────────────────────────────────

export function emptyTraits() {
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

// ── Skills ───────────────────────────────────────────────────────────────────

function classFeatureBonusMap(classFeatures = {}) {
  return foundry.utils.deepClone(classFeatures?.bonuses || {});
}

export function buildSkillDisplayRows(system) {
  const rows = [];
  const classBonuses = classFeatureBonusMap(system.classFeatures);
  for (const [key, skill] of Object.entries(system.skills || {})) {
    rows.push({
      key, label: skill.label,
      name: game.i18n.localize(skill.label || key),
      attribute: skill.attribute,
      rank: Number(skill.rank || 0),
      bonus: Number(classBonuses[key] || 0),
      source: "base", isCustom: false
    });
  }
  for (const [index, skill] of (system.customSkills || []).entries()) {
    rows.push({
      key: skill.key, label: skill.name, name: skill.name,
      attribute: skill.attribute || "in",
      rank: Number(skill.rank || 0),
      bonus: Number(skill.bonus || 0),
      cost: skill.cost ?? "1",
      source: "custom", isCustom: true, customIndex: index
    });
  }
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), game.i18n.lang || undefined));
}

export function itemHistoryLabel(item) {
  return `${item.name}${item.type ? ` (${item.type})` : ""}`;
}

// ── Class features ───────────────────────────────────────────────────────────

export function isActivatableFeature(feature) {
  return ["dailyPower","pool","focusStorage","resourceConversion","companion","sense","castingBonus"]
    .includes(String(feature?.type || ""));
}

export function featureUsesLabel(feature, state = {}) {
  if (!feature?.usesPerDay) return "—";
  const used = Number(state.used || 0);
  const max  = Number(feature.usesPerDay || 0);
  return `${Math.max(0, max - used)}/${max}`;
}

export function featureReady(feature, state = {}) {
  if (!feature?.usesPerDay) return true;
  return Number(state.used || 0) < Number(feature.usesPerDay || 0);
}

export function buildFeatureCard(actor, feature, state = {}) {
  const uses = feature?.usesPerDay
    ? `<p><strong>${game.i18n.localize("ABOREA.FeatureUses")}:</strong> ${featureUsesLabel(feature, state)}</p>`
    : "";
  const last = state?.lastActivated
    ? `<p><strong>${game.i18n.localize("ABOREA.LastActivated")}:</strong> ${state.lastActivated}</p>`
    : "";
  return `<section class="aborea-chat-card"><h2>${game.i18n.localize("ABOREA.FeatureActivation")}: ${feature.label}</h2><p><strong>${actor.name}</strong> aktiviert eine Klassenfähigkeit.</p><p>${feature.description || ""}</p>${uses}${last}</section>`;
}

// ── Effects / Spells ─────────────────────────────────────────────────────────

function effectIcon(name) {
  const slug = String(name || "").toLowerCase();
  if (slug.includes("blind") || slug.includes("blend"))   return "icons/svg/blind.svg";
  if (slug.includes("unsicht") || slug.includes("invisible")) return "icons/svg/invisible.svg";
  if (slug.includes("schlaf") || slug.includes("sleep"))  return "icons/svg/sleep.svg";
  if (slug.includes("segn") || slug.includes("beistand") || slug.includes("freundlich")) return "icons/svg/aura.svg";
  if (slug.includes("fluch") || slug.includes("trüb"))    return "icons/svg/degen.svg";
  return "icons/svg/mystery-man.svg";
}

export async function chooseMpCost(item) {
  const options = Array.isArray(item.system?.costOptions) && item.system.costOptions.length
    ? item.system.costOptions
    : [Number(item.system?.cost || 1)];
  if (options.length === 1) return Number(options[0]);
  return new Promise(resolve => {
    const optionHtml = options.map(o => `<option value="${o}">${o}</option>`).join("");
    new Dialog({
      title: game.i18n.localize("ABOREA.SelectMPCost"),
      content: `<form><div class="form-group"><label>${game.i18n.localize("ABOREA.MPCost")}</label><select name="mp">${optionHtml}</select></div></form>`,
      buttons: {
        ok:     { label: "OK",     callback: html => resolve(Number(html.find("[name=mp]").val())) },
        cancel: { label: "Cancel", callback: () => resolve(null) }
      },
      default: "ok", close: () => resolve(null)
    }).render(true);
  });
}

export function parseSimpleDuration(item, mpCost) {
  const txt = String(item.system?.duration || "").toLowerCase();
  const roundsMatch  = txt.match(/(\d+)\s*runde/);
  const minutesMatch = txt.match(/(\d+)\s*min/);
  const hoursMatch   = txt.match(/(\d+)\s*stunde/);
  const daysMatch    = txt.match(/(\d+)\s*tag/);
  if (txt.includes("/1 mp")) {
    if (txt.includes("runde"))  return { rounds:  Math.max(1, mpCost) };
    if (txt.includes("min"))    return { seconds: 60   * Math.max(1, mpCost) };
    if (txt.includes("stunde")) return { seconds: 3600 * Math.max(1, mpCost) };
    if (txt.includes("tag"))    return { seconds: 86400 * Math.max(1, mpCost) };
  }
  if (roundsMatch)  return { rounds:  Number(roundsMatch[1]) };
  if (minutesMatch) return { seconds: 60   * Number(minutesMatch[1]) };
  if (hoursMatch)   return { seconds: 3600 * Number(hoursMatch[1]) };
  if (daysMatch)    return { seconds: 86400 * Number(daysMatch[1]) };
  return {};
}

export function inferEffects(item, mpCost) {
  const name = String(item.name || "").toLowerCase();
  const duration = parseSimpleDuration(item, mpCost);
  const effects = [];
  if (name.includes("blend"))    effects.push({ name: item.name, statuses: ["blind"],       duration, description: item.system?.description, changes: [] });
  if (name.includes("schlaf"))   effects.push({ name: item.name, statuses: ["unconscious"], duration, description: item.system?.description, changes: [] });
  if (name.includes("unsicht"))  effects.push({ name: item.name, statuses: ["invisible"],   duration, description: item.system?.description, changes: [] });
  if (name.includes("segn"))     effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: "system.traits.maneuverBonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 1 }] });
  if (name.includes("beistand")) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: "system.traits.maneuverBonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: Math.min(3, Math.max(1, mpCost)) }] });
  if (name.includes("freundliche weise")) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: "system.classFeatures.bonuses.influence", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 2 }] });
  if (name.includes("trüb"))     effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: "system.traits.maneuverBonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1 }] });
  if (name === "fluch" || name.includes("verfluchen")) effects.push({ name: item.name, duration, description: item.system?.description, changes: [{ key: "system.traits.maneuverBonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1 }] });
  return effects;
}

export function inferDirectHp(item, mpCost) {
  const name = String(item.name || "").toLowerCase();
  if (name.includes("heilung"))  return { type: "heal",   amount: 4 * mpCost };
  if (name === "heilen")         return { type: "heal",   amount: 1 * mpCost };
  if (name.includes("feuerball")) return { type: "damage", amount: Math.min(5, mpCost) };
  if (name === "blitz")          return { type: "damage", amount: mpCost };
  if (name.includes("explosion")) return { type: "damage", amount: mpCost };
  if (name.includes("stoßwelle")) return { type: "damage", amount: Math.min(5, Math.floor(mpCost / 2)) };
  if (name.includes("flammenschwert")) return { type: "buffDamage", amount: Math.min(5, Math.floor(mpCost / 2)) };
  return null;
}

export async function applyEffectsToActor(actor, effects) {
  if (!effects.length) return;
  const existing = actor.effects.filter(e => effects.some(n => n.name === e.name));
  if (existing.length) await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(e => e.id));
  const docs = effects.map(e => ({
    name: e.name,
    icon: e.icon || effectIcon(e.name),
    statuses: e.statuses || [],
    disabled: false,
    duration: e.duration || {},
    origin: e.origin,
    description: e.description || "",
    changes: e.changes || []
  }));
  await actor.createEmbeddedDocuments("ActiveEffect", docs);
}

export function buildPowerCard(actor, item, mpCost, targets, extra = "") {
  return `<section class="aborea-chat-card"><h2>${game.i18n.localize("ABOREA.SpellCast")}: ${item.name}</h2><p><strong>${actor.name}</strong> wirkt ${item.type === "miracle" ? game.i18n.localize("ABOREA.Miracle") : game.i18n.localize("ABOREA.Spell")}.</p><p><strong>${game.i18n.localize("ABOREA.MPCost")}:</strong> ${mpCost}</p><p><strong>${game.i18n.localize("ABOREA.Range")}:</strong> ${item.system?.range || "—"}</p><p><strong>${game.i18n.localize("ABOREA.Duration")}:</strong> ${item.system?.duration || "—"}</p><p><strong>${game.i18n.localize("ABOREA.Targets")}:</strong> ${targets.length ? targets.map(t => t.name).join(", ") : "—"}</p><p>${item.system?.description || ""}</p>${extra}</section>`;
}

// ── Summons ───────────────────────────────────────────────────────────────────

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseDurationMeta(item, mpCost) {
  const raw = String(item.system?.duration || "").trim();
  const base = parseSimpleDuration(item, mpCost);
  let seconds = Number(base.seconds || 0);
  let rounds  = Number(base.rounds  || 0);
  if (rounds && !seconds) seconds = rounds * 6;
  return { raw, label: raw || "Permanent", seconds, rounds, permanent: !raw || (!seconds && !rounds) };
}

export function summarizeSummonRule(item, actor, mpCost) {
  const name = normalizeText(item.name);
  const list = normalizeText(item.system?.list);
  const actorLevel = Number(actor.system?.resources?.level || 1);
  if (name.includes("beschworung"))  return { templateName: "Beschworene Kreatur",  summonType: "conjured",       level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "helfer")             return { templateName: "Tierischer Helfer",     summonType: "animal-helper",  level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "animation")          return { templateName: "Animierte Pflanze",     summonType: "animated-plant", level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "tierfreund")         return { templateName: "Tierfreund",            summonType: "animal-friend",  level: Math.max(1, Math.floor(mpCost / 3)),           duration: { label: "Dauerhaft", seconds: 0, rounds: 0, permanent: true }, permanent: true };
  if (name === "erde")               return { templateName: "Erdelementar",          summonType: "earth-elemental",level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "elemente" && list.includes("wilde")) return { templateName: "Elementar", summonType: "elemental",  level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "elementar")          return { templateName: "Elementar",             summonType: "elemental",      level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "naturgeist")         return { templateName: "Naturgeist",            summonType: "nature-spirit",  level: Math.max(1, Math.min(mpCost, Math.floor(actorLevel / 2) || 1)), duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "belebung")           return { templateName: "Untoter Diener",        summonType: "undead",         level: Math.max(1, mpCost),                           duration: parseDurationMeta(item, mpCost), permanent: false };
  if (name === "dauerhafte belebung") return { templateName: "Untoter Diener",       summonType: "undead",         level: Math.max(1, Math.floor(mpCost / 2)),           duration: { label: "Dauerhaft", seconds: 0, rounds: 0, permanent: true }, permanent: true };
  return null;
}

function summonedBaseStats(kind, level) {
  const lvl = Math.max(1, Number(level || 1));
  const stats = {
    "conjured":        { st: 5+lvl, ge: 4+Math.ceil(lvl/2),  ko: 5+lvl, in: 3+Math.floor(lvl/2), ch: 3+Math.floor(lvl/3), armor: 5+Math.floor(lvl/2), dmg: 1+Math.ceil(lvl/2) },
    "animal-helper":   { st: 4+lvl, ge: 5+lvl,               ko: 4+lvl, in: 2+Math.floor(lvl/3), ch: 3+Math.floor(lvl/3), armor: 5+Math.floor(lvl/3), dmg: 1+Math.ceil(lvl/2) },
    "animated-plant":  { st: 5+lvl, ge: 2+Math.floor(lvl/2), ko: 6+lvl, in: 1+Math.floor(lvl/4), ch: 1,                   armor: 6+Math.floor(lvl/2), dmg: 1+Math.ceil(lvl/2) },
    "animal-friend":   { st: 4+lvl, ge: 5+lvl,               ko: 4+lvl, in: 2+Math.floor(lvl/3), ch: 4+Math.floor(lvl/3), armor: 5+Math.floor(lvl/3), dmg: 1+Math.ceil(lvl/2) },
    "earth-elemental": { st: 6+lvl, ge: 2+Math.floor(lvl/2), ko: 6+lvl, in: 2+Math.floor(lvl/3), ch: 2,                   armor: 6+Math.floor(lvl/2), dmg: 2+Math.ceil(lvl/2) },
    "elemental":       { st: 5+lvl, ge: 4+lvl,               ko: 5+lvl, in: 3+Math.floor(lvl/3), ch: 2,                   armor: 5+Math.floor(lvl/2), dmg: 2+Math.ceil(lvl/2) },
    "nature-spirit":   { st: 3+Math.floor(lvl/2), ge: 5+lvl, ko: 4+lvl, in: 4+Math.floor(lvl/2), ch: 4+Math.floor(lvl/2), armor: 5+Math.floor(lvl/3), dmg: 1+Math.ceil(lvl/2) },
    "undead":          { st: 5+lvl, ge: 3+Math.floor(lvl/2), ko: 6+lvl, in: 1+Math.floor(lvl/3), ch: 1,                   armor: 5+Math.floor(lvl/2), dmg: 1+Math.ceil(lvl/2) }
  };
  return stats[kind] || stats["conjured"];
}

export function buildSummonedCreatureSource(owner, item, rule) {
  const lvl = Math.max(1, Number(rule.level || 1));
  const s = summonedBaseStats(rule.summonType, lvl);
  const hpMax    = Math.max(1, 6 + lvl * 4 + ABOREA.attributeBonus(s.ko));
  const defBonus = ABOREA.attributeBonus(s.ge) + Math.max(0, Math.floor(lvl / 3));
  const actorName = `${rule.templateName} (${owner.name})`;
  return {
    name: actorName, type: "creature", img: "icons/svg/mystery-man.svg",
    prototypeToken: { name: actorName, actorLink: true, disposition: 1, bar1: { attribute: "resources.hp" }, displayName: 20, displayBars: 20 },
    system: {
      attributes: { st: { value: s.st }, ge: { value: s.ge }, ko: { value: s.ko }, in: { value: s.in }, ch: { value: s.ch } },
      resources: { hp: { value: hpMax, max: hpMax }, mp: { value: 0, max: 0 }, level: lvl, xp: 0 },
      combat: {
        combatBonus:    ABOREA.attributeBonus(s.st) + Math.max(0, Math.floor(lvl / 2)),
        offensiveBonus: ABOREA.attributeBonus(s.st) + Math.max(0, Math.floor(lvl / 2)),
        defensiveBonus: defBonus,
        armorValue: s.armor, totalArmorValue: s.armor,
        defenseValue: ABOREA.defenseValue(s.armor, defBonus),
        damageBonus: s.dmg,
        initiative: ABOREA.attributeBonus(s.ge)
      },
      details: { notes: item.system?.description || "" },
      creature: { kind: rule.templateName, size: lvl >= 8 ? "groß" : (lvl >= 4 ? "mittel" : "klein"), threat: lvl },
      summon: {
        ownerActorId: owner.id, sourceItemId: item.id, sourceItemName: item.name,
        summonType: rule.summonType, summonLevel: lvl, mpCost: rule.mpCost,
        permanent: !!rule.permanent, durationLabel: rule.duration?.label || "Permanent",
        expiresAt: rule.expiresAt || null, active: true
      }
    },
    flags: { aborea: { ownerActorId: owner.id, isCompanion: true, isSummon: true, summonType: rule.summonType } }
  };
}
