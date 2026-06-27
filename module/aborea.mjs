
import { ABOREA } from "./config.mjs";
import { AboreaActorSheet, AboreaCharacterSheet, AboreaNpcSheet, AboreaCreatureSheet, AboreaLootSheet } from "./actor-sheet.mjs";
import { AboreaItemSheet } from "./item-sheet.mjs";
import { importSingleAboreaPack, listAboreaWorldPacks, resetAboreaWorldPacks } from "./compendium-importer.mjs";
import { buildSystemPacks, resetSystemPacks } from "./system-pack-builder.mjs";
import { AboreaSoundboard } from "./audio-manager.mjs";
import { AboreaCombat, openAttackDialog, openSpellAttackDialog, registerCombatHooks } from "./combat.mjs";
import { registerConditions, registerConditionHooks } from "./conditions.mjs";
import { openCheckDialog, openGroupCheckDialog, registerCheckHooks } from "./checks.mjs";
import { registerQuickNpcSceneControl } from "./quick-npc.mjs";
import { normalizeWallet, makeHistoryEntry, logListPush, itemHistoryLabel } from "./actor-helpers.mjs";
import {
  CharacterDataModel, NpcDataModel, CreatureDataModel, LootDataModel,
  RaceDataModel, ClassDataModel, SkillDataModel,
  WeaponDataModel, ArmorDataModel, SpellDataModel,
  MiracleDataModel, GearDataModel, GodDataModel,
  MagicItemDataModel
} from "./data-models.mjs";

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

  const unlockSystemPacks = async () => {
    const packs = game.packs.filter(p => p.metadata.packageName === "aborea-v7" && p.locked);
    for (const p of packs) await p.configure({ locked: false });
    if (packs.length) console.log(`ABOREA | ${packs.length} Pack(s) entsperrt.`);
    return packs.length;
  };

  registerConditions();

  game.aborea = {
    config: ABOREA,
    importPack: importSingleAboreaPack,
    listWorldPacks: listAboreaWorldPacks,
    resetWorldPacks: resetAboreaWorldPacks,
    buildSystemPacks,
    resetSystemPacks,
    unlockPacks: unlockSystemPacks,
    cleanupExpiredSummons,
    audio: AboreaSoundboard,
    openSoundboard: () => AboreaSoundboard.openDialog(),
    attack:      openAttackDialog,
    check:       openCheckDialog,
    groupCheck:  openGroupCheckDialog,
  };
  CONFIG.ABOREA = ABOREA;

  // Register TypeDataModels (replaces template.json)
  CONFIG.Actor.dataModels = {
    character: CharacterDataModel,
    npc:       NpcDataModel,
    creature:  CreatureDataModel,
    loot:      LootDataModel,
  };
  CONFIG.Item.dataModels = {
    race:    RaceDataModel,
    class:   ClassDataModel,
    skill:   SkillDataModel,
    weapon:  WeaponDataModel,
    armor:   ArmorDataModel,
    spell:   SpellDataModel,
    miracle: MiracleDataModel,
    gear:    GearDataModel,
    god:     GodDataModel,
    magic:   MagicItemDataModel
  };

  CONFIG.Combat.documentClass = AboreaCombat;
  CONFIG.Combat.initiative = { formula: "1d10", decimals: 0 };
  AboreaSoundboard.registerSettings();
  AboreaSoundboard.registerSceneControl();
  registerCombatHooks();
  registerConditionHooks();
  registerCheckHooks();
  registerQuickNpcSceneControl();

  foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  foundry.documents.collections.Actors.registerSheet("aborea-v7", AboreaCharacterSheet, { types: ["character"], makeDefault: true, label: "ABOREA.CharacterSheet" });
  foundry.documents.collections.Actors.registerSheet("aborea-v7", AboreaNpcSheet, { types: ["npc"], makeDefault: true, label: "ABOREA.NpcSheet" });
  foundry.documents.collections.Actors.registerSheet("aborea-v7", AboreaCreatureSheet, { types: ["creature"], makeDefault: true, label: "ABOREA.CreatureSheet" });
  foundry.documents.collections.Actors.registerSheet("aborea-v7", AboreaLootSheet,    { types: ["loot"],     makeDefault: true, label: "ABOREA.LootSheet" });

  foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
  foundry.documents.collections.Items.registerSheet("aborea-v7", AboreaItemSheet, { makeDefault: true });

  await foundry.applications.handlebars.loadTemplates([
    "systems/aborea-v7/templates/actor/partials/inventory.html",
    "systems/aborea-v7/templates/actor/partials/conditions.html",
    "systems/aborea-v7/templates/item/partials/description-editor.html",
    "systems/aborea-v7/templates/combat/check-dialog.html",
    "systems/aborea-v7/templates/audio/soundboard.html",
    "systems/aborea-v7/templates/combat/attack-dialog.html",
    "systems/aborea-v7/templates/combat/spell-attack-dialog.html",
    "systems/aborea-v7/templates/actor/loot-sheet.html",
    "systems/aborea-v7/templates/loot/item-picker.html",
  ]);

  Handlebars.registerHelper("aboreaEq",  function (a, b)   { return a === b; });
  Handlebars.registerHelper("aboreaGt",  function (a, b)   { return Number(a) > Number(b); });
  Handlebars.registerHelper("aboreaJoin",function (arr, sep) { return Array.isArray(arr) ? arr.join(sep || ", ") : ""; });
  Handlebars.registerHelper("aboreaHas", function (arr, val) { return Array.isArray(arr) && arr.includes(val); });
  Handlebars.registerHelper("array",     function (...args)  { return args.slice(0, -1); });
});

Hooks.once("diceSoNiceReady", function (dice3d) {
  console.log("ABOREA V7 | Dice So Nice erkannt");
  game.aborea.dice3d = dice3d;
});

// ── Loot-Socket: Spieler-Anfragen via GM ausführen ─────────────────
const SOCKET_NAME = "system.aborea-v7";

async function _handleLootSocket(data) {
  if (data.type !== "lootRequest") return;
  if (!game.user.isGM) return;
  // Nur der erste aktive GM verarbeitet die Anfrage
  const activeGM = game.users.find(u => u.isGM && u.active);
  if (!activeGM || activeGM.id !== game.user.id) return;

  const lootActor = game.actors.get(data.lootActorId);
  if (!lootActor || lootActor.type !== "loot") return;
  if (lootActor.system.locked) return;

  const character = game.actors.get(data.characterId);
  if (!character) return;

  const scene  = game.scenes?.active?.name ?? "";
  const source = lootActor.name;

  if (data.action === "takeItem") {
    const item = lootActor.items.get(data.itemId);
    if (!item) return;
    const obj = item.toObject(); delete obj._id;
    await character.createEmbeddedDocuments("Item", [obj]);
    await lootActor.deleteEmbeddedDocuments("Item", [data.itemId]);
    // Inventar-Historie
    const current = Array.isArray(character.system.inventoryHistory)
      ? foundry.utils.deepClone(character.system.inventoryHistory) : [];
    const entry = makeHistoryEntry("inventory", "item-add", itemHistoryLabel(item),
      { itemType: item.type, note: `aus ${source}`, scene });
    await character.update({ "system.inventoryHistory": logListPush(current, entry) });

  } else if (data.action === "takeAll") {
    const items = [...lootActor.items];
    if (items.length) {
      const objs = items.map(i => { const o = i.toObject(); delete o._id; return o; });
      await character.createEmbeddedDocuments("Item", objs);
      await lootActor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
      const current = Array.isArray(character.system.inventoryHistory)
        ? foundry.utils.deepClone(character.system.inventoryHistory) : [];
      const entries = items.map(i =>
        makeHistoryEntry("inventory", "item-add", itemHistoryLabel(i),
          { itemType: i.type, note: `aus ${source}`, scene })
      );
      const updated = entries.reduce((list, e) => logListPush(list, e), current);
      await character.update({ "system.inventoryHistory": updated });
    }
    // Münzen
    const w = lootActor.system.wallet ?? {};
    const hasCoins = ["gf","tt","kl","mu"].some(k => Number(w[k] ?? 0) > 0);
    if (hasCoins) {
      const charWallet = normalizeWallet(character.system.wallet);
      for (const key of ["gf","tt","kl","mu"]) {
        const amount = Number(w[key] ?? 0);
        if (!amount) continue;
        const cur = charWallet.currencies.find(c => c.key === key);
        if (!cur) continue;
        cur.amount = (Number(cur.amount) || 0) + amount;
        charWallet.history = logListPush(charWallet.history,
          makeHistoryEntry("wallet", "add", cur.label,
            { amount, currency: cur.label, note: `aus ${source}`, scene }));
      }
      await character.update({ "system.wallet": charWallet });
      await lootActor.update({ "system.wallet": { gf: 0, tt: 0, kl: 0, mu: 0 } });
    }

  } else if (data.action === "takeMoney") {
    const w = lootActor.system.wallet ?? {};
    const hasCoins = ["gf","tt","kl","mu"].some(k => Number(w[k] ?? 0) > 0);
    if (!hasCoins) return;
    const charWallet = normalizeWallet(character.system.wallet);
    for (const key of ["gf","tt","kl","mu"]) {
      const amount = Number(w[key] ?? 0);
      if (!amount) continue;
      const cur = charWallet.currencies.find(c => c.key === key);
      if (!cur) continue;
      cur.amount = (Number(cur.amount) || 0) + amount;
      charWallet.history = logListPush(charWallet.history,
        makeHistoryEntry("wallet", "add", cur.label,
          { amount, currency: cur.label, note: `aus ${source}`, scene }));
    }
    await character.update({ "system.wallet": charWallet });
    await lootActor.update({ "system.wallet": { gf: 0, tt: 0, kl: 0, mu: 0 } });
  }
}

Hooks.once("ready", async function () {
  console.log("ABOREA V7 | Bereit");

  // Socket für Loot-Anfragen registrieren (alle Clients)
  game.socket.on(SOCKET_NAME, data => _handleLootSocket(data));

  if (game.user.isGM) {
    // Migration: "Münzen unbekannt" → "Muena" in bestehenden Charakteren
    for (const actor of game.actors.filter(a => a.type === "character")) {
      const currencies = actor.system?.wallet?.currencies;
      if (!Array.isArray(currencies)) continue;
      const muEntry = currencies.find(c => c.key === "mu");
      if (muEntry && muEntry.name !== "Muena") {
        const updated = currencies.map(c => c.key === "mu" ? { ...c, name: "Muena" } : c);
        await actor.update({ "system.wallet.currencies": updated });
      }
    }

    // System-Packs automatisch entsperren damit Inhalte direkt bearbeitbar sind
    await game.aborea.unlockPacks();

    const emptySystemPacks = game.packs.filter(p => p.metadata.packageName === "aborea-v7" && p.index.size === 0);
    if (emptySystemPacks.length) {
      ui.notifications.warn("ABOREA: Die System-Packs sind noch leer. Führe game.aborea.buildSystemPacks() als GM aus.");
    }
    setInterval(() => cleanupExpiredSummons().catch(err => console.error("ABOREA summon cleanup failed", err)), 30000);

    // Begleiter-Status abgleichen: Tokens könnten nach Neustart fehlen
    for (const actor of game.actors.filter(a => a.type === "character")) {
      const list = actor.system?.companions?.list ?? [];
      if (!list.length) continue;
      const updated = list.map(c => {
        if (c.status !== "summoned") return c;
        const hasToken = game.scenes.some(s => s.tokens.some(t => t.actorId === c.actorId));
        return hasToken ? c : { ...c, status: "available" };
      });
      if (updated.some((c, i) => c.status !== list[i].status)) {
        await actor.update({ "system.companions.list": updated });
      }
    }
  }
});

// ── Reisegefährt: Loot-Actor löschen wenn Fahrzeug-Item vom Charakter entfernt wird ──
Hooks.on("deleteItem", async (item, _options, userId) => {
  if (userId !== game.user.id) return;
  if (item.parent?.type !== "character") return;
  if (item.type !== "gear" || item.system.category !== "reisegefaehrt") return;
  const actorId = item.system.vehicleActorId;
  if (!actorId) return;
  const lootActor = game.actors.get(actorId);
  if (lootActor) await lootActor.delete();
});

// Statuseffekte aus magischen Items anwenden / entfernen wenn equipped-Status wechselt
Hooks.on("updateItem", async (item, changes) => {
  if (item.type !== "magic") return;
  if (!foundry.utils.hasProperty(changes, "system.equipped")) return;
  const statuses = item.system?.statusEffects ?? [];
  if (!statuses.length) return;
  const actor = item.parent;
  if (!actor) return;
  if (changes.system.equipped) {
    const docs = statuses.map(status => ({
      name: `${item.name} (${status})`,
      statuses: [status],
      origin: item.uuid,
      disabled: false,
      duration: {}
    }));
    await actor.createEmbeddedDocuments("ActiveEffect", docs);
  } else {
    const toDelete = actor.effects
      .filter(e => e.origin === item.uuid)
      .map(e => e.id);
    if (toDelete.length) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
  }
});

// ── Handout: Journal-Eintrag an Spieler senden ──────────────────
Hooks.on("getJournalEntryContextOptions", (html, options) => {
  if (!game.user.isGM) return;
  options.push({
    name:      "📤 An Spieler senden",
    icon:      '<i class="fas fa-share-alt"></i>',
    condition: () => game.user.isGM,
    callback:  li => {
      const entryId = li.dataset?.entryId ?? li.dataset?.documentId ?? li[0]?.dataset?.entryId;
      const entry = game.journal.get(entryId);
      if (!entry) { ui.notifications.warn("Journal-Eintrag nicht gefunden."); return; }
      entry.show("text", true);
      ui.notifications.info(`"${entry.name}" wird allen Spielern gezeigt.`);
    }
  });
});

Hooks.on("updateActor", function (actor, changes) {
  if (actor.type !== "character") return;
  const xpChanged = foundry.utils.hasProperty(changes, "system.resources.xp");
  if (!xpChanged) return;
  const xp = Number(actor.system?.resources?.xp ?? 0);
  const currentLevel = Number(actor.system?.resources?.level ?? 1);
  const targetLevel  = ABOREA.levelForXp(xp);
  if (targetLevel > currentLevel) {
    if (!actor.isOwner) return;
    ui.notifications.info(
      `🎉 ${actor.name}: Genug EP für Stufe ${targetLevel}! Öffne den Charakterbogen und klicke „Stufe aufsteigen".`,
      { permanent: false }
    );
  }
});
