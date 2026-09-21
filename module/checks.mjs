// module/checks.mjs — ABOREA Fertigkeitsproben

import { ABOREA } from "./config.mjs";
import { rollOpenD10 } from "./dice.mjs";
import { skillBonus, attributeValue, formatBreakdown } from "./bonuses.mjs";
import { openOnce } from "./windows.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ══════════════════════════════════════════════════════════════════
//  AboreaCheckDialog — ApplicationV2
// ══════════════════════════════════════════════════════════════════

class AboreaCheckDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:      "aborea-check-dialog",
    classes: ["aborea-check-dialog"],
    tag:     "form",
    window:  { resizable: false },
    position: { width: 380 },
    form:    { handler: AboreaCheckDialog._handleSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: "systems/aborea-v7/templates/combat/check-dialog.html" },
  };

  constructor(options = {}) {
    const { resolve, ...rest } = options;
    super(rest);
    this._resolve = resolve ?? null;
  }

  get title() { return `🎲 Probe — ${this.options.actor.name}`; }

  _onRender(context, options) {
    super._onRender(context, options);
    const root      = this.element;
    const sel       = root.querySelector("#check-type-select");
    const typeHid   = root.querySelector("#check-type-hidden");
    const keyHid    = root.querySelector("#check-key-hidden");
    const diffSel   = root.querySelector("#check-difficulty-select");
    const diffInput = root.querySelector("#check-difficulty-input");

    const syncType = () => {
      const [type, key] = (sel.value ?? "attr::st").split("::");
      typeHid.value = type;
      keyHid.value  = key;
    };
    sel?.addEventListener("change", syncType);
    syncType();

    diffSel?.addEventListener("change", () => {
      if (diffSel.value === "0") {
        diffInput.removeAttribute("readonly");
        diffInput.focus();
      } else {
        diffInput.value = diffSel.value;
      }
    });
  }

  async _prepareContext() {
    const actor   = this.options.actor;
    const system  = actor.system;
    const attrs   = Object.entries(ABOREA.attributes).map(([key, label]) => ({
      key,
      label: game.i18n.localize(label),
      type: "attr",
    }));
    const skills  = Object.entries(ABOREA.skills)
      .filter(([, s]) => s.creation)  // Nur Allgemein-Fertigkeiten
      .map(([key, s]) => ({
        key,
        label: game.i18n.localize(s.label),
        rank:  Number(system.skills?.[key]?.rank ?? 0),
        type: "skill",
      }));
    const customSkills = (system.customSkills ?? []).map(s => ({
      key:   s.key,
      label: s.label ?? s.name ?? s.key,
      rank:  Number(s.rank ?? 0),
      type: "custom",
    }));
    const difficulties = Object.entries(ABOREA.maneuvers).map(([key, val]) => ({
      key, val, label: _maneuverLabel(key, val),
    }));
    return { attrs, skills: [...skills, ...customSkills], difficulties };
  }

  static async _handleSubmit(event, form, formData) {
    const data   = formData.object;
    const actor  = this.options.actor;
    const result = await performCheck(actor, data);
    if (this._resolve) this._resolve(result);
  }
}

function _maneuverLabel(key, val) {
  const names = {
    routine: "Routine", sehrEinfach: "Sehr einfach", einfach: "Einfach",
    schwer: "Schwer", sehrSchwer: "Sehr schwer", aeusserstSchwer: "Äußerst schwer",
    blankerLeichtsinn: "Blanker Leichtsinn", absurd: "Absurd",
  };
  return `${names[key] ?? key} (${val})`;
}

// ══════════════════════════════════════════════════════════════════
//  Core check logic
// ══════════════════════════════════════════════════════════════════

/**
 * Bonus einer Probe — Attributprobe oder Fertigkeitsprobe.
 * Fertigkeiten laufen über skillBonus(), dieselbe Quelle wie Bogen und Kampf.
 */
function _resolveBonus(actor, checkType, checkKey) {
  if (checkType === "attr") {
    const bonus = ABOREA.attributeBonus(attributeValue(actor, checkKey));
    const label = game.i18n.localize(ABOREA.attributes[checkKey] ?? checkKey);
    return { bonus, label, breakdown: [`${label}: ${bonus >= 0 ? "+" : ""}${bonus}`] };
  }
  const b = skillBonus(actor, checkKey);
  return { bonus: b.total, label: game.i18n.localize(b.label), breakdown: formatBreakdown(b.breakdown) };
}

export async function performCheck(actor, { checkType, checkKey, situMod = 0, difficulty = 10 }) {
  situMod   = Number(situMod) || 0;
  difficulty = Number(difficulty) || 10;

  const roll = await rollOpenD10({ label: "Probe" });
  const { bonus, label, breakdown } = _resolveBonus(actor, checkType, checkKey);

  if (situMod) breakdown.push(`Situationsmod.: ${situMod >= 0 ? "+" : ""}${situMod}`);

  const total   = roll.total + bonus + situMod;
  const success = !roll.naturalOne && total >= difficulty;
  const patzer  = roll.naturalOne;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="aborea-chat-card">
      <h3>🎲 ${label}</h3>
      <p>Wurf: ${roll.formula}${roll.critical ? " 🎯 Kritisch" : ""}${patzer ? " 💀 Patzer" : ""}</p>
      ${breakdown.map(l => `<p>${l}</p>`).join("")}
      <p><strong>Ergebnis: ${total}</strong> gegen SW ${difficulty}</p>
      <p class="check-result ${success ? "check-success" : "check-failure"}">
        ${patzer ? "💀 Patzer!" : success ? "✅ Erfolg!" : "❌ Misserfolg"}
      </p>
    </div>`
  });

  return { total, success, patzer, critical: roll.critical };
}

// ══════════════════════════════════════════════════════════════════
//  Gruppenproben
// ══════════════════════════════════════════════════════════════════

async function _rollSilent(actor, { checkType, checkKey, situMod, difficulty }) {
  situMod    = Number(situMod) || 0;
  difficulty = Number(difficulty) || 0;

  const roll = await rollOpenD10({ label: checkKey, skipVisual: true });
  const { bonus, label } = _resolveBonus(actor, checkType, checkKey);

  const total   = roll.total + bonus + situMod;
  const success = difficulty > 0 ? (!roll.naturalOne && total >= difficulty) : null;
  const patzer  = roll.naturalOne;
  return { actor, label, roll, total, bonus, situMod, success, patzer };
}

export async function performGroupCheck({ checkType, checkKey, situMod = 0, difficulty = 0 }) {
  const characters = game.actors.filter(a => a.type === "character");
  if (!characters.length) { ui.notifications.warn("Keine Charaktere gefunden."); return; }

  const results = await Promise.all(
    characters.map(a => _rollSilent(a, { checkType, checkKey, situMod, difficulty }))
  );

  const checkLabel = results[0]?.label ?? checkKey;
  const dvLine     = difficulty > 0 ? ` (SW ${difficulty})` : "";
  const rows = results.map(r => {
    const icon = r.patzer ? "💀" : r.success === true ? "✅" : r.success === false ? "❌" : "🎲";
    const mod  = r.bonus + r.situMod;
    return `<tr>
      <td>${icon} <strong>${r.actor.name}</strong></td>
      <td style="text-align:center">${r.roll.formula}</td>
      <td style="text-align:center">${mod >= 0 ? "+" : ""}${mod}</td>
      <td style="text-align:center;font-weight:700">${r.total}</td>
    </tr>`;
  }).join("");

  await ChatMessage.create({
    speaker: { alias: "GM" },
    content: `<div class="aborea-chat-card">
      <h3>👥 Gruppenprobe: ${checkLabel}${dvLine}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th style="text-align:left">Charakter</th>
          <th>Wurf</th><th>Bonus</th><th>Ges.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${difficulty > 0 ? `<p style="margin-top:6px;font-size:11px">
        ✅ ${results.filter(r => r.success).length} Erfolge · ❌ ${results.filter(r => r.success === false).length} Misserfolge
      </p>` : ""}
    </div>`
  });
}

export async function openGroupCheckDialog() {
  // Nur eine Gruppenprobe gleichzeitig — der Knopf in der Werkzeugleiste
  // feuert gelegentlich mehrfach.
  let settle;
  const answered = new Promise(resolve => { settle = resolve; });
  const { created } = await openOnce("aborea-group-check", () => _buildGroupCheckDialog(settle));
  if (!created) return null;
  return answered;
}

function _buildGroupCheckDialog(resolve) {
  const attrs = Object.entries(ABOREA.attributes).map(([key, label]) =>
    `<option value="attr::${key}">${game.i18n.localize(label)}</option>`
  ).join("");
  const skills = Object.entries(ABOREA.skills)
    .filter(([, s]) => s.creation)
    .map(([key, s]) => `<option value="skill::${key}">${game.i18n.localize(s.label)}</option>`)
    .join("");

  const maneuvers = Object.entries(ABOREA.maneuvers)
    .map(([, val]) => `<option value="${val}">${val}</option>`)
    .join("");

  const dialog = new Dialog({
      title: "👥 Gruppenprobe",
      content: `
        <div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:3px">Probe auf</label>
            <select id="gp-check" style="width:100%">
              <optgroup label="Attribute">${attrs}</optgroup>
              <optgroup label="Fertigkeiten">${skills}</optgroup>
            </select>
          </div>
          <div style="display:flex;gap:8px">
            <div style="flex:1">
              <label style="font-weight:600;display:block;margin-bottom:3px">Schwierigkeitswert</label>
              <select id="gp-diff" style="width:100%">
                <option value="0">— kein Vergleich —</option>
                ${maneuvers}
              </select>
            </div>
            <div>
              <label style="font-weight:600;display:block;margin-bottom:3px">Situationsmod.</label>
              <input id="gp-situ" type="number" value="0" min="-10" max="10" style="width:60px" />
            </div>
          </div>
        </div>
      `,
      buttons: {
        roll: {
          label: "👥 Alle würfeln",
          icon: '<i class="fas fa-dice"></i>',
          callback: html => {
            const raw   = html[0].querySelector("#gp-check").value;
            const [checkType, checkKey] = raw.split("::");
            const difficulty = Number(html[0].querySelector("#gp-diff").value) || 0;
            const situMod    = Number(html[0].querySelector("#gp-situ").value) || 0;
            resolve(performGroupCheck({ checkType, checkKey, situMod, difficulty }));
          }
        },
        cancel: { label: "Abbrechen", callback: () => resolve(null) }
      },
      default: "roll",
      close: () => resolve(null)
  });
  dialog.render(true);
  // Das Fenster zurückgeben, nicht render() — daran liest die Registratur ab,
  // ob schon eins offen ist.
  return dialog;
}

// ══════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════

export async function openCheckDialog(actor) {
  let settle;
  const answered = new Promise(resolve => { settle = resolve; });
  const { created } = await openOnce(`check:${actor?.id ?? "?"}`, () => {
    const app = new AboreaCheckDialog({ actor, resolve: settle });
    app.render(true);
    return app;
  });
  if (!created) return null;
  return answered;
}

export function registerCheckHooks() {
  // Actor-Verzeichnis-Rechtsklick: Probe würfeln
  const actorFromLi = li => game.actors.get(li.dataset?.entryId ?? li.dataset?.documentId);
  Hooks.on("getActorContextOptions", (html, options) => {
    options.push({
      name:  "🎲 Probe würfeln",
      icon:  '<i class="fas fa-dice-d10"></i>',
      visible: li => ["character", "npc", "creature"].includes(actorFromLi(li)?.type),
      callback: li => {
        const actor = actorFromLi(li);
        if (actor) openCheckDialog(actor);
      },
    });
  });
}
