// module/loot.mjs — Beute-Container: was hineinkommt, wer es nimmt, wer es ausführt
//
// Die drei Aktionen (ein Gegenstand, alles, nur Geld) standen vorher dreimal
// da: im Beute-Sheet für Besitzer, im Socket-Handler für Spieler — und dort
// die Münzrechnung noch einmal doppelt. Jetzt führt performLootAction() sie
// für beide Wege aus, und was rechnet oder auswählt, steht in reinen
// Funktionen darüber.

import { normalizeWallet, makeHistoryEntry, logListPush, itemHistoryLabel } from "./actor-helpers.mjs";

export const LOOT_SOCKET = "system.aborea-v7";

/**
 * Was ein Beute-Container zeigt und hergibt.
 *
 * Ein NSC trägt auch Volk, Beruf, Fertigkeiten, Zauber und Wunder als Items.
 * "Als Beute ablegen" hat sie mitkopiert; das Beute-Sheet zeigt sie nicht an,
 * "Alles nehmen" hat sie aber dem Charakter gegeben — Fertigkeiten und
 * Zauber eines erschlagenen Gegners im eigenen Bogen.
 */
export const LOOT_TYPES = Object.freeze(["weapon", "armor", "gear", "magic"]);

export const COIN_KEYS = Object.freeze(["gf", "tt", "kl", "mu"]);

export function isLootable(item) {
  return LOOT_TYPES.includes(item?.type);
}

/** Nimmt jede Sammlung mit Iterator (Array, Foundrys Collection). */
export function lootableItems(items) {
  return [...(items ?? [])].filter(isLootable);
}

/** Eine Münzmenge, die bewegt werden darf: endlich und größer als 0. */
function coinAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function hasCoins(wallet) {
  return COIN_KEYS.some(k => coinAmount(wallet?.[k]) > 0);
}

/**
 * Überträgt die Münzen eines Containers in eine Charakter-Börse.
 *
 * Bewegt wird nur, was positiv und endlich ist: ein negativer Eintrag im
 * Container hätte dem Charakter sonst Geld abgezogen, ein NaN die Börse
 * zerstört. Was nicht bewegt wurde, bleibt im Container stehen.
 *
 * @param {object} charWallet  Börse des Charakters (beliebige Form, wird normalisiert)
 * @param {object} lootWallet  {gf, tt, kl, mu} des Containers
 * @returns {{wallet: object, remaining: object, moved: object}}
 */
export function transferCoins(charWallet, lootWallet, { source = "", scene = "" } = {}) {
  const wallet    = normalizeWallet(charWallet);
  const remaining = { ...(lootWallet ?? {}) };
  const moved     = {};
  for (const key of COIN_KEYS) {
    const amount = coinAmount(lootWallet?.[key]);
    if (!amount) continue;
    const cur = wallet.currencies.find(c => String(c.key) === key);
    if (!cur) continue;
    cur.amount = (Number(cur.amount) || 0) + amount;
    moved[key] = amount;
    remaining[key] = 0;
    wallet.history = logListPush(wallet.history,
      makeHistoryEntry("wallet", "add", cur.label, { amount, currency: cur.label, note: `aus ${source}`, scene }));
  }
  return { wallet, remaining, moved };
}

/**
 * Welcher Spielleiter führt die Anfrage eines Spielers aus?
 *
 * Genau einer, und auf jedem Client derselbe — sonst wird ein Gegenstand
 * doppelt übergeben. Deshalb nach ID sortiert statt nach der Reihenfolge der
 * Sammlung.
 */
export function responsibleGM(users) {
  const gms = [...(users ?? [])].filter(u => u?.isGM && u?.active);
  gms.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return gms[0] ?? null;
}

/**
 * Wer bekommt die Beute?
 *
 * Der zugewiesene Charakter des Benutzers. Hat ein Spieler keinen
 * zugewiesen, aber genau einen eigenen Charakter, dann dieser — vorher
 * fehlten ihm dann schlicht alle "Nehmen"-Knöpfe, ohne Hinweis.
 *
 * @param {object|null} assigned  game.user.character
 * @param {Array} owned           Charaktere, die der Benutzer besitzt
 */
export function lootRecipient(assigned, owned = []) {
  if (assigned) return assigned;
  const chars = [...(owned ?? [])].filter(a => a?.type === "character");
  return chars.length === 1 ? chars[0] : null;
}

/**
 * Adresse eines Containers, die auch ein unverknüpftes Token trifft.
 *
 * Ein Token ohne Actor-Verknüpfung hat seinen eigenen Actor; dessen `id` ist
 * die des Basis-Actors. Mit der ID allein hat der Spielleiter im Basis-Actor
 * gesucht und gelöscht, während der Spieler den Token-Actor vor sich hatte.
 */
export function lootTargetRef(actor) {
  const token = actor?.isToken ? actor.token : null;
  return {
    lootActorId: actor?.id ?? null,
    sceneId:     token?.parent?.id ?? null,
    tokenId:     token?.id ?? null,
  };
}

/**
 * Führt Aufgaben strikt nacheinander aus.
 *
 * Zwei Spieler, die gleichzeitig "Alles nehmen" drücken, hätten beim
 * Spielleiter zwei Handler verzahnt laufen lassen: beide lesen denselben
 * Inhalt, bevor einer löscht — und jeder bekommt alles.
 * Ein Fehler in einer Aufgabe hält die nächste nicht auf.
 */
export function serialQueue() {
  let tail = Promise.resolve();
  return fn => {
    const run = tail.then(() => fn());
    tail = run.catch(() => {});
    return run;
  };
}

// ══════════════════════════════════════════════════════════════════
//  Foundry-Seite
// ══════════════════════════════════════════════════════════════════

/** Container aus einer Adresse von lootTargetRef() auflösen. */
export function resolveLootActor(ref) {
  if (ref?.sceneId && ref?.tokenId) {
    const tokenActor = game.scenes?.get(ref.sceneId)?.tokens?.get(ref.tokenId)?.actor;
    if (tokenActor) return tokenActor;
  }
  return game.actors?.get(ref?.lootActorId) ?? null;
}

async function logItems(character, items, source) {
  if (character.type !== "character" || !items.length) return;
  const scene = game.scenes?.active?.name ?? "";
  const current = Array.isArray(character.system.inventoryHistory)
    ? foundry.utils.deepClone(character.system.inventoryHistory) : [];
  const updated = items.reduce((list, i) => logListPush(list,
    makeHistoryEntry("inventory", "item-add", itemHistoryLabel(i), { itemType: i.type, note: `aus ${source}`, scene })), current);
  await character.update({ "system.inventoryHistory": updated });
}

async function moveItems(lootActor, character, items) {
  if (!items.length) return;
  const objs = items.map(i => { const o = i.toObject(); delete o._id; return o; });
  // Erst beim Charakter anlegen, dann im Container löschen: scheitert das
  // Anlegen, bleibt die Beute liegen, statt zu verschwinden.
  const created = await character.createEmbeddedDocuments("Item", objs);
  if (!created?.length) return;
  await lootActor.deleteEmbeddedDocuments("Item", items.map(i => i.id));
  await logItems(character, items, lootActor.name);
}

async function moveCoins(lootActor, character) {
  if (!hasCoins(lootActor.system.wallet)) return;
  const { wallet, remaining } = transferCoins(character.system.wallet, lootActor.system.wallet,
    { source: lootActor.name, scene: game.scenes?.active?.name ?? "" });
  await character.update({ "system.wallet": wallet });
  await lootActor.update({ "system.wallet": remaining });
}

/**
 * Eine Beute-Aktion ausführen — für den Besitzer direkt, für Spieler beim
 * Spielleiter. Beide Wege laufen hier durch.
 *
 * @param {"takeItem"|"takeAll"|"takeMoney"} action
 */
export async function performLootAction(lootActor, character, action, itemId = null) {
  if (!lootActor || lootActor.type !== "loot" || !character) return;
  if (lootActor.system.locked) return;
  if (action === "takeItem") {
    const item = lootActor.items.get(itemId);
    if (item && isLootable(item)) await moveItems(lootActor, character, [item]);
  } else if (action === "takeAll") {
    await moveItems(lootActor, character, lootableItems(lootActor.items));
    await moveCoins(lootActor, character);
  } else if (action === "takeMoney") {
    await moveCoins(lootActor, character);
  }
}

const lootQueue = serialQueue();

/** Socket-Handler: nur der zuständige Spielleiter führt aus, und nacheinander. */
export function handleLootSocket(data) {
  if (data?.type !== "lootRequest") return;
  if (!game.user.isGM) return;
  if (responsibleGM(game.users)?.id !== game.user.id) return;
  return lootQueue(async () => {
    const lootActor = resolveLootActor(data);
    const character = game.actors.get(data.characterId);
    if (!lootActor || !character) return;
    // Nur für einen Charakter, den der anfragende Spieler auch besitzt.
    const requester = game.users.get(data.userId);
    if (!requester || !character.testUserPermission(requester, "OWNER")) return;
    await performLootAction(lootActor, character, data.action, data.itemId);
  }).catch(err => console.error("ABOREA | Beute-Anfrage fehlgeschlagen", err));
}

/**
 * Beute-Aktion aus dem Sheet heraus: direkt, wenn der Benutzer beide Actors
 * besitzt, sonst als Anfrage an den Spielleiter.
 *
 * @returns {boolean} ob die Aktion ausgeführt oder übergeben wurde
 */
export async function requestLootAction(lootActor, character, action, itemId = null) {
  if (lootActor.isOwner && character.isOwner) {
    await lootQueue(() => performLootAction(lootActor, character, action, itemId));
    return true;
  }
  if (!responsibleGM(game.users)) {
    ui.notifications.warn("ABOREA: Kein Spielleiter online — Beute kann nur mit Spielleiter übergeben werden.");
    return false;
  }
  game.socket.emit(LOOT_SOCKET, {
    type: "lootRequest", action, itemId,
    characterId: character.id, userId: game.user.id,
    ...lootTargetRef(lootActor),
  });
  return true;
}
