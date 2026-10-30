# Diorama-Karte: Analyse (HESTIA, 29.10.2026)

Stand vor dem Wände-Patch. Was daraus gebaut wurde, steht in [`hestia/README.md`](hestia/README.md); Bilder im
[README des Repositorys](../README.md#what-it-looks-like).

## Was es ist

| | |
|---|---|
| Typ | HA-Karte (`custom:diorama-card`), eine einzige Datei `dist/card.js` (5,9 MB) |
| Technik | React 19 + three.js 0.186 über react-three-fiber/drei, Tailwind v4, Vite, TypeScript (~58.000 Zeilen, 395 Dateien) |
| Lizenz | MIT: Ändern, Weitergeben und eigene Builds sind erlaubt, solange die Lizenz dabei bleibt |
| Tempo | ~770 Commits seit 19.09.2026, fast täglich ein Release; entwickelt mit Claude Code (`CLAUDE.md` im Repo) |
| Beliebtheit | 67 Sterne, 6 Forks, 10 offene Issues |
| Tests | keine automatischen Tests, nur `tsc` + `oxlint` + Vorschauseiten (`src/dev`) |

## Aufbau (wo was passiert)

| Ordner | Inhalt |
|---|---|
| `src/scene/` | 3D-Szene: `Scene.tsx` (Canvas, Licht, Schatten), `Room.tsx` (Boden eines Raums), `Passages.tsx` (Pfeile zwischen offenen Räumen), `CameraRig.tsx` (Kameraflüge), `Sky.tsx` (Sonne/Tageslicht) |
| `src/scene/decor/` | alle Möbel und Geräte als Code-Modelle (Sofas, Lampen, Fenster, Türen, Küche ...) |
| `src/geometry/` | Polygon-Mathe: Bodenplatte (`slab.ts`), Durchgänge (`passages.ts`), Überlappung |
| `src/decoration/catalog.ts` | der Katalog: ~110 Arten, Varianten, Größen, Farben, welche Entität was steuert |
| `src/editor/` | der Editor in HA (Räume zeichnen, Möbel ziehen); `walls.ts` = „an die nächste Wand schnappen“ |
| `src/tiles/` | die Kacheln in der Seitenleiste |

## Warum es keine Wände gibt

Ein Raum ist im Code **nur eine Bodenplatte**: Das Polygon wird etwa 10 cm dick extrudiert (`Room.tsx` →
`slabGeometry`). „Wand“ bedeutet im Code nur „Kante des Raum-Polygons“. Daran schnappen Türen, Fenster und
Rollläden ein, und zwei Räume mit gemeinsamer Kante ohne Tür gelten als offen (`passages.ts`). Wände sind also
Absicht, kein Fehler: Man soll von oben in alle Räume schauen können.

Seit heute früh gibt es dazu ein Issue: **#102 „Walls and take-from-wall/ceiling“**. Der Wunsch dort deckt sich mit
unserem: Wände pro Kante ein/aus, wahlweise durchsichtig oder massiv, und Licht soll nicht durch Wände gehen.
#106 wünscht sich zusätzliche Eckpunkte an bestehenden Räumen.

## Wie Wände dazukommen könnten (Vorschlag)

| Baustein | Was er tut |
|---|---|
| `src/geometry/walls.ts` (neu) | Aus allen Raum-Polygonen werden Wandstücke: Eine gemeinsame Kante zweier Räume wird zu **einer** Innenwand (~11 cm), eine freie Kante zur Außenwand (~30 cm). Offene Stellen (Wohnen/Essen) bleiben frei. Türen schneiden eine Lücke in Türbreite; Fenster lassen unten eine Brüstung (`sill`) und oben einen Sturz stehen. |
| `src/scene/Walls.tsx` (neu) | Zeichnet die Stücke als Körper mit Schatten. Höhe wählbar: **Puppenhaus** (abgeschnitten auf z. B. 1,2 m, wie unser alter Stil) oder volle Höhe. Wände zwischen Kamera und gewähltem Raum werden durchsichtig, wie bei „Die Sims“. |
| Konfiguration | Karte: `walls: {height: 1.2, full_height: 2.5, interior: 0.11, exterior: 0.3, style: solid}`. Raum: `walls: {open_to: [esszimmer]}`. Ohne `walls` sieht alles aus wie bisher. |
| Editor (später) | Kanten anklicken: Wand / offen / Glas |
| Licht | Wände werfen Sonnenschatten. Lampenlicht durch Wände zu blocken kostet Leistung (Punktlicht-Schatten) und ist ein zweiter Schritt. |

Aufwand geschätzt: Geometrie + Darstellung etwa 400–600 Zeilen TypeScript, dazu eine Vorschauseite in `src/dev`.
Die Kamera-Durchsichtigkeit und der Editor kommen extra dazu.

## Eigener Fork oder Beitrag zum Original?

| Weg | Vorteil | Nachteil |
|---|---|---|
| **Pull Request ans Original** (Empfehlung) | Man bekommt weiter alle Updates über HACS, und andere profitieren auch (Issue #102) | Der Autor entscheidet, ob und wie er es übernimmt |
| Eigener Fork | volle Kontrolle | Das Original ändert sich fast täglich. Bei ~770 Commits in 6 Wochen sind wir ständig mit Nachziehen beschäftigt |

Testen können wir unseren Build auf dem Dev-HA, ohne HACS anzufassen: Unser `card.js` wird als zweite Ressource
unter eigenem Namen geladen, oder die HACS-Ressource zeigt vorübergehend auf unseren Build.

## Für einen eigenen Generator wichtig

- Koordinaten in Metern, y nach oben; eine Karte pro Etage.
- Wandteile drehen sich nach der Raumkante: oben 0°, links 90°, unten 180°, rechts 270°.
- `blind` mit `params.outside: 1` hängt außen. Ohne Wände steht ein Rollladen darum ein Stück vor der Raumkante;
  mit Wänden sitzt er richtig in der Wandflucht.
