/**
 * Einmaliges Migrations-Makro: system.skill (String) → system.skills (Array)
 * Ausführen in Foundry als Makro (Script-Typ) mit GM-Rechten.
 *
 * Hinweis: system.skill ist nicht mehr im Schema — der alte Wert ist nur noch
 * in den Rohdaten (_source) sichtbar, daher wird dort gelesen.
 */
(async () => {
  let migrated = 0;

  for (const actor of game.actors) {
    const weapons = actor.items.filter(i => i.type === "weapon");
    for (const w of weapons) {
      const oldSkill = w._source?.system?.skill;
      const existing = w.system.skills;
      if (!oldSkill) continue;                                  // kein alter Wert
      if (Array.isArray(existing) && existing.length) continue; // schon migriert
      await w.update({ "system.skills": [oldSkill] });
      migrated++;
      console.log(`Migriert: ${actor.name} > ${w.name}: "${oldSkill}"`);
    }
  }

  ui.notifications.info(`Migration abgeschlossen: ${migrated} Waffe(n) aktualisiert.`);
})();
