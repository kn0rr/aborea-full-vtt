
import { ABOREA } from "./config.mjs";
import { rollAttack, rollInitiative, rollSkill } from "./dice.mjs";

function duplicateItemObject(item) {
  const obj = item.toObject();
  delete obj._id;
  return obj;
}

async function findPackDocumentByTypeAndName(type, name) {
  const matchingPacks = game.packs.filter(p => p.documentName === (type === "creature" ? "Actor" : "Item"));
  for (const pack of matchingPacks) {
    const index = await pack.getIndex({ fields: ["name", "type"] });
    const hit = index.find(e => e.name === name && (type === "creature" || e.type === type));
    if (hit) return pack.getDocument(hit._id);
  }
  return null;
}

export class AboreaActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aborea", "sheet", "actor"],
      width: 900,
      height: 760,
      resizable: true,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  get template() { return "systems/aborea-v7/templates/actor/character-sheet.html"; }

  async getData(options = {}) {
    const context = await super.getData(options);
    const actor = context.actor;
    const system = foundry.utils.deepClone(actor.system);

    for (const [key, data] of Object.entries(system.attributes ?? {})) {
      data.bonus = ABOREA.attributeBonus(data.value);
      data.label = ABOREA.attributes[key];
    }

    if (actor.type === "character") {
      system.skills = system.skills || {};
      for (const [key, cfg] of Object.entries(ABOREA.skills)) {
        const current = system.skills[key] ?? { rank: 0, attribute: cfg.attribute };
        current.key = key;
        current.label = cfg.label;
        current.attribute = current.attribute || cfg.attribute;
        system.skills[key] = current;
      }
    }

    const armorItems = actor.items.filter(i => i.type === "armor" && i.system.equipped);
    const armorBonus = armorItems.reduce((sum, item) => sum + Number(item.system.armor ?? 0) - 5, 0);
    const baseArmorValue = Number(system.combat.armorValue ?? 5);
    system.combat.totalArmorValue = baseArmorValue + armorBonus;
    system.combat.defenseValue = ABOREA.defenseValue(system.combat.totalArmorValue, system.combat.defensiveBonus ?? 0);
    system.combat.initiative = ABOREA.initiativeBonus(actor);

    context.system = system;
    context.config = ABOREA;
    context.itemLists = {
      races: actor.items.filter(i => i.type === "race"),
      classes: actor.items.filter(i => i.type === "class"),
      weapons: actor.items.filter(i => i.type === "weapon"),
      armors: actor.items.filter(i => i.type === "armor"),
      spells: actor.items.filter(i => i.type === "spell"),
      miracles: actor.items.filter(i => i.type === "miracle"),
      gear: actor.items.filter(i => i.type === "gear"),
      skills: actor.items.filter(i => i.type === "skill")
    };
    context.availablePacks = {
      races: await this._packChoices("race"),
      classes: await this._packChoices("class")
    };
    return context;
  }

  async _packChoices(type) {
    const docs = [];
    for (const pack of game.packs.filter(p => p.documentName === "Item")) {
      const index = await pack.getIndex({ fields: ["name", "type"] });
      docs.push(...index.filter(e => e.type === type).map(e => ({ name: e.name })));
    }
    return docs.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".roll-initiative").on("click", () => rollInitiative(this.actor));
    html.find(".roll-skill").on("click", ev => rollSkill(this.actor, ev.currentTarget.dataset.skill));
    html.find(".roll-attack").on("click", ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      const weapon = this.actor.items.get(itemId);
      rollAttack(this.actor, weapon, { targetDefense: this.actor.system.combat?.targetDefense ?? 5 });
    });

    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".item-edit").on("click", ev => this.actor.items.get(ev.currentTarget.closest("[data-item-id]")?.dataset.itemId)?.sheet?.render(true));
    html.find(".item-delete").on("click", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (itemId) await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
    });

    html.find(".combat-balance").on("change", async ev => {
      const offensive = Number(ev.currentTarget.value ?? 0);
      const combatBonus = Number(this.actor.system.combat?.combatBonus ?? 0);
      await this.actor.update({ "system.combat.offensiveBonus": offensive, "system.combat.defensiveBonus": combatBonus - offensive });
    });

    html.find(".rest-heal").on("click", async () => {
      const conBonus = ABOREA.attributeBonus(this.actor.system.attributes.ko.value);
      const healed = Math.max(0, ABOREA.naturalHealingPerDay(conBonus));
      const current = Number(this.actor.system.resources.hp.value ?? 0);
      const max = Number(this.actor.system.resources.hp.max ?? current);
      await this.actor.update({ "system.resources.hp.value": Math.min(max, current + healed) });
      ui.notifications.info(`${this.actor.name}: +${healed} HP`);
    });

    html.find(".rest-mp").on("click", async () => {
      const cls = String(this.actor.system.details.class ?? "").toLowerCase();
      const attrKey = ["priester", "schamane", "barde"].includes(cls) ? "ch" : "in";
      const attrBonus = ABOREA.attributeBonus(this.actor.system.attributes[attrKey].value);
      const regen = Math.max(0, ABOREA.mpRegenPerHour(attrBonus));
      const current = Number(this.actor.system.resources.mp.value ?? 0);
      const max = Number(this.actor.system.resources.mp.max ?? current);
      await this.actor.update({ "system.resources.mp.value": Math.min(max, current + regen) });
      ui.notifications.info(`${this.actor.name}: +${regen} MP`);
    });

    html.find(".apply-race").on("click", async () => {
      const selected = html.find('[name="selectedRace"]').val();
      if (!selected) return;
      const item = await findPackDocumentByTypeAndName("race", selected);
      if (item) await this._applyRace(item);
    });

    html.find(".apply-class").on("click", async () => {
      const selected = html.find('[name="selectedClass"]').val();
      if (!selected) return;
      const item = await findPackDocumentByTypeAndName("class", selected);
      if (item) await this._applyClass(item);
    });
  }

  async _onDropItem(event, data) {
    const item = await Item.implementation.fromDropData(data);
    if (!item) return super._onDropItem(event, data);

    if (item.type === "race") return this._applyRace(item);
    if (item.type === "class") return this._applyClass(item);

    const obj = duplicateItemObject(item);
    return this.actor.createEmbeddedDocuments("Item", [obj]);
  }

  async _applyRace(raceItem) {
    const race = duplicateItemObject(raceItem);
    const existing = this.actor.items.filter(i => i.type === "race");
    if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map(i => i.id));

    const updates = { "system.details.race": race.name };
    for (const [attr, mod] of Object.entries(race.system.mods ?? {})) {
      const current = Number(this.actor.system.attributes?.[attr]?.value ?? 5);
      updates[`system.attributes.${attr}.value`] = Math.max(1, current + Number(mod || 0));
    }
    await this.actor.update(updates);
    await this.actor.createEmbeddedDocuments("Item", [race]);
    ui.notifications.info(`${race.name} auf ${this.actor.name} angewendet.`);
  }

  async _applyClass(classItem) {
    const cls = duplicateItemObject(classItem);
    const existing = this.actor.items.filter(i => i.type === "class");
    if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing.map(i => i.id));

    const hpBase = Number(cls.system.hitPointsBase ?? 5);
    const hpMax = hpBase + ABOREA.attributeBonus(this.actor.system.attributes.ko.value);
    const magicAttribute = cls.system.magicAttribute || "in";
    const mpBase = Math.max(0, ABOREA.attributeBonus(this.actor.system.attributes?.[magicAttribute]?.value ?? 5) + 3);

    await this.actor.update({
      "system.details.class": cls.name,
      "system.resources.hp.max": hpMax,
      "system.resources.hp.value": Math.min(Number(this.actor.system.resources.hp.value ?? hpMax), hpMax),
      "system.resources.mp.max": mpBase,
      "system.resources.mp.value": Math.min(Number(this.actor.system.resources.mp.value ?? mpBase), mpBase)
    });
    await this.actor.createEmbeddedDocuments("Item", [cls]);
    ui.notifications.info(`${cls.name} auf ${this.actor.name} angewendet.`);
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const name = game.i18n.format("ABOREA.NewItem", { type });
    return this.actor.createEmbeddedDocuments("Item", [{ name, type, system: {} }]);
  }
}

export class AboreaCharacterSheet extends AboreaActorSheet {
  get template() { return "systems/aborea-v7/templates/actor/character-sheet.html"; }
}
export class AboreaNpcSheet extends AboreaActorSheet {
  get template() { return "systems/aborea-v7/templates/actor/npc-sheet.html"; }
}
export class AboreaCreatureSheet extends AboreaActorSheet {
  get template() { return "systems/aborea-v7/templates/actor/creature-sheet.html"; }
}
