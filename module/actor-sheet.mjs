import { ABOREA } from "./config.mjs";
import { rollAttack, rollInitiative, rollSkill } from "./dice.mjs";

export class AboreaActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aborea", "sheet", "actor"],
      width: 860,
      height: 760,
      resizable: true,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  get template() {
    return "systems/aborea-v7/templates/actor/actor-sheet.html";
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const actor = context.actor;
    const system = foundry.utils.deepClone(actor.system);

    for (const [key, data] of Object.entries(system.attributes ?? {})) {
      data.bonus = ABOREA.attributeBonus(data.value);
      data.label = ABOREA.attributes[key];
    }

    system.skills = system.skills || {};
    for (const [key, cfg] of Object.entries(ABOREA.skills)) {
      const current = system.skills[key] ?? { rank: 0, attribute: cfg.attribute };
      current.key = key;
      current.label = cfg.label;
      current.attribute = current.attribute || cfg.attribute;
      system.skills[key] = current;
    }

    const armorItems = actor.items.filter(i => i.type === "armor" && i.system.equipped);
    const armorBonus = armorItems.reduce((sum, item) => sum + Number(item.system.armor ?? 0), 0);
    system.combat.armorValue = Number(system.combat.armorValue ?? 5) + armorBonus;
    system.combat.defenseValue = ABOREA.defenseValue(system.combat.armorValue, system.combat.defensiveBonus ?? 0);
    system.combat.initiative = ABOREA.initiativeBonus(actor);

    context.system = system;
    context.config = ABOREA;
    context.referenceData = game.aborea?.data ?? {};
    context.selectedRace = system.details?.race ?? "";
    context.selectedClass = system.details?.class ?? "";
    context.itemsByType = {
      races: actor.items.filter(i => i.type === "race"),
      classes: actor.items.filter(i => i.type === "class"),
      weapons: actor.items.filter(i => i.type === "weapon"),
      armors: actor.items.filter(i => i.type === "armor"),
      spells: actor.items.filter(i => i.type === "spell"),
      miracles: actor.items.filter(i => i.type === "miracle"),
      gear: actor.items.filter(i => i.type === "gear"),
      skills: actor.items.filter(i => i.type === "skill")
    };
    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".roll-initiative").on("click", () => rollInitiative(this.actor));
    html.find(".roll-skill").on("click", ev => {
      const key = ev.currentTarget.dataset.skill;
      rollSkill(this.actor, key);
    });
    html.find(".roll-attack").on("click", ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      const weapon = this.actor.items.get(itemId);
      rollAttack(this.actor, weapon, { targetDefense: this.actor.system.combat?.targetDefense ?? 5 });
    });
    html.find(".item-create").on("click", this._onItemCreate.bind(this));
    html.find(".apply-race").on("click", this._onApplyRace.bind(this));
    html.find(".apply-class").on("click", this._onApplyClass.bind(this));
    html.find(".seed-items").on("click", this._onSeedItems.bind(this));
    html.find(".item-edit").on("click", ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) item.sheet.render(true);
    });
    html.find(".item-delete").on("click", async ev => {
      const itemId = ev.currentTarget.closest("[data-item-id]")?.dataset.itemId;
      if (itemId) await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
    });
    html.find(".combat-balance").on("change", async () => {
      const offensive = Number(html.find('[name="system.combat.offensiveBonus"]').val() ?? 0);
      const combatBonus = Number(html.find('[name="system.combat.combatBonus"]').val() ?? 0);
      const defensive = combatBonus - offensive;
      await this.actor.update({
        "system.combat.offensiveBonus": offensive,
        "system.combat.defensiveBonus": defensive
      });
    });
    html.find(".rest-heal").on("click", async () => {
      const conBonus = ABOREA.attributeBonus(this.actor.system.attributes.ko.value);
      const healed = ABOREA.naturalHealingPerDay(conBonus);
      const current = Number(this.actor.system.resources.hp.value ?? 0);
      const max = Number(this.actor.system.resources.hp.max ?? current);
      await this.actor.update({ "system.resources.hp.value": Math.min(max, current + healed) });
      ui.notifications.info(`${this.actor.name}: +${healed} HP`);
    });
    html.find(".rest-mp").on("click", async () => {
      const cls = this.actor.system.details.class ?? "";
      const attrKey = ["priester", "schamane"].includes(String(cls).toLowerCase()) ? "ch" : "in";
      const attrBonus = ABOREA.attributeBonus(this.actor.system.attributes[attrKey].value);
      const regen = ABOREA.mpRegenPerHour(attrBonus);
      const current = Number(this.actor.system.resources.mp.value ?? 0);
      const max = Number(this.actor.system.resources.mp.max ?? current);
      await this.actor.update({ "system.resources.mp.value": Math.min(max, current + regen) });
      ui.notifications.info(`${this.actor.name}: +${regen} MP`);
    });
  }


  async _onApplyRace(event) {
    event.preventDefault();
    const raceName = this.form?.querySelector('[name="system.details.race"]')?.value;
    const race = (game.aborea?.data?.races ?? []).find(r => r.name === raceName);
    if (!race) return ui.notifications.warn("Keine passende Rasse gefunden.");

    const oldRaceItem = this.actor.items.find(i => i.type === "race");
    if (oldRaceItem) {
      const mods = oldRaceItem.system?.mods ?? {};
      const update = {};
      for (const key of ["st", "ge", "ko", "in", "ch"]) {
        const current = Number(this.actor.system.attributes?.[key]?.value ?? 5);
        update[`system.attributes.${key}.value`] = Math.max(1, current - Number(mods[key] ?? 0));
      }
      await this.actor.update(update);
      await this.actor.deleteEmbeddedDocuments("Item", [oldRaceItem.id]);
    }

    const mods = race.system?.mods ?? {};
    const update = {"system.details.race": race.name};
    for (const key of ["st", "ge", "ko", "in", "ch"]) {
      const current = Number(this.actor.system.attributes?.[key]?.value ?? 5);
      update[`system.attributes.${key}.value`] = Math.max(1, current + Number(mods[key] ?? 0));
    }
    await this.actor.update(update);
    await this.actor.createEmbeddedDocuments("Item", [foundry.utils.deepClone(race)]);
    ui.notifications.info(`Rasse ${race.name} auf ${this.actor.name} angewendet.`);
  }

  async _onApplyClass(event) {
    event.preventDefault();
    const className = this.form?.querySelector('[name="system.details.class"]')?.value;
    const cls = (game.aborea?.data?.classes ?? []).find(c => c.name === className);
    if (!cls) return ui.notifications.warn("Kein passender Beruf gefunden.");

    const oldClassItem = this.actor.items.find(i => i.type === "class");
    if (oldClassItem) await this.actor.deleteEmbeddedDocuments("Item", [oldClassItem.id]);

    const koBonus = ABOREA.attributeBonus(this.actor.system.attributes?.ko?.value ?? 5);
    const hpMax = Math.max(1, Number(cls.system?.hitPointsBase ?? 5) + koBonus);
    const magicAttr = String(cls.system?.magicAttribute ?? "").toLowerCase();
    const attrBonus = magicAttr && this.actor.system.attributes?.[magicAttr] ? ABOREA.attributeBonus(this.actor.system.attributes[magicAttr].value) : 0;
    const mpMax = ["in", "ch"].includes(magicAttr) ? Math.max(0, attrBonus + 3) : 0;

    await this.actor.update({
      "system.details.class": cls.name,
      "system.resources.hp.max": hpMax,
      "system.resources.hp.value": Math.min(Number(this.actor.system.resources.hp.value ?? hpMax), hpMax),
      "system.resources.mp.max": mpMax,
      "system.resources.mp.value": Math.min(Number(this.actor.system.resources.mp.value ?? mpMax), mpMax)
    });
    await this.actor.createEmbeddedDocuments("Item", [foundry.utils.deepClone(cls)]);
    ui.notifications.info(`Beruf ${cls.name} auf ${this.actor.name} angewendet.`);
  }

  async _onSeedItems(event) {
    event.preventDefault();
    const existingKeys = new Set(this.actor.items.map(i => `${i.type}::${i.name}`));
    const payload = [];
    for (const [typeKey, targetType] of [["weapons", "weapon"], ["armors", "armor"], ["spells", "spell"], ["miracles", "miracle"]]) {
      for (const entry of (game.aborea?.data?.[typeKey] ?? [])) {
        if (entry.type !== targetType) continue;
        const key = `${entry.type}::${entry.name}`;
        if (!existingKeys.has(key)) payload.push(foundry.utils.deepClone(entry));
      }
    }
    if (!payload.length) return ui.notifications.info("Keine neuen Daten zum Importieren.");
    await this.actor.createEmbeddedDocuments("Item", payload);
    ui.notifications.info(`${payload.length} Einträge auf ${this.actor.name} importiert.`);
  }

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    const name = game.i18n.format("ABOREA.NewItem", { type });
    const itemData = { name, type, system: {} };
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }
}
