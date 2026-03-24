# ABOREA V7 Foundry System – System-Pack Builder

Dieses Paket enthält **registrierte System-Compendien** und einen **Build-Schritt**, der die mitgelieferten Quelldaten direkt in diese System-Packs schreibt.

Wichtig: Foundry erlaubt nur Änderungen an **entsperrten** Compendium-Packs. Laut offizieller Dokumentation musst du ein Compendium vor Änderungen per Rechtsklick in der Compendium-Sidebar über **Toggle Edit Lock** entsperren. citeturn786686search1turn786686search4

## Installation
1. Ordner `aborea-v7` nach `FoundryVTT/Data/systems/` kopieren.
2. Foundry neu starten.
3. Eine Welt mit dem System `aborea-v7` öffnen.
4. Als GM in die Compendium-Sidebar gehen.
5. Die ABOREA-System-Packs **entsperren**:
   - Völker
   - Berufe
   - Waffen
   - Rüstungen
   - Zauber
   - Wunder & Leitmagie
   - Kreaturen

## System-Packs direkt befüllen
Öffne als GM die Browser-Konsole (`F12`) und führe aus:

```js
await game.aborea.buildSystemPacks();
```

Danach sind die **System-Compendien selbst** befüllt. Es werden **keine World-Packs** angelegt.

## System-Packs leeren
```js
await game.aborea.resetSystemPacks();
```

## Verhalten des Builders
- liest die Quelldaten aus `systems/aborea-v7/data/*.json`
- schreibt sie in die registrierten **System-Packs** aus `system.json`
- aktualisiert vorhandene Einträge anhand stabiler `sourceId`/`externalId`
- entfernt standardmäßig alte Einträge, die nicht mehr in den Quelldaten vorkommen

## Optional: alter World-Importer
Der frühere World-Importer bleibt vorhanden:
```js
await game.aborea.importPackSources();
```
Das brauchst du **nicht**, wenn du die System-Packs direkt baust.


## Charaktererschaffung
- Basisattribute liegen unter `system.baseAttributes` und werden mit 35 Punkten gekauft.
- `Recalculate` berechnet Endattribute aus Basiswerten + Volksmodifikatoren neu.
- Restriktionen wie `Kein Krieger` werden bei der Berufswahl geprüft.
- `Finalize Character` markiert den Actor als abgeschlossen, wenn Budget, Volk und Beruf gültig sind.


## Berufsmerkmale pro Stufe
Character-Akteure berechnen aktive Berufsmerkmale automatisch anhand von Beruf und Stufe. Beim Ändern der Stufe im Character-Sheet werden die hinterlegten Features neu angewendet.

## Audio / Soundboard

Dieses System enthält ein ABOREA-Soundboard für Musik, Ambiente und One-Shots.

- Öffnen: Szenensteuerung > **ABOREA Audio** oder in der Konsole `await game.aborea.openSoundboard()`
- Die Presets stehen in `data/audio-presets.json`.
- Lege Audiodateien unter `assets/audio/music`, `assets/audio/ambience` und `assets/audio/oneshots` ab.
- Aus den Presets können per Button Foundry-Playlists angelegt werden.

Hinweis: Aus Lizenzgründen werden keine Drittanbieter-Audiodateien mitgeliefert. Nutze nur Audio, das du selbst erstellt hast oder dessen Lizenz die Nutzung in deiner Foundry-Installation erlaubt.


## Begleiter per Drag & Drop
Kreaturen können direkt aus einem Compendium auf den Bereich **Begleiter** im Charakterbogen gezogen werden.

## 3D-Würfel
Das System unterstützt das Modul **Dice So Nice** automatisch. Wenn das Modul installiert und aktiv ist, werden ABOREA-Würfe als 3D-Würfel angezeigt. Ohne das Modul bleibt der eingebaute Würfel-Overlay aktiv.
