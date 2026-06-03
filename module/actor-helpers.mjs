import { ABOREA } from "./config.mjs";

// ── XP / Level ──────────────────────────────────────────────────────────────

export function levelForXp(xp) {
  return ABOREA.levelForXp(xp);
}

export function xpForNextLevel(level) {
  const idx = Math.max(0, Number(level));
  if (idx >= ABOREA.xpTable.length) return null; // Max. Stufe erreicht
  return ABOREA.xpTable[idx];
}

// ── Custom Skills ────────────────────────────────────────────────────────────

/**
 * Normalisiert customSkills auf ein sauberes Array.
 * Foundry kann Arrays bei Formularübermittlung als {0:{…},1:{…}} serialisieren.
 * Stellt außerdem sicher, dass jeder Eintrag alle Pflichtfelder enthält
 * und dass doppelte keys entfernt werden.
 */
export function normalizeCustomSkills(raw) {
  const arr = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  const seen = new Set();
  return arr.filter(Boolean).map(s => ({
    key:       String(s.key  ?? `custom-${Math.random().toString(36).slice(2)}`),
    name:      String(s.name ?? ""),
    attribute: String(s.attribute ?? "in"),
    rank:      Math.max(0, Number(s.rank ?? 0)),
    cost:      String(s.cost ?? "1"),
    source:    String(s.source ?? "custom")
  })).filter(s => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
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

/**
 * Gibt einen Tages-Stamp zurück, der einen Spieltag eindeutig identifiziert.
 * Wenn Simple Calendar Reborn aktiv ist, wird der In-Game-Kalender verwendet.
 * Fallback: Echtzeit-Datum des Servers (YYYY-MM-DD).
 */
export function currentDayStamp() {
  try {
    if (typeof SimpleCalendar !== "undefined" && SimpleCalendar?.api?.currentDateTime) {
      const dt = SimpleCalendar.api.currentDateTime();
      if (dt && dt.year != null && dt.month != null && dt.day != null) {
        // SimpleCalendar liefert month 0-basiert
        return `sc-${dt.year}-${String(dt.month + 1).padStart(2, "0")}-${String(dt.day).padStart(2, "0")}`;
      }
    }
  } catch (_) {}
  // Fallback: Echtzeit-Serverdatum
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function nowStamp() {
  try {
    if (typeof SimpleCalendar !== "undefined" && SimpleCalendar?.api?.currentDateTime) {
      const dt = SimpleCalendar.api.currentDateTime();
      if (dt?.display?.date && dt?.display?.time) return `${dt.display.date} ${dt.display.time}`;
    }
  } catch (_) {}
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
    thermalVision: false,
    skillBonuses: {}
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
  const max = Number(feature.usesPerDay || 0);
  // Neuer Tag → alle Nutzungen wieder verfügbar (Anzeige)
  if (state.day && state.day !== currentDayStamp()) return `${max}/${max}`;
  const used = Number(state.used || 0);
  return `${Math.max(0, max - used)}/${max}`;
}

export function featureReady(feature, state = {}) {
  if (!feature?.usesPerDay) return true;
  // Neuer Tag → Feature ist bereit, auch ohne manuellen Reset
  if (state.day && state.day !== currentDayStamp()) return true;
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
  const rawEffects = Array.isArray(item.system?.effects) ? item.system.effects : [];
  if (!rawEffects.length) return [];
  const duration = parseSimpleDuration(item, mpCost);
  return rawEffects.map(e => {
    const statuses = [];
    const changes  = [];
    if (e.type === "status") {
      statuses.push(e.status);
    } else if (e.type === "attribute") {
      const raw = e.valuePerMp != null
        ? Math.round(e.valuePerMp * mpCost)
        : (e.value ?? 0);
      const value = (e.min != null || e.max != null)
        ? Math.min(e.max ?? Infinity, Math.max(e.min ?? -Infinity, raw))
        : raw;
      changes.push({ key: e.key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value });
    }
    return {
      name: item.name,
      statuses,
      duration,
      description: item.system?.description ?? "",
      changes
    };
  });
}

export function inferDirectHp(item, mpCost) {
  const hpEffect = item.system?.hpEffect;
  if (!hpEffect?.type) return null;
  const raw    = Math.round((hpEffect.multiplier ?? 1) * mpCost);
  const amount = hpEffect.max != null ? Math.min(hpEffect.max, raw) : raw;
  return { type: hpEffect.type, amount };
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

function _resolveSummonLevel(formula, mpCost, actorLevel) {
  switch (formula) {
    case "floor(mpCost/2)":               return Math.max(1, Math.floor(mpCost / 2));
    case "floor(mpCost/3)":               return Math.max(1, Math.floor(mpCost / 3));
    case "min(mpCost,floor(actorLevel/2))": return Math.max(1, Math.min(mpCost, Math.floor(actorLevel / 2) || 1));
    default:                               return Math.max(1, mpCost); // "mpCost" und Fallback
  }
}

export function summarizeSummonRule(item, actor, mpCost) {
  const rule = item.system?.summonRule;
  if (!rule?.templateName || !rule?.summonType) return null;
  const actorLevel = Number(actor.system?.resources?.level || 1);
  const level    = _resolveSummonLevel(rule.levelFormula ?? "mpCost", mpCost, actorLevel);
  const permanent = !!rule.permanent;
  const duration = permanent
    ? { label: "Dauerhaft", seconds: 0, rounds: 0, permanent: true }
    : parseDurationMeta(item, mpCost);
  return { templateName: rule.templateName, summonType: rule.summonType, level, duration, permanent };
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
