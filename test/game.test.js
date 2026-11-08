'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoom, identify, maxImposters, isSameWord, TURN_MS } = require('../game');
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

test('Gleichstand: Niemand fliegt raus und es geht weiter', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  const [imposter] = imposters;

  room.handleAction(others[0], { type: 'vote', target: imposter.id });
  room.handleAction(others[1], { type: 'vote', target: imposter.id });
  room.handleAction(others[2], { type: 'vote', target: others[0].id });
  room.handleAction(imposter, { type: 'vote', target: others[0].id });

  assert.equal(room.phase, 'kicked');
  assert.equal(room.viewFor(host).round.kick.playerId, null);
  assert.equal(room.round.kicked.size, 0);
  assert.equal(room.match.scores.size, 0, 'Punkte gibt es erst am Ende der Runde');

  room.handleAction(host, { type: 'continueRound' });
  assert.equal(room.phase, 'play');
});

function voteOut(room, players, target) {
  const voters = players.filter((p) => room.activeRoundPlayers().includes(p));
  const fallback = voters.find((p) => p !== target);
  for (const voter of voters) {
    room.handleAction(voter, { type: 'vote', target: (voter === target ? fallback : target).id });
  }
}

test('Rauswahl: Eine Person fliegt raus, die Runde geht ohne sie weiter', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'settings', imposters: 1 });
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);
  const innocent = others.find((p) => p !== host) ?? others[0];
  const lapBefore = room.round.lap;

  room.handleAction(host, { type: 'startVote' });
  voteOut(room, players, innocent);

  assert.equal(room.phase, 'kicked');
  const seen = room.viewFor(others.find((p) => p !== innocent));
  assert.equal(seen.round.kick.playerId, innocent.id);
  assert.deepEqual(seen.round.kicked, [{ id: innocent.id, role: null }], 'die Rolle bleibt erst mal offen');
  assert.ok(!JSON.stringify(seen).includes('imposterIds'));

  room.handleAction(host, { type: 'continueRound' });
  assert.equal(room.phase, 'play');
  assert.equal(room.round.lap, lapBefore + 1);
  assert.equal(room.viewFor(host).round.turnEndsIn, TURN_MS);
  const speakers = new Set();
  for (let i = 0; i < 8; i++) {
    speakers.add(room.round.order[room.round.position]);
    sayWord(room, players);
  }
  assert.equal(speakers.size, 4);
  assert.ok(!speakers.has(innocent.id), 'Rausgewählte sind nicht mehr dran');

  const kickedView = room.viewFor(innocent).round;
  assert.equal(kickedView.youKicked, true);
  assert.throws(() => room.handleAction(innocent, { type: 'sus', target: imposters[0].id }), /nicht mit/);
  room.handleAction(host, { type: 'startVote' });
  assert.throws(() => room.handleAction(innocent, { type: 'vote', target: imposters[0].id }), /nicht mit/);
  assert.ok(!room.viewFor(host).round.vote.candidates.includes(innocent.id));
});

test('Rauswahl: Wer rausfliegt, entscheidet selbst, ob die Rolle gezeigt wird', () => {
  const start = () => {
    const game = setup(6);
    game.room.handleAction(game.host, { type: 'settings', imposters: 2 });
    game.room.handleAction(game.host, { type: 'start' });
    game.room.handleAction(game.host, { type: 'startVote' });
    return { ...game, ...roles(game.room, game.players) };
  };

  const shown = start();
  const [imposter, partner] = shown.imposters;
  voteOut(shown.room, shown.players, imposter);
  assert.equal(shown.room.phase, 'kicked', 'ein Imposter ist noch übrig');
  assert.throws(() => shown.room.handleAction(partner, { type: 'revealRole', show: true }), /nur, wer rausgewählt/);
  shown.room.handleAction(imposter, { type: 'revealRole', show: true });
  assert.deepEqual(shown.room.viewFor(partner).round.kicked, [{ id: imposter.id, role: 'imposter' }]);
  assert.throws(() => shown.room.handleAction(imposter, { type: 'revealRole', show: false }), /schon entschieden/);

  const hidden = start();
  voteOut(hidden.room, hidden.players, hidden.imposters[0]);
  hidden.room.handleAction(hidden.imposters[0], { type: 'revealRole', show: false });
  const seen = hidden.room.viewFor(hidden.others[0]).round;
  assert.deepEqual(seen.kicked, [{ id: hidden.imposters[0].id, role: null }]);
  assert.equal(seen.kick.choice, 'hidden');

  // Ohne Entscheidung kann der Host weitermachen, die Rolle bleibt dann geheim.
  const skipped = start();
  voteOut(skipped.room, skipped.players, skipped.imposters[0]);
  skipped.room.handleAction(skipped.host, { type: 'continueRound' });
  assert.equal(skipped.room.viewFor(skipped.others[0]).round.kicked[0].role, null);
});

test('Spielende: Die Gruppe gewinnt erst, wenn alle Imposter draußen sind', () => {
  const { room, host, players } = setup(6);
  room.handleAction(host, { type: 'settings', imposters: 2 });
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);

  room.handleAction(host, { type: 'startVote' });
  voteOut(room, players, imposters[0]);
  assert.equal(room.phase, 'kicked');
  room.handleAction(host, { type: 'continueRound' });

  room.handleAction(host, { type: 'startVote' });
  voteOut(room, players, imposters[1]);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.caught, true);
  const { gains } = room.result;
  for (const imposter of imposters) {
    assert.equal(gains.find((g) => g.id === imposter.id).imposterWon, false);
  }
  for (const p of others) assert.equal(room.match.scores.get(p.id), 20, 'zwei richtige Stimmen');
  assert.deepEqual(
    room.viewFor(others[0]).round.kicked.map((entry) => entry.role),
    ['imposter', 'imposter'],
    'am Ende werden alle Rollen aufgedeckt',
  );
});

test('Spielende: Sind die Imposter in der Überzahl, gewinnen auch die rausgewählten', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'settings', imposters: 2 });
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);

  room.handleAction(host, { type: 'startVote' });
  voteOut(room, players, others[0]);
  assert.equal(room.phase, 'reveal', '2 Imposter gegen 2 Wort-Kenner');
  assert.equal(room.result.caught, false);
  for (const imposter of imposters) assert.equal(room.match.scores.get(imposter.id), 25);

  const second = setup(6);
  second.room.handleAction(second.host, { type: 'settings', imposters: 2 });
  second.room.handleAction(second.host, { type: 'start' });
  const parts = roles(second.room, second.players);
  second.room.handleAction(second.host, { type: 'startVote' });
  voteOut(second.room, second.players, parts.imposters[0]);
  second.room.handleAction(second.host, { type: 'continueRound' });
  second.room.handleAction(second.host, { type: 'startVote' });
  voteOut(second.room, second.players, parts.others[0]);
  assert.equal(second.room.phase, 'kicked', '1 Imposter gegen 3 Wort-Kenner');
  second.room.handleAction(second.host, { type: 'continueRound' });
  second.room.handleAction(second.host, { type: 'startVote' });
  voteOut(second.room, second.players, parts.others[1]);
  assert.equal(second.room.phase, 'kicked', '1 Imposter gegen 2 Wort-Kenner');
  second.room.handleAction(second.host, { type: 'continueRound' });
  second.room.handleAction(second.host, { type: 'startVote' });
  voteOut(second.room, second.players, parts.others[2]);
  assert.equal(second.room.phase, 'reveal', '1 Imposter gegen 1 Wort-Kenner');
  assert.equal(second.room.match.scores.get(parts.imposters[0].id), 25, 'auch der rausgewählte Imposter gewinnt mit');
});

test('Rausgewählte Imposter können nicht mehr raten, Stats zählen alle Stimmen', () => {
  const { room, host, players } = setup(6);
  room.handleAction(host, { type: 'settings', imposters: 2 });
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);
  room.handleAction(host, { type: 'startVote' });
  voteOut(room, players, imposters[0]);
  room.handleAction(host, { type: 'continueRound' });
  assert.throws(() => room.handleAction(imposters[0], { type: 'guess', guess: room.round.word }), /rausgewählt/);

  room.handleAction(imposters[1], { type: 'guess', guess: room.round.word });
  assert.equal(room.phase, 'reveal');
  const gain = room.viewFor(others[0]).round.reveal.gains.find((g) => g.id === others[0].id);
  assert.equal(gain.votesCast, 1);
  assert.equal(gain.correctVotes, 1);
  assert.equal(gain.points, 10, 'die richtige Stimme von vorhin zählt weiter');
});

test('Einstellung: Imposter sehen sich nur, wenn der Host es erlaubt', () => {
  const off = setup(5);
  off.room.handleAction(off.host, { type: 'settings', imposters: 2 });
  off.room.handleAction(off.host, { type: 'start' });
  const offRoles = roles(off.room, off.players);
  assert.equal(off.room.viewFor(offRoles.imposters[0]).round.partners, undefined);

  const on = setup(5);
  assert.equal(on.room.settings.impostersKnow, false, 'standardmäßig aus');
  assert.throws(() => on.room.handleAction(on.players[1], { type: 'settings', impostersKnow: true }), /nur der Host/);
  on.room.handleAction(on.host, { type: 'settings', imposters: 2, impostersKnow: true });
  on.room.handleAction(on.host, { type: 'start' });
  const onRoles = roles(on.room, on.players);
  assert.deepEqual(on.room.viewFor(onRoles.imposters[0]).round.partners, [onRoles.imposters[1].id]);
  assert.deepEqual(on.room.viewFor(onRoles.imposters[1]).round.partners, [onRoles.imposters[0].id]);
  for (const p of onRoles.others) {
    assert.equal(on.room.viewFor(p).round.partners, undefined, 'Wort-Kenner erfahren nichts');
  }
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

test('Punkte: Der Imposter bekommt 25, wenn er die Überzahl erreicht', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  const [imposter] = imposters;

  room.handleAction(imposter, { type: 'vote', target: others[0].id });
  room.handleAction(others[1], { type: 'vote', target: others[0].id });
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
    id: imposters[0].id, wasImposter: true, imposterWon: false, votesCast: 1, correctVotes: 0, points: 0,
  });
  assert.deepEqual(gains.find((g) => g.id === others[0].id), {
    id: others[0].id, wasImposter: false, imposterWon: false, votesCast: 1, correctVotes: 1, points: 10,
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

test('Timer: Nach 30 Sekunden kommt automatisch der Nächste dran, ein Wort startet die Zeit neu', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { room, host, players } = setup(3);
  const conns = players.map((p) => p.conn);
  room.handleAction(host, { type: 'start' });
  const [first, second, third] = room.round.order;
  assert.equal(TURN_MS, 30_000);
  assert.equal(room.viewFor(host).round.turnEndsIn, 30_000);

  t.mock.timers.tick(10_000);
  assert.equal(room.viewFor(host).round.turnEndsIn, 20_000);
  t.mock.timers.tick(19_999);
  assert.equal(room.viewFor(host).round.currentId, first);
  const seenBefore = conns[0].views.length;
  t.mock.timers.tick(1);
  assert.equal(room.viewFor(host).round.currentId, second);
  assert.deepEqual(room.round.words[0], { playerId: first, lap: 1, word: null, reason: 'timeout' });
  assert.ok(conns[0].views.length > seenBefore, 'alle werden sofort benachrichtigt');

  t.mock.timers.tick(20_000);
  sayWord(room, players, 'Schnell');
  assert.equal(room.viewFor(host).round.currentId, third);
  assert.equal(room.viewFor(host).round.turnEndsIn, 30_000);

  room.handleAction(host, { type: 'startVote' });
  t.mock.timers.tick(60_000);
  assert.equal(room.phase, 'vote');
  assert.equal(room.round.words.length, 2, 'während der Abstimmung läuft keine Zeit');
});

test('Wort raten: Gleiche Schreibweise und kleine Tippfehler zählen automatisch', () => {
  assert.ok(isSameWord('Sonnenfinsternis', 'Sonnenfinsternis'));
  assert.ok(isSameWord('  bäckerei!', 'Bäckerei'));
  assert.ok(isSameWord('baeckerei', 'Bäckerei'));
  assert.ok(isSameWord('Bäkerei', 'Bäckerei'));
  assert.ok(isSameWord('sonenfinsterni', 'Sonnenfinsternis'));
  assert.ok(!isSameWord('Ofen', 'Oben'), 'kurze Wörter müssen exakt stimmen');
  assert.ok(!isSameWord('h2o', 'Wasser'));
  assert.ok(!isSameWord('???', 'Wasser'));
});

function imposterRound(count = 4) {
  const game = setup(count);
  game.room.handleAction(game.host, { type: 'start' });
  return { ...game, ...roles(game.room, game.players) };
}

test('Wort raten: Ein richtiger Tipp lässt den Imposter sofort gewinnen', () => {
  const { room, host, imposters, others } = imposterRound();
  room.handleAction(imposters[0], { type: 'guess', guess: room.round.word });

  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.caught, false);
  assert.equal(room.match.scores.get(imposters[0].id), 25);
  for (const p of others) assert.equal(room.match.scores.get(p.id), 0);
  assert.deepEqual(room.viewFor(host).round.reveal.guess, {
    playerId: imposters[0].id, text: room.round.word, correct: true, judged: false,
  });
});

test('Wort raten: Nur Imposter dürfen raten, und das Wort bleibt bis zur Auflösung geheim', () => {
  const { room, imposters, others } = imposterRound();
  assert.throws(() => room.handleAction(others[0], { type: 'guess', guess: 'x' }), /Nur Imposter/);
  assert.throws(() => room.handleAction(imposters[0], { type: 'guess', guess: '   ' }), /Tipp/);
  assert.throws(() => room.handleAction(imposters[0], { type: 'guess', guess: 'x'.repeat(41) }), /zu lang/);

  room.handleAction(imposters[0], { type: 'guess', guess: 'zzz-ganz-anders' });
  assert.equal(room.phase, 'guess');
  const seenByImposter = room.viewFor(imposters[0]);
  assert.equal(seenByImposter.round.guess.text, 'zzz-ganz-anders');
  assert.ok(!JSON.stringify(seenByImposter).includes(`"${room.round.word}"`));
  assert.equal(room.viewFor(others[0]).round.guess.text, 'zzz-ganz-anders');
});

test('Wort raten: Die Mitwisser entscheiden über ähnliche Wörter', () => {
  const { room, imposters, others } = imposterRound();
  room.handleAction(imposters[0], { type: 'guess', guess: 'h2o' });
  assert.throws(() => room.handleAction(imposters[0], { type: 'judgeGuess', accepted: true }), /entscheiden/);

  room.handleAction(others[0], { type: 'judgeGuess', accepted: true });
  room.handleAction(others[1], { type: 'judgeGuess', accepted: true });
  assert.equal(room.phase, 'guess');
  room.handleAction(others[2], { type: 'judgeGuess', accepted: false });

  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.guess.correct, true);
  assert.equal(room.result.guess.judged, true);
  assert.equal(room.match.scores.get(imposters[0].id), 25);
});

test('Wort raten: Ein falscher Tipp beendet die Runde, die Gruppe gewinnt', () => {
  const { room, imposters, others } = imposterRound();
  room.handleAction(imposters[0], { type: 'guess', guess: 'quatsch' });
  for (const p of others) room.handleAction(p, { type: 'judgeGuess', accepted: false });

  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.caught, true);
  assert.equal(room.result.guess.correct, false);
  assert.equal(room.match.scores.get(imposters[0].id), 0);
});

test('Wort raten: Gleichstand zählt, der Host kann bei fehlenden Stimmen auswerten', () => {
  const tied = imposterRound();
  tied.room.handleAction(tied.imposters[0], { type: 'guess', guess: 'aehnlich' });
  tied.room.handleAction(tied.others[0], { type: 'judgeGuess', accepted: true });
  tied.room.handleAction(tied.others[1], { type: 'judgeGuess', accepted: false });
  const nonHost = tied.others.find((p) => p !== tied.host);
  assert.throws(() => tied.room.handleAction(nonHost, { type: 'finishGuess' }), /nur der Host/);
  tied.room.handleAction(tied.host, { type: 'finishGuess' });
  assert.equal(tied.room.result.guess.correct, true);

  const empty = imposterRound();
  empty.room.handleAction(empty.imposters[0], { type: 'guess', guess: 'aehnlich' });
  empty.room.handleAction(empty.host, { type: 'finishGuess' });
  assert.equal(empty.room.result.guess.correct, false, 'ohne jede Zustimmung zählt der Tipp nicht');
});

test('Wort raten: Auch während der Abstimmung möglich, offene Stimmen verfallen', () => {
  const { room, host, imposters, others } = imposterRound();
  room.handleAction(host, { type: 'startVote' });
  room.handleAction(others[0], { type: 'vote', target: imposters[0].id });
  room.handleAction(imposters[0], { type: 'guess', guess: room.round.word });
  assert.equal(room.phase, 'reveal');
  assert.equal(room.match.scores.get(others[0].id), 0);
  assert.equal(room.result.tally.every((row) => row.count === 0), true);
});

test('Wort raten: Geht ein Prüfer offline, entscheiden die übrigen', () => {
  const { room, imposters, others } = imposterRound();
  room.handleAction(imposters[0], { type: 'guess', guess: 'aehnlich' });
  room.handleAction(others[0], { type: 'judgeGuess', accepted: true });
  room.handleAction(others[1], { type: 'judgeGuess', accepted: true });
  room.detach(others[2], others[2].conn);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.guess.correct, true);
});

test('Sus: Markierungen sehen alle, sie lassen sich zurücknehmen und gelten pro Runde', () => {
  const { room, host, players } = setup(3, 2);
  room.handleAction(host, { type: 'start' });
  const [a, b, c] = players;

  room.handleAction(a, { type: 'sus', target: b.id });
  room.handleAction(c, { type: 'sus', target: b.id });
  assert.deepEqual(room.viewFor(a).round.sus, [{ id: b.id, by: [a.id, c.id] }]);
  assert.deepEqual(room.viewFor(b).round.sus, [{ id: b.id, by: [a.id, c.id] }]);

  room.handleAction(a, { type: 'sus', target: b.id });
  assert.deepEqual(room.viewFor(c).round.sus, [{ id: b.id, by: [c.id] }]);

  assert.throws(() => room.handleAction(a, { type: 'sus', target: a.id }), /selbst/);
  assert.throws(() => room.handleAction(a, { type: 'sus', target: 'gibt-es-nicht' }), /Ungültiger/);

  room.handleAction(host, { type: 'startVote' });
  room.handleAction(a, { type: 'sus', target: c.id });
  const { imposters, others } = roles(room, players);
  voteOut(room, players, imposters[0]);
  assert.equal(room.phase, 'reveal');
  assert.throws(() => room.handleAction(others[0], { type: 'sus', target: others[1].id }), /geht gerade nicht/);

  room.handleAction(host, { type: 'nextRound' });
  assert.deepEqual(room.viewFor(a).round.sus, []);
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
