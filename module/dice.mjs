import { ABOREA } from "./config.mjs";

export async function rollOpenD10({ label = "ABOREA.RollOpenD10" } = {}) {
  let total = 0;
  const parts = [];
  let critical = false;
  let naturalOne = false;

  while (true) {
    const roll = await (new Roll("1d10")).evaluate();
    const result = Number(roll.total);
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
    formula: parts.join(" + ")
  };
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
  const skill = actor.system.skills?.[skillKey] ?? { rank: 0, attribute: "in" };
  const attrKey = skill.attribute || ABOREA.skills?.[skillKey]?.attribute || "in";
  const attrValue = actor.system.attributes?.[attrKey]?.value ?? 5;
  const attrBonus = ABOREA.attributeBonus(attrValue);
  const rank = Number(skill.rank ?? 0);
  const roll = await rollOpenD10({ label: skill.label ?? skillKey });
  const total = roll.total + attrBonus + rank;
  const label = skill.label ?? ABOREA.skills?.[skillKey]?.label ?? skillKey;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="aborea-chat-card">
        <h3>${game.i18n.localize(label)}</h3>
        <p>${game.i18n.localize("ABOREA.Roll")}: ${roll.formula}</p>
        <p>${game.i18n.localize(ABOREA.attributes[attrKey])}: ${attrBonus >= 0 ? "+" : ""}${attrBonus}</p>
        <p>${game.i18n.localize("ABOREA.Rank")}: ${rank >= 0 ? "+" : ""}${rank}</p>
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
