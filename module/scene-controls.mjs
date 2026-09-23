// module/scene-controls.mjs — eigene Werkzeuggruppen in der Szenenleiste
//
// Alles hier steht so, weil es in client/applications/ui/scene-controls.mjs
// der v13.351 nachgelesen ist. Drei Anläufe, drei Lehren:
//
//  1. Form. v12 übergab Arrays, v13 übergibt ein Objekt nach Gruppennamen.
//     Die Registrierungen prüften nur auf Array und erschienen unter v13 gar
//     nicht.
//
//  2. Mehrfaches Feuern. #onChange() ruft erst onChange und danach — mit
//     Abwärtskompatibilitätswarnung — auch onClick; wer beide setzt, wird
//     doppelt gerufen. #postActivate() ruft beim Aktivieren einer Gruppe
//     deren activeTool auf, #preActivate() beim Verlassen das bisherige mit
//     active = false. Ein Handler, der das Argument ignoriert, öffnet sein
//     Fenster also auch beim Weggehen: "ich klicke das eine an und beide
//     gehen auf".
//
//  3. Sichtbarkeit. _prepareContext() rendert `this.tools`, und das ist
//     `this.control?.tools` — nur die Werkzeuge der *aktiven* Gruppe. Der
//     Versuch, unsere Knöpfe in Foundrys Token-Gruppe zu hängen, machte sie
//     damit unsichtbar, sobald man den Reiter wechselt.
//
// Eine eigene Gruppe braucht deshalb dreierlei:
//
//   • mindestens ein Werkzeug — eine leere Gruppe wird gelöscht
//     (isEmpty(control.tools) → delete),
//   • ein activeTool, das auf ein *vorhandenes* Werkzeug zeigt: beim
//     Verlassen liest Foundry `this.tool` und reicht das Ergebnis ungeprüft
//     an #onChange() weiter — bei undefined gäbe es dort einen Fehler,
//   • und dass dieses activeTool kein Knopf mit Wirkung ist: #onChangeTool()
//     steigt bei `tool === this.tool` vorher aus, der Knopf wäre also tot,
//     und beim Aktivieren der Gruppe würde er ungefragt feuern.
//
// Daher das Ankerwerkzeug: ein Auswählen-Werkzeug ohne Rückmeldung, wie
// Foundrys eigenes "select". Es ist der Ruhezustand der Gruppe, und die
// Gruppe aktiviert beim Öffnen die zugehörige Canvas-Ebene.

/** Wird jeder Gruppe als Ruhezustand vorangestellt. */
export const ANCHOR_SUFFIX = "-select";

/**
 * Das Ankerwerkzeug einer Gruppe.
 *
 * Bewusst ohne Rückmeldung: es soll nichts tun. Foundry braucht es nur als
 * Ziel für activeTool, und sichtbar ist es als das, was es ist — der
 * gewöhnliche Zeiger, solange dieser Reiter offen steht.
 */
export function buildAnchorTool(groupName) {
  return {
    name:   `${groupName}${ANCHOR_SUFFIX}`,
    title:  "Auswählen",
    icon:   "fa-solid fa-expand",
    button: false,
    order:  0,
  };
}

/**
 * Soll dieser Aufruf den Knopf wirklich auslösen?
 *
 * Nur ein Klick auf den Knopf selbst zählt. Foundry gibt dabei das
 * Klickereignis weiter, dessen Ziel `data-tool` trägt — dieselbe Angabe, an
 * der Foundry das Werkzeug selbst erkennt. Beim Aktivieren einer Gruppe käme
 * stattdessen das Ereignis vom Gruppensymbol mit `data-control`.
 *
 * Ohne Ereignis — Foundry legt bei programmatischer Aktivierung ein leeres
 * an — wird ausgeführt: lieber einmal zu viel als ein toter Knopf.
 */
export function isToolInvocation(toolName, event, active) {
  if (active === false) return false;
  const dataset = event?.target?.dataset;
  if (!dataset) return true;
  return dataset.tool === toolName;
}

/**
 * Bringt ein Werkzeug in die Form, die Foundry erwartet.
 *
 * Ein Werkzeug ohne Rückmeldung bekommt auch keine — das ist der Anker.
 *
 * @param {object} spec  {name, title, icon, onClick|onChange, order, button}
 * @param {object} [opts]
 * @param {number} [opts.generation]  game.release.generation
 */
export function normalizeTool(spec, { generation = 13 } = {}) {
  const run  = spec.onChange ?? spec.onClick;
  const tool = {
    name:   spec.name,
    title:  spec.title,
    icon:   spec.icon,
    button: spec.button ?? true,
    order:  spec.order ?? 90,
  };
  if (!run) return tool;

  // Genau eine Rückmeldung setzen — beide heisst unter v13: jeder Anlass
  // ruft den Knopf zweimal.
  if (Number(generation) < 13) {
    tool.onClick = active => { if (isToolInvocation(spec.name, null, active)) run(active); };
  } else {
    tool.onChange = (event, active) => { if (isToolInvocation(spec.name, event, active)) run(event, active); };
  }
  return tool;
}

/**
 * Bringt eine Gruppenbeschreibung in die Form, die Foundry erwartet.
 *
 * @param {object} spec  {name, title, icon, order, activate, tools:[…]}
 * @param {"array"|"record"} shape
 * @param {object} [opts]
 * @param {number} [opts.generation]
 */
export function normalizeControlGroup(spec, shape = "record", opts = {}) {
  const anchor = buildAnchorTool(spec.name);
  const tools  = [anchor, ...(spec.tools ?? [])]
    .filter(t => t?.name)
    .map((t, i) => normalizeTool({ ...t, order: t.order ?? i }, opts));

  const group = {
    name:       spec.name,
    title:      spec.title,
    icon:       spec.icon,
    order:      spec.order ?? 80,
    activeTool: anchor.name,
    // Eine Gruppe ohne onChange lässt die Leinwand auf der zuletzt aktiven
    // Ebene stehen. `layer` liest v13 nicht mehr — das war in den früheren
    // Fassungen wirkungslos.
    onChange: (event, active) => { if (active) spec.activate?.(); },
  };

  return shape === "array"
    ? { ...group, tools }
    : { ...group, tools: Object.fromEntries(tools.map(t => [t.name, t])) };
}

/**
 * Hängt eine Gruppe in die übergebene Steuerungsstruktur — in beiden Formen,
 * die Foundry kennt. Gibt zurück, ob sie ergänzt wurde; eine bereits
 * vorhandene bleibt unangetastet, damit ein doppelt feuernder Hook nichts
 * verdoppelt.
 */
export function addControlGroup(controls, spec, opts = {}) {
  if (!spec?.name) return false;
  if (Array.isArray(controls)) {
    if (controls.some(c => c?.name === spec.name)) return false;
    controls.push(normalizeControlGroup(spec, "array", opts));
    return true;
  }
  if (!controls || typeof controls !== "object") return false;
  if (controls[spec.name]) return false;
  controls[spec.name] = normalizeControlGroup(spec, "record", opts);
  return true;
}

/**
 * Registriert eine Werkzeuggruppe. Nur für Spielleiter.
 *
 * Es gibt nur einen Hook: v13.351 ruft `getSceneControlButtons` — der Name
 * blieb, die Struktur wurde zum Objekt. Ein `getSceneControlButtonsV2`
 * existiert dort nicht.
 */
export function registerSceneControlGroup(spec) {
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;
    addControlGroup(controls, spec, { generation: game.release?.generation ?? 13 });
  });
}
