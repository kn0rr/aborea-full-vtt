import { ABOREA } from "./config.mjs";
import { rollOpenD10, rollInitiative as rollInitiativeForActor } from "./dice.mjs";

// ══════════════════════════════════════════════════════════════════
//  AboreaCombat — Combat Document
// ══════════════════════════════════════════════════════════════════

export class AboreaCombat extends Combat {
  /** Roll initiative for one or multiple combatants using ABOREA's open d10. */
  async rollInitiative(ids, { updateTurn = true } = {}) {
    const combatantIds = typeof ids === "string" ? [ids] : ids;
    const updates = [];
    for (const id of combatantIds) {
      const combatant = this.combatants.get(id);
      if (!combatant) continue;
      const actor = combatant.actor;
      const total = actor
        ? await rollInitiativeForActor(actor)
        : await new Roll("1d10").evaluate().then(r => r.total);
      updates.push({ _id: id, initiative: total });
    }
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
    return this;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Attack Dialog & Resolution
// ══════════════════════════════════════════════════════════════════

/**
 * Open the attack dialog for the given actor.
 * Reads Foundry's current token target automatically.
 */
export async function openAttackDialog(attackerActor) {
  const weapons = attackerActor.items.filter(i => i.type === "weapon" && i.system.equipped);
  if (!weapons.length) {
    ui.notifications.warn("ABOREA: Keine ausgerüstete Waffe gefunden.");
    return;
  }

  const targetToken = game.user.targets.first() ?? null;
  const targetActor = targetToken?.actor ?? null;

  const currentOffBonus = Number(attackerActor.system.combat?.offensiveBonus ?? 0);
  const combatBonus = Number(attackerActor.system.combat?.combatBonus
    ?? attackerActor.system.combat?.offensiveBonus
    ?? 0)
    + Number(attackerActor.system.combat?.defensiveBonus ?? 0);

  const targetDefenseValue = targetActor
    ? ABOREA.defenseValue(
        Number(targetActor.system.combat?.totalArmorValue ?? 5),
        Number(targetActor.system.combat?.defensiveBonus ?? 0))
    : null;

  const weaponOptions = weapons
    .map(w => `<option value="${w.id}">${w.name} &nbsp;(+${w.system.damage ?? 0} Schaden, ${w.system.skill ?? "—"})</option>`)
    .join("");

  const targetHtml = targetActor
    ? `<div class="form-group target-info">
         <label>Ziel</label>
         <span><strong>${targetActor.name}</strong>
           &nbsp;·&nbsp; RW&nbsp;${targetDefenseValue}
           &nbsp;·&nbsp; HP&nbsp;${targetActor.system.resources?.hp?.value ?? "?"}
         </span>
       </div>`
    : `<div class="form-group">
         <label>Ziel-Verteidigungswert <span class="hint">(kein Token ausgewählt)</span></label>
         <input type="number" name="manualDefense" value="5" min="1" />
       </div>`;

  const params = await new Promise(resolve => {
    new Dialog({
      title: `⚔ Angriff — ${attackerActor.name}`,
      content: `<form class="aborea-attack-form">
        <div class="form-group">
          <label>Waffe</label>
          <select name="weaponId">${weaponOptions}</select>
        </div>
        <div class="form-group ob-row">
          <label>Offensivbonus
            <span class="hint">(Kampfbonus: ${combatBonus})</span>
          </label>
          <input type="number" name="offBonus" value="${currentOffBonus}" min="0" max="${combatBonus}" />
        </div>
        <div class="form-group">
          <label>Situationsmodifikator
            <span class="hint">(negativ = Erschwernis)</span>
          </label>
          <input type="number" name="situMod" value="0" />
        </div>
        ${targetHtml}
      </form>`,
      buttons: {
        attack: {
          icon: `<i class="fas fa-dice-d10"></i>`,
          label: "Angreifen",
          callback: html => resolve({
            weapon:        attackerActor.items.get(html.find("[name=weaponId]").val()),
            offBonus:      Number(html.find("[name=offBonus]").val() || 0),
            situMod:       Number(html.find("[name=situMod]").val() || 0),
            targetActor,
            targetDefense: targetDefenseValue
              ?? Number(html.find("[name=manualDefense]").val() || 5),
          })
        },
        cancel: { label: "Abbruch", callback: () => resolve(null) }
      },
      default: "attack",
      close: () => resolve(null)
    }).render(true);
  });

  if (!params?.weapon) return;
  await _executeAttack(attackerActor, params);
}

// ── Internal: roll + chat ────────────────────────────────────────

async function _executeAttack(attackerActor, { weapon, offBonus, situMod, targetActor, targetDefense }) {
  const roll = await rollOpenD10({ label: game.i18n.localize("ABOREA.Attack") });

  // Natural 1 → Patzer, automatic failure
  if (roll.naturalOne) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      rolls: roll.rolls,
      content: _buildAttackCard({
        attacker: attackerActor.name,
        target: targetActor?.name,
        weapon: weapon.name,
        rollFormula: roll.formula,
        rollTotal: 0,
        offBonus, situMod,
        attackValue: 0,
        defenseValue: targetDefense,
        hit: false, damage: 0,
        patzer: true, critical: false,
      })
    });
    return;
  }

  const attackValue = roll.total + offBonus - situMod;
  const hit = attackValue > targetDefense;
  const damage = hit
    ? Math.max(1, (attackValue - targetDefense) + Number(weapon.system.damage ?? 0))
    : 0;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    rolls: roll.rolls,
    content: _buildAttackCard({
      attacker: attackerActor.name,
      target: targetActor?.name,
      targetActorId: targetActor?.id,
      weapon: weapon.name,
      rollFormula: roll.formula,
      rollTotal: roll.total,
      offBonus, situMod,
      attackValue,
      defenseValue: targetDefense,
      hit, damage,
      patzer: false,
      critical: roll.critical,
      weaponDamage: weapon.system.damage ?? 0,
    }),
    flags: { "aborea-v7": { attackResult: { hit, damage, targetActorId: targetActor?.id ?? null } } }
  });
}

function _sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

function _buildAttackCard({
  attacker, target, targetActorId,
  weapon, rollFormula, rollTotal, offBonus, situMod,
  attackValue, defenseValue, hit, damage, patzer, critical, weaponDamage = 0
}) {
  const resultClass = patzer ? "patzer" : (hit ? "hit" : "miss");
  const resultLabel = patzer
    ? "⛔ Patzer — automatischer Fehlschlag"
    : (hit ? "✅ Treffer" : "❌ Kein Treffer");

  const modRow = situMod !== 0
    ? `<div class="ac-row"><span>Situationsmod.</span><span>${_sign(-situMod)}</span></div>`
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
    <div class="ac-header">
      <span class="ac-attacker">⚔ ${attacker}</span>
      ${target ? `<span class="ac-arrow">→</span><span class="ac-target">${target}</span>` : ""}
    </div>
    <div class="ac-body">
      <div class="ac-row"><span>Waffe</span><span>${weapon}</span></div>
      <div class="ac-row"><span>Würfelwurf</span><span>${rollFormula}${patzer ? " (Patzer!)" : ""}</span></div>
      <div class="ac-row"><span>Offensivbonus</span><span>${_sign(offBonus)}</span></div>
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

export function applyDamage(targetActorId, damage) {
  const actor = game.actors.get(targetActorId);
  if (!actor) { ui.notifications.warn("ABOREA: Ziel nicht gefunden."); return; }
  const hp = actor.system.resources?.hp ?? {};
  const current = Number(hp.value ?? 0);
  const newHp = Math.max(0, current - damage);
  actor.update({ "system.resources.hp.value": newHp });
  ChatMessage.create({
    speaker: { alias: "System" },
    content: `<div class="aborea-chat-card">
      <p>💢 <strong>${actor.name}</strong>: ${current} → ${newHp} HP (−${damage})</p>
      ${newHp === 0 ? `<p class="ac-note critical">☠ ${actor.name} ist bewusstlos oder tot!</p>` : ""}
    </div>`
  });
}

// ══════════════════════════════════════════════════════════════════
//  Hooks
// ══════════════════════════════════════════════════════════════════

export function registerCombatHooks() {
  // "Apply Damage" button in chat cards
  // Foundry v13: html is a plain HTMLElement
  Hooks.on("renderChatMessage", (_message, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root) return;
    root.querySelectorAll(".apply-damage-btn").forEach(btn => {
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
  });

  // Add "Attack" button to active combatant row in Combat Tracker
  // Foundry v13: hook passes a plain HTMLElement, not a jQuery object
  Hooks.on("renderCombatTracker", (_tracker, html) => {
    const combat = game.combat;
    if (!combat) return;
    const activeCombatant = combat.combatants.get(combat.current?.combatantId);
    if (!activeCombatant) return;

    const isOwner = activeCombatant.actor?.isOwner ?? false;
    if (!isOwner && !game.user.isGM) return;

    const root = html instanceof HTMLElement ? html : html[0];
    if (!root) return;
    const li = root.querySelector(`.combatant[data-combatant-id="${activeCombatant.id}"]`);
    if (!li) return;
    const controls = li.querySelector(".combatant-controls");
    if (!controls) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "combat-attack-btn";
    btn.title = "Angreifen";
    btn.textContent = "⚔";
    btn.addEventListener("click", () => {
      const actor = activeCombatant.actor;
      if (actor) openAttackDialog(actor);
    });
    controls.prepend(btn);
  });
}
