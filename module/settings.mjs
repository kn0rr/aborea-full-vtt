// module/settings.mjs — Weltoptionen des Spielleiters
//
// Die Entscheidungen, die an diesen Optionen hängen, stehen hier als reine
// Funktionen: welcher Schaden automatisch angewendet wird, wie ein
// Situationsmodifikator geklemmt wird, was ein Rückgängig-Schritt umfasst.

export const SETTINGS = {
  situMod:        "globalSituMod",
  situModReset:   "situModResetPerRound",
  damageApply:    "damageApplication",
  autoInitiative: "autoRollInitiative",
};

/** Flag-Schlüssel für den persönlichen Situationsmodifikator. */
export const SITU_FLAG = "situMod";

/** Grenzen des Situationsmodifikators — darüber hinaus wird geklemmt. */
export const SITU_MIN = -10;
export const SITU_MAX = 10;

/**
 * Wiederkehrende Erschwernisse und Erleichterungen. Als Knöpfe im Tracker,
 * damit der Spielleiter nicht jedes Mal eine Zahl tippt.
 */
export const SITU_PRESETS = [
  { key: "deckung",     label: "Deckung",    value: -2, title: "Das Ziel steht in Deckung" },
  { key: "flanke",      label: "Flanke",     value: +2, title: "Angriff aus der Flanke oder dem Rücken" },
  { key: "dunkelheit",  label: "Dunkelheit", value: -4, title: "Schlechte Sicht" },
  { key: "erhoeht",     label: "Erhöht",     value: +1, title: "Angriff von erhöhter Position" },
];

/** Hält einen Situationsmodifikator in den erlaubten Grenzen. */
export function clampSituMod(value) {
  return Math.max(SITU_MIN, Math.min(SITU_MAX, Number(value) || 0));
}

/**
 * Wird Schaden automatisch angewendet?
 *
 * "off"  — nie, es bleibt beim Knopf auf der Karte
 * "gm"   — bei Würfen des Spielleiters; die anderen bekommen den Knopf,
 *          den der Spielleiter dann drückt
 * "auto" — immer
 *
 * Vorher war das nicht einstellbar, sondern zufällig verschieden: Waffen
 * brauchten einen Knopfdruck, Zauber wendeten sofort an.
 */
export function shouldAutoApplyDamage(mode, { isGM = false } = {}) {
  if (mode === "auto") return true;
  if (mode === "gm")   return !!isGM;
  return false;
}

/**
 * Soll der Situationsmodifikator zurückgesetzt werden?
 * Nur bei einem echten Rundenwechsel — ein Zugwechsel innerhalb der Runde
 * darf ihn nicht wegräumen.
 */
export function shouldResetSituMod(enabled, { previousRound, currentRound } = {}) {
  if (!enabled) return false;
  return Number(currentRound) > Number(previousRound ?? 0);
}

/**
 * Der Situationsmodifikator, der für einen Kombattanten gilt.
 *
 * Der globale Wert ist die Grundlage für alle — Dunkelheit, Sturm, was die
 * ganze Szene betrifft. Der persönliche kommt hinzu: erhöhte Position,
 * Flankenangriff, was nur diesen einen betrifft. Additiv statt ersetzend,
 * damit der Spielleiter nicht bei jedem Einzelnen den globalen Wert
 * nachtragen muss.
 */
export function effectiveSituMod(globalMod, combatantMod) {
  return clampSituMod((Number(globalMod) || 0) + (Number(combatantMod) || 0));
}

/**
 * Ein Rückgängig-Eintrag: was vor der Handlung galt und was danach angelegt
 * wurde. Vorher war nur der HP-Wert erfasst, MP-Abzug und angelegte Effekte
 * blieben Handarbeit.
 */
export function buildUndoRecord(entries = []) {
  const clean = entries
    .filter(e => e?.actorId)
    .map(e => ({
      actorId:  e.actorId,
      name:     e.name ?? "",
      ...(e.hp      != null ? { hp: Number(e.hp) } : {}),
      ...(e.mp      != null ? { mp: Number(e.mp) } : {}),
      ...(e.effectIds?.length ? { effectIds: [...e.effectIds] } : {}),
    }))
    .filter(e => "hp" in e || "mp" in e || "effectIds" in e);
  return clean.length ? { entries: clean } : null;
}

/** Was ein Rückgängig-Schritt zurückdrehen würde, als Text für den Knopf. */
export function describeUndo(record) {
  if (!record?.entries?.length) return "";
  const parts = [];
  const hp = record.entries.filter(e => "hp" in e).length;
  const mp = record.entries.filter(e => "mp" in e).length;
  const fx = record.entries.reduce((s, e) => s + (e.effectIds?.length ?? 0), 0);
  if (hp) parts.push(`${hp}× HP`);
  if (mp) parts.push(`${mp}× MP`);
  if (fx) parts.push(`${fx} Effekt${fx === 1 ? "" : "e"}`);
  return parts.join(", ");
}
