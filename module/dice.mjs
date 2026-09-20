import { ABOREA } from "./config.mjs";
import { skillBonus, formatBreakdown } from "./bonuses.mjs";

function ensureDiceOverlay() {
  let overlay = document.getElementById("aborea-dice-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "aborea-dice-overlay";
  overlay.className = "aborea-dice-overlay hidden";
  overlay.innerHTML = `
    <div class="aborea-dice-backdrop"></div>
    <div class="aborea-dice-panel">
      <div class="aborea-dice-label"></div>
      <div class="aborea-die d10">
        <div class="aborea-die-face">10</div>
      </div>
      <div class="aborea-dice-subline"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

async function showDiceSoNiceRoll(result) {
  const dice3d = game.dice3d ?? game.aborea?.dice3d;
  if (!dice3d?.showForRoll || !Array.isArray(result.rolls) || !result.rolls.length) return false;
  try {
    for (const roll of result.rolls) {
      await dice3d.showForRoll(roll, game.user, true);
    }
    return true;
  } catch (err) {
    console.warn("ABOREA | Dice So Nice visualization failed, falling back to overlay", err);
    return false;
  }
}

async function showVisualRoll(label, roller) {
  const result = await roller();
  const usedDiceSoNice = await showDiceSoNiceRoll(result);
  if (usedDiceSoNice) return result;

  const overlay = ensureDiceOverlay();
  const face = overlay.querySelector(".aborea-die-face");
  const labelEl = overlay.querySelector(".aborea-dice-label");
  const subline = overlay.querySelector(".aborea-dice-subline");
  labelEl.textContent = label;
  subline.textContent = game.i18n.localize("ABOREA.Rolling") || "Würfelt …";
  overlay.classList.remove("hidden");
  overlay.classList.add("visible");
  let tick = 1;
  face.textContent = "?";
  const interval = window.setInterval(() => {
    face.textContent = String(((Math.random() * 10) | 0) + 1);
    overlay.querySelector('.aborea-die')?.style.setProperty('--aborea-spin', String(tick++));
  }, 85);
  await new Promise(resolve => setTimeout(resolve, 900));
  window.clearInterval(interval);
  face.textContent = String(result.parts?.[0] || result.total || 0);
  subline.textContent = result.parts?.length > 1 ? `${result.formula} = ${result.total}` : `${result.total}`;
  await new Promise(resolve => setTimeout(resolve, 600));
  overlay.classList.remove("visible");
  overlay.classList.add("hidden");
  return result;
}

async function _evaluateOpenD10({ label = "ABOREA.RollOpenD10" } = {}) {
  let total = 0;
  const parts = [];
  const rolls = [];
  let critical = false;
  let naturalOne = false;

  while (true) {
    const roll = await (new Roll("1d10")).evaluate();
    const result = Number(roll.total);
    rolls.push(roll);
    parts.push(result);
    total += result;

    if (parts.length === 1 && result === 1) naturalOne = true;
    if (result === 10) {
      critical = true;
      continue;
    }
    break;
  }

  return {
    label,
    parts,
    total,
    critical,
    naturalOne,
    formula: parts.join(" + "),
    rolls
  };
}

export async function rollOpenD10({ label = "ABOREA.RollOpenD10", skipVisual = false } = {}) {
  if (skipVisual) return _evaluateOpenD10({ label });
  return showVisualRoll(game.i18n.localize(label), () => _evaluateOpenD10({ label }));
}

export async function rollAttribute(actor, attrKey) {
  const attrValue = actor.system.finalAttributes?.[attrKey]?.value
                 ?? actor.system.attributes?.[attrKey]?.value ?? 5;
  const bonus  = ABOREA.attributeBonus(attrValue);
  const label  = ABOREA.attributes[attrKey] ?? attrKey;
  const roll   = await rollOpenD10({ label });
  const total  = roll.total + bonus;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="aborea-chat-card">
        <h3>${game.i18n.localize(label)}</h3>
        <p>${game.i18n.localize("ABOREA.Roll")}: ${roll.formula}</p>
        <p>${game.i18n.localize("ABOREA.Bonus")}: ${bonus >= 0 ? "+" : ""}${bonus}</p>
        <p><strong>${game.i18n.localize("ABOREA.Total")}: ${total}</strong></p>
      </div>
    `
  });
  return total;
}

export async function rollSkill(actor, skillKey) {
  const b    = skillBonus(actor, skillKey);
  const roll = await rollOpenD10({ label: b.label });
  const total = roll.total + b.total;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="aborea-chat-card">
        <h3>${game.i18n.localize(b.label)}</h3>
        <p>${game.i18n.localize("ABOREA.Roll")}: ${roll.formula}</p>
        ${formatBreakdown(b.breakdown).map(l => `<p>${l}</p>`).join("")}
        <p><strong>${game.i18n.localize("ABOREA.Total")}: ${total}</strong></p>
      </div>
    `
  });

  return total;
}
