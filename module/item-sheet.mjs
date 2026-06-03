
export class AboreaItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aborea", "sheet", "item"],
      width: 620,
      height: 480,
      resizable: true
    });
  }

  get template() { return "systems/aborea-v7/templates/item/item-sheet.html"; }

  async getData(options = {}) {
    const context = await super.getData(options);
    const item = context.item;
    context.system = item.system;

    // Beschreibungstext als Rich-HTML aufbereiten
    if (item.system.description) {
      context.enrichedDescription = await TextEditor.enrichHTML(
        item.system.description,
        { async: true, relativeTo: item }
      );
    }

    // Attribut-Auswahl für Waffen als lokalisierte Liste
    if (item.type === "weapon") {
      context.attributeChoices = { st: "ST", ge: "GE", ko: "KO", in: "IN", ch: "CH" };
    }

    return context;
  }
}
