# Imposter

Wort-Partyspiel für den Browser, gemacht zum Spielen über Discord. Alle bekommen dasselbe Wort, nur der Imposter nicht. Ihr sagt reihum ein Wort dazu und stimmt dann ab, wer blufft.

**Jetzt spielen:** https://imposter-u7fh.onrender.com

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

## Online-Version

Das Spiel läuft als kostenloser Web Service bei [Render](https://render.com), Region Frankfurt. Render holt den Code aus dem öffentlichen GitHub-Repo, verwendet `npm install` als Build Command und `npm start` als Start Command.

**Änderungen veröffentlichen:** Render übernimmt neue Commits nicht automatisch. Lade die Änderung zuerst auf GitHub hoch und wähle dann im Render-Dashboard beim Dienst `imposter` unter **Manual Deploy** den Punkt **Deploy latest commit**. Dabei werden offene Räume beendet.

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
