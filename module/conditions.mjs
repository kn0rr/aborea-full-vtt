// module/conditions.mjs — ABOREA Kampfzustände

// Fallback-Mapping auf Foundry-eigene Status-IDs: Icons werden zur Laufzeit
// aus CONFIG.statusEffects übernommen, damit immer gültige Pfade verwendet werden.
const _BUILTIN_MAP = {
  "aborea-stunned":   ["stun", "unconscious"],
  "aborea-bleeding":  ["bleeding"],
  "aborea-poisoned":  ["poisoned"],
  "aborea-exhausted": ["exhaustion", "unconscious"],
  "aborea-slowed":    ["restrained", "paralysis"],
  "aborea-blinded":   ["blinded"],
};

export const ABOREA_CONDITIONS = [
  { id: "aborea-stunned",   name: "Betäubt",     description: "Kann nicht angreifen. −4 auf alle Würfe." },
  { id: "aborea-bleeding",  name: "Blutend",     description: "Verliert 1 HP zu Beginn des eigenen Zuges." },
  { id: "aborea-poisoned",  name: "Vergiftet",   description: "−2 auf Angriff und Fertigkeitsproben." },
  { id: "aborea-exhausted", name: "Erschöpft",   description: "−2 auf alle körperlichen Würfe." },
  { id: "aborea-slowed",    name: "Verlangsamt", description: "Initiative −3, kann nur eine Aktion ausführen." },
  { id: "aborea-blinded",   name: "Geblendet",   description: "−4 auf Angriff, kein Fernkampf." },
];

/**
 * Registriert ABOREA-Zustände im Token-HUD (CONFIG.statusEffects).
 * Icon-Pfade werden aus Foundrys eingebauten Status-Effekten übernommen —
 * so funktionieren sie in jeder Foundry-Version ohne hartcodierte Pfade.
 */
export function registerConditions() {
  const builtIn = new Map(
    (CONFIG.statusEffects ?? []).map(e => [e.id, e.img ?? e.icon ?? ""])
  );

  for (const cond of [...ABOREA_CONDITIONS].reverse()) {
    const candidates = _BUILTIN_MAP[cond.id] ?? [];
    const img = candidates.map(id => builtIn.get(id)).find(p => p) ?? "";
    // img bleibt leer wenn nichts gefunden — Foundry zeigt dann kein Icon, aber kein 404
    CONFIG.statusEffects.unshift({ id: cond.id, name: cond.name, img });
    // img auch auf dem ABOREA_CONDITIONS-Objekt speichern (für Sheet-Badges)
    cond.img = img;
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
