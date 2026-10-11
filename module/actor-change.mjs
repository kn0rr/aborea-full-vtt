// module/actor-change.mjs — Änderungen an fremden Akteuren über den Spielleiter
//
// Spieler konnten bestimmte Kreaturen nicht angreifen: der Angriff verbraucht
// den Defensivbonus des Verteidigers und schrieb das direkt an dessen Akteur.
// Der gehört dem Spieler nicht, Foundry lehnte ab, und der Angriff brach vor
// dem Wurf ab. Dasselbe Muster steckte im automatischen Schaden, in Zaubern
// auf fremde Ziele (Beistand auf einen Mitspieler, Fluch auf eine Kreatur)
// und im Knopf "anwenden" für vertrauenswürdige Spieler.
//
// Jetzt gibt es einen Weg: changeActor(). Gehört der Akteur dem Benutzer,
// schreibt er selbst. Sonst fragt er den aktiven Spielleiter, und dessen
// Client schreibt — über Foundrys Benutzeranfragen (User#query und
// CONFIG.queries, v13.351). Ist kein Spielleiter da, gibt es eine klare
// Meldung statt eines abgebrochenen Angriffs.
//
// Die Anfrage trägt keinen Absender (der Handler bekommt nur die Daten).
// Deshalb kennt sie nur drei eng umrissene Änderungen, und jede wird auf dem
// Client des Spielleiters noch einmal geprüft: Lebenspunkte um einen Betrag
// verschieben, die Rundenerklärung setzen, Effekte anlegen.

import { applyEffectsToActor } from "./actor-helpers.mjs";

export const ACTOR_CHANGE_QUERY = "aborea-v7.actorChange";
const SYSTEM_ID = "aborea-v7";

/** Flags, die über die Anfrage gesetzt werden dürfen. */
export const CHANGEABLE_FLAGS = new Set(["declaration"]);

/** Höchstens so viele Effekte auf einmal — ein Zauber legt wenige an. */
const MAX_EFFECTS = 20;

// ══════════════════════════════════════════════════════════════════
//  Reine Rechnungen
// ══════════════════════════════════════════════════════════════════

/**
 * Wer schreibt?
 *  - "direct": der Benutzer selbst — der Akteur gehört ihm, oder er leitet
 *  - "gm":     der aktive Spielleiter, auf Anfrage
 *  - "none":   niemand — kein Spielleiter online
 */
export function changeRoute({ isOwner = false, isGM = false, gmActive = false } = {}) {
  if (isOwner || isGM) return "direct";
  return gmActive ? "gm" : "none";
}

const isPlainObject = v => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v, max = 2000) => String(v ?? "").slice(0, max);

/** Ein Effekt in genau der Form, die applyEffectsToActor liest — nichts sonst. */
function cleanEffect(e) {
  if (!isPlainObject(e) || !e.name) throw new Error("Effekt ohne Namen.");
  const changes = Array.isArray(e.changes) ? e.changes : [];
  return {
    name:        str(e.name, 200),
    icon:        e.icon ? str(e.icon, 500) : undefined,
    statuses:    Array.isArray(e.statuses) ? e.statuses.map(s => str(s, 100)) : [],
    duration:    isPlainObject(e.duration) ? Object.fromEntries(Object.entries(e.duration)
                   .filter(([, v]) => v === null || Number.isFinite(Number(v)))
                   .map(([k, v]) => [str(k, 50), v === null ? null : Number(v)])) : {},
    origin:      e.origin ? str(e.origin, 500) : undefined,
    description: str(e.description),
    changes:     changes.slice(0, 50).map(c => ({
      key:   str(c?.key, 200),
      mode:  Number.isFinite(Number(c?.mode)) ? Number(c.mode) : 2,
      value: typeof c?.value === "number" ? c.value : str(c?.value, 200),
    })).filter(c => c.key),
  };
}

/**
 * Prüft eine Änderung und bringt sie in feste Form. Wirft bei allem, was
 * nicht zu den drei erlaubten Arten passt.
 *
 *   {type: "hpDelta", delta}         Lebenspunkte verschieben (Schaden negativ)
 *   {type: "flag", key, value}       eine erlaubte Flag setzen
 *   {type: "effects", effects: [..]} Effekte anlegen (gleichnamige ersetzen)
 */
export function validateChange(op) {
  if (!isPlainObject(op)) throw new Error("Ungültige Änderung.");
  switch (op.type) {
    case "hpDelta": {
      const delta = Number(op.delta);
      if (!Number.isFinite(delta)) throw new Error("Lebenspunkte: kein gültiger Betrag.");
      return { type: "hpDelta", delta: Math.round(delta) };
    }
    case "flag": {
      if (!CHANGEABLE_FLAGS.has(op.key)) throw new Error(`Flag "${op.key}" darf so nicht gesetzt werden.`);
      if (!isPlainObject(op.value)) throw new Error("Flag ohne gültigen Wert.");
      return { type: "flag", key: op.key, value: JSON.parse(JSON.stringify(op.value)) };
    }
    case "effects": {
      if (!Array.isArray(op.effects) || !op.effects.length) throw new Error("Keine Effekte.");
      if (op.effects.length > MAX_EFFECTS) throw new Error("Zu viele Effekte auf einmal.");
      return { type: "effects", effects: op.effects.map(cleanEffect) };
    }
    default:
      throw new Error(`Unbekannte Änderung "${op.type}".`);
  }
}

/**
 * Neue Lebenspunkte nach einer Verschiebung: Schaden nie unter 0, Heilung nie
 * über das Maximum. Ein Wert, der schon darüber liegt, wird durch Schaden
 * nicht aufs Maximum gekürzt.
 */
export function shiftedHp(current, max, delta) {
  const cur = Number(current) || 0;
  const top = Number.isFinite(Number(max)) ? Number(max) : cur;
  const d   = Number(delta) || 0;
  if (d >= 0) return Math.max(cur, Math.min(top, cur + d));
  return Math.max(0, cur + d);
}

// ══════════════════════════════════════════════════════════════════
//  Foundry-Anbindung
// ══════════════════════════════════════════════════════════════════

/** Führt eine geprüfte Änderung aus. Rückgabe ist JSON — sie geht über die Leitung. */
async function applyActorChange(actor, change) {
  switch (change.type) {
    case "hpDelta": {
      const hp = actor.system.resources?.hp ?? {};
      const before = Number(hp.value ?? 0);
      const after  = shiftedHp(before, hp.max, change.delta);
      if (after !== before) await actor.update({ "system.resources.hp.value": after });
      return { before, after };
    }
    case "flag":
      await actor.setFlag(SYSTEM_ID, change.key, change.value);
      return {};
    case "effects": {
      const created = await applyEffectsToActor(actor, change.effects);
      return { effectIds: (created ?? []).map(e => e.id) };
    }
  }
  return {};
}

/**
 * Ändert einen Akteur — selbst, wenn er einem gehört, sonst über den
 * Spielleiter. Wirft mit verständlicher Meldung, wenn beides nicht geht.
 */
export async function changeActor(actor, op) {
  if (!actor) throw new Error("ABOREA: Ziel nicht gefunden.");
  const change = validateChange(op);
  const gm = game.users.activeGM;
  const route = changeRoute({ isOwner: actor.isOwner, isGM: game.user.isGM, gmActive: !!gm });
  if (route === "direct") return applyActorChange(actor, change);
  if (route === "gm") return gm.query(ACTOR_CHANGE_QUERY, { uuid: actor.uuid, change }, { timeout: 15000 });
  throw new Error(`ABOREA: ${actor.name} gehört dir nicht, und kein Spielleiter ist online, der die Änderung übernimmt.`);
}

/** Wie changeActor, meldet einen Fehler aber nur, statt den Ablauf abzubrechen. */
export async function tryChangeActor(actor, op, fallback = null) {
  try {
    return await changeActor(actor, op);
  } catch (err) {
    console.warn("ABOREA | Änderung an fremdem Akteur", err);
    ui.notifications?.warn(err.message);
    return fallback;
  }
}

/** Der Spielleiter nimmt Anfragen an. Bei init registrieren. */
export function registerActorChangeQuery() {
  CONFIG.queries[ACTOR_CHANGE_QUERY] = async ({ uuid, change } = {}) => {
    if (!game.user.isGM) throw new Error("Nur der Spielleiter führt fremde Änderungen aus.");
    const actor = await fromUuid(String(uuid ?? ""));
    if (!(actor instanceof Actor)) throw new Error("Akteur nicht gefunden.");
    return applyActorChange(actor, validateChange(change));
  };
}
