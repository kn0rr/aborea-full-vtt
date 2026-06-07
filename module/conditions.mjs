// module/conditions.mjs — ABOREA Kampfzustände

export const ABOREA_CONDITIONS = [
  { id: "aborea-stunned",   name: "Betäubt",     img: "icons/svg/stun.svg",        description: "Kann nicht angreifen. −4 auf alle Würfe." },
  { id: "aborea-bleeding",  name: "Blutend",     img: "icons/svg/blood.svg",       description: "Verliert 1 HP zu Beginn des eigenen Zuges." },
  { id: "aborea-poisoned",  name: "Vergiftet",   img: "icons/svg/poison.svg",      description: "−2 auf Angriff und Fertigkeitsproben." },
  { id: "aborea-exhausted", name: "Erschöpft",   img: "icons/svg/unconscious.svg", description: "−2 auf alle körperlichen Würfe." },
  { id: "aborea-slowed",    name: "Verlangsamt", img: "icons/svg/paralysis.svg",   description: "Initiative −3, kann nur eine Aktion ausführen." },
  { id: "aborea-blinded",   name: "Geblendet",   img: "icons/svg/blind.svg",       description: "−4 auf Angriff, kein Fernkampf." },
];

/** Registriert ABOREA-Zustände im Token-HUD (CONFIG.statusEffects). */
export function registerConditions() {
  for (const cond of [...ABOREA_CONDITIONS].reverse()) {
    CONFIG.statusEffects.unshift({ id: cond.id, name: cond.name, img: cond.img });
  }
}

/**
 * Registriert den Blutungs-Hook:
 * Zu Beginn des Zuges eines blutenden Kombattanten → −1 HP, Chat-Meldung.
 */
export function registerConditionHooks() {
  Hooks.on("updateCombat", async (combat, changes) => {
    if (!game.user.isGM) return;
    if (changes.turn === undefined && changes.round === undefined) return;
    if (!combat.started || combat.round < 1) return;

    const combatant = combat.combatant;
    if (!combatant) return;
    const actor = combatant.actor;
    if (!actor) return;

    const isBleeding = Array.from(actor.effects).some(e => e.statuses?.has("aborea-bleeding"));
    if (!isBleeding) return;

    const curHp = Number(actor.system.resources?.hp?.value ?? 0);
    if (curHp <= 0) return;
    const newHp = Math.max(0, curHp - 1);
    await actor.update({ "system.resources.hp.value": newHp });

    ChatMessage.create({
      content: `<div class="aborea-chat-card">
        <p>🩸 <strong>${actor.name}</strong> blutet! −1 HP</p>
        <p>${newHp} / ${actor.system.resources.hp.max} HP verbleibend</p>
      </div>`
    });
  });
}
