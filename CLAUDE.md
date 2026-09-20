# ABOREA V7 — Arbeitsanweisungen

## Tests sind Pflicht

**Jede Änderung an der Regel-Logik wird von Tests begleitet. Ohne Ausnahme.**

Das gilt für neue Funktionen, für Fehlerbehebungen und für geänderte Formeln.
Ein Fehler, der einmal aufgetreten ist, bekommt einen Test, der ihn festhält —
sonst kommt er wieder.

```
npm test          # Testsuite
npm run check     # Syntaxprüfung aller Module + Tests
```

Der pre-commit-Hook führt `npm run check` aus und bricht den Commit bei
Fehlern ab (`npm run hooks:install`, einmalig). Ihn mit `--no-verify` zu
umgehen ist kein Weg, einen fehlschlagenden Test loszuwerden.

### Was getestet wird

Alles, was rechnet oder entscheidet: Boni, Schaden, Verteidigungswert,
Würfelmechanik, Dauern, Fortschritt, Datenkonsistenz der Kompendien.

### Was nicht getestet werden kann

Foundry-Interaktion — Dialoge, Chatkarten, Sheet-Rendering, das Anlegen von
Active Effects. Dafür bräuchte es Foundry selbst, und Mocks würden das
Verhalten nachbauen statt es zu prüfen.

**Daraus folgt eine Bauregel:** Logik gehört nicht in Dialog- oder
Sheet-Methoden, sondern in reine Funktionen, die der Dialog aufruft. Wer eine
Rechnung in einen `_onRender`-Block schreibt, macht sie unprüfbar. Reine
Funktionen, die nur für Tests exportiert werden, sind ausdrücklich in Ordnung
und am Dateiende als solche gekennzeichnet.

### Wenn ein Fehler nicht sofort behoben wird

Als `todo`-Test hinterlegen, der das *gewünschte* Verhalten beschreibt. Er
lässt den Lauf nicht scheitern, steht aber in der Ausgabe — so lebt die Lücke
in der Suite statt in einer Chatnachricht.

## Aufbau

| Verzeichnis | Inhalt |
|---|---|
| `module/` | Systemcode, von Foundry direkt geladen |
| `module/bonuses.mjs` | **einzige** Quelle für Fertigkeits- und Kampfboni |
| `data/` | Kompendiumsdaten, von `buildSystemPacks()` importiert |
| `tests/` | Testsuite, Nodes eingebauter Runner, keine Abhängigkeiten |
| `scripts/` | Entwicklungswerkzeuge, nicht im Release-ZIP |

Fällt eine Rechnung an mehreren Stellen an, gehört sie nach `bonuses.mjs`.
Drei Implementierungen desselben Wurfs waren der Grund für mehrere stille
Fehler — Attributquelle, NPC-Ränge, doppelte Maluszüge.

## Daten

Die Dateien in `data/` sind 2-Space-JSON mit CRLF und ohne BOM, und
serialisieren mit `json.dumps(indent=2, ensure_ascii=False)` byte-identisch
zurück. Wer sie programmatisch ändert, prüft das vorher — dann bleibt der Diff
auf die echte Änderung beschränkt.

Felder, die das DataModel nicht kennt, werden von Foundry **still verworfen**.
`tests/data.test.mjs` fängt diese Klasse ab; neue Felder bekommen dort eine
Prüfung.

## Versionierung

`system.json` trägt die **kommende** Version und wird beim Entwickeln
hochgezählt (Cache-Busting beim Foundry-Reload). Die veröffentlichte Version
kommt aus dem Git-Tag — der Release-Workflow überschreibt das Feld. Beide
Nummern gehören in dieselbe Linie.
