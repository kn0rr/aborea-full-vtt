# ABOREA V7 Foundry System Repo (Importable)

Dieses Paket enthält das ABOREA-System mit Pack-Quellen unter `packs/*/_source` und einem GM-Importer für befüllte **World-Compendien**.

## Installation
1. Ordner `aborea-v7` nach `FoundryVTT/Data/systems/` kopieren.
2. Foundry neu starten.
3. Eine Welt mit dem System `aborea-v7` öffnen.
4. Als GM die Browser-Konsole (`F12`) öffnen.

## Import aller Packs
```js
await game.aborea.importPackSources();
```

## Import einzelner Packs
```js
await game.aborea.importPack("races");
await game.aborea.importPack("classes");
await game.aborea.importPack("spells");
await game.aborea.importPack("miracles");
await game.aborea.importPack("weapons");
await game.aborea.importPack("armors");
await game.aborea.importPack("creatures");
```

## Vorhandene ABOREA-World-Packs anzeigen
```js
await game.aborea.listWorldPacks();
```

## ABOREA-World-Packs leeren
```js
await game.aborea.resetWorldPacks();
```

## ABOREA-World-Packs komplett löschen
```js
await game.aborea.resetWorldPacks({ deletePacks: true });
```
Danach kannst du erneut importieren:
```js
await game.aborea.importPackSources();
```

## Hinweise
- Die mitgelieferten `packs/*/_source` sind **Pack-Quellen**. Die sichtbaren Compendien in der Sidebar entstehen erst nach dem GM-Import in World-Compendien.
- Der Importer ist **idempotent**: vorhandene Einträge mit gleicher `externalId` werden aktualisiert, nicht dupliziert.
- Gleichnamige Zauber/Wunder aus unterschiedlichen Listen haben kollisionsfreie `_id`s und Dateinamen.
