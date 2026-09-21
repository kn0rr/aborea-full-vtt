// module/scene-controls.mjs — eigene Werkzeuge in der Szenenleiste
//
// Zwei Anläufe, zwei Fehler. Der erste: die Registrierungen prüften nur auf
// ein Array und erschienen unter v13 gar nicht, weil Foundry dort ein Objekt
// übergibt. Der zweite: die Fenster gingen mehrfach auf.
//
// Die Ursachen des zweiten stehen in client/applications/ui/scene-controls.mjs
// der v13.351 und sind dort nachgelesen, nicht vermutet:
//
//   1. #onChange() ruft erst onChange und danach — mit
//      Abwärtskompatibilitätswarnung — auch onClick. Wer beide setzt, wird
//      bei jedem Anlass zweimal gerufen. Wir setzen genau eins.
//   2. #postActivate() ruft beim Aktivieren einer Gruppe deren activeTool
//      auf, #preActivate() beim Verlassen das bisherige mit active = false.
//      Eine eigene Gruppe aus lauter Knöpfen muss also einen davon zum
//      activeTool machen — und der feuert dann beim blossen Umschalten mit.
//      Genau das war "ich klicke das eine an und beide gehen auf".
//   3. #onChangeTool() steigt bei `tool === this.tool` vorher aus. Der Knopf,
//      den man zum activeTool gemacht hat, ist damit gleichzeitig tot.
//
// Aus 2 und 3 folgt: eigene Gruppen sind für reine Knöpfe der falsche Ort.
// Die Werkzeuge gehören in die vorhandenen Gruppen ("tokens", "sounds"),
// deren activeTool Foundrys eigenes "select" bleibt. Dann feuert nichts beim
// Umschalten, und jeder Knopf reagiert auf seinen eigenen Klick.

/**
 * Soll dieser Aufruf den Knopf wirklich auslösen?
 *
 * Nur ein Klick auf den Knopf selbst zählt. Foundry gibt dabei das
 * Klickereignis weiter, dessen Ziel `data-tool` trägt — dieselbe Angabe, an
 * der Foundry das Werkzeug selbst erkennt. Beim Aktivieren einer Gruppe
 * käme stattdessen das Ereignis vom Gruppensymbol mit `data-control`.
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
 * @param {object} spec  {name, title, icon, onClick|onChange, order}
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
  // Genau eine Rückmeldung setzen — beide heisst unter v13: jeder Anlass
  // ruft den Knopf zweimal.
  if (Number(generation) < 13) {
    tool.onClick = active => { if (isToolInvocation(spec.name, null, active)) run?.(active); };
  } else {
    tool.onChange = (event, active) => { if (isToolInvocation(spec.name, event, active)) run?.(event, active); };
  }
  return tool;
}

/** Findet eine Werkzeuggruppe — in beiden Formen, die Foundry kennt. */
export function findControlGroup(controls, groupName) {
  if (Array.isArray(controls)) return controls.find(c => c?.name === groupName) ?? null;
  if (!controls || typeof controls !== "object") return null;
  return controls[groupName] ?? null;
}

/**
 * Hängt Werkzeuge in eine vorhandene Gruppe.
 *
 * Gibt die Namen der ergänzten Werkzeuge zurück; bereits vorhandene bleiben
 * unangetastet, damit ein doppelt feuernder Hook nichts verdoppelt. Fehlt die
 * Gruppe, wird nichts ergänzt — und der Aufrufer erfährt es an der leeren
 * Liste, statt dass die Werkzeuge stillschweigend verschwinden.
 */
export function addControlTools(controls, groupName, toolSpecs = [], opts = {}) {
  const group = findControlGroup(controls, groupName);
  if (!group) return [];

  const added = [];
  for (const spec of toolSpecs) {
    if (!spec?.name) continue;
    const tool = normalizeTool(spec, opts);
    if (Array.isArray(group.tools)) {
      if (group.tools.some(t => t?.name === spec.name)) continue;
      group.tools.push(tool);
    } else {
      group.tools ??= {};
      if (group.tools[spec.name]) continue;
      group.tools[spec.name] = tool;
    }
    added.push(spec.name);
  }
  return added;
}

/**
 * Registriert Werkzeuge in einer vorhandenen Gruppe der Szenenleiste.
 * Nur für Spielleiter.
 *
 * Es gibt nur einen Hook: v13.351 ruft `getSceneControlButtons` — der Name
 * blieb, die Struktur wurde zum Objekt. Ein `getSceneControlButtonsV2`
 * existiert dort nicht; darauf zu registrieren war eine Annahme und hat nie
 * gefeuert. Das System setzt ohnehin v13 voraus.
 *
 * @param {object} spec  {group, tools:[…]}
 */
export function registerSceneControlTools({ group, tools }) {
  let gemeldet = false;
  const add = controls => {
    if (!game.user?.isGM) return;
    const added = addControlTools(controls, group, tools,
      { generation: game.release?.generation ?? 13 });
    // Nichts ergänzt und die Gruppe gibt es gar nicht: das ist der Fall, der
    // beim ersten Anlauf unbemerkt blieb — die Werkzeuge erschienen einfach
    // nicht. Einmal melden reicht.
    if (!added.length && !findControlGroup(controls, group) && !gemeldet) {
      gemeldet = true;
      console.warn(`ABOREA | Werkzeuggruppe "${group}" nicht gefunden — `
        + `${tools.map(t => t.name).join(", ")} erscheinen nicht.`);
    }
  };
  Hooks.on("getSceneControlButtons", add);
}
