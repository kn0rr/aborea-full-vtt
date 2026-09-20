// module/combat-console.mjs — Kampfpult für den Spielleiter
//
// Der Combat Tracker in der Seitenleiste ist schmal und zeigt wenig. Hier
// steht alles auf einem Blatt: Zustand, Erklärung, Defensivvorrat — und
// Angriffe lassen sich zuweisen, ohne jeden Token einzeln anzuklicken.
//
// Die Aufbereitung der Zeilen ist eine reine Funktion (buildConsoleRows) und
// deshalb ohne Foundry prüfbar; die Klasse darunter macht nur Oberfläche.

import { roundSplit, splitRange, defenseRemaining, defenseSpentTotal } from "./declaration.mjs";
import { registerSceneControlGroup } from "./scene-controls.mjs";
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
 * Bereitet die Zeilen des Kampfpults auf.
 *
 * @param {Array} combatants  [{id, name, img, actorId, defeated, initiative, hp, combat, split}]
 * @param {object} [opts]
 * @param {string} [opts.activeId]  Kombattant, der gerade am Zug ist
 * @returns {{rows, alive, defeated, round}}
 */
export function buildConsoleRows(combatants = [], { activeId = "" } = {}) {
  const rows = (combatants ?? []).filter(Boolean).map(c => {
    const hpVal = Number(c.hp?.value ?? 0);
    const hpMax = Number(c.hp?.max ?? 1);
    const pct   = hpMax > 0 ? Math.max(0, Math.min(100, Math.round((hpVal / hpMax) * 100))) : 0;
    const split = c.split ?? { pool: 0, offensive: 0, defensive: 0, mode: "weapon", declared: false, locked: false, defenseSpent: null };
    const range = splitRange(split.pool);
    return {
      id: c.id,
      actorId: c.actorId,
      name: c.name,
      img: c.img || "icons/svg/mystery-man.svg",
      initiative: c.initiative ?? null,
      hp: hpVal, hpMax, hpPct: pct,
      defeated: isDefeated(c),
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
      fleeing: split.mode === "flee",
      situMod: Number(c.situMod ?? 0) || 0,
    };
  });

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

// ══════════════════════════════════════════════════════════════════
//  AboreaCombatConsole — ApplicationV2
// ══════════════════════════════════════════════════════════════════

export class AboreaCombatConsole extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "aborea-combat-console",
    classes:  ["aborea", "aborea-combat-console"],
    window:   { resizable: true, title: "⚔ Kampfpult" },
    position: { width: 720, height: 560 },
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
    if (!mayUseConsole(game.user)) return { hasCombat: false, rows: [], alive: [], defeated: [] };
    const combat = game.combat;
    const round  = combat?.round ?? null;
    const entries = (combat?.turns ?? []).map(c => ({
      id: c.id,
      actorId: c.actor?.id,
      name: c.name,
      img: c.actor?.img,
      defeated: c.isDefeated,
      initiative: c.initiative,
      hp: c.actor?.system?.resources?.hp,
      split: c.actor ? roundSplit(c.actor, round) : null,
      situMod: c.actor ? combatantSituMod(c.actor) : 0,
    }));

    const { rows, alive, defeated } = buildConsoleRows(entries, {
      activeId: combat?.current?.combatantId ?? "",
    });

    return {
      hasCombat: !!combat,
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

    bind(".cc-attack", "click", async ({ actor, targetId }) => {
      if (!actor) return;
      const target = combat?.combatants.get(targetId)?.token;
      if (target) await executeGroupAttack([actor], { targetToken: target });
      else await openAttackDialog(actor);
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
  for (const hook of ["updateCombat", "createCombatant", "updateCombatant", "deleteCombatant",
                      "updateActor", "deleteCombat", "combatStart", "combatTurn", "combatRound"]) {
    Hooks.on(hook, rerender);
  }

  registerSceneControlGroup({
    name:  "aborea-combat",
    title: "ABOREA Kampf",
    icon:  "fas fa-chess-board",
    layer: "tokens",
    tools: [
      { name: "combat-console", title: "Kampfpult öffnen", icon: "fas fa-chess-board",
        onClick: () => AboreaCombatConsole.open() },
      { name: "group-attack",
        title: "Gruppenangriff: ausgewählte Tokens greifen das markierte Ziel an",
        icon: "fas fa-users",
        onClick: async () => (await import("./combat.mjs")).startGroupAttack() },
    ],
  });
}
