/**
 * Einmaliges Migrations-Makro: system.skill (String) → system.skills (Array)
 * Ausführen in Foundry als Makro (Script-Typ) mit GM-Rechten.
 */
(async () => {
  let migrated = 0;
  const actors = [...game.actors];

  for (const actor of actors) {
    const weapons = actor.items.filter(i => i.type === "weapon");
    for (const w of weapons) {
      const oldSkill = w.system.skill;
      const existing = w.system.skills;
      if (!oldSkill) continue;                          // kein alter Wert
      if (Array.isArray(existing) && existing.length) continue; // schon migriert
      await w.update({ "system.skills": [oldSkill], "system.skill": null });
      migrated++;
      console.log(`Migriert: ${actor.name} > ${w.name}: "${oldSkill}"`);
    }
  }

  // Kompendium-Waffen überspringen (read-only, werden durch weapons.json/loot.json aktualisiert)
  ui.notifications.info(`Migration abgeschlossen: ${migrated} Waffe(n) aktualisiert.`);
})();
