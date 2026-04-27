
import { ABOREA } from "./config.mjs";
import { AboreaActorSheet, AboreaCharacterSheet, AboreaNpcSheet, AboreaCreatureSheet } from "./actor-sheet.mjs";
import { AboreaItemSheet } from "./item-sheet.mjs";
import { importAboreaPackSources, importSingleAboreaPack, listAboreaWorldPacks, resetAboreaWorldPacks } from "./compendium-importer.mjs";
import { buildSystemPacks, resetSystemPacks } from "./system-pack-builder.mjs";
import { AboreaSoundboard } from "./audio-manager.mjs";
import { rollInitiative } from "./dice.mjs";

class AboreaCombat extends Combat {
  async rollInitiative(ids, { updateTurn = true, messageOptions = {} } = {}) {
    const combatantIds = typeof ids === "string" ? [ids] : ids;
    const updates = [];
    for (const id of combatantIds) {
      const combatant = this.combatants.get(id);
      if (!combatant) continue;
      const actor = combatant.actor;
      const total = actor ? await rollInitiative(actor) : await (new Roll("1d10")).evaluate().then(r => r.total);
      updates.push({ _id: id, initiative: total });
    }
    if (updates.length) await this.updateEmbeddedDocuments("Combatant", updates);
    if (updateTurn && this.started) await this.update({ turn: 0 });
    return this;
  }
}

async function cleanupExpiredSummons() {
  if (!game.user?.isGM) return [];
  const now = Date.now();
  const expired = game.actors.filter(a => a.type === "creature" && a.system?.summon?.active && a.system?.summon?.expiresAt && Number(a.system.summon.expiresAt) <= now);
  for (const actor of expired) {
    for (const scene of game.scenes) {
      const ids = scene.tokens.filter(t => t.actorId === actor.id).map(t => t.id);
      if (ids.length) await scene.deleteEmbeddedDocuments("Token", ids);
    }
    const ownerId = actor.system?.summon?.ownerActorId || actor.flags?.aborea?.ownerActorId;
    const owner = ownerId ? game.actors.get(ownerId) : null;
    if (owner) {
      const list = (owner.system?.companions?.list || []).filter(c => c.actorId !== actor.id);
      await owner.update({ "system.companions.list": list });
    }
    await actor.delete();
  }
  return expired.map(a => a.name);
}

Hooks.once("init", async function () {
  console.log("ABOREA V7 | Initialisiere System");

  game.aborea = {
    config: ABOREA,
    importPackSources: importAboreaPackSources,
    importPack: importSingleAboreaPack,
    listWorldPacks: listAboreaWorldPacks,
    resetWorldPacks: resetAboreaWorldPacks,
    buildSystemPacks,
    resetSystemPacks,
    cleanupExpiredSummons,
    audio: AboreaSoundboard,
    openSoundboard: () => AboreaSoundboard.openDialog()
  };
  CONFIG.ABOREA = ABOREA;
  CONFIG.Combat.documentClass = AboreaCombat;
  CONFIG.Combat.initiative = { formula: "1d10", decimals: 0 };
  AboreaSoundboard.registerSettings();
  AboreaSoundboard.registerSceneControl();

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("aborea-v7", AboreaCharacterSheet, { types: ["character"], makeDefault: true, label: "ABOREA.CharacterSheet" });
  Actors.registerSheet("aborea-v7", AboreaNpcSheet, { types: ["npc"], makeDefault: true, label: "ABOREA.NpcSheet" });
  Actors.registerSheet("aborea-v7", AboreaCreatureSheet, { types: ["creature"], makeDefault: true, label: "ABOREA.CreatureSheet" });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("aborea-v7", AboreaItemSheet, { makeDefault: true });

  await loadTemplates([
    "systems/aborea-v7/templates/actor/partials/inventory.html",
    "systems/aborea-v7/templates/audio/soundboard.html"
  ]);

  Handlebars.registerHelper("aboreaEq",  function (a, b)   { return a === b; });
  Handlebars.registerHelper("aboreaJoin",function (arr, sep) { return Array.isArray(arr) ? arr.join(sep || ", ") : ""; });
  Handlebars.registerHelper("aboreaHas", function (arr, val) { return Array.isArray(arr) && arr.includes(val); });
  Handlebars.registerHelper("array",     function (...args)  { return args.slice(0, -1); });
  Handlebars.registerHelper("aboreaJoin", function (arr, sep = ", ") { return Array.isArray(arr) ? arr.join(sep) : ""; });
  Handlebars.registerHelper("aboreaHas", function (arr, value) { return Array.isArray(arr) && arr.includes(value); });
});

Hooks.once("diceSoNiceReady", function (dice3d) {
  console.log("ABOREA V7 | Dice So Nice erkannt");
  game.aborea.dice3d = dice3d;
});

Hooks.once("ready", async function () {
  console.log("ABOREA V7 | Bereit");
  if (game.user.isGM) {
    const emptySystemPacks = game.packs.filter(p => p.metadata.packageName === "aborea-v7" && p.index.size === 0);
    if (emptySystemPacks.length) {
      ui.notifications.warn("ABOREA: Die System-Packs sind noch leer. Entsperre die Packs und führe game.aborea.buildSystemPacks() als GM aus.");
    }
    setInterval(() => cleanupExpiredSummons().catch(err => console.error("ABOREA summon cleanup failed", err)), 30000);
  }
});

/**
 * XP-Hook: Wenn ein Spielercharakter EP erhält und dadurch
 * einen Stufenschwellenwert überschreitet, wird der Spieler benachrichtigt.
 * Der tatsächliche Stufenaufstieg muss manuell per Button bestätigt werden.
 */
Hooks.on("updateActor", function (actor, changes) {
  if (actor.type !== "character") return;
  const xpChanged = foundry.utils.hasProperty(changes, "system.resources.xp");
  if (!xpChanged) return;
  const xp = Number(actor.system?.resources?.xp ?? 0);
  const currentLevel = Number(actor.system?.resources?.level ?? 1);
  const targetLevel  = ABOREA.levelForXp(xp);
  if (targetLevel > currentLevel) {
    // Nur dem besitzenden Spieler oder dem GM anzeigen
    if (!actor.isOwner) return;
    ui.notifications.info(
      `🎉 ${actor.name}: Genug EP für Stufe ${targetLevel}! Öffne den Charakterbogen und klicke „Stufe aufsteigen".`,
      { permanent: false }
    );
  }
});

