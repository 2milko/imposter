# Imposter

Wort-Partyspiel für den Browser, gemacht zum Spielen über Discord. Alle bekommen dasselbe Wort, nur der Imposter nicht. Ihr sagt reihum ein Wort dazu und stimmt dann ab, wer blufft.

## So läuft eine Runde

1. Eine Person erstellt einen Raum und schickt den Einladungslink in euren Discord. Ihr braucht mindestens 3 Spieler.
2. Der Host wählt Kategorie und Anzahl der Imposter und startet das Spiel.
3. Jeder deckt seine eigene Karte auf: entweder das Wort oder „Du bist Imposter“.
4. Das Spiel lost aus, wer anfängt, und zeigt die Reihenfolge. Ihr sagt eure Wörter im Voice-Chat und klickt danach auf „Wort gesagt, weiter“.
5. Sobald ihr bereit seid, startet der Host die Abstimmung. Danach werden Wort, Imposter und Stimmen aufgedeckt.

Bei Gleichstand gewinnt der Imposter.

## Lokal starten

Du brauchst [Node.js](https://nodejs.org) ab Version 18. Weitere Pakete sind nicht nötig.

```bash
npm start
```

Danach läuft das Spiel auf http://localhost:3000. Zum Ausprobieren kannst du mehrere Tabs öffnen, das ist dann aber nur auf deinem eigenen PC erreichbar.

```bash
npm test
```

## Online stellen, damit deine Freunde mitspielen können

Empfehlung: [Render](https://render.com), dort gibt es einen kostenlosen Tarif.

1. Lade diesen Ordner in ein GitHub-Repository hoch.
2. Lege bei Render einen neuen **Web Service** an und wähle das Repository aus.
3. Trage diese Einstellungen ein:
   - **Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Nach dem Deploy bekommst du eine Adresse wie `https://dein-name.onrender.com`. Die rufst du auf und erstellst dort einen Raum.

Das solltest du zum kostenlosen Tarif wissen (Stand November 2026):

- Der Dienst schläft nach 15 Minuten ohne eingehende Anfragen ein. Der erste Aufruf danach dauert etwa eine Minute. Am besten öffnest du die Seite also kurz vor dem Spielen.
- Räume liegen nur im Arbeitsspeicher. Schläft der Dienst ein oder startet er neu, sind sie weg. Dann erstellt ihr einfach einen neuen Raum.

**Cloudflare Quick Tunnels funktionieren nicht:** Sie unterstützen keine Server-Sent Events, und darüber bekommen die Browser ihre Live-Updates.

## Eigene Wörter

Alle Wörter stehen in [words.js](words.js). Du kannst dort Wörter ergänzen oder neue Kategorien anlegen. Neue Kategorien erscheinen automatisch in der Auswahl.

## Technik

- `game.js`: Räume und Spielregeln. Jeder Spieler bekommt vom Server nur seine eigene Sicht, der Imposter erhält das Wort also erst bei der Auflösung.
- `server.js`: HTTP-Server. Aktionen laufen über POST, Live-Updates über Server-Sent Events.
- `public/`: Oberfläche ohne Framework.
