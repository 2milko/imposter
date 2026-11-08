'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoom, identify, maxImposters } = require('../game');
const { randomAvatar, isValidAvatar, avatarMarkup, PARTS } = require('../public/avatar');

let nextId = 1;
function fakeAccount(username) {
  return { id: `konto-${nextId++}`, username, avatar: randomAvatar() };
}

function fakeConn() {
  return { views: [], send(view) { this.views.push(view); }, replaced() {} };
}

function setup(count = 4, rounds = 1) {
  const { room, player: host } = createRoom(fakeAccount('Host'));
  const players = [host];
  for (let i = 1; i < count; i++) players.push(room.addPlayer(fakeAccount(`Spieler${i}`)));
  for (const p of players) room.attach(p, fakeConn());
  room.handleAction(host, { type: 'settings', rounds });
  return { room, host, players };
}

function roles(room, players) {
  const imposters = players.filter((p) => room.round.imposters.has(p.id));
  const others = players.filter((p) => !room.round.imposters.has(p.id));
  return { imposters, others };
}

function currentSpeaker(room, players) {
  return players.find((p) => p.id === room.round.order[room.round.position]);
}

function sayWord(room, players, word = 'Testwort') {
  room.handleAction(currentSpeaker(room, players), { type: 'word', word, turn: room.round.turn });
}

test('alle bekommen dasselbe Wort, der Imposter bekommt es nicht', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);

  assert.equal(imposters.length, 1);
  assert.deepEqual(room.viewFor(imposters[0]).round.card, { type: 'imposter' });
  const words = new Set(others.map((p) => room.viewFor(p).round.card.word));
  assert.equal(words.size, 1);
  assert.ok(words.has(room.round.word));
});

test('vor der Auflösung verrät die Sicht von niemandem zu viel', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);

  assert.ok(!JSON.stringify(room.viewFor(imposters[0])).includes(`"${room.round.word}"`));

  room.handleAction(host, { type: 'startVote' });
  assert.ok(!JSON.stringify(room.viewFor(imposters[0])).includes(`"${room.round.word}"`));
  for (const p of others) {
    assert.equal(room.viewFor(p).round.reveal, undefined);
    assert.ok(!JSON.stringify(room.viewFor(p)).includes('imposterIds'));
  }
});

test('Start braucht mindestens drei Spieler und nur der Host darf starten', () => {
  const small = setup(2);
  assert.throws(() => small.room.handleAction(small.host, { type: 'start' }), /mindestens 3/);
  const { room, players } = setup(3);
  assert.throws(() => room.handleAction(players[1], { type: 'start' }), /nur der Host/);
});

test('jeder kommt mal als Startspieler dran', () => {
  const { room, host, players } = setup(4);
  const starters = new Set();
  for (let i = 0; i < 60; i++) {
    room.handleAction(host, { type: 'start' });
    starters.add(players.findIndex((p) => p.id === room.round.order[0]));
    room.handleAction(host, { type: 'lobby' });
  }
  assert.equal(starters.size, 4);
});

test('Wörter: Der Sprecher muss schreiben, danach ist der Nächste dran und alle sehen es', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'start' });
  const order = [...room.round.order];

  for (let lap = 1; lap <= 2; lap++) {
    for (const id of order) {
      const view = room.viewFor(host).round;
      assert.equal(view.currentId, id);
      assert.equal(view.lap, lap);
      room.handleAction(players.find((p) => p.id === id), { type: 'word', word: `Wort${lap}`, turn: view.turn });
    }
  }

  const { words } = room.viewFor(players[1]).round;
  assert.equal(words.length, 6);
  assert.deepEqual(words[0], { playerId: order[0], lap: 1, word: 'Wort1' });
  assert.deepEqual(words[5], { playerId: order[2], lap: 2, word: 'Wort2' });
});

test('Wörter: leer, mehrere Wörter, zu lang und falscher Spieler werden abgelehnt', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'start' });
  const speaker = currentSpeaker(room, players);
  const bystander = players.find((p) => p !== speaker);
  const turn = room.round.turn;

  assert.throws(() => room.handleAction(speaker, { type: 'word', word: '   ', turn }), /Schreib dein Wort/);
  assert.throws(() => room.handleAction(speaker, { type: 'word', word: 'zwei Wörter', turn }), /einzelnes Wort/);
  assert.throws(() => room.handleAction(speaker, { type: 'word', word: 'x'.repeat(25), turn }), /zu lang/);
  assert.throws(() => room.handleAction(bystander, { type: 'word', word: 'Frech', turn }), /nicht dran/);
  assert.equal(room.round.words.length, 0);
});

test('Wörter: Doppelt abgeschickt zählt einmal, nur der Host kann überspringen', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  const speaker = currentSpeaker(room, players);

  room.handleAction(speaker, { type: 'word', word: 'Einmal', turn: 0 });
  assert.equal(room.round.words.length, 1);

  const nonHost = players.find((p) => p !== host);
  assert.throws(() => room.handleAction(nonHost, { type: 'skip', turn: 1 }), /nur der Host/);
  room.handleAction(host, { type: 'skip', turn: 1 });
  room.handleAction(host, { type: 'skip', turn: 1 }); // veralteter Klick
  assert.equal(room.round.position, 2);
  assert.equal(room.round.words[1].word, null);
});

test('Punkte: 10 fürs richtige Abstimmen, der enttarnte Imposter geht leer aus', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  const [imposter] = imposters;

  room.handleAction(others[0], { type: 'vote', target: imposter.id });
  room.handleAction(others[1], { type: 'vote', target: imposter.id });
  room.handleAction(others[2], { type: 'vote', target: others[0].id });
  room.handleAction(imposter, { type: 'vote', target: others[0].id });

  assert.equal(room.phase, 'reveal');
  const reveal = room.viewFor(others[0]).round.reveal;
  assert.equal(reveal.caught, false, 'Gleichstand 2:2 enttarnt niemanden');

  const score = (p) => room.match.scores.get(p.id);
  assert.equal(score(others[0]), 10);
  assert.equal(score(others[1]), 10);
  assert.equal(score(others[2]), 0);
  assert.equal(score(imposter), 25, 'Gleichstand ist ein Imposter-Sieg');
});

test('Punkte: Klare Mehrheit enttarnt den Imposter und gibt ihm nichts', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  const [imposter] = imposters;

  for (const p of others) room.handleAction(p, { type: 'vote', target: imposter.id });
  room.handleAction(imposter, { type: 'vote', target: others[0].id });

  assert.equal(room.result.caught, true);
  assert.equal(room.match.scores.get(imposter.id), 0);
  for (const p of others) assert.equal(room.match.scores.get(p.id), 10);
});

test('Punkte: Der Imposter bekommt 25, wenn jemand anders rausgewählt wird', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  const [imposter] = imposters;

  room.handleAction(imposter, { type: 'vote', target: others[0].id });
  room.handleAction(others[1], { type: 'vote', target: others[0].id });
  room.handleAction(others[2], { type: 'vote', target: others[0].id });
  room.handleAction(others[0], { type: 'vote', target: others[1].id });

  assert.equal(room.result.accusedId, others[0].id);
  assert.equal(room.match.scores.get(imposter.id), 25);
  assert.equal(room.match.scores.get(others[0].id), 0);
});

test('man kann nicht für sich selbst stimmen', () => {
  const { room, host } = setup(3);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  assert.throws(() => room.handleAction(host, { type: 'vote', target: host.id }), /dich selbst/);
});

function playRoundWhereImposterIsCaught(room, host, players) {
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  for (const p of others) room.handleAction(p, { type: 'vote', target: imposters[0].id });
  room.handleAction(imposters[0], { type: 'vote', target: others[0].id });
}

test('Mehrere Runden: Punkte summieren sich, danach kommt das Endergebnis', () => {
  const { room, host, players } = setup(3, 2);
  room.handleAction(host, { type: 'start' });
  assert.equal(room.match.current, 1);
  sayWord(room, players);
  playRoundWhereImposterIsCaught(room, host, players);

  assert.equal(room.phase, 'reveal');
  assert.throws(() => room.handleAction(host, { type: 'showFinal' }), /weitere Runden/);
  const firstWord = room.round.word;
  room.handleAction(host, { type: 'nextRound' });
  assert.equal(room.phase, 'play');
  assert.equal(room.match.current, 2);
  assert.notEqual(room.round.word, firstWord);
  assert.equal(room.round.words.length, 0, 'jede Runde beginnt mit leerer Wortliste');

  playRoundWhereImposterIsCaught(room, host, players);
  assert.throws(() => room.handleAction(host, { type: 'nextRound' }), /letzte Runde/);
  room.handleAction(host, { type: 'showFinal' });
  assert.equal(room.phase, 'final');

  const { match } = room.viewFor(host);
  assert.equal(match.total, 2);
  assert.ok(match.winners.length >= 1);
  const points = match.leaderboard.map((entry) => entry.points);
  assert.deepEqual(points, [...points].sort((a, b) => b - a), 'Rangliste ist absteigend sortiert');
  assert.equal(points.reduce((sum, value) => sum + value, 0), 40, '2 Runden mit je 2 richtigen Stimmen');

  room.handleAction(host, { type: 'start' });
  assert.equal(room.match.current, 1, 'Nochmal spielen beginnt von vorn');
  assert.ok([...room.match.scores.values()].every((value) => value === 0));
});

test('Runden-Einstellung wird geprüft', () => {
  const { room, host, players } = setup(3);
  assert.throws(() => room.handleAction(host, { type: 'settings', rounds: 0 }), /1 bis 10/);
  assert.throws(() => room.handleAction(host, { type: 'settings', rounds: 11 }), /1 bis 10/);
  assert.throws(() => room.handleAction(players[1], { type: 'settings', rounds: 5 }), /nur der Host/);
  room.handleAction(host, { type: 'settings', rounds: 5 });
  assert.equal(room.settings.rounds, 5);
});

test('Die Auflösung liefert dem Browser alles für seine Stats', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'start' });
  playRoundWhereImposterIsCaught(room, host, players);

  const { imposters, others } = roles(room, players);
  const { gains } = room.viewFor(host).round.reveal;
  assert.deepEqual(gains.find((g) => g.id === imposters[0].id), {
    id: imposters[0].id, wasImposter: true, imposterWon: false, voted: true, correctVote: false, points: 0,
  });
  assert.deepEqual(gains.find((g) => g.id === others[0].id), {
    id: others[0].id, wasImposter: false, imposterWon: false, voted: true, correctVote: true, points: 10,
  });
});

test('Ohne Login: Die geheime Browser-Kennung bleibt geheim und muss gültig sein', () => {
  const clientId = 'a'.repeat(32);
  const avatar = randomAvatar();
  const person = identify({ clientId, name: '  Milko  ', avatar });
  assert.equal(person.username, 'Milko');
  assert.equal(identify({ clientId, name: 'Anders', avatar }).id, person.id, 'gleicher Browser, gleiche Person');
  assert.ok(!person.id.includes(clientId) && !clientId.includes(person.id));

  const { room, player: host } = createRoom(person);
  room.attach(host, fakeConn());
  assert.ok(!JSON.stringify(room.viewFor(host)).includes(clientId));

  assert.throws(() => identify({ clientId: 'kurz', name: 'Milko', avatar }), /Ungültige Anfrage/);
  assert.throws(() => identify({ clientId, name: '   ', avatar }), /Namen/);
  assert.throws(() => identify({ clientId, name: 'x'.repeat(17), avatar }), /höchstens 16/);
  assert.throws(() => identify({ clientId, name: 'Milko', avatar: { ...avatar, head: 99 } }), /Avatar/);
});

test('Namen sind pro Raum eindeutig, auch beim Umbenennen', () => {
  const { room, players } = setup(3);
  assert.throws(() => room.addPlayer(fakeAccount('spieler1')), /vergeben/);
  assert.throws(() => room.handleAction(players[2], {
    type: 'profile', name: 'SPIELER1', avatar: randomAvatar(),
  }), /vergeben/);

  const avatar = randomAvatar();
  room.handleAction(players[2], { type: 'profile', name: 'Neu', avatar });
  const seen = room.viewFor(players[0]).players.find((p) => p.id === players[2].id);
  assert.equal(seen.name, 'Neu');
  assert.deepEqual(seen.avatar, avatar);
});

test('Das Profil lässt sich während einer Runde nicht ändern', () => {
  const { room, host } = setup(3);
  room.handleAction(host, { type: 'start' });
  assert.throws(() => room.handleAction(host, { type: 'profile', name: 'Neu', avatar: randomAvatar() }), /geht gerade nicht/);
});

test('Avatare: Nur gültige Werte, jeder Teil lässt sich zeichnen', () => {
  const good = { head: 0, skin: 0, outfit: 0, color: 0, eyes: 0 };
  assert.equal(isValidAvatar(good), true);
  for (const bad of [null, [], {}, { head: 0 }, { figure: 0, color: 0 }, { ...good, head: 99 }, { ...good, skin: 1.5 }, { ...good, color: '1' }, { ...good, hack: 1 }]) {
    assert.equal(isValidAvatar(bad), false);
  }
  for (const key of Object.keys(PARTS)) {
    assert.ok(PARTS[key].names.length <= 6, `${key}: Die Auswahl soll klein bleiben`);
    for (let option = 0; option < PARTS[key].names.length; option++) {
      const avatar = { ...good, [key]: option };
      assert.equal(isValidAvatar(avatar), true);
      const markup = avatarMarkup(avatar);
      assert.ok(markup.includes('clip-path'));
      assert.ok(!/undefined|NaN/.test(markup), `${key} ${option} hat fehlende Werte`);
    }
  }
});

test('Mehrere Imposter: Anzahl lässt sich einstellen und alle sehen sie von Anfang an', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'settings', imposters: 3 });
  room.handleAction(host, { type: 'start' });
  assert.equal(room.round.imposters.size, 3);
  for (const player of players) {
    assert.equal(room.viewFor(player).round.imposterCount, 3);
  }
  const cards = players.map((p) => room.viewFor(p).round.card.type);
  assert.equal(cards.filter((type) => type === 'imposter').length, 3);
  assert.equal(cards.filter((type) => type === 'word').length, 2);

  const { imposters, others } = roles(room, players);
  const leak = JSON.stringify(room.viewFor(imposters[0]));
  assert.ok(!leak.includes(`"${room.round.word}"`));
  assert.ok(!leak.includes('imposterIds'), 'Imposter erfahren nicht, wer die anderen sind');
  assert.deepEqual(Object.keys(room.viewFor(imposters[0]).round).sort(), Object.keys(room.viewFor(others[0]).round).sort());
});

test('Mehrere Imposter: Wer unentdeckt bleibt, bekommt 25, ein enttarnter Imposter beendet das', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'settings', imposters: 2 });
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);

  // Alle stimmen für einen Unschuldigen: Beide Imposter gewinnen.
  for (const p of players.filter((player) => player !== others[0])) {
    room.handleAction(p, { type: 'vote', target: others[0].id });
  }
  room.handleAction(others[0], { type: 'vote', target: others[1].id });
  assert.equal(room.result.caught, false);
  for (const imposter of imposters) assert.equal(room.match.scores.get(imposter.id), 25);

  // Ein enttarnter Imposter: Die Gruppe gewinnt, die Imposter gehen leer aus.
  room.handleAction(host, { type: 'lobby' });
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const second = roles(room, players);
  for (const p of players.filter((player) => player !== second.imposters[0])) {
    room.handleAction(p, { type: 'vote', target: second.imposters[0].id });
  }
  room.handleAction(second.imposters[0], { type: 'vote', target: second.others[0].id });
  assert.equal(room.result.caught, true);
  assert.equal(room.match.scores.get(second.imposters[0].id), 0);
});

test('wer während der Runde dazukommt, schaut zu und spielt ab der nächsten mit', () => {
  const { room, host, players } = setup(3, 2);
  room.handleAction(host, { type: 'start' });
  const late = room.addPlayer(fakeAccount('Spaet'));
  room.attach(late, fakeConn());

  const view = room.viewFor(late);
  assert.equal(view.round.card, null);
  assert.ok(!JSON.stringify(view).includes(`"${room.round.word}"`));

  playRoundWhereImposterIsCaught(room, host, players);
  room.handleAction(host, { type: 'nextRound' });
  assert.ok(room.round.order.includes(late.id));
});

test('Verlassen: Sprecher wird übersprungen, ohne Imposter endet das Spiel', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'start' });
  const { imposters } = roles(room, players);

  if (imposters.includes(currentSpeaker(room, players))) sayWord(room, players);
  const speaker = currentSpeaker(room, players);
  room.handleAction(speaker, { type: 'leave' });
  assert.equal(room.phase, 'play');
  assert.notEqual(room.round.order[room.round.position], speaker.id);

  room.handleAction(imposters[0], { type: 'leave' });
  assert.equal(room.phase, 'lobby');
  assert.match(room.notice, /Imposter/);
  assert.equal(room.match, null);
});

test('Host geht: die Rolle wandert weiter', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'leave' });
  assert.equal(room.hostId, players[1].id);
});

test('Aus demselben Browser kommt man auf seinen Platz zurück', () => {
  const account = fakeAccount('Wieder');
  const { room, player: host } = createRoom(fakeAccount('Host'));
  const player = room.addPlayer(account);
  room.attach(host, fakeConn());
  const conn = fakeConn();
  room.attach(player, conn);

  room.detach(player, conn);
  assert.equal(room.addPlayer(account).token, player.token);
  assert.equal(room.players.size, 2);
});

test('Mindestens ein Spieler kennt immer das Wort', () => {
  assert.equal(maxImposters(1), 1);
  assert.equal(maxImposters(2), 1);
  assert.equal(maxImposters(3), 2);
  assert.equal(maxImposters(5), 4);

  const { room, host } = setup(3);
  room.handleAction(host, { type: 'settings', imposters: 5 });
  room.handleAction(host, { type: 'start' });
  assert.equal(room.round.imposters.size, 2, 'zu hohe Einstellung wird begrenzt');
});
