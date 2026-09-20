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
    };
  });

  return {
    rows,
    alive:    rows.filter(r => !r.defeated),
    defeated: rows.filter(r => r.defeated),
  };
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
    this.#instance ??= new this();
    this.#instance.render(true);
    return this.#instance;
  }

  async _prepareContext() {
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
    }));

    const { rows, alive, defeated } = buildConsoleRows(entries, {
      activeId: combat?.current?.combatantId ?? "",
    });

    return {
      hasCombat: !!combat,
      round,
      rows, alive, defeated,
      situMod: Number(game.settings.get("aborea-v7", "globalSituMod") ?? 0),
    };
  }

  _onRender(context, options) {
    const html = this.element;
    if (!html) return;

    const combat   = game.combat;
    const actorOf  = id => combat?.combatants.get(id)?.actor ?? null;
    const rowOf    = el => el.closest("[data-combatant-id]")?.dataset.combatantId;

    // Angriff zuweisen: Angreifer wählen, Ziel wählen, ausführen
    html.querySelectorAll(".cc-attack").forEach(btn => btn.addEventListener("click", async ev => {
      const attacker = actorOf(rowOf(ev.currentTarget));
      const targetId = ev.currentTarget.closest(".cc-row")?.querySelector(".cc-target")?.value;
      const target   = combat?.combatants.get(targetId)?.token;
      if (!attacker) return;
      const { openAttackDialog, executeGroupAttack } = await import("./combat.mjs");
      if (target) await executeGroupAttack([attacker], { targetToken: target,
        situMod: Number(game.settings.get("aborea-v7", "globalSituMod") ?? 0) });
      else await openAttackDialog(attacker);
      this.render();
    }));

    // Offensiv/Defensiv erklären
    html.querySelectorAll(".cc-offensive").forEach(inp => inp.addEventListener("change", async ev => {
      const actor = actorOf(rowOf(ev.currentTarget));
      if (!actor) return;
      const { declareRound } = await import("./combat.mjs");
      await declareRound(actor, { mode: "weapon", offensive: Number(ev.target.value) });
      this.render();
    }));

    html.querySelectorAll(".cc-mode").forEach(btn => btn.addEventListener("click", async ev => {
      const actor = actorOf(rowOf(ev.currentTarget));
      if (!actor) return;
      const mode = ev.currentTarget.dataset.mode;
      const { declareRound } = await import("./combat.mjs");
      await declareRound(actor, { mode, offensive: Number(
        ev.currentTarget.closest(".cc-row")?.querySelector(".cc-offensive")?.value ?? 0) });
      this.render();
    }));

    // Besiegt-Markierung
    html.querySelectorAll(".cc-defeat").forEach(btn => btn.addEventListener("click", async ev => {
      const c = combat?.combatants.get(rowOf(ev.currentTarget));
      if (c) await c.update({ defeated: !c.isDefeated });
      this.render();
    }));

    // Situationsmodifikator
    html.querySelector(".cc-situ")?.addEventListener("change", async ev => {
      const { clampSituMod } = await import("./settings.mjs");
      await game.settings.set("aborea-v7", "globalSituMod", clampSituMod(ev.target.value));
      this.render();
    });

    html.querySelector(".cc-refresh")?.addEventListener("click", () => this.render());
  }
}

/** Hooks, die das Pult auf dem Laufenden halten. */
export function registerCombatConsole() {
  const rerender = () => {
    const app = Object.values(ui.windows ?? {}).find(w => w instanceof AboreaCombatConsole);
    if (app?.rendered) app.render();
  };
  Hooks.on("updateCombat", rerender);
  Hooks.on("updateCombatant", rerender);
  Hooks.on("updateActor", rerender);

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
