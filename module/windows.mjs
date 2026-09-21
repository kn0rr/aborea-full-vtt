// module/windows.mjs — Fenster, die es nur einmal geben darf
//
// Soundboard und Kreaturenauswahl gingen bei jedem Klick erneut auf: ein
// zweites Dialogfenster über dem ersten, mit eigenen Ereignisbindungen und
// eigener Update-Schleife. Die Ursache war doppelt — die Werkzeugleiste löst
// den Knopf mehrfach aus (siehe scene-controls.mjs), und `new Dialog(...)`
// hat sich nicht dafür interessiert, ob schon eins offen war.
//
// Gegen den zweiten Teil hilft diese Registratur: ein Schlüssel, ein Fenster.
// Damit ist es gleichgültig, wie oft der Knopf feuert.

/** Eigene Registratur — ui.windows ist die V1-Liste und bleibt bei V2 leer. */
const REGISTRY = new Map();

/**
 * Zustand eines Eintrags.
 *
 * "pending" ist der Fall, den ein einfacher `rendered`-Test nicht abdeckt:
 * das Soundboard lädt erst Gruppen und Voreinstellungen und legt das Fenster
 * danach an. Zwischen Klick und Fenster liegen also zwei await — ein zweiter
 * Klick in dieser Zeit sähe kein offenes Fenster und würde ein weiteres
 * aufziehen. Deshalb wird die Kennung schon vor dem Laden belegt.
 *
 * `rendered` tragen beide Generationen: die alte Application ebenso wie
 * ApplicationV2. Ein geschlossenes Fenster bleibt als Objekt bestehen, meldet
 * aber `rendered: false` und gibt die Kennung damit wieder frei.
 */
export function windowState(entry) {
  if (entry?.pending)       return "pending";
  if (entry?.app?.rendered) return "open";
  return "free";
}

/** Holt ein Fenster nach vorn — V2 kennt bringToFront, V1 bringToTop. */
export function focusWindow(app) {
  if (!app) return false;
  app.bringToFront?.();
  app.bringToTop?.();
  return true;
}

/**
 * Öffnet ein Fenster höchstens einmal.
 *
 * Ist es bereits offen oder gerade im Aufbau, wird es nur nach vorn geholt
 * und `created: false` gemeldet — der Aufrufer weiß damit, dass er keine
 * zweite Auswertung anstoßen soll (der Kreaturen-Dialog etwa gäbe sonst ein
 * Versprechen zurück, das nie eingelöst wird).
 *
 * @param {string}   key       Kennung des Fensters
 * @param {Function} factory   legt es an und gibt es zurück; darf asynchron
 *                             sein. Wichtig: das Fenster zurückgeben, nicht
 *                             das Ergebnis von render() — das ist ein
 *                             Versprechen und trägt kein `rendered`.
 * @param {Map}      registry  für Tests austauschbar
 * @returns {Promise<{app: any, created: boolean}>}
 */
export async function openOnce(key, factory, registry = REGISTRY) {
  const entry = registry.get(key);
  if (windowState(entry) !== "free") {
    focusWindow(entry?.app);
    return { app: entry?.app ?? null, created: false };
  }

  registry.set(key, { app: null, pending: true });
  try {
    const app = await factory();
    if (app) registry.set(key, { app, pending: false });
    else     registry.delete(key);
    return { app: app ?? null, created: true };
  } catch (err) {
    registry.delete(key);
    throw err;
  }
}

/** Vergisst ein Fenster — nach dem Schließen, damit nichts hängen bleibt. */
export function forgetWindow(key, registry = REGISTRY) {
  return registry.delete(key);
}
