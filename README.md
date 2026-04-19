# ABOREA V7 – Foundry VTT System

Inoffizielles Foundry-VTT-System für **ABOREA V7**. Enthält Charakterbogen, Kompendien, Regelautomatisierung und Release-Pipeline.

---

## Installation

### Manuell
1. Ordner `aborea-v7` nach `FoundryVTT/Data/systems/` kopieren.
2. Foundry neu starten und eine Welt mit dem System `ABOREA V7` öffnen.

### Über den Foundry-Updater
Das System meldet neue Versionen automatisch über die Manifest-URL:
```
https://github.com/kn0rr/aborea-full-vtt/releases/latest/download/system.json
```
Foundry erkennt neue Releases und bietet das Update in den Systemeinstellungen an.

---

## Kompendien

| Kompendium | Inhalt |
|---|---|
| Völker | Elf, Zwerg, Halbling, Mensch, Gnom |
| Berufe | Krieger, Zauberer, Priester, Barde, Schamane, Waldläufer, Dieb |
| Waffen | Standardwaffen mit Schadenswerten |
| Rüstungen | Rüstungen mit Rüstungswerten |
| Zauber | 40 Zauber in 4 Listen (Elementare, Freie, Schwarze, Wilde Magie) |
| Wunder & Leitmagie | Wunder, Bardenmagie, Schamanenmagie, Zeichen |
| Götter | 28 Götter aus 4 Pantheons |
| Kreaturen | Basis-Kreaturen (z.B. Troll) |

### Kompendien befüllen (GM-Konsole)
```js
await game.aborea.buildSystemPacks();   // Kompendien befüllen
await game.aborea.resetSystemPacks();   // Kompendien leeren
await game.aborea.importPackSources();  // Alternativ: World-Packs importieren
```

---

## Charaktererschaffung

### Attributpunkte
- **35 Punkte** verteilen auf 5 Attribute (ST, GE, KO, IN, CH).
- Kosten steigen mit dem Attributwert (Wert 7 = 8 Punkte, Wert 10 = 16 Punkte gesamt).
- Budget-Anzeige in Echtzeit; Finalisierung erst bei genau 0 verbleibenden Punkten möglich.

### Volk & Beruf
- Volk und Beruf werden aus dem Kompendium gewählt und per „Übernehmen" angewendet.
- Volksmodifikatoren (z.B. +1 ST für Zwerge) werden automatisch auf die Endattribute addiert.
- Restriktionen wie `Kein Krieger` aus dem Volk werden bei der Berufswahl geprüft.
- **Nach der Finalisierung** können Volk und Beruf nicht mehr geändert werden.

### Ausbildungspunkte (AP)
- Grundbudget: **8 AP × Stufe** (Menschen: +2 AP pro Stufe).
- Fertigkeitskosten kommen aus dem jeweiligen Beruf (`skillCosts`).
- Slash-Notation (`2/4`) bedeutet: Rang 1 kostet 2 AP, Rang 2 kostet 4 AP.
- Eigene Fähigkeiten können mit freier Kostenangabe erstellt werden.

### Finalisierung
`Charakter abschließen` setzt `system.creation.completed = true`. Danach sind Volk, Beruf und Fertigkeiten (außer bei Stufenaufstiegen) gesperrt.

---

## Fertigkeiten

### Standardfertigkeiten
Alle Fertigkeiten aus dem Regelwerk sind vordefiniert (z.B. Athletik, Waffen, Spruchlisten). Berufsspezifische Kosten werden automatisch aus dem Beruf geladen.

### Eigene Fähigkeiten
Über `+ Eigene Fähigkeit` können beliebige Fertigkeiten mit eigenem Attribut und AP-Kosten erstellt werden.  
Kostenangabe `2/3`: max. 2 Ränge während der Erstellung (Rang 1 = 2 AP, Rang 2 = 3 AP).  
Kostenangabe `2`: max. 1 Rang während der Erstellung.

### Berufsfertigkeitsboni
Boni aus Berufsmerkmalen (z.B. „Heilen +1" beim Priester) werden in der Fertigkeitsliste live angezeigt.

---

## Spruchlisten (Zauberer, arkane Klassen)

### Regel
**Rang Spruchlisten** bestimmt, wie viele verschiedene Zauberlisten ein Charakter kennen darf:
- Rang 1 → 1 bekannte Liste
- Rang 2 → 2 bekannte Listen (Maximum während der Charaktererstellung)

### Mechanik im System
- Bekannte Listen werden aus den vorhandenen Zauber-Items des Charakters automatisch ermittelt (eindeutige Werte des Felds `system.list`).
- **Kapazitätsanzeige** im Inventar-Tab: `Listen: X / Y` (rot bei Überschreitung).
- **Validierungsfehler** bei `Charakter neu berechnen`, wenn mehr Listen vorhanden sind als der Rang erlaubt.
- **Warnung beim Import**: Beim Hinzufügen eines Zaubers aus einer neuen Liste erscheint ein Hinweis, wenn die Kapazität dadurch überschritten würde.

### Anzeige
Zauber werden im Inventar-Tab nach Liste gruppiert und innerhalb jeder Liste nach Rang (1–10) sortiert.

### Wunder & Leitmagie
Wunder unterliegen **keiner** Spruchlisten-Kapazität – der Zugang wird über Klasse und Gottheit geregelt.

---

## Leitmagie-Klassen (Priester, Barde, Schamane)

### Gottheit
- Leitmagie-Klassen (erkannt am Merkmal `Leitmagie-Beruf.`) zeigen ein **Gottheit-Feld** im Charakterbogen-Header.
- Über ein Dropdown können alle 28 Götter aus dem Kompendium ausgewählt werden.
- Die gewählte Gottheit wird in `system.details.god` gespeichert.
- Die Gottheit kann jederzeit geändert werden (auch nach der Finalisierung).

### Leitmagie-Fertigkeiten
- `magieEntwickeln`: Bestimmt den MP-Pool: `(Attributbonus + 3) × Rang`
- `spruchlisten` (bei Leitmagie = Wunderlisten): Rang gibt die Anzahl bekannter Listen an.

---

## Götter-Kompendium

28 Götter aus 4 Pantheons, basierend auf ABOREA-Spielerheft S. 46–51.

| Pantheon | Götter |
|---|---|
| **Elfisch (Ïareth)** | Othil, Il Anæra, Næroth |
| **Zwergisch** | Esron, Hornwan, Otheila, Tragur, Egaros, Barros, Minna |
| **Trionisch** | Ænora, Aone, Ateom, Esthion, Hemron, Iandara, Juvio, Leceia, Mycael, Neome, Otum, Seista, Thios, Varus, Zia |
| **Halblingisch** | Insa, Elm, Pria |

Jeder Eintrag enthält: Aspekte, heilige Waffe, Symbol, Pantheon, Rang und Beschreibung.

---

## Kampf

### Kampfwerte
- **Angriffswert** = Würfelergebnis + Kampfbonus (Attributbonus + Waffenfertigkeit – 2 wenn ungelernt)
- **Verteidigungswert** = Rüstungswert + Verteidigungsbonus
- **Schaden** = max(1, Angriff – Verteidigung + Waffenschaden)
- **Initiative** = GE-Bonus

### Manöver
Manöver-Schwellen (Routine 5 bis Absurd 18) sind in `config.mjs` hinterlegt und werden beim Würfeln als Referenz angezeigt.

### Angriff
Waffeneinträge im Inventar bieten einen `⚔ Angriff`-Button. Das Ergebnis wird als Chat-Nachricht mit Trefferwertung ausgegeben.

---

## Ressourcen

| Ressource | Berechnung |
|---|---|
| **HP max** | `(HP-Basis der Klasse + KO-Bonus) × Stufe` (+2 für Zwerge) |
| **MP max** | `(Attributbonus + 3) × Rang Magie entwickeln` |
| **Natürliche Heilung** | `1 + KO-Bonus` HP pro Ruhetag |
| **MP-Regeneration** | `1 + Attributbonus` MP pro Stunde |

---

## Inventar & Geldbeutel

### Währungen
Standard: GF, TT, KL, MU (1 GF = 10 TT = 100 KL = 1.000 MU). Weitere Währungen können hinzugefügt werden.

### Einzahlen / Auszahlen
Beim Einzahlen und Auszahlen öffnet sich ein Dialog mit Betrag und optionaler **Notiz**.

### Gegenstände
Gegenstände können aus dem Kompendium importiert, neu erstellt oder per Drag & Drop hinzugefügt werden. Beim Hinzufügen und Entfernen kann ebenfalls eine **Notiz** hinterlegt werden.

### Audit-Log
Alle Transaktionen (Münzen und Gegenstände) werden mit Zeitstempel, Aktion und optionaler Notiz in der Transaktionshistorie gespeichert.

---

## Stufenaufstieg

1. EP (Erfahrungspunkte) im Charakterbogen eintragen.
2. Das System zeigt einen Banner, wenn genug EP für die nächste Stufe vorhanden sind.
3. `Stufe aufsteigen` erhöht die Stufe und löst eine Neuberechnung aus.
4. Neue AP können für Fertigkeiten ausgegeben werden.

---

## Begleiter

Kreaturen können direkt aus einem Kompendium per **Drag & Drop** auf den Begleiter-Tab gezogen werden.  
Begleiter können dort verwaltet, angesehen und entfernt werden.

---

## 3D-Würfel

Das System unterstützt das Modul **Dice So Nice** automatisch. Wenn installiert und aktiv, werden alle ABOREA-Würfe als 3D-Würfel angezeigt.

---

## Soundboard

- Öffnen: Szenensteuerung → **ABOREA Audio** oder `await game.aborea.openSoundboard()`
- Presets in `data/audio-presets.json`.
- Audiodateien unter `assets/audio/music`, `assets/audio/ambience`, `assets/audio/oneshots` ablegen.

*Aus Lizenzgründen werden keine Audiodateien mitgeliefert.*

---

## Releases & Updates

Neue Versionen werden als GitHub Releases veröffentlicht. Der Workflow läuft automatisch beim Setzen eines `v*.*.*`-Tags:
1. `system.json` wird mit der neuen Version aktualisiert.
2. Ein ZIP-Archiv wird erstellt und als Release-Asset hochgeladen.
3. Foundry erkennt das Update über die Manifest-URL.
