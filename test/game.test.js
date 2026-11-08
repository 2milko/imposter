'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoom, maxImposters } = require('../game');

function fakeConn() {
  return { views: [], send(view) { this.views.push(view); }, replaced() {} };
}

function setup(count = 4) {
  const { room, player: host } = createRoom('Host');
  const players = [host];
  for (let i = 1; i < count; i++) players.push(room.addPlayer(`Spieler ${i}`));
  for (const p of players) room.attach(p, fakeConn());
  return { room, host, players };
}

function roles(room, players) {
  const imposters = players.filter((p) => room.round.imposters.has(p.id));
  const others = players.filter((p) => !room.round.imposters.has(p.id));
  return { imposters, others };
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

  const imposterView = JSON.stringify(room.viewFor(imposters[0]));
  assert.ok(!imposterView.includes(`"${room.round.word}"`), 'Imposter darf das Wort nicht erhalten');

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

test('der Startspieler ist zufällig verteilt', () => {
  const starters = new Set();
  for (let i = 0; i < 60; i++) {
    const { room, host } = setup(4);
    room.handleAction(host, { type: 'start' });
    starters.add(room.round.order[0]);
    const seen = room.viewFor(host).round.currentId;
    assert.equal(seen, room.round.order[0]);
    starters.add(seen);
  }
  // Ein neuer Raum hat neue IDs, deshalb reicht es zu prüfen, dass Reihenfolgen variieren.
  assert.ok(starters.size > 1);

  const { room, host, players } = setup(4);
  const positions = new Set();
  for (let i = 0; i < 60; i++) {
    room.handleAction(host, { type: 'start' });
    positions.add(players.findIndex((p) => p.id === room.round.order[0]));
    room.handleAction(host, { type: 'lobby' });
  }
  assert.equal(positions.size, 4, 'jeder Spieler sollte mal anfangen');
});

test('reihum geht es durch alle und danach in den nächsten Durchgang', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'start' });
  const order = [...room.round.order];

  for (let lap = 1; lap <= 2; lap++) {
    for (const id of order) {
      const view = room.viewFor(host).round;
      assert.equal(view.currentId, id);
      assert.equal(view.lap, lap);
      room.handleAction(players.find((p) => p.id === id), { type: 'next', turn: view.turn });
    }
  }
});

test('nur der Sprecher oder der Host können weiterschalten, Doppelklicks zählen einmal', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  const bystander = players.find((p) => p.id !== host.id && p.id !== room.round.order[0]);
  assert.throws(() => room.handleAction(bystander, { type: 'next', turn: 0 }), /nicht dran/);

  room.handleAction(host, { type: 'next', turn: 0 });
  room.handleAction(host, { type: 'next', turn: 0 }); // veralteter Klick
  assert.equal(room.round.position, 1);
});

test('die richtige Stimme enttarnt den Imposter', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const { imposters, others } = roles(room, players);
  const [imposter] = imposters;

  for (const p of others) room.handleAction(p, { type: 'vote', target: imposter.id });
  assert.equal(room.phase, 'vote');
  room.handleAction(imposter, { type: 'vote', target: others[0].id });

  assert.equal(room.phase, 'reveal');
  const reveal = room.viewFor(others[0]).round.reveal;
  assert.equal(reveal.caught, true);
  assert.equal(reveal.accusedId, imposter.id);
  assert.equal(reveal.word, room.round.word);
});

test('Gleichstand zählt als Sieg für den Imposter', () => {
  const { room, host, players } = setup(4);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  const [a, b, c, d] = players;
  room.handleAction(a, { type: 'vote', target: b.id });
  room.handleAction(b, { type: 'vote', target: a.id });
  room.handleAction(c, { type: 'vote', target: a.id });
  room.handleAction(d, { type: 'vote', target: b.id });

  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.accusedId, null);
  assert.equal(room.result.caught, false);
});

test('man kann nicht für sich selbst stimmen', () => {
  const { room, host } = setup(3);
  room.handleAction(host, { type: 'start' });
  room.handleAction(host, { type: 'startVote' });
  assert.throws(() => room.handleAction(host, { type: 'vote', target: host.id }), /dich selbst/);
});

test('wer während der Runde dazukommt, schaut zu und sieht das Wort nicht', () => {
  const { room, host } = setup(3);
  room.handleAction(host, { type: 'start' });
  const late = room.addPlayer('Zu spät');
  room.attach(late, fakeConn());

  const view = room.viewFor(late);
  assert.equal(view.round.card, null);
  assert.ok(!JSON.stringify(view).includes(`"${room.round.word}"`));
});

test('Verlassen: Sprecher wird übersprungen, ohne Imposter endet die Runde', () => {
  const { room, host, players } = setup(5);
  room.handleAction(host, { type: 'start' });
  const { imposters, others } = roles(room, players);

  // Nicht-Imposter als aktuellen Sprecher verlassen lassen
  const speaker = players.find((p) => p.id === room.round.order[room.round.position]);
  if (imposters.includes(speaker)) {
    room.handleAction(host, { type: 'next', turn: room.round.turn });
  }
  const current = players.find((p) => p.id === room.round.order[room.round.position]);
  const nonHostLeaver = current;
  room.handleAction(nonHostLeaver, { type: 'leave' });
  assert.equal(room.phase, 'play');
  assert.notEqual(room.round.order[room.round.position], nonHostLeaver.id);

  room.handleAction(imposters[0], { type: 'leave' });
  assert.equal(room.phase, 'lobby');
  assert.match(room.notice, /Imposter/);
  assert.ok(others.length > 0);
});

test('Host geht: die Rolle wandert weiter', () => {
  const { room, host, players } = setup(3);
  room.handleAction(host, { type: 'leave' });
  assert.equal(room.hostId, players[1].id);
});

test('verlorene Verbindung: Mit demselben Namen kommt man zurück, belegte Namen sind gesperrt', () => {
  const { room, players } = setup(3);
  const target = players[1];
  assert.throws(() => room.addPlayer(target.name), /vergeben/);

  room.detach(target, target.conn);
  assert.equal(room.addPlayer(target.name).token, target.token);
});

test('höchstens so viele Imposter, dass die Mehrheit das Wort kennt', () => {
  assert.equal(maxImposters(3), 1);
  assert.equal(maxImposters(4), 1);
  assert.equal(maxImposters(5), 2);
  assert.equal(maxImposters(7), 3);

  const { room, host } = setup(3);
  room.handleAction(host, { type: 'settings', imposters: 5 });
  room.handleAction(host, { type: 'start' });
  assert.equal(room.round.imposters.size, 1);
});
