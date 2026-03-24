import { ABOREA } from "./config.mjs";

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
  if (!game.dice3d?.showForRoll || !Array.isArray(result.rolls) || !result.rolls.length) return false;
  try {
    for (const roll of result.rolls) {
      await game.dice3d.showForRoll(roll, game.user, true);
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

export async function rollOpenD10({ label = "ABOREA.RollOpenD10" } = {}) {
  return showVisualRoll(game.i18n.localize(label), () => _evaluateOpenD10({ label }));
}

export async function rollInitiative(actor) {
  const roll = await rollOpenD10({ label: game.i18n.localize("ABOREA.Initiative") });
  const bonus = ABOREA.initiativeBonus(actor);
  const total = roll.total + bonus;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="aborea-chat-card">
        <h3>${game.i18n.localize("ABOREA.Initiative")}</h3>
        <p>${game.i18n.localize("ABOREA.Roll")}: ${roll.formula}</p>
        <p>${game.i18n.localize("ABOREA.AttributeGE")}: ${bonus >= 0 ? "+" : ""}${bonus}</p>
        <p><strong>${game.i18n.localize("ABOREA.Total")}: ${total}</strong></p>
      </div>
    `
  });

  return total;
}

export async function rollSkill(actor, skillKey) {
  const custom = (actor.system.customSkills || []).find(s => s.key === skillKey);
  const skill = custom ?? actor.system.skills?.[skillKey] ?? { rank: 0, attribute: "in" };
  const attrKey = skill.attribute || ABOREA.skills?.[skillKey]?.attribute || "in";
  const attrValue = actor.system.attributes?.[attrKey]?.value ?? 5;
  const attrBonus = ABOREA.attributeBonus(attrValue);
  const rank = Number(skill.rank ?? 0);
  const classBonus = Number(actor.system.classFeatures?.bonuses?.[skillKey] ?? skill.bonus ?? 0);
  const roll = await rollOpenD10({ label: skill.label ?? skill.name ?? skillKey });
  const total = roll.total + attrBonus + rank + classBonus;
  const label = skill.label ?? skill.name ?? ABOREA.skills?.[skillKey]?.label ?? skillKey;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="aborea-chat-card">
        <h3>${game.i18n.localize(label)}</h3>
        <p>${game.i18n.localize("ABOREA.Roll")}: ${roll.formula}</p>
        <p>${game.i18n.localize(ABOREA.attributes[attrKey])}: ${attrBonus >= 0 ? "+" : ""}${attrBonus}</p>
        <p>${game.i18n.localize("ABOREA.Rank")}: ${rank >= 0 ? "+" : ""}${rank}</p>
        <p>${game.i18n.localize("ABOREA.ClassBonus")}: ${classBonus >= 0 ? "+" : ""}${classBonus}</p>
        <p><strong>${game.i18n.localize("ABOREA.Total")}: ${total}</strong></p>
      </div>
    `
  });

  return total;
}

export async function rollAttack(actor, weapon, { targetDefense = null, situational = 0 } = {}) {
  const roll = await rollOpenD10({ label: game.i18n.localize("ABOREA.Attack") });
  const offensiveBonus = Number(actor.system.combat?.offensiveBonus ?? 0);
  const attackValue = ABOREA.attackValue(roll.total, offensiveBonus, situational);
  const weaponDamage = Number(weapon?.system?.damage ?? 0);
  const defense = targetDefense ?? Number(actor.system.combat?.targetDefense ?? 5);
  const isNaturalOneMiss = roll.naturalOne;
  const hit = !isNaturalOneMiss && attackValue > defense;
  const damage = hit ? ABOREA.damage(attackValue, defense, weaponDamage) : 0;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="aborea-chat-card">
        <h3>${weapon?.name ?? game.i18n.localize("ABOREA.Attack")}</h3>
        <p>${game.i18n.localize("ABOREA.Roll")}: ${roll.formula}</p>
        <p>${game.i18n.localize("ABOREA.OffensiveBonus")}: ${offensiveBonus >= 0 ? "+" : ""}${offensiveBonus}</p>
        <p>${game.i18n.localize("ABOREA.SituationalModifier")}: ${Number(situational) >= 0 ? "+" : ""}${Number(situational)}</p>
        <p>${game.i18n.localize("ABOREA.AttackValue")}: ${attackValue}</p>
        <p>${game.i18n.localize("ABOREA.DefenseValue")}: ${defense}</p>
        <p><strong>${hit ? game.i18n.localize("ABOREA.Hit") : game.i18n.localize("ABOREA.Miss")}</strong></p>
        ${hit ? `<p>${game.i18n.localize("ABOREA.Damage")}: ${damage}</p>` : ""}
        ${roll.critical ? `<p>${game.i18n.localize("ABOREA.CriticalHint")}</p>` : ""}
        ${isNaturalOneMiss ? `<p>${game.i18n.localize("ABOREA.NaturalOneMiss")}</p>` : ""}
      </div>
    `
  });

  return { attackValue, defense, hit, damage, critical: roll.critical, naturalOne: isNaturalOneMiss };
}
