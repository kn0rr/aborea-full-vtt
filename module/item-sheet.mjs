
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

    // Beschreibungstext als Rich-HTML aufbereiten (für alle Item-Typen)
    if (item.system.description && context.canViewDescription) {
      context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description,
        { async: true, relativeTo: item }
      );
    } else {
      context.enrichedDescription = "";
    }

    // Attribut-Auswahl für Waffen als lokalisierte Liste
    if (item.type === "weapon") {
      context.attributeChoices = { st: "ST", ge: "GE", ko: "KO", in: "IN", ch: "CH" };
    }

    return context;
  }

  async _mountDescriptionEditor() {
    const mount = this.element.querySelector(".description-prose-mount");
    if (!mount || !game.user.isGM || !this.isEditable) return;

    // Alten Editor aufräumen
    if (this._proseMirrorEditor) {
      this._proseMirrorEditor.destroy?.();
      this._proseMirrorEditor = null;
    }
    mount.innerHTML = "";

    const content = this.item.system.description ?? "";
    try {
      this._proseMirrorEditor = await foundry.prosemirror.ProseMirrorEditor.create(mount, content, {
        document: this.item,
        fieldName: "system.description",
        collaborate: false,
        plugins: {
          ...foundry.prosemirror.defaultPlugins,
          menu: foundry.prosemirror.ProseMirrorMenu.build(foundry.prosemirror.defaultSchema, {
            compact: false,
            destroyOnSave: false,
            onSave: () => this._proseMirrorEditor?.save(),
          }),
        },
      });
    } catch(e) {
      console.error("ABOREA | ProseMirror init failed:", e);
    }
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

    // ProseMirror-Editor mounten
    this._mountDescriptionEditor();

    // Portrait (data-edit): normaler Klick = Bild vergrößern, Shift+Klick = FilePicker (nur editierbar)
    this.element.querySelectorAll("img[data-edit]").forEach(img => {
      img.style.cursor = "zoom-in";
      img.addEventListener("click", (ev) => {
        if (ev.shiftKey) {
          if (!this.isEditable) return;
          new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            current: this.document.img,
            callback: path => this.document.update({ img: path }),
          }).render(true);
        } else {
          if (!img.src) return;
          new foundry.applications.apps.ImagePopout({ src: img.src, window: { title: this.document.name || "" } }).render(true);
        }
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
