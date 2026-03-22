# ABOREA V7 (inoffiziell) – Foundry VTT System

Dieses Paket ist ein installierbares Foundry-VTT-Systemgerüst für Foundry VTT v13.

## Enthalten
- Actor-Typen: `character`, `npc`, `creature`
- Item-Typen: `race`, `class`, `skill`, `weapon`, `armor`, `spell`, `miracle`, `gear`
- Offener W10
- Attributsboni
- Fertigkeitswürfe
- Angriffs- und Schadenswürfe
- deutscher und englischer Sprachsatz
- Beispiel-Kreatur `Troll` als JSON in `examples/troll-creature.json`
- Datenpaket unter `data/` mit:
  - 5 Völkern
  - 7 Berufen
  - 40 Zaubern
  - 37 Wundern / Leitmagie-Einträgen
  - 11 Waffen
  - 8 Rüstungen

## Wichtige Dateien
- `system.json`: Registrierung von Actor- und Item-Typen
- `template.json`: Datenmodell
- `data/`: importierbare JSON-Daten
- `examples/troll-creature.json`: Beispiel für Actor-Typ `creature`

## Hinweise
- Das Paket bildet die Regelmechanik aus dem hochgeladenen Spielerheft technisch ab.
- Die Zauber- und Wunderlisten wurden aus der von dir bereitgestellten strukturierten Spruchliste ergänzt.
- Die Daten unter `data/` sind als importierbare JSON-Quellen enthalten; sie sind nicht als vorgebaute Foundry-Compendium-Datenbank ausgeliefert.
- Einige komplexe Regelfolgen (z. B. automatische Flächeneffekte, Beschwörungen, SL-Entscheidungszauber) sind als Beschreibungen hinterlegt und nicht vollautomatisiert.
