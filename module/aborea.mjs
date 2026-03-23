
import { ABOREA } from "./config.mjs";
import { AboreaActorSheet, AboreaCharacterSheet, AboreaNpcSheet, AboreaCreatureSheet } from "./actor-sheet.mjs";
import { AboreaItemSheet } from "./item-sheet.mjs";

Hooks.once("init", async function () {
  console.log("ABOREA V7 | Initialisiere System");

  game.aborea = { config: ABOREA };
  CONFIG.ABOREA = ABOREA;

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("aborea-v7", AboreaCharacterSheet, { types: ["character"], makeDefault: true, label: "ABOREA.CharacterSheet" });
  Actors.registerSheet("aborea-v7", AboreaNpcSheet, { types: ["npc"], makeDefault: true, label: "ABOREA.NpcSheet" });
  Actors.registerSheet("aborea-v7", AboreaCreatureSheet, { types: ["creature"], makeDefault: true, label: "ABOREA.CreatureSheet" });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("aborea-v7", AboreaItemSheet, { makeDefault: true });

  Handlebars.registerHelper("aboreaEq", function (a, b) { return a === b; });
  Handlebars.registerHelper("aboreaJoin", function (arr, sep = ", ") { return Array.isArray(arr) ? arr.join(sep) : ""; });
  Handlebars.registerHelper("aboreaHas", function (arr, value) { return Array.isArray(arr) && arr.includes(value); });
});

Hooks.once("ready", async function () {
  console.log("ABOREA V7 | Bereit");
});
