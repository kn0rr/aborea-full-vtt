
export class AboreaItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["aborea", "sheet", "item"],
    position: { width: 620, height: 480 },
    window: { resizable: true },
    // Kein submitOnChange: der Voll-Formular-Submit würde bei jeder Änderung
    // auch system.description mitschicken — mit leerem Editor-Wert bei offenem/
    // frischem ProseMirror wird der gespeicherte Text sonst überschrieben.
    // Updates laufen gezielt pro Feld über den change-Handler in _onRender.
    form: { submitOnChange: false, closeOnSubmit: false }
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
    context.descriptionField = item.system.schema.fields.description;

    // Beschreibungstext als Rich-HTML für Spieler-Ansicht aufbereiten
    if (!context.isGM && item.system.description && context.canViewDescription) {
      context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        item.system.description,
        { async: true, relativeTo: item }
      );
    } else {
      context.enrichedDescription = "";
    }

    // Attribut- und Fertigkeitsauswahl für Waffen
    if (item.type === "weapon") {
      // attrChoices (Regelwerk) schränkt ein, welche Attribute die Waffe erlaubt
      const allAttrs = { st: "ST", ge: "GE", ko: "KO", in: "IN", ch: "CH" };
      const allowed  = item.system.attrChoices;
      context.attributeChoices = (Array.isArray(allowed) && allowed.length)
        ? Object.fromEntries(Object.entries(allAttrs).filter(([k]) => allowed.includes(k)))
        : allAttrs;
      const { ABOREA } = await import("./config.mjs");
      context.weaponSkillChoices = Object.fromEntries(
        ABOREA.weaponSkillKeys.map(k => [k, game.i18n.localize(ABOREA.skills[k]?.label ?? k)])
      );
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
    // Waffenfertigkeits-Checkboxen
    if (this.item.type === "weapon") {
      this.element.querySelectorAll(".weapon-skill-cb").forEach(cb => {
        cb.addEventListener("change", async () => {
          const checked = [...this.element.querySelectorAll(".weapon-skill-cb:checked")]
            .map(el => el.dataset.skill);
          await this.document.update({ "system.skills": checked });
        });
      });
    }
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
