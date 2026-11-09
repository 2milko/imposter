# Imposter

Wort-Partyspiel für den Browser, gemacht zum Spielen über Discord. Alle bekommen dasselbe Wort, nur der Imposter nicht. Ihr sagt reihum ein Wort dazu und stimmt dann ab, wer blufft.

**Jetzt spielen:** https://imposter.ikarus-cloud.cc

## So läuft eine Runde

1. Jeder Spieler legt ein Konto mit Name und Passwort an (ohne E-Mail) und baut sich einen Charakter aus Kopfbedeckung, Haut, Anzug, Farbe und Augen.
2. Eine Person erstellt einen Raum und schickt den Einladungslink in euren Discord. Ihr braucht mindestens 3 Spieler.
3. Der Host wählt Runden, Anzahl der Imposter, Kategorie, Modus und Zeit pro Wort und startet das Spiel. Während der Runde sehen alle, wie viele Imposter dabei sind, aber nicht, wer es ist. Mindestens ein Spieler kennt immer das Wort.
4. Jeder deckt seine eigene Karte auf: entweder das Wort oder „Du bist Imposter“.
5. Das Spiel lost aus, wer anfängt, und zeigt die Reihenfolge. Wer dran ist, sagt sein Wort im Voice-Chat und schreibt es auf der Seite auf. So kann jeder jederzeit nachlesen, was die anderen gesagt haben. Eingetippte Wörter liest der Browser vor. Mit einem Klick auf einen Mitspieler zeigt man allen, dass man ihn verdächtig findet.
6. Ein Imposter kann jederzeit das Wort raten. Exakte Treffer und kleine Tippfehler zählen automatisch, über alles andere entscheiden die Spieler, die das Wort kennen (bei Gleichstand zählt der Tipp). Richtig: Die Imposter gewinnen. Falsch: Die Gruppe gewinnt. Beides beendet die Runde sofort.
7. Sonst startet der Host die Abstimmung, sobald ihr bereit seid. Wer die meisten Stimmen hat, fliegt raus und entscheidet selbst, ob die eigene Rolle gezeigt wird. Bei Gleichstand fliegt niemand raus. Danach spielt ihr weiter, bis alle Imposter draußen sind (die Gruppe gewinnt) oder die Imposter mindestens so viele sind wie die übrigen Spieler (die Imposter gewinnen).
8. Nach der letzten Runde zeigt das Endergebnis, wer gewonnen hat, dazu Titel wie „Detektiv“, „Meister-Bluffer“ oder „Paranoid“.

## Einstellungen in der Lobby

- **Modus Klassisch:** Die Imposter wissen, dass sie Imposter sind, und kennen das Wort nicht.
- **Modus Undercover:** Die Imposter bekommen ein ähnliches Wort (etwa Hund statt Katze) und wissen selbst nicht, dass sie Imposter sind. Raten gibt es in diesem Modus nicht.
- **Zeit pro Wort:** 15 bis 90 Sekunden oder ohne Timer.
- **Imposter sieht die Kategorie:** Hilft dem Imposter vor allem bei „Alle gemischt“ (nur im klassischen Modus).
- **Imposter sehen sich gegenseitig:** ab 2 Impostern, nur im klassischen Modus.

## Punkte und Stats

- Richtig abgestimmt: **10 Punkte**
- Imposter gewinnt: **25 Punkte** für den Imposter

Punkte werden erst am Ende der Runde vergeben, damit die Rangliste keine Rollen verrät. Jede Stimme für einen Imposter zählt, auch über mehrere Abstimmungen. Gewinnen die Imposter, bekommen auch rausgewählte Imposter ihre 25 Punkte.

Punkte, Siege, Runden, Imposter-Siege und Stimmen-Quote speichert der Server im Konto. Auf der Startseite steht eine Bestenliste aller Spieler.

## Lokal starten

Du brauchst [Node.js](https://nodejs.org) ab Version 22.13 (wegen der eingebauten SQLite-Datenbank). Weitere Pakete sind nicht nötig.

```bash
npm start
```

Danach läuft das Spiel auf http://localhost:3000. Die lokale Datenbank liegt in `data/imposter.db` und wird nicht hochgeladen.

Zum Üben allein öffnest du für jeden Testspieler einen eigenen Tab mit `?spieler=` und einer Nummer, zum Beispiel http://localhost:3000/?spieler=2. Jede Nummer meldet sich mit einem eigenen Konto an.

```bash
npm test
```

## Server (Proxmox)

Das Spiel läuft auf dem Proxmox-Host `192.168.178.20` im LXC-Container **115 `imposter`** (Debian 12, Node.js 24) unter `192.168.178.193:3000`. Von außen ist es über den Cloudflare Tunnel **Ikaruscloud** als `imposter.ikarus-cloud.cc` erreichbar, ohne offene Ports am Router.

- Programm: `/opt/imposter` (Git-Klon dieses Repos)
- Daten (Konten, Stats): `/var/lib/imposter/imposter.db`
- Dienst: `systemctl status imposter` im Container, startet beim Hochfahren automatisch

Alle Befehle laufen auf dem Proxmox-Host:

```bash
# Neue Version von GitHub holen und neu starten (offene Räume werden dabei beendet)
pct exec 115 -- imposter-update

# Passwort zurücksetzen, wenn jemand es vergessen hat
pct exec 115 -- runuser -u imposter -- env DATA_DIR=/var/lib/imposter node /opt/imposter/admin.js passwort NAME NEUESPASSWORT

# Alle Konten anzeigen
pct exec 115 -- runuser -u imposter -- env DATA_DIR=/var/lib/imposter node /opt/imposter/admin.js konten

# Log ansehen
pct exec 115 -- journalctl -u imposter -n 50
```

Damit der Tunnel das Spiel immer findet, sollte der Container im Router eine feste IP-Adresse haben.

## Eigene Wörter

Alle Wörter stehen in [words.js](words.js). Du kannst dort Wörter ergänzen oder neue Kategorien anlegen. Neue Kategorien erscheinen automatisch in der Auswahl.

## Technik

- `game.js`: Räume, Spielregeln und Punkte. Jeder Spieler bekommt vom Server nur seine eigene Sicht, der Imposter erhält das Wort also erst bei der Auflösung.
- `accounts.js`: Konten, Anmeldung und Stats in SQLite. Passwörter werden mit scrypt gehasht, Anmelde-Tokens nur als Hash gespeichert.
- `server.js`: HTTP-Server. Aktionen laufen über POST, Live-Updates über Server-Sent Events.
- `admin.js`: Hilfe für den Server (Passwort zurücksetzen, Konten anzeigen).
- `public/avatar.js`: Avatare als Vektorgrafik.
- `public/sounds.js`: Sounds und Sprachausgabe, im Browser erzeugt.
- `public/app.js`: Oberfläche ohne Framework.
