// module/combat-console.mjs — Kampfpult für den Spielleiter
//
// Der Combat Tracker in der Seitenleiste ist schmal und zeigt wenig. Hier
// steht alles auf einem Blatt: Zustand, Erklärung, Defensivvorrat — und
// Angriffe lassen sich zuweisen, ohne jeden Token einzeln anzuklicken.
//
// Die Aufbereitung der Zeilen ist eine reine Funktion (buildConsoleRows) und
// deshalb ohne Foundry prüfbar; die Klasse darunter macht nur Oberfläche.

import { roundSplit, splitRange, defenseRemaining, defenseSpentTotal } from "./declaration.mjs";
import { registerSceneControlTools } from "./scene-controls.mjs";
import { clampSituMod, SETTINGS } from "./settings.mjs";
import { declareRound, executeGroupAttack, openAttackDialog,
         setCombatantSituMod, combatantSituMod } from "./combat.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Gilt ein Kombattant als ausgeschieden?
 *
 * Entweder hat der Spielleiter ihn im Tracker als besiegt markiert, oder die
 * Lebenspunkte sind auf 0. Beides zählt — sonst bliebe ein Gegner mit 0 HP
 * als Angriffsziel stehen, nur weil niemand den Haken gesetzt hat.
 */
export function isDefeated(entry) {
  if (entry?.defeated) return true;
  return Number(entry?.hp?.value ?? 1) <= 0;
}

/**
 * In welchem Zustand ist der Kampf?
 *
 *   "none"     — es gibt keinen
 *   "prepared" — angelegt, aber nicht gestartet: Runde 0
 *   "running"  — gestartet
 *
 * Der Unterschied war vorher keiner: alles außer "kein Kampf" galt als
 * laufend. Ein angelegter Kampf steht aber auf Runde 0, und eine Erklärung
 * braucht eine Rundennummer — das Pult zeigte Knöpfe, die nichts taten.
 */
export function combatPhase({ hasCombat = false, started = false, round = 0 } = {}) {
  if (!hasCombat) return "none";
  return started && Number(round) > 0 ? "running" : "prepared";
}

/**
 * Warum sieht das Pult keinen Kampf?
 *
 * game.combat ist der Kampf der *betrachteten* Szene, nicht irgendeiner.
 * Steht der Spielleiter auf einer anderen Szene, ist er leer, obwohl im
 * Kampfbericht ein Kampf steht — "Kein Kampf aktiv" war da eine irreführende
 * Auskunft.
 */
export function noCombatReason({ viewed = false, total = 0 } = {}) {
  if (viewed) return "";
  return Number(total) > 0 ? "other-scene" : "none";
}

/**
 * Bereitet die Zeilen des Kampfpults auf.
 *
 * @param {Array} combatants  [{id, name, img, actorId, defeated, initiative, hp, split, situMod, targetId}]
 * @param {object} [opts]
 * @param {string} [opts.activeId]  Kombattant, der gerade am Zug ist
 * @param {string} [opts.phase]     "none" | "prepared" | "running"
 * @returns {{rows, alive, defeated}}
 */
export function buildConsoleRows(combatants = [], { activeId = "", phase = "running" } = {}) {
  const running = phase === "running";
  const rows = (combatants ?? []).filter(Boolean).map(c => {
    const hpVal = Number(c.hp?.value ?? 0);
    const hpMax = Number(c.hp?.max ?? 1);
    const pct   = hpMax > 0 ? Math.max(0, Math.min(100, Math.round((hpVal / hpMax) * 100))) : 0;
    const split = c.split ?? { pool: 0, offensive: 0, defensive: 0, mode: "weapon", declared: false, locked: false, defenseSpent: null };
    const range = splitRange(split.pool);
    const dead  = isDefeated(c);
    const flees = split.mode === "flee";
    return {
      id: c.id,
      actorId: c.actorId,
      name: c.name,
      img: c.img || "icons/svg/mystery-man.svg",
      initiative: c.initiative ?? null,
      hp: hpVal, hpMax, hpPct: pct,
      defeated: dead,
      active: c.id === activeId,
      mode: split.mode,
      declared: split.declared,
      locked: split.locked,
      pool: split.pool,
      offensive: split.offensive,
      defensive: split.defensive,
      defenseLeft: defenseRemaining(split.defensive, split.defenseSpent),
      defenseUsed: defenseSpentTotal(split.defenseSpent),
      splitMin: range.min,
      splitMax: range.max,
      canSplit: range.min !== range.max,
      fleeing: flees,
      situMod: Number(c.situMod ?? 0) || 0,
      targetId: c.targetId ?? "",
      // Erklären geht nur im laufenden Kampf und nur, solange noch nicht
      // gehandelt wurde. Angreifen zusätzlich nicht, wer flieht — Flucht ist
      // die einzige Handlung der Runde.
      //
      // Ein Ziel zuweisen darf man dagegen schon vor dem Start: die
      // Angriffsreihenfolge festzulegen ist gerade die Vorbereitung.
      canDeclare: running && !dead && !split.locked,
      canAttack:  running && !dead && !flees,
      canAssign:  !dead && !flees,
    };
  });

  // Zielauswahl je Zeile. Sie entsteht erst hier, weil jede Zeile die
  // anderen braucht — und in JavaScript statt in der Vorlage, weil ein
  // verschachteltes {{#each}} mit ../id sich der Prüfung entzieht.
  for (const row of rows) {
    const options = assignableTargets(rows, row.id);
    row.target  = options.some(o => o.id === row.targetId) ? row.targetId : "";
    row.targets = options.map(o => ({ id: o.id, name: o.name, selected: o.id === row.target }));
  }

  return {
    rows,
    alive:    rows.filter(r => !r.defeated),
    defeated: rows.filter(r => r.defeated),
  };
}

/**
 * Darf dieser Benutzer das Pult öffnen?
 *
 * Es zeigt jeden Kombattanten samt Lebenspunkten und Rundenerklärung — auch
 * die Gegner, die der Spielleiter noch nicht preisgegeben hat. Der Knopf in
 * der Werkzeugleiste erscheint Spielern zwar nicht, über die Konsole oder ein
 * Makro wäre das Fenster sonst aber trotzdem erreichbar.
 */
export function mayUseConsole(user) {
  return !!user?.isGM;
}

/**
 * Wer kommt als Ziel für diesen Angreifer infrage?
 * Ausgeschiedene Kombattanten und der Angreifer selbst fallen weg — ein
 * toter Goblin soll nicht mehr in der Auswahl stehen.
 */
export function assignableTargets(rows, attackerId) {
  return (rows ?? []).filter(r => !r.defeated && r.id !== attackerId);
}

/** Flag-Schlüssel für das zugewiesene Ziel. */
export const TARGET_FLAG = "target";

/**
 * Das zugewiesene Ziel eines Kombattanten.
 *
 * Es steht am Kombattanten, nicht im DOM. Vorher war es reine
 * Auswahlfeld-Zustand: jedes Neuzeichnen des Pults — und das geschieht nach
 * jeder Änderung, auch nach dem Setzen eines Situationsmodifikators — hat die
 * Zuweisung wieder auf "— Ziel wählen —" zurückgesetzt.
 */
export function combatantTarget(combatant) {
  return combatant?.flags?.["aborea-v7"]?.[TARGET_FLAG] ?? "";
}

/** Setzt es; ein leerer Wert entfernt das Flag wieder. */
export async function setCombatantTarget(combatant, targetId) {
  if (!combatant) return "";
  const id = String(targetId ?? "");
  if (id) await combatant.setFlag("aborea-v7", TARGET_FLAG, id);
  else if (combatantTarget(combatant)) await combatant.unsetFlag("aborea-v7", TARGET_FLAG);
  return id;
}

// ══════════════════════════════════════════════════════════════════
//  AboreaCombatConsole — ApplicationV2
// ══════════════════════════════════════════════════════════════════

export class AboreaCombatConsole extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "aborea-combat-console",
    classes:  ["aborea", "aborea-combat-console"],
    window:   { resizable: true, title: "⚔ Kampfpult" },
    position: { width: 800, height: 560 },
  };

  static PARTS = {
    main: { template: "systems/aborea-v7/templates/combat/combat-console.html" },
  };

  /** Einzelinstanz — ein zweites Pult würde nur auseinanderlaufen. */
  static #instance = null;
  static open() {
    if (!mayUseConsole(game.user)) {
      ui.notifications?.warn("ABOREA: Das Kampfpult ist dem Spielleiter vorbehalten.");
      return null;
    }
    this.#instance ??= new this();
    this.#instance.render(true);
    return this.#instance;
  }

  /** Zeichnet das offene Pult neu, falls es eins gibt. */
  static refresh() {
    if (this.#instance?.rendered) this.#instance.render();
  }

  /**
   * Der Combat Tracker bleibt die Quelle der Wahrheit — über ihn führen die
   * Spieler ihre Angriffe aus. Das Pult zeichnet ihn deshalb mit, wenn es
   * selbst etwas geändert hat.
   */
  async render(...args) {
    const result = await super.render(...args);
    ui.combat?.render();
    return result;
  }

  async _prepareContext() {
    if (!mayUseConsole(game.user)) return { phase: "none", rows: [], alive: [], defeated: [] };
    const combat = game.combat;
    const round  = combat?.round ?? null;
    const phase  = combatPhase({ hasCombat: !!combat, started: !!combat?.started, round });

    // turns ist die Zugreihenfolge; vor dem Kampfstart kann sie leer sein,
    // die Kombattanten stehen dann trotzdem schon fest.
    const list = combat?.turns?.length ? combat.turns : [...(combat?.combatants ?? [])];
    const entries = list.map(c => ({
      id: c.id,
      actorId: c.actor?.id,
      name: c.name,
      img: c.actor?.img,
      defeated: c.isDefeated,
      initiative: c.initiative,
      hp: c.actor?.system?.resources?.hp,
      split: c.actor ? roundSplit(c.actor, round) : null,
      situMod: c.actor ? combatantSituMod(c.actor) : 0,
      targetId: combatantTarget(c),
    }));

    const { rows, alive, defeated } = buildConsoleRows(entries, {
      activeId: combat?.current?.combatantId ?? "",
      phase,
    });

    return {
      phase,
      isRunning:  phase === "running",
      isPrepared: phase === "prepared",
      noCombat:   noCombatReason({ viewed: !!combat, total: game.combats?.size ?? 0 }),
      round,
      rows, alive, defeated,
      situMod: Number(game.settings.get("aborea-v7", SETTINGS.situMod) ?? 0),
      activeName: rows.find(r => r.active)?.name ?? "",
    };
  }

  _onRender(context, options) {
    const html = this.element;
    if (!html) return;

    const combat  = game.combat;
    const actorOf = id => combat?.combatants.get(id)?.actor ?? null;

    // Alles aus dem DOM wird VOR dem ersten await gelesen: nach einem await
    // ist die Ereigniszustellung beendet und ev.currentTarget null.
    const bind = (selector, event, handler) =>
      html.querySelectorAll(selector).forEach(el => el.addEventListener(event, async ev => {
        ev.preventDefault();
        const row  = el.closest("[data-combatant-id]");
        const id   = row?.dataset.combatantId;
        const data = {
          id, row,
          actor:     actorOf(id),
          combatant: combat?.combatants.get(id) ?? null,
          value:     el.value,
          mode:      el.dataset.mode,
          offensive: Number(row?.querySelector(".cc-offensive")?.value ?? 0),
          targetId:  row?.querySelector(".cc-target")?.value,
        };
        await handler(data);
        this.render();
      }));

    bind(".cc-attack", "click", async ({ actor, combatant, targetId }) => {
      if (!actor) return;
      // Die Zuweisung am Kombattanten hat Vorrang; das Auswahlfeld ist nur
      // ihre Anzeige.
      const wanted = combatantTarget(combatant) || targetId;
      if (wanted === combatant?.id) return;            // nicht sich selbst
      const target = combat?.combatants.get(wanted)?.token;
      if (target) await executeGroupAttack([actor], { targetToken: target });
      else await openAttackDialog(actor, { attackerTokenId: combatant?.tokenId ?? "" });
    });

    bind(".cc-target", "change", async ({ combatant, value }) => {
      if (combatant) await setCombatantTarget(combatant, value);
    });

    bind(".cc-offensive", "change", async ({ actor, value }) => {
      if (actor) await declareRound(actor, { mode: "weapon", offensive: Number(value) });
    });

    bind(".cc-mode", "click", async ({ actor, mode, offensive }) => {
      if (actor) await declareRound(actor, { mode, offensive });
    });

    bind(".cc-defeat", "click", async ({ combatant }) => {
      if (combatant) await combatant.update({ defeated: !combatant.isDefeated });
    });

    // Situationsmodifikator je Kombattant
    bind(".cc-row-situ", "change", async ({ actor, value }) => {
      if (actor) await setCombatantSituMod(actor, value);
    });

    // Zugsteuerung — der Combat Tracker bleibt die Quelle der Wahrheit,
    // das Pult bedient ihn nur.
    html.querySelector(".cc-prev")?.addEventListener("click", async () => {
      await combat?.previousTurn(); this.render();
    });
    html.querySelector(".cc-next")?.addEventListener("click", async () => {
      await combat?.nextTurn(); this.render();
    });

    // Ein angelegter Kampf steht auf Runde 0 — ohne Start lässt sich nichts
    // erklären. Der Knopf erspart den Weg zurück in den Tracker.
    html.querySelector(".cc-start")?.addEventListener("click", async () => {
      await combat?.startCombat(); this.render();
    });

    html.querySelector(".cc-situ")?.addEventListener("change", async ev => {
      await game.settings.set("aborea-v7", SETTINGS.situMod, clampSituMod(ev.target.value));
      this.render();
    });

    html.querySelector(".cc-refresh")?.addEventListener("click", () => this.render());
  }
}

/** Hooks, die das Pult auf dem Laufenden halten. */
export function registerCombatConsole() {
  // ApplicationV2-Fenster stehen nicht in ui.windows — das ist die V1-Liste
  // und bleibt leer. Deshalb hält die Klasse ihre Instanz selbst.
  const rerender = () => AboreaCombatConsole.refresh();
  // Zugwechsel, Initiative, Besiegt-Markierung, Lebenspunkte und
  // Rundenerklärungen — alles, was im Pult steht, kann auch anderswo
  // geändert werden.
  // createCombat fehlte: wer das Pult vor dem Anlegen des Kampfes öffnete,
  // bekam "Kein Kampf aktiv" zu sehen und es blieb dabei, bis er von Hand
  // neu einlas.
  for (const hook of ["createCombat", "updateCombat", "deleteCombat",
                      "createCombatant", "updateCombatant", "deleteCombatant",
                      "updateActor", "combatStart", "combatTurn", "combatRound"]) {
    Hooks.on(hook, rerender);
  }

  // In die Token-Gruppe statt in eine eigene: eine eigene Gruppe müsste eins
  // ihrer Werkzeuge zum activeTool machen, und das feuert dann beim blossen
  // Umschalten mit — siehe scene-controls.mjs.
  registerSceneControlTools({
    group: "tokens",
    tools: [
      { name: "aborea-combat-console", title: "ABOREA: Kampfpult öffnen",
        icon: "fas fa-chess-board", order: 90,
        onClick: () => AboreaCombatConsole.open() },
      { name: "aborea-group-attack", order: 91,
        title: "ABOREA: Gruppenangriff — ausgewählte Tokens greifen das markierte Ziel an",
        icon: "fas fa-users-rectangle",
        onClick: async () => (await import("./combat.mjs")).startGroupAttack() },
    ],
  });
}
