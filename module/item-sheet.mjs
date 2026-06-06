
export class AboreaItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["aborea", "sheet", "item"],
    position: { width: 620, height: 480 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false }
  };
  static PARTS = { main: { template: "systems/aborea-v7/templates/item/item-sheet.html" } };

  async _prepareContext(options = {}) {
    const context = await super._prepareContext(options);
    const item = this.item;
    context.item = item;
    context.system = item.system;
    context.cssClass = this.isEditable ? "editable" : "locked";

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

  // statusEffects: Komma-String → Array (ersetzt _updateObject)
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;
    if (this.item.type === "magic") {
      const input = this.element.querySelector('[data-status-effects]');
      if (input) {
        input.addEventListener("change", async ev => {
          const val = ev.currentTarget.value;
          await this.item.update({
            "system.statusEffects": val.split(",").map(s => s.trim()).filter(Boolean)
          });
        });
      }
    }
  }
}
