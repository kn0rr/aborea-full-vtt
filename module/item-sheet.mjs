export class AboreaItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["aborea", "sheet", "item"],
      width: 560,
      height: 520,
      resizable: true
    });
  }

  get template() {
    return "systems/aborea-v7/templates/item/item-sheet.html";
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    context.system = context.item.system;
    return context;
  }
}
