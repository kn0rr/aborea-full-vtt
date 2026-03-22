export const ABOREA = {
  id: "aborea-v7",
  attributes: {
    st: "ABOREA.AttributeST",
    ge: "ABOREA.AttributeGE",
    ko: "ABOREA.AttributeKO",
    in: "ABOREA.AttributeIN",
    ch: "ABOREA.AttributeCH"
  },
  skills: {
    athletik: { label: "ABOREA.SkillAthletik", attribute: "st" },
    natur: { label: "ABOREA.SkillNatur", attribute: "in" },
    heilkunst: { label: "ABOREA.SkillHeilkunst", attribute: "in" },
    heimlichkeit: { label: "ABOREA.SkillHeimlichkeit", attribute: "ge" },
    wahrnehmung: { label: "ABOREA.SkillWahrnehmung", attribute: "in" },
    ueberreden: { label: "ABOREA.SkillUeberreden", attribute: "ch" },
    mechanik: { label: "ABOREA.SkillMechanik", attribute: "in" },
    waffenlos: { label: "ABOREA.SkillWaffenlos", attribute: "st" },
    boegen: { label: "ABOREA.SkillBoegen", attribute: "ge" },
    aexte: { label: "ABOREA.SkillAexte", attribute: "st" },
    langeKlingenwaffe: { label: "ABOREA.SkillLangeKlingenwaffe", attribute: "st" },
    kurzeKlingenwaffe: { label: "ABOREA.SkillKurzeKlingenwaffe", attribute: "ge" },
    stangenwaffe: { label: "ABOREA.SkillStangenwaffe", attribute: "st" },
    wurfwaffe: { label: "ABOREA.SkillWurfwaffe", attribute: "ge" }
  },
  maneuvers: {
    routine: 5,
    sehrEinfach: 7,
    einfach: 8,
    schwer: 10,
    sehrSchwer: 12,
    aeusserstSchwer: 14,
    blankerLeichtsinn: 16,
    absurd: 18
  },
  attributeBonus(value) {
    const v = Number(value ?? 0);
    if (v <= 1) return -3;
    if (v === 2) return -2;
    if (v <= 4) return -1;
    if (v === 5) return 0;
    if (v <= 7) return 1;
    if (v <= 9) return 2;
    if (v <= 11) return 3;
    if (v <= 13) return 4;
    return 5;
  },
  initiativeBonus(actor) {
    return this.attributeBonus(actor?.system?.attributes?.ge?.value ?? 5);
  },
  combatBonus(attributeBonus, skillRank = 0) {
    const learnedPenalty = Number(skillRank) > 0 ? 0 : -2;
    return Number(attributeBonus) + Number(skillRank) + learnedPenalty;
  },
  defenseValue(armorValue = 5, defensiveBonus = 0) {
    return Number(armorValue) + Number(defensiveBonus);
  },
  attackValue(rollTotal, offensiveBonus = 0, situational = 0) {
    return Number(rollTotal) + Number(offensiveBonus) + Number(situational);
  },
  damage(attackValue, defenseValue, weaponDamage = 0) {
    return Math.max(1, Number(attackValue) - Number(defenseValue) + Number(weaponDamage));
  },
  naturalHealingPerDay(conBonus = 0) {
    return 1 + Number(conBonus);
  },
  mpRegenPerHour(attrBonus = 0) {
    return 1 + Number(attrBonus);
  }
};
