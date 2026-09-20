// module/scene-controls.mjs — Werkzeuggruppen in der Szenenleiste
//
// Foundry hat die Form zwischen den Versionen geändert:
//
//   v12  getSceneControlButtons    → Array von Gruppen, tools als Array
//   v13  getSceneControlButtonsV2  → Objekt nach Gruppennamen, tools ebenso
//
// Die drei Registrierungen im System prüften alle nur auf Array und liefen
// unter v13 deshalb ins Leere — die Gruppen erschienen schlicht nicht. Der
// Kommentar in audio-manager.mjs behauptete das Gegenteil, war aber eine
// Annahme, keine Feststellung.
//
// Die Umformung steht hier als reine Funktion, damit beide Formen prüfbar
// sind, ohne Foundry zu starten.

/**
 * Bringt eine Gruppenbeschreibung in die Form, die Foundry erwartet.
 *
 * @param {object} spec  {name, title, icon, layer, tools:[{name,title,icon,onClick}]}
 * @param {"array"|"record"} shape
 */
export function normalizeControlGroup(spec, shape = "array") {
  const tools = (spec.tools ?? []).map((t, i) => ({
    name:   t.name,
    title:  t.title,
    icon:   t.icon,
    button: t.button ?? true,
    order:  t.order ?? i,
    // v13 ruft onChange, v12 onClick — beide setzen, damit es in jeder
    // Version dieselbe Funktion trifft.
    onClick:  t.onClick ?? t.onChange,
    onChange: t.onChange ?? t.onClick,
  }));

  const group = {
    name:       spec.name,
    title:      spec.title,
    icon:       spec.icon,
    layer:      spec.layer,
    activeTool: spec.activeTool ?? tools[0]?.name,
    order:      spec.order,
  };

  return shape === "record"
    ? { ...group, tools: Object.fromEntries(tools.map(t => [t.name, t])) }
    : { ...group, tools };
}

/**
 * Hängt eine Gruppe in die übergebene Steuerungsstruktur — egal welcher Form.
 * Gibt zurück, ob sie ergänzt wurde; eine bereits vorhandene Gruppe bleibt
 * unangetastet, damit ein doppelt feuernder Hook nichts verdoppelt.
 */
export function addControlGroup(controls, spec) {
  if (Array.isArray(controls)) {
    if (controls.some(c => c?.name === spec.name)) return false;
    controls.push(normalizeControlGroup(spec, "array"));
    return true;
  }
  if (!controls || typeof controls !== "object") return false;
  if (controls[spec.name]) return false;
  controls[spec.name] = normalizeControlGroup(spec, "record");
  return true;
}

/**
 * Registriert eine Werkzeuggruppe für beide Foundry-Versionen.
 * Nur für Spielleiter sichtbar.
 */
export function registerSceneControlGroup(spec) {
  const add = controls => {
    if (!game.user?.isGM) return;
    addControlGroup(controls, spec);
  };
  Hooks.on("getSceneControlButtonsV2", add);
  Hooks.on("getSceneControlButtons",   add);
}
