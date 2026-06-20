import { ABOREA } from "./config.mjs";
import { rollOpenD10 } from "./dice.mjs";
import { inferDirectHp, inferEffects, applyEffectsToActor } from "./actor-helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Gibt den Rang von "gezielteSprueche" zurück — Characters/NPCs: skills.gezielteSprueche.rank, Kreaturen: magicSkills.gezielteSprueche
function _getGezielteSpruecheRank(actor) {
  if (actor.type === "creature") return Number(actor.system.magicSkills?.gezielteSprueche ?? 0);
  return Number(actor.system.skills?.gezielteSprueche?.rank ?? 0);
}

// Gibt den aktuellen MP-Wert zurück (alle Actor-Typen nutzen resources.mp.value)
function _getCurrentMp(actor) {
  return Number(actor.system.resources?.mp?.value ?? 0);
}

// ══════════════════════════════════════════════════════════════════
//  AboreaCombat — Combat Document
// ══════════════════════════════════════════════════════════════════

export class AboreaCombat extends Combat {
  /**
   * Setzt Initiative als fixen Wert: GE-Bonus + bester Waffen-Initiative-Mod.
   * Kein Würfelwurf — bei Gleichstand muss manuell ein W10 geworfen werden.
   */
  async rollInitiative(ids, { updateTurn = true } = {}) {
    const combatantIds = typeof ids === "string" ? [ids] : ids;
    const updates = [];
    for (const id of combatantIds) {
      const combatant = this.combatants.get(id);
      if (!combatant) continue;
      const actor = combatant.actor;
      const total = actor ? ABOREA.initiativeBonus(actor) : 0;
      updates.push({ _id: id, initiative: total });

      if (actor) {
        const geBonus = ABOREA.attributeBonus(
          actor.system?.attributes?.ge?.value ??
          actor.system?.finalAttributes?.ge?.value ?? 5
        );
        const weapons = actor.items?.filter(i => i.type === "weapon" && i.system.equipped) ?? [];
        const bestWeapon = weapons.reduce((b, w) =>
          Number(w.system.initiative ?? 0) > Number(b?.system?.initiative ?? -Infinity) ? w : b
        , null);
        const weaponMod = bestWeapon ? Number(bestWeapon.system.initiative ?? 0) : 0;
        const lines = [
          `<strong>${game.i18n.localize("ABOREA.Initiative")}: ${total}</strong>`,
          `${game.i18n.localize("ABOREA.AttributeGE")}: ${geBonus >= 0 ? "+" : ""}${geBonus}`,
          weaponMod !== 0 ? `${bestWeapon.name}: ${weaponMod >= 0 ? "+" : ""}${weaponMod}` : null,
          `<em>Bei Gleichstand: W10 würfeln</em>`
        ].filter(Boolean).map(l => `<p>${l}</p>`).join("");
        ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="aborea-chat-card">${lines}</div>`
        });
      }
    }
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
    return this;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Shared helpers
// ══════════════════════════════════════════════════════════════════

function _getUntrainedPenalty(actor, weapon) {
  if (!weapon) return 0;
  const skillKey = weapon.system?.skill;
  if (!skillKey) return 0;
  const rank = Number(actor.system.skills?.[skillKey]?.rank ?? 0);
  if (rank > 0) return 0;
  const minimums = actor.system.classFeatures?.weaponMinimums ?? {};
  if ("all" in minimums) return 0;
  if (skillKey === "boegen" && "bows-crossbows" in minimums) return 0;
  if ("deityWeapon" in minimums) {
    const godItem = actor.items.find(i => i.type === "god");
    const deitySkills = godItem?.system?.weaponSkills ?? [];
    if (deitySkills.includes(skillKey)) return 0;
  }
  return -2;
}

function _dv(actor) {
  if (!actor) return 5;
  if (actor.type === "character" && actor.system.combat?.totalArmorValue != null) {
    return ABOREA.defenseValue(
      Number(actor.system.combat.totalArmorValue),
      Number(actor.system.combat?.defensiveBonus ?? 0));
  }
  const baseArmor      = Number(actor.system.combat?.armorValue ?? 0);
  const armorFromItems = actor.items
    .filter(i => i.type === "armor" && i.system.equipped)
    .reduce((s, i) => s + Number(i.system.armor ?? 0), 0);
  return ABOREA.defenseValue(baseArmor + armorFromItems, Number(actor.system.combat?.defensiveBonus ?? 0));
}

function _sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

function _hpColor(pct) {
  if (pct > 60) return "#2d8a3e";
  if (pct > 25) return "#c08a00";
  return "#b91c1c";
}

/** Builds a target candidate list from scene tokens, excluding the given token id. */
function _buildTargetCandidates(attackerTokenId) {
  return (canvas?.tokens?.placeables ?? [])
    .filter(t => t.actor && t.id !== attackerTokenId)
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
    .map(t => {
      const hp    = t.actor.system.resources?.hp ?? {};
      const hpVal = Number(hp.value ?? 0);
      const hpMax = Number(hp.max ?? 1);
      const pct   = hpMax > 0 ? Math.round((hpVal / hpMax) * 100) : 0;
      return {
        id:          t.id,
        name:        t.name,
        dv:          _dv(t.actor),
        hp:          hpVal,
        hpMax,
        hpPct:       pct,
        hpColor:     _hpColor(pct),
        img:         t.actor.img ?? "icons/svg/mystery-man.svg",
        preselected: t.id === (game.user.targets.first()?.id ?? ""),
      };
    });
}

// ══════════════════════════════════════════════════════════════════
//  AboreaAttackDialog — ApplicationV2
// ══════════════════════════════════════════════════════════════════

class AboreaAttackDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "aborea-attack-dialog",
    classes:  ["aborea-attack-dialog"],
    tag:      "form",
    window:   { resizable: false },
    position: { width: 420 },
    form:     { handler: AboreaAttackDialog._handleSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: "systems/aborea-v7/templates/combat/attack-dialog.html" },
  };

  constructor(options = {}) {
    const { resolve, ...rest } = options;
    super(rest);
    this._resolve = resolve ?? null;
  }

  get title() { return `⚔ Angriff — ${this.options.attackerActor.name}`; }

  async _prepareContext() {
    const actor         = this.options.attackerActor;
    const weapons       = actor.items.filter(i => i.type === "weapon" && i.system.equipped);
    const globalSituMod = Number(game.settings.get("aborea-v7", "globalSituMod") ?? 0);
    const currentOffBonus = Number(actor.system.combat?.offensiveBonus ?? 0);
    const combatBonus   = Number(actor.system.combat?.combatBonus ?? actor.system.combat?.offensiveBonus ?? 0)
                        + Number(actor.system.combat?.defensiveBonus ?? 0);
    const attackerTokenId = canvas?.tokens?.placeables.find(t => t.actor?.id === actor.id)?.id;
    const initialPenalty  = weapons[0] ? _getUntrainedPenalty(actor, weapons[0]) : 0;

    // Gezielte Zauber & Wunder
    const targetedSpells = actor.items.filter(i =>
      ["spell", "miracle"].includes(i.type) && i.system.targeted
    );
    const inValue    = Number(actor.system.finalAttributes?.in?.value ?? actor.system.attributes?.in?.value ?? 5);
    const attrBonus  = ABOREA.attributeBonus(inValue);
    const skillRank  = _getGezielteSpruecheRank(actor);
    const classBonus = Number(actor.system.classFeatures?.bonuses?.gezielteSprueche ?? 0);
    const spellAttackBonus = attrBonus + skillRank + classBonus;
    const currentMp  = _getCurrentMp(actor);

    return {
      weapons: weapons.map(w => ({
        id:     w.id,
        name:   w.name,
        damage: w.system.damage ?? 0,
        skill:  w.system.skill ?? "",
      })),
      targetedSpells: targetedSpells.map(s => {
        const baseCost = Number(s.system.cost ?? 1) || 1;
        // costOptions kann Zahlen ODER Objekte enthalten — robust extrahieren
        const rawOptions = Array.isArray(s.system.costOptions) ? s.system.costOptions : [];
        const parsedOptions = rawOptions
          .map(o => typeof o === "object" && o !== null ? Number(o.cost ?? o.value ?? o) : Number(o))
          .filter(n => Number.isFinite(n) && n > 0);
        const costs = parsedOptions.length ? parsedOptions : [baseCost];
        const minCost = Math.min(...costs);
        return {
          id:        s.id,
          name:      s.name,
          cost:      baseCost,
          costs,
          minCost,
          canAfford: currentMp >= minCost,
          rank:      s.system.rank ?? 1,
        };
      }),
      hasSpells:        targetedSpells.length > 0,
      spellAttackBonus,
      signedAttrBonus:  _sign(attrBonus),
      signedSkillRank:  _sign(skillRank),
      signedClassBonus: _sign(classBonus),
      currentMp,
      targetCandidates: _buildTargetCandidates(attackerTokenId),
      combatBonus,
      currentOffBonus,
      globalSituMod,
      initialPenalty,
    };
  }

  _onRender(context, options) {
    const html         = this.element;
    const actor        = this.options.attackerActor;
    const targetSelect = html.querySelector("[name=targetTokenId]");
    const weaponSelect = html.querySelector("[name=weaponId]");
    const spellSelect  = html.querySelector("[name=spellId]");
    const manualRow    = html.querySelector(".manual-dv-row");
    const untrainedRow = html.querySelector(".untrained-row");
    const preview      = html.querySelector(".target-preview");
    const weaponSection = html.querySelector(".weapon-section");
    const spellSection  = html.querySelector(".spell-section");
    const modeRadios    = html.querySelectorAll("[name=attackMode]");
    const mpCostSelect  = html.querySelector("[name=mpCost]");
    const submitBtn     = html.querySelector("[type=submit]");

    const candidateMap = Object.fromEntries(
      (context.targetCandidates ?? []).map(c => [c.id, c])
    );

    // Spell data lookup by id
    const spellMap = Object.fromEntries(
      (context.targetedSpells ?? []).map(s => [s.id, s])
    );

    const toggleManual = () => { manualRow.style.display = targetSelect.value ? "none" : ""; };
    const updatePreview = () => {
      const c = candidateMap[targetSelect.value];
      if (!c) { preview.style.display = "none"; return; }
      preview.style.display = "";
      preview.querySelector(".target-preview-img").src = c.img;
      preview.querySelector(".target-preview-name").textContent = c.name;
      const fill = preview.querySelector(".target-preview-hp-fill");
      fill.style.width           = `${c.hpPct}%`;
      fill.style.backgroundColor = c.hpColor;
      preview.querySelector(".target-preview-stats").textContent = `RW ${c.dv} · HP ${c.hp}/${c.hpMax}`;
    };

    targetSelect.addEventListener("change", () => { toggleManual(); updatePreview(); });
    toggleManual();
    updatePreview();

    // Weapon untrained penalty
    const updatePenalty = () => {
      const weapon  = actor.items.get(weaponSelect?.value);
      const penalty = _getUntrainedPenalty(actor, weapon);
      if (untrainedRow) untrainedRow.style.display = penalty ? "" : "none";
    };
    weaponSelect?.addEventListener("change", updatePenalty);

    // MP-Kosten-Dropdown bei Zauberwahl aktualisieren
    const updateSpellCosts = () => {
      if (!spellSelect || !mpCostSelect) return;
      const spell = spellMap[spellSelect.value];
      mpCostSelect.innerHTML = "";
      (spell?.costs ?? []).forEach(c => {
        const opt = document.createElement("option");
        opt.value = c; opt.textContent = `${c} MP`;
        if (c > context.currentMp) opt.disabled = true;
        mpCostSelect.appendChild(opt);
      });
      // Disable submit if can't afford
      const minCost = spell ? Math.min(...(spell.costs ?? [1])) : 0;
      if (submitBtn) submitBtn.disabled = minCost > context.currentMp;
    };
    spellSelect?.addEventListener("change", updateSpellCosts);
    updateSpellCosts();

    // Modus-Umschalten Waffe ↔ Zauber
    const updateMode = () => {
      const mode = html.querySelector("[name=attackMode]:checked")?.value ?? "weapon";
      if (weaponSection) weaponSection.style.display = mode === "weapon" ? "" : "none";
      if (spellSection)  spellSection.style.display  = mode === "spell"  ? "" : "none";
      if (submitBtn) submitBtn.textContent = mode === "spell" ? " Zauber wirken" : " Angreifen";
    };
    modeRadios.forEach(r => r.addEventListener("change", updateMode));
    updateMode();

    html.querySelector(".dialog-cancel-btn")?.addEventListener("click", () => this.close());
  }

  static async _handleSubmit(event, form, formData) {
    const data    = formData.object;
    const actor   = this.options.attackerActor;
    const tokenId = data.targetTokenId;
    const targetToken = tokenId ? (canvas?.tokens?.placeables ?? []).find(t => t.id === tokenId) : null;
    const targetActor = targetToken?.actor ?? null;
    const mode        = data.attackMode ?? "weapon";

    const resolve = this._resolve;
    this._resolve = null;

    if (mode === "spell") {
      const spell = actor.items.get(data.spellId);
      resolve?.({
        mode:         "spell",
        spell,
        mpCost:       Number(data.mpCost || spell?.system?.cost || 1),
        spellBonus:   Number(data.spellBonus || 0),
        situMod:      Number(data.situMod || 0),
        targetActor,
        targetDefense: targetActor ? _dv(targetActor) : Number(data.manualDefense || 5),
        attackerImg:  actor.img ?? "",
        targetImg:    targetActor?.img ?? "",
      });
    } else {
      const weapon = actor.items.get(data.weaponId);
      resolve?.({
        mode:             "weapon",
        weapon,
        offBonus:         Number(data.offBonus || 0),
        untrainedPenalty: weapon ? _getUntrainedPenalty(actor, weapon) : 0,
        situMod:          Number(data.situMod || 0),
        targetActor,
        targetDefense:    targetActor ? _dv(targetActor) : Number(data.manualDefense || 5),
        attackerImg:      actor.img ?? "",
        targetImg:        targetActor?.img ?? "",
      });
    }
  }

  async _onClose(options) {
    await super._onClose(options);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(null);
  }
}

// ══════════════════════════════════════════════════════════════════
//  AboreaSpellAttackDialog — ApplicationV2
// ══════════════════════════════════════════════════════════════════

class AboreaSpellAttackDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "aborea-spell-attack-dialog",
    classes:  ["aborea-attack-dialog"],
    tag:      "form",
    window:   { resizable: false },
    position: { width: 420 },
    form:     { handler: AboreaSpellAttackDialog._handleSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: "systems/aborea-v7/templates/combat/spell-attack-dialog.html" },
  };

  constructor(options = {}) {
    const { resolve, ...rest } = options;
    super(rest);
    this._resolve = resolve ?? null;
  }

  get title() { return `✨ Gezielter Zauber — ${this.options.item.name}`; }

  async _prepareContext() {
    const actor      = this.options.attackerActor;
    const item       = this.options.item;
    const inValue    = Number(actor.system.finalAttributes?.in?.value ?? actor.system.attributes?.in?.value ?? 5);
    const attrBonus  = ABOREA.attributeBonus(inValue);
    const skillRank  = _getGezielteSpruecheRank(actor);
    const classBonus = Number(actor.system.classFeatures?.bonuses?.gezielteSprueche ?? 0);

    const attackerTokenId = canvas?.tokens?.placeables.find(t => t.actor?.id === actor.id)?.id;

    return {
      itemName:         item.name,
      mpCost:           this.options.mpCost,
      spellAttackBonus: attrBonus + skillRank + classBonus,
      signedAttrBonus:  _sign(attrBonus),
      signedSkillRank:  _sign(skillRank),
      signedClassBonus: _sign(classBonus),
      globalSituMod:    Number(game.settings.get("aborea-v7", "globalSituMod") ?? 0),
      targetCandidates: _buildTargetCandidates(attackerTokenId),
    };
  }

  _onRender(context, options) {
    const html         = this.element;
    const targetSelect = html.querySelector("[name=targetTokenId]");
    const manualRow    = html.querySelector(".manual-dv-row");
    const preview      = html.querySelector(".target-preview");

    const candidateMap = Object.fromEntries(
      (context.targetCandidates ?? []).map(c => [c.id, c])
    );

    const toggleManual = () => { manualRow.style.display = targetSelect.value ? "none" : ""; };
    const updatePreview = () => {
      const c = candidateMap[targetSelect.value];
      if (!c) { preview.style.display = "none"; return; }
      preview.style.display = "";
      preview.querySelector(".target-preview-img").src = c.img;
      preview.querySelector(".target-preview-name").textContent = c.name;
      const fill = preview.querySelector(".target-preview-hp-fill");
      fill.style.width           = `${c.hpPct}%`;
      fill.style.backgroundColor = c.hpColor;
      preview.querySelector(".target-preview-stats").textContent = `RW ${c.dv} · HP ${c.hp}/${c.hpMax}`;
    };

    targetSelect.addEventListener("change", () => { toggleManual(); updatePreview(); });
    toggleManual();
    updatePreview();

    html.querySelector(".dialog-cancel-btn")?.addEventListener("click", () => this.close());
  }

  static async _handleSubmit(event, form, formData) {
    const data    = formData.object;
    const actor   = this.options.attackerActor;
    const tokenId = data.targetTokenId;
    const targetToken = tokenId ? (canvas?.tokens?.placeables ?? []).find(t => t.id === tokenId) : null;
    const targetActor = targetToken?.actor ?? null;

    const resolve = this._resolve;
    this._resolve = null;
    resolve?.({
      spellBonus:    Number(data.spellBonus || 0),
      situMod:       Number(data.situMod || 0),
      targetActor,
      targetDefense: targetActor ? _dv(targetActor) : Number(data.manualDefense || 5),
      attackerImg:   actor.img ?? "",
      targetImg:     targetActor?.img ?? "",
    });
  }

  async _onClose(options) {
    await super._onClose(options);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(null);
  }
}

// ══════════════════════════════════════════════════════════════════
//  Attack Dialog & Resolution
// ══════════════════════════════════════════════════════════════════

export async function openAttackDialog(attackerActor) {
  const weapons       = attackerActor.items.filter(i => i.type === "weapon" && i.system.equipped);
  const targetedSpells = attackerActor.items.filter(i =>
    ["spell", "miracle"].includes(i.type) && i.system.targeted
  );
  if (!weapons.length && !targetedSpells.length) {
    ui.notifications.warn("ABOREA: Keine ausgerüstete Waffe und keine gezielten Zauber gefunden.");
    return;
  }

  const params = await new Promise(resolve => {
    new AboreaAttackDialog({ attackerActor, resolve }).render(true);
  });
  if (!params) return;

  if (params.mode === "spell") {
    await _executeSpellAttack(attackerActor, params);
  } else {
    if (!params.weapon) return;
    await _executeAttack(attackerActor, params);
  }
  if (game.combat?.started) await game.combat.nextTurn();
}

async function _executeSpellAttack(attackerActor, { spell, mpCost, spellBonus, situMod, targetActor, targetDefense, attackerImg, targetImg }) {
  if (!spell) return;

  // MP prüfen & abziehen
  const currentMp = _getCurrentMp(attackerActor);
  if (currentMp < mpCost) { ui.notifications.warn(game.i18n.localize("ABOREA.NotEnoughMP")); return; }
  await attackerActor.update({ "system.resources.mp.value": Math.max(0, currentMp - mpCost) });

  const roll        = await rollOpenD10({ label: `Gezielter Zauber: ${spell.name}`, skipVisual: true });
  const attackValue = roll.total + spellBonus + situMod;
  const hit         = !roll.naturalOne && attackValue > targetDefense;

  const resultClass = roll.naturalOne ? "patzer" : (hit ? "hit" : "miss");
  const resultLabel = roll.naturalOne
    ? "⛔ Patzer — automatischer Fehlschlag"
    : (hit ? "✅ Treffer — Zauber wirkt!" : "❌ Kein Treffer — Zauber verpufft");
  const critNote = roll.critical
    ? `<div class="ac-note critical">💥 Kritisch — 10er offen gewürfelt!</div>` : "";

  // Effekte bei Treffer anwenden
  let effectHtml = "";
  if (hit && targetActor) {
    const hp      = inferDirectHp(spell, mpCost);
    const effects = inferEffects(spell, mpCost).map(e => ({ ...e, origin: spell.uuid }));
    if (hp?.type === "heal") {
      const cur = Number(targetActor.system.resources?.hp?.value ?? 0);
      const max = Number(targetActor.system.resources?.hp?.max ?? cur);
      await targetActor.update({ "system.resources.hp.value": Math.min(max, cur + hp.amount) });
      effectHtml += `<div class="ac-effect-row">✨ <strong>${targetActor.name}</strong>: +${hp.amount} HP</div>`;
    }
    if (hp?.type === "damage") {
      const cur = Number(targetActor.system.resources?.hp?.value ?? 0);
      await targetActor.update({ "system.resources.hp.value": Math.max(0, cur - hp.amount) });
      effectHtml += `<div class="ac-effect-row">💥 <strong>${targetActor.name}</strong>: −${hp.amount} HP</div>`;
    }
    if (effects.length) {
      await applyEffectsToActor(targetActor, effects);
      effectHtml += `<div class="ac-effect-row">🔮 <strong>${targetActor.name}</strong>: ${game.i18n.localize("ABOREA.EffectApplied")}</div>`;
    }
  }

  const effectSection = effectHtml ? `<div class="ac-effects">${effectHtml}</div>` : "";
  const cardContent = `<div class="aborea-chat-card aborea-attack-card">
    ${_buildCardHeader(attackerActor.name, attackerImg, targetActor?.name, targetImg)}
    <div class="ac-body">
      <div class="ac-row"><span>Zauber</span><span>${spell.name} (${mpCost} MP)</span></div>
      <div class="ac-row"><span>Würfelwurf</span><span>${roll.formula}</span></div>
      <div class="ac-row"><span>Angriffsbonus</span><span>${_sign(spellBonus)}</span></div>
      ${situMod !== 0 ? `<div class="ac-row"><span>Situationsmod.</span><span>${_sign(situMod)}</span></div>` : ""}
      <div class="ac-row ac-total"><span>Angriffswert</span><span><strong>${roll.naturalOne ? "—" : attackValue}</strong></span></div>
      <div class="ac-row"><span>Verteidigungswert</span><span>${targetDefense}</span></div>
    </div>
    <div class="ac-result ${resultClass}">${resultLabel}</div>
    ${critNote}
    ${effectSection}
  </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    rolls:   roll.rolls,
    content: cardContent,
    flags:   { "aborea-v7": { spellAttackResult: { hit, targetActorId: targetActor?.id ?? null, itemId: spell.id, mpCost } } }
  });
}

// ══════════════════════════════════════════════════════════════════
//  Targeted Spell Attack Dialog
// ══════════════════════════════════════════════════════════════════

export async function openSpellAttackDialog(attackerActor, item, mpCost) {
  const params = await new Promise(resolve => {
    new AboreaSpellAttackDialog({ attackerActor, item, mpCost, resolve }).render(true);
  });
  if (!params) return null;

  const roll = await rollOpenD10({ label: `Gezielter Zauber: ${item.name}`, skipVisual: true });
  const attackValue = roll.total + params.spellBonus + params.situMod;
  const hit = !roll.naturalOne && attackValue > params.targetDefense;

  const resultClass = roll.naturalOne ? "patzer" : (hit ? "hit" : "miss");
  const resultLabel = roll.naturalOne
    ? "⛔ Patzer — automatischer Fehlschlag"
    : (hit ? "✅ Treffer — Zauber wirkt!" : "❌ Kein Treffer — Zauber verpufft");

  const critNote = roll.critical
    ? `<div class="ac-note critical">💥 Kritisch — 10er offen gewürfelt!</div>` : "";

  // Karte wird NICHT hier gepostet — _castPower hängt Effekte an und postet dann
  const cardOpen = `<div class="aborea-chat-card aborea-attack-card">
    ${_buildCardHeader(attackerActor.name, params.attackerImg, params.targetActor?.name, params.targetImg)}
    <div class="ac-body">
      <div class="ac-row"><span>Zauber</span><span>${item.name} (${mpCost} MP)</span></div>
      <div class="ac-row"><span>Würfelwurf</span><span>${roll.formula}</span></div>
      <div class="ac-row"><span>Angriffsbonus</span><span>${_sign(params.spellBonus)}</span></div>
      ${params.situMod !== 0 ? `<div class="ac-row"><span>Situationsmod.</span><span>${_sign(params.situMod)}</span></div>` : ""}
      <div class="ac-row ac-total"><span>Angriffswert</span><span><strong>${roll.naturalOne ? "—" : attackValue}</strong></span></div>
      <div class="ac-row"><span>Verteidigungswert</span><span>${params.targetDefense}</span></div>
    </div>
    <div class="ac-result ${resultClass}">${resultLabel}</div>
    ${critNote}`;

  return {
    hit,
    targetActor: params.targetActor,
    rolls:       roll.rolls,
    cardOpen,    // noch offen — caller schließt mit </div> + Effekte
    flags:       { "aborea-v7": { spellAttackResult: { hit, targetActorId: params.targetActor?.id ?? null, itemId: item.id, mpCost } } },
    speaker:     ChatMessage.getSpeaker({ actor: attackerActor }),
  };
}

// ── Internal: roll + chat ────────────────────────────────────────

async function _executeAttack(attackerActor, { weapon, offBonus, untrainedPenalty = 0, situMod, targetActor, targetDefense, attackerImg = "", targetImg = "" }) {
  const effectiveOffBonus = offBonus + untrainedPenalty;
  const roll = await rollOpenD10({ label: game.i18n.localize("ABOREA.Attack"), skipVisual: true });

  if (roll.naturalOne) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      rolls: roll.rolls,
      content: _buildAttackCard({
        attacker: attackerActor.name, attackerImg,
        target: targetActor?.name, targetImg,
        weapon: weapon.name,
        rollFormula: roll.formula, rollTotal: 0,
        offBonus, untrainedPenalty, situMod,
        attackValue: 0, defenseValue: targetDefense,
        hit: false, damage: 0, patzer: true, critical: false,
      })
    });
    return;
  }

  const attackValue = roll.total + effectiveOffBonus + situMod;
  const hit    = attackValue > targetDefense;
  const damage = hit ? Math.max(1, (attackValue - targetDefense) + Number(weapon.system.damage ?? 0)) : 0;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    rolls: roll.rolls,
    content: _buildAttackCard({
      attacker: attackerActor.name, attackerImg,
      target: targetActor?.name, targetImg,
      targetActorId: targetActor?.id,
      weapon: weapon.name,
      rollFormula: roll.formula, rollTotal: roll.total,
      offBonus, untrainedPenalty, situMod,
      attackValue, defenseValue: targetDefense,
      hit, damage, patzer: false, critical: roll.critical,
      weaponDamage: weapon.system.damage ?? 0,
    }),
    flags: { "aborea-v7": { attackResult: { hit, damage, targetActorId: targetActor?.id ?? null } } }
  });
}

function _buildCardHeader(attacker, attackerImg, target, targetImg) {
  const attackerPortrait = attackerImg
    ? `<img class="ac-portrait" src="${attackerImg}" alt="${attacker}" />`
    : "";
  const targetPortrait = targetImg
    ? `<img class="ac-portrait" src="${targetImg}" alt="${target}" />`
    : "";
  const targetBlock = target
    ? `<span class="ac-arrow">→</span>
       <div class="ac-combatant">
         ${targetPortrait}
         <span class="ac-target">${target}</span>
       </div>`
    : "";
  return `<div class="ac-header">
    <div class="ac-combatant">
      ${attackerPortrait}
      <span class="ac-attacker">⚔ ${attacker}</span>
    </div>
    ${targetBlock}
  </div>`;
}

function _buildAttackCard({
  attacker, attackerImg = "",
  target,   targetImg = "",   targetActorId,
  weapon, rollFormula, rollTotal, offBonus, untrainedPenalty = 0, situMod,
  attackValue, defenseValue, hit, damage, patzer, critical, weaponDamage = 0
}) {
  const resultClass = patzer ? "patzer" : (hit ? "hit" : "miss");
  const resultLabel = patzer
    ? "⛔ Patzer — automatischer Fehlschlag"
    : (hit ? "✅ Treffer" : "❌ Kein Treffer");

  const untrainedRow = untrainedPenalty
    ? `<div class="ac-row ac-penalty"><span>Ungelernt</span><span>${_sign(untrainedPenalty)}</span></div>`
    : "";
  const modRow = situMod !== 0
    ? `<div class="ac-row"><span>Situationsmod.</span><span>${_sign(situMod)}</span></div>`
    : "";
  const critNote = critical
    ? `<div class="ac-note critical">💥 Kritisch — 10er offen gewürfelt!</div>`
    : "";

  const dmgSection = hit ? `
    <div class="ac-damage">
      <div class="ac-row">
        <span>Angriff − Verteidigung</span>
        <span>${attackValue} − ${defenseValue} = ${attackValue - defenseValue}</span>
      </div>
      <div class="ac-row">
        <span>Waffenschaden</span>
        <span>${_sign(weaponDamage)}</span>
      </div>
      <div class="ac-row ac-total">
        <span><strong>Schaden</strong></span>
        <span><strong>${damage}</strong></span>
      </div>
      ${targetActorId
        ? `<button type="button" class="apply-damage-btn" data-target-id="${targetActorId}" data-damage="${damage}">
             💢 Schaden anwenden (${damage})
           </button>`
        : ""}
    </div>` : "";

  return `<div class="aborea-chat-card aborea-attack-card">
    ${_buildCardHeader(attacker, attackerImg, target, targetImg)}
    <div class="ac-body">
      <div class="ac-row"><span>Waffe</span><span>${weapon}</span></div>
      <div class="ac-row"><span>Würfelwurf</span><span>${rollFormula}${patzer ? " (Patzer!)" : ""}</span></div>
      <div class="ac-row"><span>Offensivbonus</span><span>${_sign(offBonus)}</span></div>
      ${untrainedRow}
      ${modRow}
      <div class="ac-row ac-total"><span>Angriffswert</span><span><strong>${patzer ? "—" : attackValue}</strong></span></div>
      <div class="ac-row"><span>Verteidigungswert</span><span>${defenseValue}</span></div>
    </div>
    <div class="ac-result ${resultClass}">${resultLabel}</div>
    ${critNote}
    ${dmgSection}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════
//  Damage Application
// ══════════════════════════════════════════════════════════════════

export async function applyDamage(targetActorId, damage) {
  const actor = game.actors.get(targetActorId);
  if (!actor) { ui.notifications.warn("ABOREA: Ziel nicht gefunden."); return; }
  const hp         = actor.system.resources?.hp ?? {};
  const previousHp = Number(hp.value ?? 0);
  const hpMax      = Number(hp.max ?? previousHp);
  const newHp      = Math.max(0, previousHp - damage);
  const pct        = hpMax > 0 ? Math.round((newHp / hpMax) * 100) : 0;
  const color      = _hpColor(pct);

  await actor.update({ "system.resources.hp.value": newHp });

  const portrait = actor.img
    ? `<img class="ac-portrait ac-portrait-lg" src="${actor.img}" alt="${actor.name}" />`
    : "";

  await ChatMessage.create({
    speaker: { alias: "System" },
    flags: { "aborea-v7": { undo: { actorId: targetActorId, previousHp } } },
    content: `<div class="aborea-chat-card aborea-damage-card">
      <div class="ac-damage-header">
        ${portrait}
        <div class="ac-damage-info">
          <strong>${actor.name}</strong>
          <span class="ac-damage-amount">−${damage} HP</span>
        </div>
      </div>
      <div class="ac-hp-bar-wrap">
        <div class="ac-hp-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="ac-hp-label">${newHp} / ${hpMax} HP</div>
      ${newHp === 0 ? `<div class="ac-result patzer" style="margin-top:6px">☠ ${actor.name} ist bewusstlos oder tot!</div>` : ""}
      <button type="button" class="undo-damage-btn btn-sm">↩ Rückgängig</button>
    </div>`
  });
}

// ══════════════════════════════════════════════════════════════════
//  Gleichstand-Auflösung
// ══════════════════════════════════════════════════════════════════

async function _resolveTiebreak(combat) {
  const byInit = new Map();
  for (const c of combat.combatants.values()) {
    if (c.initiative === null || c.initiative === undefined) continue;
    const key = c.initiative;
    if (!byInit.has(key)) byInit.set(key, []);
    byInit.get(key).push(c);
  }

  const updates = [];
  for (const [baseInit, group] of byInit) {
    if (group.length < 2) continue;
    for (const c of group) {
      const roll = await (new Roll("1d10")).evaluate();
      const tieVal = baseInit + roll.total * 0.01;
      updates.push({ _id: c.id, initiative: tieVal });
      ChatMessage.create({
        content: `<div class="aborea-chat-card">
          <p>⚔ <strong>${c.name}</strong> Gleichstand-W10: <strong>${roll.total}</strong></p>
          <p>Neue Initiative: ${tieVal.toFixed(2)}</p>
        </div>`
      });
    }
  }
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

// ══════════════════════════════════════════════════════════════════
//  Hooks
// ══════════════════════════════════════════════════════════════════

export function registerCombatHooks() {
  game.settings.register("aborea-v7", "globalSituMod", {
    name: "Globaler Situationsmodifikator",
    hint: "Wird im Angriffsdialog als Voreinstellung verwendet. Negativer Wert = Erschwernis.",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    html.querySelectorAll(".apply-damage-btn").forEach(btn => {
      btn.addEventListener("click", ev => {
        if (!game.user.isGM && !game.user.isTrusted) {
          ui.notifications.warn("ABOREA: Nur GM oder vertraute Spieler können Schaden anwenden.");
          return;
        }
        const b = ev.currentTarget;
        applyDamage(b.dataset.targetId, Number(b.dataset.damage));
        b.disabled = true;
        b.textContent = `✓ Angewandt (${b.dataset.damage})`;
      });
    });

    // Schaden rückgängig machen (GM only, einmalig)
    html.querySelectorAll(".undo-damage-btn").forEach(btn => {
      if (!game.user.isGM) { btn.style.display = "none"; return; }
      btn.addEventListener("click", async () => {
        const flag = message.getFlag("aborea-v7", "undo");
        if (!flag) { ui.notifications.warn("Rückgängig bereits verwendet."); return; }
        const actor = game.actors.get(flag.actorId);
        if (!actor) { ui.notifications.warn("Ziel-Aktor nicht gefunden."); return; }
        await actor.update({ "system.resources.hp.value": flag.previousHp });
        await message.unsetFlag("aborea-v7", "undo");
        btn.disabled = true;
        btn.textContent = `✓ ${flag.previousHp} HP wiederhergestellt`;
        ui.notifications.info(`${actor.name}: HP auf ${flag.previousHp} zurückgesetzt.`);
      });
    });
  });

  const _onRenderTracker = (app, html) => {
    // v13: html kann HTMLElement (V2-App) oder jQuery (V1) sein
    const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
    if (!root?.querySelector) return;

    const combat = game.combat;

    // ── Rundenzeit-Anzeige ─────────────────────────────────
    root.querySelectorAll(".aborea-round-timer").forEach(el => el.remove());
    if (combat?.started && combat.round > 0) {
      const secs   = combat.round * 10;
      const mins   = Math.floor(secs / 60);
      const label  = mins > 0 ? `${mins} min ${secs % 60} s` : `${secs} s`;
      const timer  = document.createElement("div");
      timer.className   = "aborea-round-timer";
      timer.textContent = `Runde ${combat.round} · ~${label}`;
      const header = root.querySelector(".combat-tracker-header") ?? root.querySelector("header") ?? root.firstElementChild;
      if (header) header.after(timer);
    }

    if (game.user.isGM) {
      root.querySelectorAll(".aborea-situ-mod-bar").forEach(el => el.remove());

      const currentMod = Number(game.settings.get("aborea-v7", "globalSituMod") ?? 0);
      const modBar = document.createElement("div");
      modBar.className = "aborea-situ-mod-bar";
      modBar.innerHTML = `
        <label class="situ-mod-label" title="Voreinstellung im Angriffsdialog">⚠ Situationsmod.</label>
        <button type="button" class="situ-mod-step" data-delta="-1">−</button>
        <input  type="number"  class="situ-mod-input" value="${currentMod}" />
        <button type="button" class="situ-mod-step" data-delta="1">+</button>
        <button type="button" class="situ-mod-reset" title="Zurücksetzen">✕</button>
      `;

      const updateMod = async (val) => {
        const clamped = Math.max(-10, Math.min(10, Number(val) || 0));
        await game.settings.set("aborea-v7", "globalSituMod", clamped);
        modBar.querySelector(".situ-mod-input").value = clamped;
      };
      modBar.querySelector(".situ-mod-input").addEventListener("change", ev => updateMod(ev.target.value));
      modBar.querySelectorAll(".situ-mod-step").forEach(btn => {
        btn.addEventListener("click", () => {
          const cur = Number(game.settings.get("aborea-v7", "globalSituMod") ?? 0);
          updateMod(cur + Number(btn.dataset.delta));
        });
      });
      modBar.querySelector(".situ-mod-reset").addEventListener("click", () => updateMod(0));

      const footer = root.querySelector("#combat-controls") ?? root.querySelector(".combat-controls") ?? null;
      if (footer) footer.before(modBar);
      else root.appendChild(modBar);

      // ── Gleichstand lösen ───────────────────────────────
      root.querySelectorAll(".aborea-tiebreak-btn").forEach(el => el.remove());
      if (combat?.started) {
        const inits = [...(combat.combatants?.values() ?? [])].map(c => c.initiative).filter(v => v !== null && v !== undefined);
        const hasTies = inits.some((v, i) => inits.indexOf(v) !== i);
        if (hasTies) {
          const tieBtn = document.createElement("button");
          tieBtn.type      = "button";
          tieBtn.className = "aborea-tiebreak-btn";
          tieBtn.title     = "W10 für alle Gleichstand-Kombattanten würfeln";
          tieBtn.textContent = "⚔ Gleichstand lösen";
          tieBtn.addEventListener("click", () => _resolveTiebreak(combat));
          if (footer) footer.before(tieBtn);
          else root.appendChild(tieBtn);
        }
      }
    }

    if (!combat) return;
    const activeCombatant = combat.combatants.get(combat.current?.combatantId ?? "");
    if (!activeCombatant) return;

    const isOwner = activeCombatant.actor?.isOwner ?? false;
    if (!isOwner && !game.user.isGM) return;

    const li = root.querySelector(`.combatant[data-combatant-id="${activeCombatant.id}"]`);
    if (!li) return;
    const controls = li.querySelector(".combatant-controls");
    if (!controls) return;

    const btn = document.createElement("button");
    btn.type        = "button";
    btn.className   = "combat-attack-btn";
    btn.title       = "Angreifen";
    btn.textContent = "⚔";
    btn.addEventListener("click", () => {
      const actor = activeCombatant.actor;
      if (actor) openAttackDialog(actor);
    });
    controls.prepend(btn);
  };

  Hooks.on("renderCombatTrackerHTML", _onRenderTracker);
  // Fallback für den Fall dass der CombatTracker noch V1 ist
  Hooks.on("renderCombatTracker", _onRenderTracker);
}
