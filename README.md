# Imposter

Wort-Partyspiel für den Browser, gemacht zum Spielen über Discord. Alle bekommen dasselbe Wort, nur der Imposter nicht. Ihr sagt reihum ein Wort dazu und stimmt dann ab, wer blufft.

**Jetzt spielen:** https://imposter-u7fh.onrender.com

## So läuft eine Runde

1. Beim ersten Besuch wählt jeder Spieler einen Namen und baut sich einen Charakter aus Kopfbedeckung, Haut, Anzug, Farbe und Augen. Ein Login gibt es nicht.
2. Eine Person erstellt einen Raum und schickt den Einladungslink in euren Discord. Ihr braucht mindestens 3 Spieler.
3. Der Host wählt die Anzahl der Runden, die Anzahl der Imposter und die Kategorie und startet das Spiel. Während der Runde sehen alle, wie viele Imposter dabei sind, aber nicht, wer es ist. Mindestens ein Spieler kennt immer das Wort.
4. Jeder deckt seine eigene Karte auf: entweder das Wort oder „Du bist Imposter“.
5. Das Spiel lost aus, wer anfängt, und zeigt die Reihenfolge. Wer dran ist, sagt sein Wort im Voice-Chat und schreibt es auf der Seite auf. So kann jeder jederzeit nachlesen, was die anderen gesagt haben.
   Für jedes Wort gibt es 30 Sekunden, danach ist automatisch der Nächste dran. Eingetippte Wörter liest der Browser vor. Mit einem Klick auf einen Mitspieler zeigt man allen, dass man ihn verdächtig findet.
6. Ein Imposter kann jederzeit das Wort raten. Exakte Treffer und kleine Tippfehler zählen automatisch, über alles andere entscheiden die Spieler, die das Wort kennen (bei Gleichstand zählt der Tipp). Richtig: Die Imposter gewinnen. Falsch: Die Gruppe gewinnt. Beides beendet die Runde sofort.
7. Sonst startet der Host die Abstimmung, sobald ihr bereit seid. Wer die meisten Stimmen hat, fliegt raus und entscheidet selbst, ob die eigene Rolle gezeigt wird. Bei Gleichstand fliegt niemand raus. Danach spielt ihr weiter, bis alle Imposter draußen sind (die Gruppe gewinnt) oder die Imposter mindestens so viele sind wie die übrigen Spieler (die Imposter gewinnen). Am Ende werden Wort, Imposter und Stimmen aufgedeckt.
8. Nach der letzten Runde zeigt das Endergebnis, wer gewonnen hat.

## Punkte

- Richtig abgestimmt: **10 Punkte**
- Imposter gewinnt: **25 Punkte** für den Imposter

Punkte werden erst am Ende der Runde vergeben, damit die Rangliste keine Rollen verrät. Jede Stimme für einen Imposter zählt, auch über mehrere Abstimmungen. Gewinnen die Imposter, bekommen auch rausgewählte Imposter ihre 25 Punkte. In der Lobby lässt sich außerdem einstellen, ob sich mehrere Imposter gegenseitig sehen. Name, Charakter und Stats wie Siege und Stimmen-Quote bleiben im Browser des jeweiligen Spielers gespeichert. Sie gelten also pro Browser und gehen verloren, wenn man die Browserdaten löscht.

## Lokal starten

Du brauchst [Node.js](https://nodejs.org) ab Version 18. Weitere Pakete sind nicht nötig.

```bash
npm start
```

Danach läuft das Spiel auf http://localhost:3000, erreichbar nur auf deinem eigenen PC.

Zum Üben allein öffnest du für jeden Testspieler einen eigenen Tab mit `?spieler=` und einer Nummer, zum Beispiel http://localhost:3000/?spieler=2. Jede Nummer ist ein eigenes Profil.

```bash
npm test
```

## Online-Version

Das Spiel läuft als kostenloser Web Service bei [Render](https://render.com), Region Frankfurt. Render holt den Code aus dem öffentlichen GitHub-Repo, verwendet `npm install` als Build Command und `npm start` als Start Command.

**Änderungen veröffentlichen:** Render übernimmt neue Commits nicht automatisch. Lade die Änderung zuerst auf GitHub hoch und wähle dann im Render-Dashboard beim Dienst `imposter` unter **Manual Deploy** den Punkt **Deploy latest commit**. Dabei werden offene Räume beendet.

Das solltest du zum kostenlosen Tarif wissen (Stand November 2026):

- Der Dienst schläft nach 15 Minuten ohne eingehende Anfragen ein. Der erste Aufruf danach dauert etwa eine Minute. Am besten öffnest du die Seite also kurz vor dem Spielen.
- Räume liegen nur im Arbeitsspeicher. Schläft der Dienst ein oder startet er neu, sind sie weg. Dann erstellt ihr einfach einen neuen Raum. Profile und Stats bleiben erhalten, weil sie im Browser liegen.

**Cloudflare Quick Tunnels funktionieren nicht:** Sie unterstützen keine Server-Sent Events, und darüber bekommen die Browser ihre Live-Updates.

## Eigene Wörter

Alle Wörter stehen in [words.js](words.js). Du kannst dort Wörter ergänzen oder neue Kategorien anlegen. Neue Kategorien erscheinen automatisch in der Auswahl.

## Technik

- `game.js`: Räume, Spielregeln und Punkte. Jeder Spieler bekommt vom Server nur seine eigene Sicht, der Imposter erhält das Wort also erst bei der Auflösung.
- `server.js`: HTTP-Server. Aktionen laufen über POST, Live-Updates über Server-Sent Events. Der Server speichert nichts dauerhaft.
- `public/avatar.js`: Avatare als Vektorgrafik. Neue Kopfbedeckungen, Anzüge und Farben kommen hier dazu.
- `public/sounds.js`: Sounds, im Browser erzeugt.
- `public/app.js`: Oberfläche ohne Framework.
