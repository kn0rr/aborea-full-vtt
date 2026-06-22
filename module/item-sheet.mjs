
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

    context.isGM = game.user.isGM;
    context.canViewDescription = game.user.isGM || !item.system.descriptionLocked;

    // Beschreibungstext als Rich-HTML aufbereiten
    if (item.system.description && context.canViewDescription) {
      context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
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

    if (this._changeHandler) this.element.removeEventListener("change", this._changeHandler);
    this._changeHandler = async (ev) => {
      if (!this.isEditable) return;
      const field = ev.target;
      if (!field?.name) return;
      const n = field.name;
      if (!n.startsWith("system.") && n !== "name" && n !== "img") return;
      if (field.dataset.statusEffects !== undefined) return; // eigener Handler
      if (!field.closest("form")) return;
      const val = field.type === "checkbox" ? field.checked
                : field.type === "number"   ? (Number(field.value) || 0)
                : field.value;
      await this.document.update({ [n]: val });
    };
    this.element.addEventListener("change", this._changeHandler);

    // Bild-Picker: data-edit="img" in ApplicationV2 manuell verdrahten
    this.element.querySelectorAll("img[data-edit]").forEach(img => {
      img.style.cursor = "pointer";
      img.addEventListener("click", () => {
        if (!this.isEditable) return;
        new FilePicker({
          type: "image",
          current: this.document.img,
          callback: path => this.document.update({ img: path }),
        }).render(true);
      });
    });
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
