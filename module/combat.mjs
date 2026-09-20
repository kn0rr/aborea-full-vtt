import { ABOREA } from "./config.mjs";
import { rollOpenD10 } from "./dice.mjs";
import { inferDirectHp, inferEffects, applyEffectsToActor } from "./actor-helpers.mjs";
import { weaponCombatBonus, weaponSkillKeys, minStrengthPenalty, skillBonus, formatBreakdown } from "./bonuses.mjs";
import { roundSplit, declarationFor, buildDeclaration, splitLabel, canRedeclare, splitRange, clampOffensive,
         defenseAgainst, defenseRemaining, spendDefense, fleeDefenseBonus, isFleeing,
         SYSTEM_FLAG, DECLARATION } from "./declaration.mjs";
import { selectTargetTokens, attackPlan } from "./targeting.mjs";
import { SETTINGS, SITU_PRESETS, clampSituMod, shouldAutoApplyDamage,
         shouldResetSituMod, buildUndoRecord, describeUndo } from "./settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

/** Aufteilung des Kampfbonus für die laufende Runde. */
function _split(actor) {
  return roundSplit(actor, game.combat?.round);
}

/**
 * Erklärt die Runde für einen Actor. `lock` setzt sie fest — das passiert,
 * sobald gehandelt wurde, damit niemand rückwirkend umentscheidet.
 *
 * Eine bereits festgesetzte Erklärung wird nicht überschrieben: wer als
 * Waffenkämpfer erklärt hat und dann doch zaubert, behält die Erklärung und
 * bekommt einen Hinweis. Der Spielleiter entscheidet, ob er das zulässt.
 */
export async function declareRound(actor, { mode = "weapon", offensive = 0, lock = false } = {}) {
  const round = game.combat?.round;
  if (!round || !actor) return null;
  if (!canRedeclare(actor, round)) return roundSplit(actor, round);

  const pool = Number(actor.system.combat?.combatBonus ?? 0);
  const decl = buildDeclaration(round, { mode, offensive, pool, locked: lock });
  await actor.setFlag(SYSTEM_FLAG, DECLARATION, decl);
  return roundSplit(actor, round);
}

/** Initiative eines Actors im laufenden Kampf. */
function _initiativeOf(actor) {
  const c = (game.combat?.combatants ?? []).find?.(x => x.actor?.id === actor?.id)
         ?? [...(game.combat?.combatants ?? [])].find(x => x.actor?.id === actor?.id);
  return Number(c?.initiative ?? 0) || 0;
}

/**
 * Fluchtbonus auf den Defensivbonus gegen diesen Angreifer.
 * Nur wer Flucht erklärt hat und schneller ist als der Angreifer, bekommt
 * die Initiative-Differenz gutgeschrieben.
 */
function _fleeBonus(defender, attackerActor) {
  if (!attackerActor || !isFleeing(defender, game.combat?.round)) return 0;
  return fleeDefenseBonus(_initiativeOf(defender), _initiativeOf(attackerActor));
}

/** Manöverbonus aus Active Effects (Beistand, Fluch, Trübung …). */
function _maneuverBonus(actor) {
  return Number(actor?.system?.traits?.maneuverBonus ?? 0);
}

/** Zusätzlicher Waffenschaden aus Active Effects (Flammenschwert …). */
function _bonusWeaponDamage(actor) {
  return Number(actor?.flags?.aborea?.extraWeaponDamage ?? 0);
}

/**
 * Verteidigungswert: Rüstung (Grundwert + Rassen-/Klassenbonus + getragene
 * Rüstungen) plus Defensivbonus und Manöverbonus.
 *
 * Früher las der Charakterzweig system.combat.totalArmorValue — das wird aber
 * nur auf dem Sheet-Klon gesetzt und nie persistiert, der Zweig lief also nie.
 * Der Rest liess Rassen- und Klassenbonus fallen, sodass der RW im Kampf nicht
 * zum RW auf dem Bogen passte.
 */
/**
 * Der Anteil des Defensivbonus, der gegen einen bestimmten Angreifer zählt.
 *
 * Ohne Angreifer gilt der volle Defensivbonus — das ist die Anzeige im
 * Tracker. Mit Angreifer der noch verfügbare Vorrat beziehungsweise der
 * bereits gegen ihn eingesetzte Anteil (S. 33).
 */
function _defensiveFor(actor, attackerActor = null) {
  const split = _split(actor);
  if (!attackerActor || split.defensive <= 0) return split.defensive;
  return defenseAgainst(split.defensive, split.defenseSpent, attackerActor.id);
}

/**
 * Verbraucht den Defensivbonus des Verteidigers gegen diesen Angreifer und
 * gibt den Anteil zurück, der gegen ihn zählt. Wird beim Auflösen eines
 * Angriffs aufgerufen, nicht beim blossen Anzeigen.
 */
async function _consumeDefense(defender, attackerActor, wanted = null) {
  const round = game.combat?.round;
  const split = _split(defender);
  if (!round || !attackerActor || split.defensive <= 0) return split.defensive;

  const result = spendDefense(split.defensive, split.defenseSpent, attackerActor.id, wanted);
  if (JSON.stringify(result.spent) !== JSON.stringify(split.defenseSpent ?? {})) {
    const decl = declarationFor(defender, round)
      ?? buildDeclaration(round, { mode: "weapon", offensive: split.offensive, pool: split.pool });
    await defender.setFlag(SYSTEM_FLAG, DECLARATION, { ...decl, defenseSpent: result.spent });
  }
  return result.applied;
}

/** Verteidigungswert gegen einen Angreifer, mit Verbrauch des Vorrats. */
async function _dvConsuming(defender, attackerActor, wanted = null) {
  if (!defender) return 5;
  const applied = await _consumeDefense(defender, attackerActor, wanted);
  const baseArmor = Number(defender.system.combat?.armorValue ?? 0)
                  + Number(defender.system.traits?.racialArmorBonus ?? 0)
                  + Number(defender.system.classFeatures?.armorBonus ?? 0);
  const armorFromItems = defender.items
    .filter(i => i.type === "armor" && i.system.equipped)
    .reduce((s, i) => s + Number(i.system.armor ?? 0), 0);
  return ABOREA.defenseValue(baseArmor + armorFromItems,
    applied + _maneuverBonus(defender) + _fleeBonus(defender, attackerActor));
}

function _dv(actor, attackerActor = null) {
  if (!actor) return 5;
  const baseArmor = Number(actor.system.combat?.armorValue ?? 0)
                  + Number(actor.system.traits?.racialArmorBonus ?? 0)
                  + Number(actor.system.classFeatures?.armorBonus ?? 0);
  const armorFromItems = actor.items
    .filter(i => i.type === "armor" && i.system.equipped)
    .reduce((s, i) => s + Number(i.system.armor ?? 0), 0);
  return ABOREA.defenseValue(
    baseArmor + armorFromItems,
    _defensiveFor(actor, attackerActor) + _maneuverBonus(actor) + _fleeBonus(actor, attackerActor));
}

function _sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

function _hpColor(pct) {
  if (pct > 60) return "#2d8a3e";
  if (pct > 25) return "#c08a00";
  return "#b91c1c";
}

/** Zielliste für den Angriffsdialog, ohne den Angreifer selbst. */
function _buildTargetCandidates(attackerTokenId, attackerActor = null) {
  // Mit laufendem Kampf nur die Kombattanten, sonst alles Bespielbare auf der
  // Szene — ein Hinterhalt außerhalb der Initiative soll nicht an einer leeren
  // Auswahl scheitern.
  const combatTokenIds = game.combat?.combatants.size
    ? new Set(game.combat.combatants.map(c => c.tokenId).filter(Boolean))
    : null;
  return selectTargetTokens(canvas?.tokens?.placeables ?? [], {
    attackerTokenId, combatTokenIds, lang: game.i18n.lang,
  })
    .map(t => {
      const hp    = t.actor.system.resources?.hp ?? {};
      const hpVal = Number(hp.value ?? 0);
      const hpMax = Number(hp.max ?? 1);
      const pct   = hpMax > 0 ? Math.round((hpVal / hpMax) * 100) : 0;
      return {
        id:          t.id,
        name:        t.name,
        dv:          _dv(t.actor, attackerActor),
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
    const globalSituMod = Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0);
    const isCreatureOrNpc = ["npc", "creature"].includes(actor.type);
    // Vorbelegung aus der Rundenerklärung, sonst aus der Aufteilung am Bogen
    const storedOffBonus  = _split(actor).offensive;
    const storedCB        = Number(actor.system.combat?.combatBonus ?? 0);
    const storedDef       = Number(actor.system.combat?.defensiveBonus ?? 0);
    const currentOffBonus = storedOffBonus;
    const combatBonus     = storedCB;
    const attackerTokenId = canvas?.tokens?.placeables.find(t => t.actor?.id === actor.id)?.id;
    const initialBonus    = weapons[0] ? weaponCombatBonus(actor, { weapon: weapons[0] }) : null;
    const initialPenalty  = initialBonus?.untrained ?? 0;
    const minStrengthMod  = minStrengthPenalty(actor);
    const maneuverMod     = _maneuverBonus(actor);

    // Gezielte Zauber & Wunder
    const targetedSpells = actor.items.filter(i =>
      ["spell", "miracle"].includes(i.type) && i.system.targeted
    );
    // Zauberangriffsbonus aus derselben Quelle wie Fertigkeitsprobe und Waffen.
    // skillBonus kennt das magicAttribute der Klasse, holt NPC- und
    // Kreaturenränge aus magicSkills und vergibt bei Magie keinen
    // Ungelernt-Malus.
    const spellB = skillBonus(actor, "gezielteSprueche");
    const spellAttackBonus = spellB.total;
    const currentMp    = _getCurrentMp(actor);
    const currentMpMax = Number(actor.system.resources?.mp?.max ?? currentMp);

    const weaponList = weapons.map(w => ({
      id:     w.id,
      name:   w.name,
      damage: w.system.damage ?? 0,
      skill:  weaponSkillKeys(w)
        .map(k => game.i18n.localize(ABOREA.skills[k]?.label ?? k))
        .join(", "),
    }));
    // Kreaturen/NPCs ohne Waffen-Items: generischen Angriff eintragen
    if (!weaponList.length && isCreatureOrNpc) {
      weaponList.push({ id: "__native__", name: "Angriff", damage: 0, skill: "" });
    }
    return {
      weapons: weaponList,
      preselectedSpellId: this.options.preselectedSpellId ?? null,
      targetedSpells: targetedSpells.map(s => {
        const baseCost   = Number(s.system.cost ?? 1) || 1;
        const rawOptions = Array.isArray(s.system.costOptions) ? s.system.costOptions : [];
        const parsedOptions = rawOptions
          .map(o => typeof o === "object" && o !== null ? Number(o.cost ?? o.value ?? o) : Number(o))
          .filter(n => Number.isFinite(n) && n > 0);
        const costs    = parsedOptions.length ? parsedOptions : [baseCost];
        const minCost  = Math.min(...costs);
        const hpEffect = s.system.hpEffect ?? {};
        const mpPerTarget = Number(s.system.mpPerTarget ?? 0);
        return {
          id:        s.id,
          name:      s.name,
          minCost,
          canAfford:    currentMp >= minCost,
          rank:         s.system.rank ?? 1,
          mpPerTarget,
          hpEffect,
        };
      }),
      hasSpells:        targetedSpells.length > 0,
      spellAttackBonus,
      spellBonusBreakdown: formatBreakdown(spellB.breakdown).join(" + "),
      currentMp,
      currentMpMax,
      targetCandidates: _buildTargetCandidates(attackerTokenId, actor),
      combatBonus,
      currentOffBonus,
      splitMin: splitRange(combatBonus).min,
      splitMax: splitRange(combatBonus).max,
      globalSituMod,
      initialPenalty,
      minStrengthMod,
      maneuverMod,
    };
  }

  _onRender(context, options) {
    const html          = this.element;
    const actor         = this.options.attackerActor;
    const targetSelect  = html.querySelector("[name=targetTokenId]");
    const weaponSelect  = html.querySelector("[name=weaponId]");
    const spellSelect   = html.querySelector("[name=spellId]");
    const manualRow     = html.querySelector(".manual-dv-row");
    const untrainedRow  = html.querySelector(".untrained-row");
    const preview       = html.querySelector(".target-preview");
    const weaponSection = html.querySelector(".weapon-section");
    const spellSection  = html.querySelector(".spell-section");
    const modeRadios    = html.querySelectorAll("[name=attackMode]");
    const mpCostSelect  = html.querySelector("[name=mpCost]");
    const submitBtn     = html.querySelector("[type=submit]");
    const singleRow     = html.querySelector(".single-target-row");
    const multiRow      = html.querySelector(".multi-target-row");
    const multiHint     = html.querySelector(".multi-target-count-hint");
    const multiChecks   = () => html.querySelectorAll("[name=multiTargetId]");

    const candidateMap = Object.fromEntries(
      (context.targetCandidates ?? []).map(c => [c.id, c])
    );
    const spellMap = Object.fromEntries(
      (context.targetedSpells ?? []).map(s => [s.id, s])
    );

    // Einzelziel-Logik
    const toggleManual = () => { manualRow.style.display = targetSelect?.value ? "none" : ""; };
    const updatePreview = () => {
      const c = candidateMap[targetSelect?.value];
      if (!c) { preview.style.display = "none"; return; }
      preview.style.display = "";
      preview.querySelector(".target-preview-img").src = c.img;
      preview.querySelector(".target-preview-name").textContent = c.name;
      const fill = preview.querySelector(".target-preview-hp-fill");
      fill.style.width = `${c.hpPct}%`;
      fill.style.backgroundColor = c.hpColor;
      preview.querySelector(".target-preview-stats").textContent = `RW ${c.dv} · HP ${c.hp}/${c.hpMax}`;
    };
    targetSelect?.addEventListener("change", () => { toggleManual(); updatePreview(); });
    toggleManual();
    updatePreview();

    // Mehrziel-Checkbox-Limit — einmalig registrieren, max dynamisch per Closure
    let _multiMax = 1;
    multiChecks().forEach(cb => cb.addEventListener("change", () => _updateSpellPreview?.()));
    const updateMultiLimit = (max) => {
      _multiMax = max;
      if (multiHint) multiHint.textContent = max >= 999 ? "" : `(max. ${max})`;
    };

    // Weapon untrained penalty + dynamic combat bonus per weapon's best skill
    const offBonusInput   = html.querySelector("[name=offBonus]");
    const cbHint          = html.querySelector(".combat-bonus-hint");
    const cbBreakdown     = html.querySelector(".combat-bonus-breakdown");
    const _isCreatureOrNpc = ["npc", "creature"].includes(actor.type);
    const _storedCB        = Number(actor.system.combat?.combatBonus ?? 0);
    const updateWeapon = () => {
      const wId     = weaponSelect?.value;
      const weapon  = (wId && wId !== "__native__") ? actor.items.get(wId) : null;
      // Kampfbonus aus der geteilten Rechnung — dieselbe Quelle wie
      // Fertigkeitsprobe und Charakterbogen. Enthält Attribut, Rang,
      // Klassen-/Talent-/Magie-/Rassenboni und den Ungelernt-Malus.
      const cb      = weaponSkillKeys(weapon).length ? weaponCombatBonus(actor, { weapon }) : null;
      const penalty = cb?.untrained ?? 0;
      if (untrainedRow) untrainedRow.style.display = penalty ? "" : "none";
      // Fallback: gespeicherter Kampfbonus, wenn die Waffe keine Fertigkeiten führt
      const bestCB  = cb?.total ?? _storedCB;
      if (cbBreakdown) cbBreakdown.textContent = cb ? formatBreakdown(cb.breakdown).join(" · ") : "";
      if (_isCreatureOrNpc) {
        if (cbHint) cbHint.textContent = _storedCB;
        if (offBonusInput) { offBonusInput.min = -99; offBonusInput.max = 99; }
      } else {
        if (cbHint) cbHint.textContent = bestCB;
        if (offBonusInput) {
          // Ein negativer Kampfbonus ist ein Malus, der sich verschieben
          // lässt: bei −1 sind −2 offensiv und dafür +1 defensiv erlaubt.
          const range = splitRange(bestCB);
          offBonusInput.min = range.min;
          offBonusInput.max = range.max;
          offBonusInput.value = clampOffensive(offBonusInput.value, bestCB);
        }
      }
    };
    weaponSelect?.addEventListener("change", updateWeapon);
    updateWeapon();

    // MP-Kosten-Input + Vorschau
    const noMpWarning    = html.querySelector(".spell-no-mp-warning");
    const spellPreview   = html.querySelector(".spell-effect-preview");
    const mpCostVal      = html.querySelector(".spell-mp-cost-value");
    const mpRemaining    = html.querySelector(".spell-mp-remaining-value");
    const spellDmgLabel  = html.querySelector(".spell-damage-label");
    const spellDmgValue  = html.querySelector(".spell-damage-value");
    const mpMinHint      = html.querySelector(".mp-cost-min");
    const mpProZielInput = html.querySelector("[name=mpProZiel]");

    const _getMpProZiel = () => Number(mpProZielInput?.value ?? 1);
    const _getMpCost    = () => Number(mpCostSelect?.value ?? 0);

    const _showSpellTargetMode = () => {
      if (singleRow) singleRow.style.display = "none";
      if (multiRow)  multiRow.style.display  = "";
      updateMultiLimit(999);
    };

    // Gesamtkosten: erstes Ziel = baseCost, jedes weitere = baseCost + mpProZiel
    const _calcTotalMp = (spell, checkedCount) => {
      const mpProZiel = _getMpProZiel();
      const minCost   = spell?.minCost ?? 1;
      const baseCost  = Math.max(minCost, _getMpCost());
      const totalMp   = checkedCount * (baseCost + mpProZiel) - mpProZiel;
      return { totalMp, baseCost };
    };

    const _updateSpellPreview = () => {
      const spell        = spellMap[spellSelect?.value];
      const checkedCount = [...multiChecks()].filter(c => c.checked).length || 1;
      const { totalMp, baseCost } = _calcTotalMp(spell, checkedCount);

      // MP-Status-Zeile
      if (mpCostVal)   mpCostVal.textContent   = totalMp ? `${totalMp} MP` : "—";
      if (mpRemaining) {
        const left = context.currentMp - totalMp;
        mpRemaining.textContent = totalMp ? `${left} MP` : "—";
        mpRemaining.style.color = left < 0 ? "#b42828" : "";
      }

      // Schaden pro Ziel basiert auf Basiskosten
      const hp = spell?.hpEffect ?? {};
      const damagePerTarget = hp.type
        ? Math.min(hp.max > 0 ? hp.max : Infinity, Math.round((hp.multiplier ?? 1) * baseCost))
        : null;
      if (spellDmgLabel) {
        spellDmgLabel.style.display = damagePerTarget ? "" : "none";
        if (damagePerTarget) spellDmgLabel.textContent = hp.type === "heal" ? "→ Heilung/Ziel:" : "→ MP-Schaden/Ziel:";
      }
      if (spellDmgValue) {
        spellDmgValue.style.display = damagePerTarget ? "" : "none";
        // Beim Schaden kommt der Überschuss (Angriff − Verteidigung) erst beim Wurf dazu
        if (damagePerTarget) {
          spellDmgValue.textContent = hp.type === "heal"
            ? `+${damagePerTarget} HP`
            : `−${damagePerTarget} HP + Überschuss`;
        }
      }
      if (spellPreview) spellPreview.style.display = "none";

      // Zu wenig MP?
      const cantAfford = totalMp > context.currentMp;
      if (submitBtn)   submitBtn.disabled = cantAfford || !totalMp;
      if (noMpWarning) noMpWarning.style.display = cantAfford ? "" : "none";
    };

    const updateSpellCosts = () => {
      if (!spellSelect) return;
      const spell = spellMap[spellSelect.value];
      const min   = spell?.minCost ?? 1;
      if (mpCostSelect) { mpCostSelect.min = min; mpCostSelect.max = context.currentMp; mpCostSelect.value = min; }
      if (mpProZielInput) mpProZielInput.value = spell?.mpPerTarget > 0 ? spell.mpPerTarget : 1;
      _showSpellTargetMode();
      _updateSpellPreview();
    };

    spellSelect?.addEventListener("change", updateSpellCosts);
    mpCostSelect?.addEventListener("input", _updateSpellPreview);
    mpProZielInput?.addEventListener("input", _updateSpellPreview);
    updateSpellCosts();

    // Modus-Umschalten Waffe ↔ Zauber
    const updateMode = () => {
      const mode = html.querySelector("[name=attackMode]:checked")?.value ?? "weapon";
      if (weaponSection) weaponSection.style.display = mode === "weapon" ? "" : "none";
      if (spellSection)  spellSection.style.display  = mode === "spell"  ? "" : "none";
      if (submitBtn) submitBtn.textContent = mode === "spell" ? " Zauber wirken" : " Angreifen";
      if (mode === "weapon") {
        if (singleRow) singleRow.style.display = "";
        if (multiRow)  multiRow.style.display  = "none";
      } else {
        _showSpellTargetMode();
        _updateSpellPreview();
      }
    };
    modeRadios.forEach(r => r.addEventListener("change", updateMode));
    updateMode();

    html.querySelector(".dialog-cancel-btn")?.addEventListener("click", () => this.close());
  }

  static async _handleSubmit(event, form, formData) {
    const data    = formData.object;
    const actor   = this.options.attackerActor;
    const mode    = data.attackMode ?? "weapon";

    // Mehrfach-Ziele aus Checkboxen (multi-target Modus)
    const multiTokenIds = form.querySelectorAll("[name=multiTargetId]:checked");
    const multiTargetActors = multiTokenIds.length
      ? [...multiTokenIds].map(cb => (canvas?.tokens?.placeables ?? []).find(t => t.id === cb.value)?.actor).filter(Boolean)
      : null;

    // Einzelziel (Waffe oder Einzelziel-Zauber)
    const tokenId     = data.targetTokenId;
    const targetToken = tokenId ? (canvas?.tokens?.placeables ?? []).find(t => t.id === tokenId) : null;
    const targetActor = targetToken?.actor ?? null;

    const resolve = this._resolve;
    this._resolve = null;

    if (mode === "spell") {
      const spell        = actor.items.get(data.spellId);
      const mpPerTarget  = Number(data.mpProZiel ?? spell?.system?.mpPerTarget ?? 1);
      const checkedCount = multiTargetActors?.length ?? 1;
      const minCost      = Number(spell?.system?.cost ?? 1);
      const baseCost     = Math.max(minCost, Number(data.mpCost ?? minCost));
      const mpCost       = checkedCount * (baseCost + mpPerTarget) - mpPerTarget;
      const targetCount  = checkedCount;
      resolve?.({
        mode:         "spell",
        spell,
        mpCost,
        baseCost,
        mpPerTarget,
        targetCount,
        multiTargetActors: multiTargetActors?.length ? multiTargetActors : null,
        spellBonus:   Number(data.spellBonus || 0),
        situMod:      Number(data.situMod || 0),
        targetActor,
        targetDefense: targetActor ? _dv(targetActor, actor) : Number(data.manualDefense || 5),
        attackerImg:  actor.img ?? "",
        targetImg:    targetActor?.img ?? "",
      });
    } else {
      const weapon = data.weaponId === "__native__" ? null : actor.items.get(data.weaponId);
      resolve?.({
        mode:             "weapon",
        weapon,
        offBonus:         Number(data.offBonus || 0),
        // Der Ungelernt-Malus steckt bereits im Kampfbonus und damit im Deckel
        // des Offensivbonus — hier würde er ein zweites Mal ziehen.
        minStrengthMod:   minStrengthPenalty(actor),
        maneuverMod:      _maneuverBonus(actor),
        situMod:          Number(data.situMod || 0),
        targetActor,
        targetDefense:    targetActor ? _dv(targetActor, actor) : Number(data.manualDefense || 5),
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
//  Attack Dialog & Resolution
// ══════════════════════════════════════════════════════════════════

export async function openAttackDialog(attackerActor, options = {}) {
  // Flucht ist die einzige Handlung der Runde — wer sie erklärt hat, greift
  // nicht mehr an.
  if (isFleeing(attackerActor, game.combat?.round)) {
    ui.notifications.warn(`ABOREA: ${attackerActor.name} flieht in dieser Runde und kann nicht angreifen.`);
    return;
  }
  const weapons       = attackerActor.items.filter(i => i.type === "weapon" && i.system.equipped);
  const targetedSpells = attackerActor.items.filter(i =>
    ["spell", "miracle"].includes(i.type) && i.system.targeted
  );
  if (!weapons.length && !targetedSpells.length) {
    ui.notifications.warn("ABOREA: Keine ausgerüstete Waffe und keine gezielten Zauber gefunden.");
    return;
  }

  const params = await new Promise(resolve => {
    new AboreaAttackDialog({ attackerActor, preselectedSpellId: options?.preselectedSpellId, resolve }).render(true);
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

/**
 * Zauberschaden — analog zum Waffenschaden in _executeAttack():
 *   (Angriffswert − Verteidigungswert) + MP-gekaufter Schaden [+ Krit-Bonus]
 * Der MP-Anteil kommt aus inferDirectHp() und ist dort bereits durch hpEffect.max
 * gedeckelt; der Überschuss aus der Trefferprobe bleibt ungedeckelt. Ein Krit
 * (offene 10) verdoppelt den MP-Anteil — wie den Waffenschaden bei Waffen.
 */
function _spellDamage(hp, attackValue, defenseValue, critical) {
  if (hp?.type !== "damage") return null;
  const overshoot = attackValue - defenseValue;
  const mpDamage  = Math.max(0, hp.amount);
  const critBonus = critical ? mpDamage : 0;
  return {
    attackValue, defenseValue, overshoot, mpDamage, critBonus,
    total: Math.max(1, overshoot + mpDamage + critBonus),
  };
}

/** Schadens-Aufschlüsselung für die Chatkarte — Aufbau wie in _buildAttackCard. */
function _buildSpellDamageSection(dmg) {
  if (!dmg) return "";
  return `
    <div class="ac-damage">
      <div class="ac-row">
        <span>Angriff − Verteidigung</span>
        <span>${dmg.attackValue} − ${dmg.defenseValue} = ${dmg.overshoot}</span>
      </div>
      <div class="ac-row"><span>MP-Schaden</span><span>${_sign(dmg.mpDamage)}</span></div>
      ${dmg.critBonus ? `<div class="ac-row critical-bonus"><span>💥 Kritisch (MP-Schaden ×2)</span><span>+${dmg.critBonus}</span></div>` : ""}
      <div class="ac-row ac-total"><span><strong>Schaden</strong></span><span><strong>${dmg.total}</strong></span></div>
    </div>`;
}

/**
 * Wendet HP-Effekt und Active Effects eines Zaubers auf ein Ziel an.
 * damageTotal übersteuert den reinen MP-Schaden — dort sind Überschuss und
 * Krit aus der Trefferprobe schon eingerechnet (siehe _spellDamage).
 */
/** Ist der Schaden dieser Handlung automatisch anzuwenden? */
function _autoApplyDamage() {
  return shouldAutoApplyDamage(
    game.settings.get("aborea-v7", SETTINGS.damageApply),
    { isGM: game.user.isGM });
}

/**
 * Wendet HP-Effekt und Active Effects eines Zaubers auf ein Ziel an.
 *
 * Gibt neben dem Kartentext zurück, was sich geändert hat — daraus entsteht
 * der Rückgängig-Eintrag. Schaden folgt der Weltoption; Heilung und Effekte
 * wirken immer sofort, sie sind nicht der strittige Teil.
 */
async function _applySpellEffectsToTarget(spell, mpCost, targetActor, damageTotal = null) {
  let html = "";
  const undo = { actorId: targetActor.id, name: targetActor.name };
  const hp      = inferDirectHp(spell, mpCost);
  const effects = inferEffects(spell, mpCost).map(e => ({ ...e, origin: spell.uuid }));

  if (hp?.type === "heal") {
    const cur = Number(targetActor.system.resources?.hp?.value ?? 0);
    const max = Number(targetActor.system.resources?.hp?.max ?? cur);
    undo.hp = cur;
    await targetActor.update({ "system.resources.hp.value": Math.min(max, cur + hp.amount) });
    html += `<div class="ac-effect-row">✨ <strong>${targetActor.name}</strong>: +${hp.amount} HP</div>`;
  }
  if (hp?.type === "damage") {
    const amount = damageTotal ?? hp.amount;
    const cur = Number(targetActor.system.resources?.hp?.value ?? 0);
    if (_autoApplyDamage()) {
      undo.hp = cur;
      await targetActor.update({ "system.resources.hp.value": Math.max(0, cur - amount) });
      html += `<div class="ac-effect-row">💥 <strong>${targetActor.name}</strong>: −${amount} HP</div>`;
    } else {
      html += `<div class="ac-effect-row">💥 <strong>${targetActor.name}</strong>: ${amount} Schaden
        <button type="button" class="apply-damage-btn btn-sm"
                data-target-id="${targetActor.id}" data-damage="${amount}">💢 anwenden</button></div>`;
    }
  }
  if (effects.length) {
    const created = await applyEffectsToActor(targetActor, effects);
    if (created?.length) undo.effectIds = created.map(e => e.id);
    html += `<div class="ac-effect-row">🔮 <strong>${targetActor.name}</strong>: ${game.i18n.localize("ABOREA.EffectApplied")}</div>`;
  }
  return { html, undo };
}

async function _executeSpellAttack(attackerActor, { spell, mpCost, baseCost, mpPerTarget = 0, targetCount = 1, multiTargetActors = null, spellBonus, situMod, targetActor, targetDefense, attackerImg, targetImg }) {
  if (!spell) return;

  // Ziele sammeln — Priorität: manuelle Checkbox-Auswahl > T-markierte Tokens > Dialog-Einzelziel
  const isUnlimited = targetCount >= 999;
  let targets = [];
  if (multiTargetActors?.length) {
    targets = multiTargetActors;
  } else if ((mpPerTarget > 0 || isUnlimited) && targetCount > 1) {
    const maxTargets = isUnlimited ? Infinity : targetCount;
    targets = Array.from(game.user.targets ?? []).map(t => t.actor).filter(Boolean);
    if (!isUnlimited) targets = targets.slice(0, maxTargets);
    if (!targets.length && targetActor) targets = [targetActor];
    if (!isUnlimited && targets.length < targetCount) {
      ui.notifications.info(`ABOREA: Zauber trifft ${targets.length} von ${targetCount} möglichen Zielen.`);
    }
  } else {
    targets = targetActor ? [targetActor] : [];
  }

  // MP prüfen & abziehen (mpCost wurde bereits korrekt im Dialog berechnet)
  const currentMp = _getCurrentMp(attackerActor);
  if (currentMp < mpCost) { ui.notifications.warn(game.i18n.localize("ABOREA.NotEnoughMP")); return; }
  await attackerActor.update({ "system.resources.mp.value": Math.max(0, currentMp - mpCost) });
  const casterUndo = { actorId: attackerActor.id, name: attackerActor.name, mp: currentMp };
  const castSplit = await declareRound(attackerActor, { mode: "spell", lock: true });
  const undeclaredSpell = castSplit && castSplit.mode !== "spell";

  // Pro Ziel: eigener Treffer-Wurf
  const rolls = [];
  const undoEntries = [];
  let effectHtml = "";
  let cardRows   = "";

  // MP-gekaufter Schadensanteil — für alle Ziele gleich (Basiskosten pro Ziel)
  const spellMpCost = baseCost ?? mpCost;
  const hpBase      = inferDirectHp(spell, spellMpCost);

  for (let i = 0; i < Math.max(1, targets.length || 1); i++) {
    const currentTarget     = targets[i] ?? null;
    const currentDefense    = currentTarget
      ? await _dvConsuming(currentTarget, attackerActor)
      : targetDefense;
    const currentTargetImg  = currentTarget?.img ?? targetImg;
    const roll       = await rollOpenD10({ label: `Gezielter Zauber: ${spell.name}`, skipVisual: true });
    const attackValue = roll.total + spellBonus + situMod;
    const hit         = !roll.naturalOne && attackValue > currentDefense;

    rolls.push(...roll.rolls);

    const resultClass = roll.naturalOne ? "patzer" : (hit ? "hit" : "miss");
    const resultLabel = roll.naturalOne
      ? "⛔ Patzer — automatischer Fehlschlag"
      : (hit ? "✅ Treffer — Zauber wirkt!" : "❌ Kein Treffer — Zauber verpufft");
    const critNote = roll.critical
      ? `<div class="ac-note critical">💥 Kritisch — 10er offen gewürfelt!</div>` : "";
    const dmg = hit ? _spellDamage(hpBase, attackValue, currentDefense, roll.critical) : null;

    const targetLabel = currentTarget ? currentTarget.name : (i === 0 ? (targetActor?.name ?? "—") : "—");
    const headerLabel = targets.length > 1 ? `Ziel ${i + 1}: ${targetLabel}` : targetLabel;

    cardRows += `
      <div class="ac-body${i > 0 ? " ac-body-extra" : ""}">
        ${targets.length > 1 ? `<div class="ac-row ac-target-label"><span>Ziel</span><span><strong>${headerLabel}</strong></span></div>` : ""}
        <div class="ac-row"><span>Würfelwurf</span><span>${roll.formula}</span></div>
        <div class="ac-row ac-total"><span>Angriffswert</span><span><strong>${roll.naturalOne ? "—" : attackValue}</strong></span></div>
        <div class="ac-row"><span>Verteidigungswert</span><span>${currentDefense}</span></div>
      </div>
      <div class="ac-result ${resultClass}">${resultLabel}</div>
      ${critNote}
      ${_buildSpellDamageSection(dmg)}`;

    if (hit && currentTarget) {
      const applied = await _applySpellEffectsToTarget(spell, spellMpCost, currentTarget, dmg?.total ?? null);
      effectHtml += applied.html;
      undoEntries.push(applied.undo);
    }
  }

  const targetNames   = targets.length > 1 ? targets.map(t => t.name).join(", ") : (targetActor?.name ?? null);
  const effectSection = effectHtml ? `<div class="ac-effects">${effectHtml}</div>` : "";
  const cardContent   = `<div class="aborea-chat-card aborea-attack-card">
    ${_buildCardHeader(attackerActor.name, attackerImg, targetNames, targets[0]?.img ?? targetImg)}
    <div class="ac-body">
      <div class="ac-row"><span>Zauber</span><span>${spell.name} (${mpCost} MP)</span></div>
      <div class="ac-row"><span>Angriffsbonus</span><span>${_sign(spellBonus)}</span></div>
      ${situMod !== 0 ? `<div class="ac-row"><span>Situationsmod.</span><span>${_sign(situMod)}</span></div>` : ""}
      ${targets.length > 1 ? `<div class="ac-row"><span>Ziele</span><span>${targets.length}</span></div>` : ""}
      ${undeclaredSpell
        ? `<div class="ac-row ac-penalty"><span>⚠ Abweichung</span><span>als ${splitLabel(castSplit)} erklärt</span></div>`
        : `<div class="ac-row ac-penalty"><span>Defensivbonus</span><span>entfällt diese Runde</span></div>`}
    </div>
    ${cardRows}
    ${effectSection}
    <button type="button" class="undo-damage-btn btn-sm">↩ Rückgängig</button>
  </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    rolls,
    content: cardContent,
    flags:   { "aborea-v7": {
      spellAttackResult: { itemId: spell.id, mpCost, targetCount: targets.length },
      undo: buildUndoRecord([casterUndo, ...undoEntries]),
    } }
  });
}

// ── Internal: roll + chat ────────────────────────────────────────

async function _executeAttack(attackerActor, { weapon, offBonus, minStrengthMod = 0, maneuverMod = 0, situMod, targetActor, targetDefense, attackerImg = "", targetImg = "" }) {
  // Der Angriff ist zugleich die Erklärung, falls noch keine vorliegt.
  await declareRound(attackerActor, { mode: "weapon", offensive: offBonus, lock: true });
  // Der Verteidiger verbraucht jetzt seinen Defensivbonus gegen diesen Angreifer.
  if (targetActor) targetDefense = await _dvConsuming(targetActor, attackerActor);
  // Der Ungelernt-Malus steckt schon im Kampfbonus und damit im Offensivbonus.
  const effectiveOffBonus = offBonus + maneuverMod + minStrengthMod;
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
        offBonus, minStrengthMod, maneuverMod, situMod,
        attackValue: 0, defenseValue: targetDefense,
        hit: false, damage: 0, patzer: true, critical: false,
      })
    });
    return;
  }

  const attackValue = roll.total + effectiveOffBonus + situMod;
  const hit    = attackValue > targetDefense;
  // Waffenschaden inkl. Active-Effect-Bonus (Flammenschwert)
  const bonusDmg  = _bonusWeaponDamage(attackerActor);
  const weaponDmg = Number(weapon.system.damage ?? 0) + bonusDmg;
  const critBonus = (hit && roll.critical) ? Math.max(0, weaponDmg) : 0;
  const damage = hit ? Math.max(1, (attackValue - targetDefense) + weaponDmg + critBonus) : 0;

  // Schaden folgt der Weltoption — dieselbe Regel wie bei Zaubern. Vorher
  // brauchten Waffen immer einen Knopfdruck und Zauber nie einen.
  const autoApplied = hit && damage > 0 && !!targetActor && _autoApplyDamage();
  let undo = null;
  if (autoApplied) {
    const before = Number(targetActor.system.resources?.hp?.value ?? 0);
    await targetActor.update({ "system.resources.hp.value": Math.max(0, before - damage) });
    undo = buildUndoRecord([{ actorId: targetActor.id, name: targetActor.name, hp: before }]);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    rolls: roll.rolls,
    content: _buildAttackCard({
      attacker: attackerActor.name, attackerImg,
      target: targetActor?.name, targetImg,
      targetActorId: targetActor?.id,
      weapon: weapon.name,
      rollFormula: roll.formula, rollTotal: roll.total,
      offBonus, minStrengthMod, maneuverMod, situMod,
      attackValue, defenseValue: targetDefense,
      hit, damage, patzer: false, critical: roll.critical,
      weaponDamage: weaponDmg, bonusDamage: bonusDmg, critBonus, autoApplied,
    }),
    flags: { "aborea-v7": {
      attackResult: { hit, damage, targetActorId: targetActor?.id ?? null },
      ...(undo ? { undo } : {}),
    } }
  });
}

/**
 * Gruppenangriff: mehrere Angreifer gegen ein Ziel, ein Wurf je Angreifer,
 * eine Sammelkarte. Spart fünf Dialoge und fünf Chatkarten, wenn eine Horde
 * Goblins auf denselben Charakter einschlägt.
 *
 * Der Verteidigungswert wird einmal vor dem ersten Wurf bestimmt: alle
 * Angriffe einer Runde treffen auf denselben Schild, auch wenn zwischendurch
 * Schaden angewendet wird.
 */
export async function executeGroupAttack(attackers, { targetToken, situMod = 0 } = {}) {
  const targetActor = targetToken?.actor ?? null;
  if (!attackers?.length || !targetActor) return;

  const round = game.combat?.round;
  const rolls = [];
  let rows = "";
  let anyHit = false;

  // Der Defensivbonus wird auf die Angreifer verteilt (S. 33) — jeder trifft
  // deshalb auf seinen eigenen Verteidigungswert.
  // Der Vorrat wird in der Reihenfolge verbraucht, in der die Angriffe
  // eintreffen — das ist hier die Initiative-Reihenfolge der Angreifer.
  const defenseByAttacker = {};
  for (const a of attackers) defenseByAttacker[a.id] = await _dvConsuming(targetActor, a);

  for (const actor of attackers) {
    const targetDefense = defenseByAttacker[actor.id];
    const plan = attackPlan(actor, { round, situMod });
    await declareRound(actor, { mode: "weapon", offensive: plan.offBonus, lock: true });

    const minStrengthMod = minStrengthPenalty(actor);
    const maneuverMod    = _maneuverBonus(actor);
    const roll = await rollOpenD10({ label: game.i18n.localize("ABOREA.Attack"), skipVisual: true });
    rolls.push(...roll.rolls);

    const attackValue = roll.naturalOne
      ? 0
      : roll.total + plan.offBonus + maneuverMod + minStrengthMod + plan.situMod;
    const hit = !roll.naturalOne && attackValue > targetDefense;
    if (hit) anyHit = true;

    const weaponDmg = plan.weapon
      ? Number(plan.weapon.system.damage ?? 0) + _bonusWeaponDamage(actor)
      : _bonusWeaponDamage(actor);
    const critBonus = (hit && roll.critical) ? Math.max(0, weaponDmg) : 0;
    const damage    = hit ? Math.max(1, (attackValue - targetDefense) + weaponDmg + critBonus) : 0;

    const resultClass = roll.naturalOne ? "patzer" : (hit ? "hit" : "miss");
    const resultLabel = roll.naturalOne ? "⛔ Patzer" : (hit ? `✅ ${damage} Schaden` : "❌ Fehlschlag");

    rows += `
      <div class="ac-group-row ${resultClass}">
        <span class="acg-name">${actor.name}</span>
        <span class="acg-weapon">${plan.weapon?.name ?? "Angriff"}</span>
        <span class="acg-roll">${roll.formula}${_sign(plan.offBonus + maneuverMod + minStrengthMod + plan.situMod)}</span>
        <span class="acg-value">${roll.naturalOne ? "—" : attackValue}</span>
        <span class="acg-dv" title="Verteidigungswert gegen diesen Angreifer">RW ${targetDefense}</span>
        <span class="acg-result">${resultLabel}</span>
        ${damage && targetActor.id
          ? `<button type="button" class="apply-damage-btn btn-sm"
                     data-target-id="${targetActor.id}" data-damage="${damage}">💢</button>`
          : ""}
      </div>`;
  }

  await ChatMessage.create({
    content: `<div class="aborea-chat-card aborea-attack-card aborea-group-attack">
      <div class="ac-header">
        <span class="ac-attacker">⚔ Gruppenangriff (${attackers.length})</span>
        <span class="ac-arrow">→</span>
        <span class="ac-target">${targetActor.name}</span>
      </div>
      <div class="ac-row"><span>Verteidigungswert</span><span><strong>${
        [...new Set(Object.values(defenseByAttacker))].sort((a, b) => a - b).join(" / ")
      }</strong></span></div>
      ${situMod !== 0 ? `<div class="ac-row"><span>Situationsmod.</span><span>${_sign(situMod)}</span></div>` : ""}
      <div class="ac-group-rows">${rows}</div>
      ${anyHit ? "" : `<div class="ac-result miss">Kein Angriff kam durch.</div>`}
    </div>`,
    rolls,
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
  weapon, rollFormula, rollTotal, offBonus, minStrengthMod = 0, maneuverMod = 0, situMod,
  attackValue, defenseValue, hit, damage, patzer, critical,
  weaponDamage = 0, bonusDamage = 0, critBonus = 0, autoApplied = false
}) {
  const resultClass = patzer ? "patzer" : (hit ? "hit" : "miss");
  const resultLabel = patzer
    ? "⛔ Patzer — automatischer Fehlschlag"
    : (hit ? "✅ Treffer" : "❌ Kein Treffer");

  const minStrengthRow = minStrengthMod
    ? `<div class="ac-row ac-penalty"><span>Mindeststärke</span><span>${_sign(minStrengthMod)}</span></div>`
    : "";
  const maneuverRow = maneuverMod
    ? `<div class="ac-row"><span>Manöverbonus</span><span>${_sign(maneuverMod)}</span></div>`
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
        <span>${_sign(weaponDamage)}${bonusDamage ? ` <em>(inkl. ${_sign(bonusDamage)} Zauber)</em>` : ""}</span>
      </div>
      ${critBonus ? `<div class="ac-row critical-bonus"><span>💥 Kritisch (Waffenschaden ×2)</span><span>+${critBonus}</span></div>` : ""}
      <div class="ac-row ac-total">
        <span><strong>Schaden</strong></span>
        <span><strong>${damage}</strong></span>
      </div>
      ${targetActorId && !autoApplied
        ? `<button type="button" class="apply-damage-btn" data-target-id="${targetActorId}" data-damage="${damage}">
             💢 Schaden anwenden (${damage})
           </button>`
        : ""}
      ${autoApplied
        ? `<div class="ac-note">✓ Schaden automatisch angewendet</div>
           <button type="button" class="undo-damage-btn btn-sm">↩ Rückgängig</button>`
        : ""}
    </div>` : "";

  return `<div class="aborea-chat-card aborea-attack-card">
    ${_buildCardHeader(attacker, attackerImg, target, targetImg)}
    <div class="ac-body">
      <div class="ac-row"><span>Waffe</span><span>${weapon}</span></div>
      <div class="ac-row"><span>Würfelwurf</span><span>${rollFormula}${patzer ? " (Patzer!)" : ""}</span></div>
      <div class="ac-row"><span>Offensivbonus</span><span>${_sign(offBonus)}</span></div>
      ${maneuverRow}
      ${minStrengthRow}
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
    flags: { "aborea-v7": { undo: buildUndoRecord([{ actorId: targetActorId, name: actor.name, hp: previousHp }]) } },
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
//  Reine Regel-Rechnungen — exportiert für tests/combat.test.mjs
// ══════════════════════════════════════════════════════════════════

export {
  _dv                as actorDefenseValue,
  _spellDamage       as spellDamage,
  _maneuverBonus     as maneuverBonus,
  _bonusWeaponDamage as bonusWeaponDamage,
  _hpColor           as hpColor,
  _split             as roundSplitOf,
};

// ══════════════════════════════════════════════════════════════════
//  Hooks
// ══════════════════════════════════════════════════════════════════

/**
 * Zustandszeile eines Kombattanten im Tracker: Lebenspunkte,
 * Verteidigungswert und die Rundenerklärung. Eigentümer erklären direkt hier —
 * dafür muss niemand mehr mitten im Kampf seinen Charakterbogen öffnen.
 *
 * Reine DOM-Arbeit; gerechnet wird in declaration.mjs und _dv().
 */
function _buildCombatantState(actor, round) {
  const wrap = document.createElement("div");
  wrap.className = "aborea-combatant-state";

  const hp    = actor.system.resources?.hp ?? {};
  const hpVal = Number(hp.value ?? 0);
  const hpMax = Number(hp.max ?? 1);
  const pct   = hpMax > 0 ? Math.round((hpVal / hpMax) * 100) : 0;
  const split = roundSplit(actor, round);
  const rest  = defenseRemaining(split.defensive, split.defenseSpent);

  const hint = split.declared
    ? (split.locked ? "Erklärt und festgesetzt — es wurde bereits gehandelt" : "Für diese Runde erklärt")
    : "Noch nicht erklärt — es gilt die Aufteilung vom Bogen";

  wrap.innerHTML = `
    <div class="acs-bar"><div class="acs-bar-fill" style="width:${pct}%;background:${_hpColor(pct)}"></div></div>
    <div class="acs-line">
      <span class="acs-hp">${hpVal}/${hpMax}</span>
      <span class="acs-dv" title="Verteidigungswert mit vollem Defensivbonus — gegen einzelne Angreifer kann er niedriger sein">RW ${_dv(actor)}</span>
      <span class="acs-split${split.declared ? "" : " undeclared"}${split.locked ? " locked" : ""}" title="${hint}">
        ${splitLabel(split)}${rest !== split.defensive ? ` (${rest} übrig)` : ""}${split.declared ? "" : " ?"}
      </span>
    </div>`;

  // Auch ein negativer Kampfbonus laesst sich verschieben — nur bei genau 0
  // gibt es nichts zu verteilen.
  const range   = splitRange(split.pool);
  const canEdit = (actor.isOwner || game.user.isGM) && range.min !== range.max && canRedeclare(actor, round);
  if (!canEdit) return wrap;

  const controls = document.createElement("div");
  controls.className = "acs-declare";
  controls.innerHTML = `
    <button type="button" class="acs-mode${split.mode === "weapon" ? " active" : ""}"
            data-mode="weapon" title="Mit der Waffe kämpfen">⚔</button>
    <input type="range" class="acs-offensive" min="${range.min}" max="${range.max}" value="${split.offensive}"
           title="Offensivanteil des Kampfbonus (${range.min} bis ${range.max})" />
    <button type="button" class="acs-mode${split.mode === "spell" ? " active" : ""}"
            data-mode="spell" title="Zaubern — kein Defensivbonus">✨</button>
    <button type="button" class="acs-mode${split.mode === "flee" ? " active" : ""}"
            data-mode="flee" title="Fliehen — einzige Handlung, der Gegner schlägt noch einmal zu">🏃</button>`;

  const slider = controls.querySelector(".acs-offensive");
  slider.addEventListener("change", ev => {
    ev.stopPropagation();
    declareRound(actor, { mode: "weapon", offensive: Number(ev.target.value) });
  });
  controls.querySelectorAll(".acs-mode").forEach(btn => btn.addEventListener("click", ev => {
    ev.stopPropagation();
    const mode = btn.dataset.mode;
    declareRound(actor, { mode, offensive: mode === "weapon" ? Number(slider.value) : split.pool });
  }));

  wrap.appendChild(controls);
  return wrap;
}

export function registerCombatHooks() {
  game.settings.register("aborea-v7", SETTINGS.situMod, {
    name: "Globaler Situationsmodifikator",
    hint: "Wird im Angriffsdialog als Voreinstellung verwendet. Negativer Wert = Erschwernis.",
    scope: "world", config: false, type: Number, default: 0
  });

  game.settings.register("aborea-v7", SETTINGS.situModReset, {
    name: "Situationsmodifikator je Runde zurücksetzen",
    hint: "Setzt den globalen Modifikator bei jedem Rundenwechsel auf 0. Verhindert, dass eine vergessene Erschwernis die halbe Sitzung verfälscht.",
    scope: "world", config: true, type: Boolean, default: true
  });

  game.settings.register("aborea-v7", SETTINGS.damageApply, {
    name: "Schaden automatisch anwenden",
    hint: "Gilt für Waffen und Zauber gleichermaßen.",
    scope: "world", config: true, type: String, default: "gm",
    choices: {
      off:  "Nie — immer über den Knopf auf der Karte",
      gm:   "Bei Würfen des Spielleiters",
      auto: "Immer",
    },
  });

  game.settings.register("aborea-v7", SETTINGS.autoInitiative, {
    name: "Initiative beim Kampfstart für alle würfeln",
    hint: "Spart es, jeden Kombattanten einzeln anzuklicken.",
    scope: "world", config: true, type: Boolean, default: true
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

    // Rückgängig (GM only, einmalig) — HP, MP und angelegte Effekte
    html.querySelectorAll(".undo-damage-btn").forEach(btn => {
      if (!game.user.isGM) { btn.style.display = "none"; return; }
      const flag = message.getFlag("aborea-v7", "undo");
      if (!flag) { btn.disabled = true; return; }

      // Altbestand: frühere Karten trugen nur { actorId, previousHp }
      const record = flag.entries
        ? flag
        : buildUndoRecord([{ actorId: flag.actorId, hp: flag.previousHp }]);
      const summary = describeUndo(record);
      if (summary) btn.title = `Macht rückgängig: ${summary}`;

      btn.addEventListener("click", async () => {
        if (!message.getFlag("aborea-v7", "undo")) {
          ui.notifications.warn("Rückgängig bereits verwendet.");
          return;
        }
        let restored = 0;
        for (const entry of record.entries ?? []) {
          const actor = game.actors.get(entry.actorId);
          if (!actor) continue;
          const update = {};
          if ("hp" in entry) update["system.resources.hp.value"] = entry.hp;
          if ("mp" in entry) update["system.resources.mp.value"] = entry.mp;
          if (Object.keys(update).length) await actor.update(update);
          if (entry.effectIds?.length) {
            const present = entry.effectIds.filter(id => actor.effects.get(id));
            if (present.length) await actor.deleteEmbeddedDocuments("ActiveEffect", present);
          }
          restored++;
        }
        await message.unsetFlag("aborea-v7", "undo");
        btn.disabled = true;
        btn.textContent = `✓ zurückgesetzt (${summary || restored})`;
        ui.notifications.info(`ABOREA: ${restored} Aktor(en) zurückgesetzt.`);
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

      const currentMod = Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0);
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
        const clamped = clampSituMod(val);
        await game.settings.set("aborea-v7", SETTINGS.situMod, clamped);
        modBar.querySelector(".situ-mod-input").value = clamped;
      };
      modBar.querySelector(".situ-mod-input").addEventListener("change", ev => updateMod(ev.target.value));
      modBar.querySelectorAll(".situ-mod-step").forEach(btn => {
        btn.addEventListener("click", () => {
          const cur = Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0);
          updateMod(cur + Number(btn.dataset.delta));
        });
      });
      modBar.querySelector(".situ-mod-reset").addEventListener("click", () => updateMod(0));

      // Wiederkehrende Erschwernisse als Knöpfe statt jedes Mal zu tippen.
      const presets = document.createElement("div");
      presets.className = "situ-mod-presets";
      for (const p of SITU_PRESETS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "situ-preset";
        b.title = `${p.title} (${p.value >= 0 ? "+" : ""}${p.value})`;
        b.textContent = `${p.label} ${p.value >= 0 ? "+" : ""}${p.value}`;
        b.addEventListener("click", () => {
          const cur = Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0);
          // Zweiter Klick auf dasselbe Preset nimmt es wieder heraus.
          updateMod(cur === p.value ? 0 : p.value);
        });
        presets.appendChild(b);
      }
      modBar.appendChild(presets);

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

    // ── Je Kombattant: Zustand und Rundenerklärung ──────────────────
    root.querySelectorAll(".aborea-combatant-state").forEach(el => el.remove());
    for (const c of combat.combatants) {
      const row = root.querySelector(`.combatant[data-combatant-id="${c.id}"]`);
      if (c.actor && row) row.appendChild(_buildCombatantState(c.actor, combat.round));
    }

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

  // ── Rundenwechsel: Situationsmodifikator zurücksetzen ─────────────
  // Ein vergessener −4 verfälscht sonst die halbe Sitzung. Nur bei einem
  // echten Rundenwechsel — ein Zugwechsel darf ihn nicht wegräumen.
  Hooks.on("updateCombat", async (combat, changes, options) => {
    if (!game.user.isGM || changes.round === undefined) return;
    const previousRound = Number(options?.aboreaPreviousRound ?? combat.previous?.round ?? 0);
    const enabled = game.settings.get("aborea-v7", SETTINGS.situModReset);
    if (!shouldResetSituMod(enabled, { previousRound, currentRound: changes.round })) return;
    if (Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0) === 0) return;
    await game.settings.set("aborea-v7", SETTINGS.situMod, 0);
    ui.notifications.info("ABOREA: Situationsmodifikator für die neue Runde zurückgesetzt.");
  });

  // ── Kampfstart: Initiative für alle ───────────────────────────────
  Hooks.on("combatStart", async combat => {
    if (!game.user.isGM) return;
    if (!game.settings.get("aborea-v7", SETTINGS.autoInitiative)) return;
    const pending = combat.combatants.filter(c => c.initiative === null || c.initiative === undefined);
    if (!pending.length) return;
    await combat.rollInitiative(pending.map(c => c.id));
  });

  // ── Angriff direkt vom Token ──────────────────────────────────────
  // Vorher war der Dialog nur über den Tracker (aktiver Kombattant) oder den
  // geöffneten Charakterbogen erreichbar — für den Spielleiter der Umweg.
  Hooks.on("renderTokenHUD", (hud, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
    const actor = hud?.object?.actor;
    if (!root?.querySelector || !actor || actor.type === "loot") return;
    if (!actor.isOwner && !game.user.isGM) return;

    const column = root.querySelector(".col.left") ?? root.querySelector(".left");
    if (!column) return;

    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "control-icon aborea-hud-attack";
    btn.title     = "Angreifen";
    btn.innerHTML = "⚔";
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      openAttackDialog(actor);
    });
    column.appendChild(btn);
  });

  // ── Gruppenangriff als Szenenwerkzeug ─────────────────────────────
  const _groupAttackTool = {
    name: "aborea-group-attack",
    title: "ABOREA: Gruppenangriff",
    icon: "fas fa-users",
    button: true,
    visible: true,
    onChange: () => _startGroupAttack(),
    onClick:  () => _startGroupAttack(),
  };
  const _addTool = controls => {
    if (!game.user.isGM) return;
    const tokenControls = Array.isArray(controls)
      ? controls.find(c => c.name === "token")
      : controls?.token;
    if (!tokenControls) return;
    if (Array.isArray(tokenControls.tools)) {
      if (!tokenControls.tools.some(t => t.name === _groupAttackTool.name)) tokenControls.tools.push(_groupAttackTool);
    } else if (tokenControls.tools) {
      tokenControls.tools[_groupAttackTool.name] ??= _groupAttackTool;
    }
  };
  Hooks.on("getSceneControlButtonsV2", _addTool);
  Hooks.on("getSceneControlButtons",   _addTool);
}

/**
 * Sammelt die ausgewählten Tokens als Angreifer und das markierte Token als
 * Ziel. Beides kommt aus dem, was der Spielleiter ohnehin auf der Szene tut —
 * auswählen und mit T markieren — statt aus einem weiteren Dialog.
 */
async function _startGroupAttack() {
  const attackers = (canvas?.tokens?.controlled ?? [])
    .map(t => t.actor).filter(a => a && a.type !== "loot");
  if (attackers.length < 2) {
    ui.notifications.warn("ABOREA: Mindestens zwei Tokens auswählen, die angreifen sollen.");
    return;
  }
  const targetToken = game.user.targets.first();
  if (!targetToken?.actor) {
    ui.notifications.warn("ABOREA: Kein Ziel markiert — mit T ein Ziel wählen.");
    return;
  }
  if (attackers.some(a => a.id === targetToken.actor.id)) {
    ui.notifications.warn("ABOREA: Das Ziel ist unter den Angreifern.");
    return;
  }
  const situMod = Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0);
  await executeGroupAttack(attackers, { targetToken, situMod });
}
