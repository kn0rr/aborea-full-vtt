/**
 * data-models.mjs — ABOREA TypeDataModel definitions
 *
 * Replaces template.json for Foundry v13+.
 * All complex nested structures use ObjectField / ArrayField so that
 * existing stored data is preserved without strict-schema migration.
 */

const { fields } = foundry.data;

// ── Shared helpers ────────────────────────────────────────────────

function attrField(initial = 5) {
  return new fields.SchemaField({
    value: new fields.NumberField({ required: true, nullable: false, initial, integer: true })
  });
}

function attrsBlock() {
  return new fields.SchemaField({
    st: attrField(), ge: attrField(), ko: attrField(),
    in: attrField(), ch: attrField()
  });
}

function resourcesBlock() {
  return new fields.SchemaField({
    hp:             new fields.SchemaField({
      value: new fields.NumberField({ initial: 5 }),
      max:   new fields.NumberField({ initial: 5 })
    }),
    mp:             new fields.SchemaField({
      value: new fields.NumberField({ initial: 0 }),
      max:   new fields.NumberField({ initial: 0 })
    }),
    xp:             new fields.NumberField({ initial: 0 }),
    level:          new fields.NumberField({ initial: 1, integer: true }),
    trainingPoints: new fields.NumberField({ initial: 0 })
  });
}

// ══════════════════════════════════════════════════════════════════
//  Actor Data Models
// ══════════════════════════════════════════════════════════════════

export class CharacterDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes:      attrsBlock(),
      baseAttributes:  attrsBlock(),
      finalAttributes: attrsBlock(),
      resources:       resourcesBlock(),
      combat: new fields.ObjectField({ initial: () => ({
        initiative: 0, combatBonus: 0, offensiveBonus: 0, defensiveBonus: 0,
        defenseValue: 5, armorValue: 0, targetDefense: 5
      })}),
      details: new fields.ObjectField({ initial: () => ({
        race: "", class: "", god: "", size: "mittel", notes: ""
      })}),
      skills:       new fields.ObjectField({ initial: () => ({}) }),
      customSkills: new fields.ArrayField(new fields.ObjectField()),
      talents:      new fields.ArrayField(new fields.ObjectField()),
      classFeatures: new fields.ObjectField({ initial: () => ({
        list: [], labels: [], notes: [], flags: {}, bonuses: {},
        armorBonus: 0, weaponMinimums: {}, followers: 0,
        activations: {}, lastResetDay: ""
      })}),
      companions: new fields.ObjectField({ initial: () => ({ list: [] }) }),
      wallet: new fields.ObjectField({ initial: () => ({
        currencies: [
          { key: "gf", label: "GF",  name: "Goldfalken",       amount: 0 },
          { key: "tt", label: "TT",  name: "Trionthaler",      amount: 0 },
          { key: "kl", label: "KL",  name: "Kupferlinge",      amount: 0 },
          { key: "mu", label: "MU",  name: "Münzen unbekannt", amount: 0 }
        ],
        history: []
      })}),
      inventoryHistory: new fields.ArrayField(new fields.ObjectField()),
      traits: new fields.ObjectField({ initial: () => ({
        racialArmorBonus: 0, maneuverBonus: 0, spellResistance: false,
        diseaseImmunity: false, secretDoorsBonus: false,
        mechanicsBonus: false, thermalVision: false
      })}),
      creation: new fields.ObjectField({ initial: () => ({
        status: "draft", completed: false,
        pointsBudget: 35, pointsSpent: 25, pointsRemaining: 10,
        validationErrors: [],
        trainingBudget: 8, trainingSpent: 0, trainingRemaining: 8,
        appliedStarterPackage: ""
      })})
    };
  }
}

export class NpcDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes:      attrsBlock(),
      baseAttributes:  attrsBlock(),
      finalAttributes: attrsBlock(),
      resources:       resourcesBlock(),
      combat: new fields.ObjectField({ initial: () => ({
        initiative: 0, combatBonus: 0, offensiveBonus: 0, defensiveBonus: 0,
        defenseValue: 5, armorValue: 5, targetDefense: 5
      })}),
      details: new fields.ObjectField({ initial: () => ({
        race: "", class: "", size: "mittel", notes: ""
      })}),
      traits:        new fields.ObjectField({ initial: () => ({}) }),
      creation:      new fields.ObjectField({ initial: () => ({}) }),
      weaponSkills:  new fields.ObjectField({ initial: () => ({}) }),
      magicSkills:   new fields.ObjectField({ initial: () => ({}) }),
      role:          new fields.StringField({ initial: "" }),
      faction:       new fields.StringField({ initial: "" }),
      wallet: new fields.ObjectField({ initial: () => ({ gf: 0, tt: 0, kl: 0, mu: 0 }) }),
    };
  }
}

export class CreatureDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      attributes:      attrsBlock(),
      baseAttributes:  attrsBlock(),
      finalAttributes: attrsBlock(),
      resources:       resourcesBlock(),
      combat: new fields.ObjectField({ initial: () => ({
        initiative: 0, combatBonus: 0, offensiveBonus: 0, defensiveBonus: 0,
        defenseValue: 5, armorValue: 5, targetDefense: 5
      })}),
      details: new fields.ObjectField({ initial: () => ({
        race: "", class: "", size: "mittel", notes: ""
      })}),
      traits:       new fields.ObjectField({ initial: () => ({}) }),
      creation:     new fields.ObjectField({ initial: () => ({}) }),
      weaponSkills: new fields.ObjectField({ initial: () => ({}) }),
      magicSkills:  new fields.ObjectField({ initial: () => ({}) }),
      creature: new fields.ObjectField({ initial: () => ({
        kind: "", threat: 1, regeneration: 0,
        resistances: "", vulnerability: "", special: ""
      })}),
      summon: new fields.ObjectField({ initial: () => ({
        ownerActorId: "", sourceItemId: "", sourceItemName: "",
        summonType: "", summonLevel: 0, mpCost: 0,
        permanent: false, durationLabel: "", expiresAt: null, active: false
      })}),
      wallet: new fields.ObjectField({ initial: () => ({ gf: 0, tt: 0, kl: 0, mu: 0 }) }),
    };
  }
}

// ══════════════════════════════════════════════════════════════════
//  Loot Actor
// ══════════════════════════════════════════════════════════════════

export class LootDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:     new fields.StringField({ initial: "" }),
      locked:          new fields.BooleanField({ initial: false }),
      lockDifficulty:  new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      wallet: new fields.ObjectField({ initial: () => ({ gf: 0, tt: 0, kl: 0, mu: 0 }) }),
    };
  }
}

// ══════════════════════════════════════════════════════════════════
//  Item Data Models
// ══════════════════════════════════════════════════════════════════

export class RaceDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:  new fields.StringField({ initial: "" }),
      equipped:     new fields.BooleanField({ initial: false }),
      mods: new fields.ObjectField({ initial: () => ({
        st: 0, ge: 0, ko: 0, in: 0, ch: 0
      })}),
      special:       new fields.StringField({ initial: "" }),
      restrictions:  new fields.StringField({ initial: "" }),
      allowedClasses: new fields.ArrayField(new fields.StringField()),
      traits: new fields.ObjectField({ initial: () => ({}) })
    };
  }
}

export class ClassDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:    new fields.StringField({ initial: "" }),
      equipped:       new fields.BooleanField({ initial: false }),
      hitPointsBase:  new fields.NumberField({ initial: 5 }),
      magicAttribute: new fields.StringField({ initial: "" }),
      special:        new fields.StringField({ initial: "" }),
      magicFormula:   new fields.StringField({ initial: "" }),
      skillCosts:     new fields.ObjectField({ initial: () => ({}) }),
      skillBonuses:   new fields.ObjectField({ initial: () => ({}) }),
      features:       new fields.ArrayField(new fields.ObjectField())
    };
  }
}

export class SkillDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      linkedAttribute: new fields.StringField({ initial: "" }),
      rank:            new fields.NumberField({ initial: 0, integer: true })
    };
  }
}

export class WeaponDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      skill:       new fields.StringField({ initial: "" }),
      minStrength: new fields.NumberField({ initial: 0 }),
      damage:      new fields.NumberField({ initial: 0 }),
      initiative:  new fields.NumberField({ initial: 0 }),
      range:       new fields.StringField({ initial: "kurz" }),
      attrChoices: new fields.ArrayField(new fields.StringField()),
      hands:       new fields.NumberField({ initial: 1, integer: true }),
      price:       new fields.StringField({ initial: "" }),
      weight:      new fields.NumberField({ initial: 0 }),
      notes:       new fields.StringField({ initial: "" })
    };
  }
}

export class ArmorDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      minStrength: new fields.NumberField({ initial: 0 }),
      armor:       new fields.NumberField({ initial: 5 }),
      maneuverMod: new fields.NumberField({ initial: 0 }),
      price:       new fields.StringField({ initial: "" }),
      weight:      new fields.NumberField({ initial: 0 }),
      notes:       new fields.StringField({ initial: "" })
    };
  }
}

export class SpellDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      rank:        new fields.NumberField({ initial: 1, integer: true }),
      cost:        new fields.NumberField({ initial: 1 }),
      school:      new fields.StringField({ initial: "" }),
      list:        new fields.StringField({ initial: "" }),
      costOptions: new fields.ArrayField(new fields.ObjectField()),
      range:       new fields.StringField({ initial: "" }),
      targeted:    new fields.BooleanField({ initial: false }),
      duration:    new fields.StringField({ initial: "" }),
      sourcePage:  new fields.NumberField({ initial: 0 }),
      sourcePdf:   new fields.StringField({ initial: "" }),
      slug:        new fields.StringField({ initial: "" }),
      externalId:  new fields.StringField({ initial: "" }),
      effects:     new fields.ArrayField(new fields.ObjectField()),
      hpEffect:    new fields.ObjectField({ initial: () => ({}) }),
      summonRule:  new fields.ObjectField({ initial: () => ({}) }),
      notes:       new fields.StringField({ initial: "" })
    };
  }
}

export class MiracleDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      rank:        new fields.NumberField({ initial: 1, integer: true }),
      cost:        new fields.NumberField({ initial: 1 }),
      domain:      new fields.StringField({ initial: "" }),
      list:        new fields.StringField({ initial: "" }),
      costOptions: new fields.ArrayField(new fields.ObjectField()),
      range:       new fields.StringField({ initial: "" }),
      targeted:    new fields.BooleanField({ initial: false }),
      duration:    new fields.StringField({ initial: "" }),
      sourcePage:  new fields.NumberField({ initial: 0 }),
      sourcePdf:   new fields.StringField({ initial: "" }),
      slug:        new fields.StringField({ initial: "" }),
      externalId:  new fields.StringField({ initial: "" }),
      effects:     new fields.ArrayField(new fields.ObjectField()),
      hpEffect:    new fields.ObjectField({ initial: () => ({}) }),
      summonRule:  new fields.ObjectField({ initial: () => ({}) }),
      notes:       new fields.StringField({ initial: "" })
    };
  }
}

export class GearDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      quantity:    new fields.NumberField({ initial: 1, integer: true }),
      weight:      new fields.NumberField({ initial: 0 }),
      price:       new fields.StringField({ initial: "" }),
      notes:       new fields.StringField({ initial: "" }),
      healAmount:  new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      healType:    new fields.StringField({ initial: "hp" })
    };
  }
}

export class GodDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      pantheon:     new fields.StringField({ initial: "" }),
      rank:         new fields.StringField({ initial: "" }),
      aspects:      new fields.StringField({ initial: "" }),
      weapon:       new fields.StringField({ initial: "" }),
      weaponSkills: new fields.ArrayField(new fields.StringField()),
      symbol:       new fields.StringField({ initial: "" }),
      miracleList:  new fields.StringField({ initial: "" })
    };
  }
}

export class MagicItemDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description:       new fields.StringField({ initial: "" }),
      descriptionLocked: new fields.BooleanField({ initial: false }),
      equipped:          new fields.BooleanField({ initial: false }),
      notes:         new fields.StringField({ initial: "" }),
      price:         new fields.StringField({ initial: "" }),
      weight:        new fields.NumberField({ initial: 0 }),
      // Fertigkeits-Boni (identisch mit Rassen/Klassen-System)
      skillBonuses:  new fields.ObjectField({ initial: () => ({}) }),
      // Attribut-Modifikatoren (Anzeige, kein Einfluss auf Würfe)
      attributeMods: new fields.ObjectField({ initial: () => ({ st: 0, ge: 0, ko: 0, in: 0, ch: 0 }) }),
      // Passive Traits (regeneration, spellResistance, etc.)
      passiveTraits: new fields.ObjectField({ initial: () => ({}) }),
      // Foundry Active Effect Status-IDs (z.B. ["fear"])
      statusEffects: new fields.ArrayField(new fields.StringField()),
      // Verliehene Zauber mit optionaler Tageslimitierung
      grantedSpells: new fields.ArrayField(new fields.ObjectField()),
      // Nutzungs-Tracking für verliehene Zauber (wie classFeatures.activations)
      activations:   new fields.ObjectField({ initial: () => ({}) })
    };
  }
}
