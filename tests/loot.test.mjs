// tests/loot.test.mjs — Beute-Container
//
// Drei Fehler lagen hier übereinander, und jeder sah von aussen gleich aus:
// "Beute lässt sich nicht nehmen".
//
//   1. system.json meldete keinen Socket-Kanal an. Die Anfrage eines Spielers
//      ohne Besitzrecht am Container kam nie beim Spielleiter an.
//   2. Der Geld-Knopf stand hinter "../canTake" auf oberster Ebene und war
//      immer unsichtbar (siehe templates.test.mjs).
//   3. "Als Beute ablegen" kopierte auch Fertigkeiten, Zauber, Volk und Beruf
//      des Gegners. Das Sheet zeigte sie nicht, "Alles nehmen" gab sie weiter.
//
// Geprüft werden die Regeln dahinter, nicht die Foundry-Aufrufe.

import "./helpers/foundry-stub.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOOT_SOCKET, LOOT_TYPES, COIN_KEYS, isLootable, lootableItems, hasCoins,
  transferCoins, responsibleGM, lootRecipient, lootTargetRef, serialQueue,
} from "../module/loot.mjs";

const manifest = JSON.parse(readFileSync(new URL("../system.json", import.meta.url), "utf8"));
const ITEM_TYPES = Object.keys(manifest.documentTypes.Item);

// ── Manifest ───────────────────────────────────────────────────────────────

test("das Manifest meldet den Socket-Kanal an, auf dem die Beute spricht", () => {
  assert.equal(manifest.socket, true,
    'ohne "socket": true kommt keine Beute-Anfrage eines Spielers beim Spielleiter an');
  assert.equal(LOOT_SOCKET, `system.${manifest.id}`);
});

// ── Was ist Beute? ─────────────────────────────────────────────────────────

test("jeder Item-Typ ist entweder Beute oder nicht — und die Beute-Typen gibt es", () => {
  for (const t of LOOT_TYPES) assert.ok(ITEM_TYPES.includes(t), `${t} ist kein Item-Typ im Manifest`);
  for (const t of ITEM_TYPES) {
    assert.equal(isLootable({ type: t }), LOOT_TYPES.includes(t), t);
  }
});

test("was einem NSC gehört, aber keine Beute ist, bleibt zurück", () => {
  for (const t of ["race", "class", "skill", "spell", "miracle", "god"]) {
    assert.equal(isLootable({ type: t }), false, `${t} darf nicht in den Container`);
  }
});

test("lootableItems: nimmt jede Sammlung und verliert nichts, was Beute ist", async t => {
  const npc = ITEM_TYPES.map((type, i) => ({ id: `i${i}`, type }));

  await t.test("Array", () => {
    const got = lootableItems(npc);
    assert.equal(got.length, LOOT_TYPES.length);
    assert.ok(got.every(isLootable));
  });
  await t.test("Map-artige Sammlung (Foundrys Collection iteriert Werte)", () => {
    const coll = new Set(npc);
    assert.equal(lootableItems(coll).length, LOOT_TYPES.length);
  });
  await t.test("leer, null, undefined", () => {
    assert.deepEqual(lootableItems([]), []);
    assert.deepEqual(lootableItems(null), []);
    assert.deepEqual(lootableItems(undefined), []);
  });
  await t.test("kaputte Einträge fallen heraus statt zu werfen", () =>
    assert.deepEqual(lootableItems([null, {}, { type: "weapon" }]), [{ type: "weapon" }]));
});

// ── Münzen ─────────────────────────────────────────────────────────────────

const WERTE = [-5, -1, 0, 1, 7, 250, 0.5, NaN, Infinity, "3", "", null, undefined];
const bewegbar = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const betrag = (wallet, key) => Number(wallet.currencies.find(c => c.key === key)?.amount ?? 0);

test("hasCoins: nur positive, endliche Beträge zählen", () => {
  for (const v of WERTE) {
    for (const key of COIN_KEYS) {
      assert.equal(hasCoins({ [key]: v }), bewegbar(v) > 0, `${key}=${String(v)}`);
    }
  }
  assert.equal(hasCoins(undefined), false);
  assert.equal(hasCoins({}), false);
});

test("transferCoins: Geld wird verschoben, nicht erzeugt und nicht vernichtet", () => {
  const start = { currencies: [
    { key: "gf", label: "GF", amount: 2 }, { key: "tt", label: "TT", amount: 0 },
    { key: "kl", label: "KL", amount: 11 }, { key: "mu", label: "MU", amount: 5 },
  ], history: [] };

  for (const v of WERTE) {
    for (const key of COIN_KEYS) {
      const loot = { gf: 0, tt: 0, kl: 0, mu: 0, [key]: v };
      const { wallet, remaining, moved } = transferCoins(start, loot);
      const soll = bewegbar(v);
      const fall = `${key}=${String(v)}`;

      // Invariante je Münze: Charakter nachher = vorher + bewegt,
      // Container nachher = vorher − bewegt.
      for (const k of COIN_KEYS) {
        const m = k === key ? soll : 0;
        assert.equal(betrag(wallet, k), betrag(start, k) + m, `Charakter ${k} bei ${fall}`);
        assert.equal(moved[k] ?? 0, m, `bewegt ${k} bei ${fall}`);
        if (m) assert.equal(remaining[k], 0, `Container ${k} bei ${fall}`);
        else   assert.equal(Object.is(remaining[k], loot[k]), true, `Container ${k} unverändert bei ${fall}`);
      }
      // Ein negativer Eintrag zieht dem Charakter nichts ab.
      for (const k of COIN_KEYS) assert.ok(betrag(wallet, k) >= betrag(start, k), fall);
      // Jede bewegte Münzart steht einmal in der Historie.
      assert.equal(wallet.history.length, soll ? 1 : 0, `Historie bei ${fall}`);
    }
  }
});

test("transferCoins: alle vier Münzen auf einmal", () => {
  const { wallet, remaining } = transferCoins({}, { gf: 1, tt: 2, kl: 3, mu: 4 }, { source: "Beute: Ork" });
  assert.deepEqual(COIN_KEYS.map(k => betrag(wallet, k)), [1, 2, 3, 4]);
  assert.deepEqual(remaining, { gf: 0, tt: 0, kl: 0, mu: 0 });
  assert.equal(wallet.history.length, 4);
  assert.ok(wallet.history.every(e => e.note === "aus Beute: Ork"));
});

test("transferCoins: verändert die Eingaben nicht", () => {
  const charWallet = { currencies: [{ key: "gf", label: "GF", amount: 1 }], history: [] };
  const lootWallet = { gf: 4 };
  const vorher = structuredClone({ charWallet, lootWallet });
  transferCoins(charWallet, lootWallet);
  assert.deepEqual({ charWallet, lootWallet }, vorher);
});

test("transferCoins: leere oder fehlende Börsen", () => {
  for (const [c, l] of [[undefined, undefined], [{}, {}], [null, null], [{ currencies: "kaputt" }, { gf: 2 }]]) {
    const { wallet, moved } = transferCoins(c, l);
    assert.equal(wallet.currencies.length, 4);
    for (const k of COIN_KEYS) assert.ok(Number.isFinite(betrag(wallet, k)));
    assert.deepEqual(moved, l?.gf ? { gf: 2 } : {});
  }
});

// ── Wer führt aus? ─────────────────────────────────────────────────────────

/** Alle Reihenfolgen einer Liste. */
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]));
}

test("responsibleGM: genau ein Spielleiter, auf jedem Client derselbe", () => {
  const users = [
    { id: "zGM", isGM: true, active: true },
    { id: "aSpieler", isGM: false, active: true },
    { id: "mGM", isGM: true, active: true },
    { id: "bGM", isGM: true, active: false },
  ];
  // Jeder Client sieht die Benutzer womöglich in anderer Reihenfolge.
  const gewaehlt = new Set(permutations(users).map(p => responsibleGM(p)?.id));
  assert.deepEqual([...gewaehlt], ["mGM"]);
});

test("responsibleGM: niemand zuständig, wenn kein Spielleiter online ist", () => {
  assert.equal(responsibleGM([]), null);
  assert.equal(responsibleGM(null), null);
  assert.equal(responsibleGM([{ id: "a", isGM: true, active: false }, { id: "b", isGM: false, active: true }]), null);
});

test("responsibleGM: von allen aktiven Spielleitern führt genau einer aus", () => {
  for (let n = 1; n <= 4; n++) {
    const gms = Array.from({ length: n }, (_, i) => ({ id: `gm${i}`, isGM: true, active: true }));
    const zustaendig = gms.filter(me => responsibleGM(gms)?.id === me.id);
    assert.equal(zustaendig.length, 1, `${n} Spielleiter`);
  }
});

// ── Wer bekommt die Beute? ─────────────────────────────────────────────────

test("lootRecipient", async t => {
  const held = { id: "h", type: "character", name: "Held" };
  const zweit = { id: "z", type: "character", name: "Zweit" };
  const hund = { id: "d", type: "creature", name: "Hund" };

  await t.test("der zugewiesene Charakter hat Vorrang", () =>
    assert.equal(lootRecipient(held, [zweit]), held));
  await t.test("ohne Zuweisung: der einzige eigene Charakter", () =>
    assert.equal(lootRecipient(null, [held]), held));
  await t.test("Begleiter und Kreaturen zählen nicht als Charakter", () =>
    assert.equal(lootRecipient(null, [held, hund]), held));
  await t.test("mehrere eigene Charaktere: keiner geraten", () =>
    assert.equal(lootRecipient(null, [held, zweit]), null));
  await t.test("keiner", () => {
    assert.equal(lootRecipient(null, []), null);
    assert.equal(lootRecipient(undefined, undefined), null);
    assert.equal(lootRecipient(null, [hund]), null);
  });
});

// ── Welcher Container? ─────────────────────────────────────────────────────

test("lootTargetRef: ein Token-Actor wird über Szene und Token adressiert", () => {
  const basis = { id: "A1", isToken: false, token: null };
  assert.deepEqual(lootTargetRef(basis), { lootActorId: "A1", sceneId: null, tokenId: null });

  // Unverknüpftes Token: gleiche Actor-ID wie der Basis-Actor, aber eigener Inhalt.
  const tokenActor = { id: "A1", isToken: true, token: { id: "T7", parent: { id: "S3" } } };
  assert.deepEqual(lootTargetRef(tokenActor), { lootActorId: "A1", sceneId: "S3", tokenId: "T7" });

  assert.deepEqual(lootTargetRef(null), { lootActorId: null, sceneId: null, tokenId: null });
});

// ── Nacheinander ───────────────────────────────────────────────────────────

test("serialQueue: zwei gleichzeitige Anfragen laufen nicht verzahnt", async () => {
  const queue = serialQueue();
  const log = [];
  const pause = ms => new Promise(r => setTimeout(r, ms));
  // Zwei Spieler drücken "Alles nehmen": beide lesen, dann löschen.
  const anfrage = name => queue(async () => {
    log.push(`${name} liest`);
    await pause(5);
    log.push(`${name} löscht`);
    return name;
  });
  const ergebnisse = await Promise.all([anfrage("A"), anfrage("B")]);
  assert.deepEqual(log, ["A liest", "A löscht", "B liest", "B löscht"]);
  assert.deepEqual(ergebnisse, ["A", "B"]);
});

test("serialQueue: ein Fehler hält die nächste Aufgabe nicht auf", async () => {
  const queue = serialQueue();
  const erste = queue(async () => { throw new Error("kaputt"); });
  const zweite = queue(async () => "läuft");
  await assert.rejects(erste, /kaputt/);
  assert.equal(await zweite, "läuft");
});
