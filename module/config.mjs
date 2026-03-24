export const ABOREA = {
  id: "aborea-v7",
  attributeBudget: 35,
  baseTrainingPoints: 8,
  attributes: {
    st: "ABOREA.AttributeST",
    ge: "ABOREA.AttributeGE",
    ko: "ABOREA.AttributeKO",
    in: "ABOREA.AttributeIN",
    ch: "ABOREA.AttributeCH"
  },
  skills: {
    athletik: { label: "ABOREA.SkillAthletik", attribute: "st", creation: true },
    einflussnahme: { label: "ABOREA.SkillEinflussnahme", attribute: "ch", creation: true },
    gezielteSprueche: { label: "ABOREA.SkillGezielteSprueche", attribute: "in", creation: true, maxCreationRank: 1 },
    kunst: { label: "ABOREA.SkillKunst", attribute: "ch", creation: true },
    list: { label: "ABOREA.SkillList", attribute: "in", creation: true },
    magieEntwickeln: { label: "ABOREA.SkillMagieEntwickeln", attribute: "in", creation: true, maxCreationRank: 2 },
    natur: { label: "ABOREA.SkillNatur", attribute: "in", creation: true },
    reiten: { label: "ABOREA.SkillReiten", attribute: "ge", creation: true },
    schwimmen: { label: "ABOREA.SkillSchwimmen", attribute: "ko", creation: true },
    spruchlisten: { label: "ABOREA.SkillSpruchlisten", attribute: "in", creation: true, maxCreationRank: 2 },
    waffen: { label: "ABOREA.SkillWaffen", attribute: "st", creation: true, maxCreationRank: 2 },
    wahrnehmung: { label: "ABOREA.SkillWahrnehmung", attribute: "in", creation: true },
    wissen: { label: "ABOREA.SkillWissen", attribute: "in", creation: true },
    waffenlos: { label: "ABOREA.SkillWaffenlos", attribute: "st" },
    boegen: { label: "ABOREA.SkillBoegen", attribute: "ge" },
    aexte: { label: "ABOREA.SkillAexte", attribute: "st" },
    langeKlingenwaffe: { label: "ABOREA.SkillLangeKlingenwaffe", attribute: "st" },
    kurzeKlingenwaffe: { label: "ABOREA.SkillKurzeKlingenwaffe", attribute: "ge" },
    stangenwaffe: { label: "ABOREA.SkillStangenwaffe", attribute: "st" },
    wurfwaffe: { label: "ABOREA.SkillWurfwaffe", attribute: "ge" },
    fallen: { label: "ABOREA.SkillFallen", attribute: "in" },
    gift: { label: "ABOREA.SkillGift", attribute: "in" },
    heimlichkeit: { label: "ABOREA.SkillHeimlichkeit", attribute: "ge" },
    heilen: { label: "ABOREA.SkillHeilen", attribute: "ch" },
    information: { label: "ABOREA.SkillInformation", attribute: "ch" },
    magieWahrnehmen: { label: "ABOREA.SkillMagieWahrnehmen", attribute: "in" }
  },
  weaponSkillKeys: ["waffenlos","boegen","aexte","langeKlingenwaffe","kurzeKlingenwaffe","stangenwaffe","wurfwaffe"],
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
  attributeCost(value) {
    const v = Number(value ?? 1);
    if (v <= 0) return 0;
    if (v <= 6) return v;
    if (v === 7) return 8;
    if (v === 8) return 10;
    if (v === 9) return 12;
    return 16;
  },
  attributeCostTotal(attributes = {}) {
    return Object.values(attributes).reduce((sum, entry) => sum + this.attributeCost(entry?.value ?? entry ?? 1), 0);
  },
  skillCostForRank(costSpec, rank = 1) {
    const parts = String(costSpec ?? "0").split("/").map(p => Number(p.trim())).filter(n => Number.isFinite(n));
    if (!parts.length) return 0;
    if (rank <= 1) return parts[0];
    return parts[Math.min(rank - 1, parts.length - 1)] ?? parts[parts.length - 1];
  },
  skillTrainingSpent(skills = {}, classSystem = {}) {
    const costs = classSystem?.skillCosts ?? {};
    let total = 0;
    for (const [key, cfg] of Object.entries(this.skills)) {
      if (!cfg.creation) continue;
      const rank = Number(skills?.[key]?.rank ?? 0);
      for (let r = 1; r <= rank; r++) total += this.skillCostForRank(costs[key], r);
    }
    return total;
  },
  skillMaxCreationRank(key, classSystem = {}) {
    const skillCfg = this.skills[key] ?? {};
    const base = Number(skillCfg.maxCreationRank ?? 1);
    const parts = String(classSystem?.skillCosts?.[key] ?? "").split("/").filter(Boolean);
    return Math.max(base, parts.length > 1 ? 2 : 1);
  },
  getCreationSkills() {
    return Object.entries(this.skills).filter(([, cfg]) => cfg.creation).map(([key, cfg]) => ({ key, ...cfg }));
  },
  customSkillTemplate(index = 0) {
    return {
      key: `custom-${index}`,
      name: `Neue Fähigkeit ${index + 1}`,
      attribute: "in",
      rank: 0,
      source: "custom"
    };
  },
  activeClassFeatures(classSystem = {}, level = 1) {
    const features = Array.isArray(classSystem?.levelFeatures) ? classSystem.levelFeatures : [];
    return features.filter(f => Number(f.level ?? 1) <= Number(level ?? 1)).sort((a, b) => Number(a.level ?? 1) - Number(b.level ?? 1));
  },
  initiativeBonus(actor) {
    return this.attributeBonus(actor?.system?.attributes?.ge?.value ?? actor?.system?.finalAttributes?.ge?.value ?? 5);
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
  },
  parseRestrictions(text = "") {
    return String(text).split(/[;,]/).map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/^Kein\s+(.+)$/i);
      return m ? { type: "forbidClass", value: m[1].trim() } : { type: "text", value: s };
    });
  },
  classAllowedForRace(raceSystem = {}, className = "") {
    const rules = this.parseRestrictions(raceSystem?.restrictions ?? "");
    return !rules.some(r => r.type === "forbidClass" && r.value.toLowerCase() === String(className).toLowerCase());
  }
};
