
export class AboreaItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aborea", "sheet", "item"],
      width: 620,
      height: 620,
      resizable: true
    });
  }

  get template() { return "systems/aborea-v7/templates/item/item-sheet.html"; }

  async getData(options = {}) {
    const context = await super.getData(options);
    context.system = context.item.system;
    return context;
  }
}
