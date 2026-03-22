import { ABOREA } from "./config.mjs";
import { AboreaActorSheet } from "./actor-sheet.mjs";
import { AboreaItemSheet } from "./item-sheet.mjs";

Hooks.once("init", async function () {
  console.log("ABOREA V7 | Initialisiere System");

  game.aborea = {
    config: ABOREA
  };

  CONFIG.ABOREA = ABOREA;

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("aborea-v7", AboreaActorSheet, { makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("aborea-v7", AboreaItemSheet, { makeDefault: true });

  Handlebars.registerHelper("aboreaEq", function (a, b) {
    return a === b;
  });

  Handlebars.registerHelper("aboreaLabel", function (key) {
    return game.i18n.localize(key);
  });
});

Hooks.once("ready", async function () {
  console.log("ABOREA V7 | Bereit");
});
