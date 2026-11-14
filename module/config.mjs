export const ABOREA = {
  /**
   * Münzbilder aus dem ABOREA-Spielleiterheft v8 (S. 35), freigestellt.
   * ABOREA steht unter CC BY-NC 4.0 — Nachweis in assets/images/QUELLEN.md.
   */
  coinIcons: {
    gf: "systems/aborea-v7/assets/images/muenzen/goldfalke.webp",
    tt: "systems/aborea-v7/assets/images/muenzen/trionthaler.webp",
    kl: "systems/aborea-v7/assets/images/muenzen/kupferling.webp",
    mu: "systems/aborea-v7/assets/images/muenzen/muena.webp",
  },
  id: "aborea-v7",
  attributeBudget: 35,
  baseTrainingPoints: 8,

  /**
   * Offizielle Stufentabelle: Index 0 = Stufe 1, Index 1 = Stufe 2 usw.
   * Wert = EP, die zum Erreichen dieser Stufe benötigt werden.
   */
  xpTable: [
       0,  1000,  4000,  8000, 13000, 19000, 26000, 34000,
    43000, 53000, 64000, 76000, 89000,103000,118000,134000,
   151000,169000,188000,208000
  ],

  /** Gibt die Stufe zurück, die einem EP-Wert entspricht. */
  levelForXp(xp) {
    let level = 1;
    for (let i = 0; i < this.xpTable.length; i++) {
      if (Number(xp) >= this.xpTable[i]) level = i + 1;
      else break;
    }
    return level;
  },
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
    // spruchlisten + waffen kept without creation:true for backward compat (legacy actors)
    spruchlisten: { label: "ABOREA.SkillSpruchlisten", attribute: "in" },
    waffen: { label: "ABOREA.SkillWaffen", attribute: "st", untrained: -2 },
    wahrnehmung: { label: "ABOREA.SkillWahrnehmung", attribute: "in", creation: true },
    wissen: { label: "ABOREA.SkillWissen", attribute: "in", creation: true, untrained: -2 },
    // Weapon skills — each group is a separate creation skill; class cost lookup uses "waffen"
    waffenlos: { label: "ABOREA.SkillWaffenlos", attribute: "st", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    boegen: { label: "ABOREA.SkillBoegen", attribute: "ge", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    aexte: { label: "ABOREA.SkillAexte", attribute: "st", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    langeKlingenwaffe: { label: "ABOREA.SkillLangeKlingenwaffe", attribute: "st", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    kurzeKlingenwaffe: { label: "ABOREA.SkillKurzeKlingenwaffe", attribute: "ge", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    stangenwaffe: { label: "ABOREA.SkillStangenwaffe", attribute: "st", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    wurfwaffe: { label: "ABOREA.SkillWurfwaffe", attribute: "ge", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    armbrust: { label: "ABOREA.SkillArmbrust", attribute: "ge", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    stichwaffe: { label: "ABOREA.SkillStichwaffe", attribute: "ge", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    wuchtwaffe: { label: "ABOREA.SkillWuchtwaffe", attribute: "st", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    schleuder: { label: "ABOREA.SkillSchleuder", attribute: "ge", creation: true, maxCreationRank: 2, costGroup: "waffen", untrained: -2 },
    // Spell list skills — each list is a separate creation skill; class cost lookup uses "spruchlisten"
    wildeMagie: { label: "ABOREA.SkillWildeMagie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Wilde Magie" },
    elementareMagie: { label: "ABOREA.SkillElementareMagie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Elementare Magie" },
    freieMagie: { label: "ABOREA.SkillFreieMagie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Freie Magie" },
    schwarzeMagie: { label: "ABOREA.SkillSchwarze_Magie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Schwarze Magie" },
    weisseMagie: { label: "ABOREA.SkillWeisseMagie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Weiße Magie" },
    bardenmagie: { label: "ABOREA.SkillBardenmagie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Bardenmagie (Leitmagie)" },
    schamanenmagie: { label: "ABOREA.SkillSchamanenmagie", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Schamanenmagie (Leitmagie)" },
    wunder: { label: "ABOREA.SkillWunder", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Wunder (Leitmagie)" },
    zeichen: { label: "ABOREA.SkillZeichen", attribute: "in", creation: true, maxCreationRank: 2, costGroup: "spruchlisten", spellList: "Zeichen (Leitmagie)" },
    fallen: { label: "ABOREA.SkillFallen", attribute: "in", creation: true, maxCreationRank: 2, untrained: -2 },
    geheimtuer: { label: "ABOREA.SkillGeheimtuer", attribute: "in", creation: true, maxCreationRank: 1, untrained: -2 },
    mechanik: { label: "ABOREA.SkillMechanik", attribute: "in", creation: true, maxCreationRank: 2, untrained: -2 },
    gift: { label: "ABOREA.SkillGift", attribute: "in", creation: true, maxCreationRank: 2, untrained: -2 },
    heimlichkeit: { label: "ABOREA.SkillHeimlichkeit", attribute: "ge", creation: true, maxCreationRank: 2, untrained: -2 },
    heilen: { label: "ABOREA.SkillHeilen", attribute: "ch", creation: true, maxCreationRank: 1, untrained: -2 },
    information: { label: "ABOREA.SkillInformation", attribute: "ch", creation: true, maxCreationRank: 1, untrained: -2 },
    magieWahrnehmen: { label: "ABOREA.SkillMagieWahrnehmen", attribute: "in", creation: true, maxCreationRank: 1 }
  },
  weaponSkillKeys: ["waffenlos","boegen","armbrust","aexte","langeKlingenwaffe","kurzeKlingenwaffe","stichwaffe","stangenwaffe","wuchtwaffe","wurfwaffe","schleuder"],
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
  /**
   * Lernschritte für einen Rang (Spielerheft S. 30): bis Rang 4 genügt ein
   * Lernen, für Rang 5 bis 9 muss man "doppelt" lernen, ab Rang 10 vierfach.
   * Wie oft man pro Stufe lernen darf, bleibt gleich (1 oder 2) — höhere
   * Ränge brauchen deshalb mehrere Stufen.
   */
  learningsForRank(rank) {
    const r = Number(rank) || 0;
    if (r <= 0) return 0;
    return r >= 10 ? 4 : r >= 5 ? 2 : 1;
  },
  /** Lernschritte insgesamt bis zu diesem Rang. */
  learnedForRank(rank) {
    let total = 0;
    for (let r = 1; r <= Math.floor(Number(rank) || 0); r++) total += this.learningsForRank(r);
    return total;
  },
  /** Rang nach so vielen Lernschritten — angefangene Ränge zählen noch nicht. */
  rankForLearned(learned) {
    const l = Math.max(0, Math.floor(Number(learned) || 0));
    let rank = 0;
    while (this.learnedForRank(rank + 1) <= l) rank++;
    return rank;
  },
  /**
   * Lernschritte einer Fertigkeit. Ohne Angabe — ältere Charaktere, oder ein
   * Rang, der woanders von Hand geändert wurde — zählt der Rang.
   */
  skillLearned(entry = {}) {
    const rank = Math.max(0, Math.floor(Number(entry?.rank) || 0));
    const learned = Number(entry?.learned);
    if (Number.isFinite(learned) && learned >= 0 && this.rankForLearned(learned) === rank) return Math.floor(learned);
    return this.learnedForRank(rank);
  },
  /** "1/2", wenn ein Lernschritt von zweien zum nächsten Rang getan ist, sonst "". */
  learningProgress(entry = {}) {
    const learned = this.skillLearned(entry);
    const rank = this.rankForLearned(learned);
    const done = learned - this.learnedForRank(rank);
    return done > 0 ? `${done}/${this.learningsForRank(rank + 1)}` : "";
  },
  /**
   * AP für die Lernschritte innerhalb *einer* Stufe: das erste Lernen kostet
   * Wert1, das zweite Wert2 (Spielerheft S. 30). Die Kosten hängen nicht vom
   * Rang ab — höhere Ränge sind teurer, weil sie mehr Lernschritte brauchen.
   *
   * @param {string} costSpec     "2" oder "1/3"
   * @param {number} fromLearned  Lernschritte zu Beginn der Stufe
   * @param {number} toLearned    Lernschritte jetzt
   */
  levelLearningCost(costSpec, fromLearned = 0, toLearned = 0) {
    const parts = String(costSpec ?? "0").split("/").map(p => Number(p.trim())).filter(n => Number.isFinite(n));
    if (!parts.length) return 0;
    const from = Math.max(0, Math.floor(Number(fromLearned) || 0));
    const to   = Math.max(0, Math.floor(Number(toLearned) || 0));
    let total = 0;
    for (let n = 0; n < to - from; n++) total += parts[Math.min(n, parts.length - 1)];
    return total;
  },
  /**
   * Ausgegebene AP: was in abgeschlossenen Stufen ausgegeben wurde, plus die
   * Lernschritte der laufenden Stufe.
   *
   * Vorher wurde über alle Ränge seit Spielbeginn gerechnet, mit dem Wert
   * für den x-ten Rang insgesamt: wer auf Stufe 1 zweimal lernte, zahlte auf
   * Stufe 2 fürs erste Lernen den teureren Wert2, und ab Rang 5 genügte ein
   * Lernen pro Rang.
   *
   * @param {object} ledger  {spentBefore, learnedAtStart: {fertigkeit: Lernschritte}}
   *        ohne Angaben: Erschaffung, alles in Stufe 1
   */
  trainingSpentByLevel(skills = {}, classSystem = {}, customSkills = [], ledger = {}) {
    const costs = classSystem?.skillCosts ?? {};
    const start = ledger?.learnedAtStart ?? {};
    let total = Math.max(0, Number(ledger?.spentBefore) || 0);
    for (const [key, cfg] of Object.entries(this.skills)) {
      if (!cfg.creation) continue;
      const costKey = cfg.costGroup ?? key;
      total += this.levelLearningCost(costs[costKey] ?? costs[key], start[key] ?? 0, this.skillLearned(skills?.[key]));
    }
    const csArray = Array.isArray(customSkills) ? customSkills : Object.values(customSkills || {});
    for (const cs of csArray) total += this.levelLearningCost(cs.cost ?? "1", start[cs.key] ?? 0, this.skillLearned(cs));
    return total;
  },
  /** Lernschritte aller Fertigkeiten, auch der eigenen: {schlüssel: Schritte}. */
  learnedSnapshot(skills = {}, customSkills = []) {
    const out = {};
    for (const [key, s] of Object.entries(skills ?? {})) out[key] = this.skillLearned(s);
    for (const cs of (Array.isArray(customSkills) ? customSkills : Object.values(customSkills || {}))) out[cs.key] = this.skillLearned(cs);
    return out;
  },
  /**
   * Das Kassenbuch eines Charakters. Ältere Charaktere haben keins: dann gilt
   * die alte Gesamtrechnung als bis zum Beginn der laufenden Stufe
   * ausgegeben — mitten im Aufstieg ab dem gemerkten Rangstand, sonst ab
   * jetzt.
   */
  trainingLedger(creation = {}, skills = {}, classSystem = {}, customSkills = [], level = 1) {
    const l = creation?.trainingLedger;
    if (l && typeof l === "object" && l.learnedAtStart) return l;
    const csArray = Array.isArray(customSkills) ? customSkills : Object.values(customSkills || {});
    if (creation?.status === "leveling" && creation?.levelingRankSnapshot) {
      const snap = creation.levelingRankSnapshot;
      const atStart = Object.fromEntries(Object.entries(snap).map(([k, r]) => [k, { rank: r }]));
      const csAtStart = csArray.map(cs => ({ ...cs, rank: snap[cs.key] ?? 0, learned: undefined }));
      return {
        spentBefore: this.skillTrainingSpent(atStart, classSystem, csAtStart),
        learnedAtStart: Object.fromEntries(Object.entries(snap).map(([k, r]) => [k, this.learnedForRank(r)])),
      };
    }
    // Erschaffung auf Stufe 1: alles gehört zur ersten Stufe.
    if (!creation?.completed && (Number(level) || 1) <= 1) return { spentBefore: 0, learnedAtStart: {} };
    return { spentBefore: this.skillTrainingSpent(skills, classSystem, csArray), learnedAtStart: this.learnedSnapshot(skills, csArray) };
  },
  skillTrainingSpent(skills = {}, classSystem = {}, customSkills = []) {
    const costs = classSystem?.skillCosts ?? {};
    let total = 0;
    for (const [key, cfg] of Object.entries(this.skills)) {
      if (!cfg.creation) continue;
      const rank = Number(skills?.[key]?.rank ?? 0);
      const costKey = cfg.costGroup ?? key;
      for (let r = 1; r <= rank; r++) total += this.skillCostForRank(costs[costKey] ?? costs[key], r);
    }
    const csArray = Array.isArray(customSkills) ? customSkills : Object.values(customSkills || {});
    for (const cs of csArray) {
      const rank = Number(cs.rank ?? 0);
      for (let r = 1; r <= rank; r++) total += this.skillCostForRank(cs.cost ?? "1", r);
    }
    return total;
  },
  skillMaxCreationRank(key, classSystem = {}) {
    const skillCfg = this.skills[key] ?? {};
    const base = Number(skillCfg.maxCreationRank ?? 1);
    const costKey = skillCfg.costGroup ?? key;
    const parts = String(classSystem?.skillCosts?.[costKey] ?? classSystem?.skillCosts?.[key] ?? "").split("/").filter(Boolean);
    return Math.max(base, parts.length > 1 ? 2 : 1);
  },
  /** Returns the spell list skill key for a given list name, or null. */
  spellListToSkillKey(listName) {
    for (const [key, cfg] of Object.entries(this.skills)) {
      if (cfg.spellList === listName) return key;
    }
    return null;
  },
  spellListSkillKeys: ["wildeMagie","elementareMagie","freieMagie","schwarzeMagie","weisseMagie","bardenmagie","schamanenmagie","wunder","zeichen"],
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
    const geBonus = this.attributeBonus(
      actor?.system?.attributes?.ge?.value ??
      actor?.system?.finalAttributes?.ge?.value ?? 5
    );
    const weapons = actor?.items?.filter(i => i.type === "weapon" && i.system.equipped) ?? [];
    const weaponMod = weapons.length
      ? weapons.reduce((best, w) => Math.max(best, Number(w.system.initiative ?? 0)), -Infinity)
      : 0;
    return geBonus + weaponMod;
  },
  defenseValue(armorValue = 5, defensiveBonus = 0) {
    return Number(armorValue) + Number(defensiveBonus);
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
