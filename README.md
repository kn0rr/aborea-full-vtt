# ABOREA V7 System-Repo (inoffiziell)

Dieses Paket enthält:
- ein Foundry-VTT-Systemgerüst für ABOREA V7
- kollisionsfreie Pack-Quellen unter `packs/*/_source`
- einen Importer für Welt-Compendien

## Wichtig
Die System-Packs unter `packs/` sind **Quellstände**. In Foundry erscheinen sie oft leer, solange keine gebauten Pack-Datenbanken vorliegen.

Deshalb ist zusätzlich ein Importskript enthalten, das aus den `_source`-Dokumenten **befüllte Welt-Compendien** erzeugt.

## Import in Foundry
1. System installieren und Welt mit dem System starten.
2. Als GM die Entwicklerkonsole öffnen (`F12`).
3. Folgenden Befehl ausführen:

```js
await game.aborea.importPackSources();
```

Danach werden diese Welt-Compendien angelegt und befüllt:
- `ABOREA: Völker`
- `ABOREA: Berufe`
- `ABOREA: Waffen`
- `ABOREA: Rüstungen`
- `ABOREA: Zauber`
- `ABOREA: Wunder & Leitmagie`
- `ABOREA: Kreaturen`

Die Welt-Compendien unterstützen Sidebar-Nutzung und Drag-and-drop.

## Einzelnes Pack importieren
```js
await game.aborea.importPack("spells");
```

Mögliche Keys:
- `races`
- `classes`
- `weapons`
- `armors`
- `spells`
- `miracles`
- `creatures`

## Struktur
- `data/` enthält normalisierte Quelldaten
- `packs/*/_source` enthält kollisionsfreie Foundry-Dokumente mit stabilen `_id`s
- `packs/index.json` ist das Import-Manifest
- `module/compendium-importer.mjs` enthält die Importlogik
