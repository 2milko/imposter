'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore } = require('../accounts');
const { randomAvatar } = require('../public/avatar');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imposter-test-'));
  return path.join(dir, 'unterordner', 'imposter.db');
}

test('Registrieren, Anmelden, Abmelden', async () => {
  const store = new AccountStore(':memory:');
  const avatar = randomAvatar();
  const { token, account } = await store.register('Milko', 'geheim123', avatar);
  assert.equal(store.authenticate(token).id, account.id);
  assert.deepEqual(account.avatar, avatar);

  const login = await store.login('MILKO', 'geheim123');
  assert.equal(login.account.id, account.id, 'Groß- und Kleinschreibung egal');
  await assert.rejects(store.login('Milko', 'falsch'), /stimmt nicht/);
  await assert.rejects(store.login('Niemand', 'geheim123'), /stimmt nicht/);

  store.logout(token);
  assert.equal(store.authenticate(token), null);
  assert.equal(store.authenticate('quatsch'), null);
  assert.equal(store.authenticate(login.token).id, account.id, 'andere Geräte bleiben angemeldet');
});

test('Ungültige Namen und Passwörter werden abgelehnt, Namen sind eindeutig', async () => {
  const store = new AccountStore(':memory:');
  await assert.rejects(store.register('ab', 'geheim123'), /3 bis 16/);
  await assert.rejects(store.register('<b>Hack</b>', 'geheim123'), /3 bis 16/);
  await assert.rejects(store.register('Lang', '123'), /mindestens 6/);
  await assert.rejects(store.register('Gut', 'geheim123', { head: 99 }), /Avatar/);
  await store.register('Björn_1', 'geheim123');
  await assert.rejects(store.register('björn_1', 'anderes123'), /vergeben/);
});

test('Passwort und Token liegen nie im Klartext in der Datenbank', async () => {
  const file = tempDb();
  const store = new AccountStore(file);
  const { account, token } = await store.register('Milko', 'SuperGeheim');
  store.close();
  const raw = fs.readFileSync(file).toString('latin1');
  assert.ok(!raw.includes('SuperGeheim'));
  assert.ok(!raw.includes(token));

  const reopened = new AccountStore(file);
  const shown = JSON.stringify(reopened.publicAccount(reopened.findById(account.id)));
  assert.ok(!/passwordHash|salt/.test(shown));
  reopened.close();
});

test('Zu viele Fehlversuche sperren die Anmeldung, zu viele Konten pro Adresse auch', async () => {
  const store = new AccountStore(':memory:');
  await store.register('Milko', 'geheim123');
  for (let i = 0; i < 10; i++) await assert.rejects(store.login('Milko', 'falsch'), /stimmt nicht/);
  await assert.rejects(store.login('Milko', 'geheim123'), /Zu viele/);

  for (let i = 0; i < 20; i++) await store.register(`Konto${i}`, 'geheim123', undefined, '1.2.3.4');
  await assert.rejects(store.register('Konto99', 'geheim123', undefined, '1.2.3.4'), /Zu viele neue Konten/);
  await store.register('Andere', 'geheim123', undefined, '5.6.7.8');
});

test('Passwort ändern meldet alle anderen Geräte ab', async () => {
  const store = new AccountStore(':memory:');
  const { account, token } = await store.register('Milko', 'geheim123');
  await assert.rejects(store.changePassword(account, 'falsch', 'neuesPasswort'), /alte Passwort/);
  await store.changePassword(account, 'geheim123', 'neuesPasswort');
  assert.equal(store.authenticate(token), null);
  await assert.rejects(store.login('Milko', 'geheim123'), /stimmt nicht/);
  await store.login('Milko', 'neuesPasswort');
});

test('Stats, Avatar und Anmeldung überstehen einen Neustart, Bestenliste sortiert nach Punkten', async () => {
  const file = tempDb();
  const store = new AccountStore(file);
  const a = await store.register('Aria', 'geheim123');
  const b = await store.register('Bram', 'geheim123');
  await store.register('Cora', 'geheim123'); // spielt nie, taucht nicht auf
  const avatar = randomAvatar();
  store.setAvatar(a.account, avatar);
  store.recordRound([
    { id: a.account.id, wasImposter: true, imposterWon: true, votesCast: 1, correctVotes: 0, points: 25 },
    { id: b.account.id, wasImposter: false, imposterWon: false, votesCast: 2, correctVotes: 1, points: 10 },
  ]);
  store.recordMatch([a.account.id, b.account.id], [a.account.id]);
  store.close();

  const reopened = new AccountStore(file);
  const loaded = reopened.authenticate(a.token);
  assert.deepEqual(loaded.avatar, avatar);
  assert.deepEqual(reopened.statsFor(a.account.id), {
    matchesPlayed: 1, matchesWon: 1, roundsPlayed: 1, imposterRounds: 1,
    imposterWins: 1, votesCast: 1, correctVotes: 0, points: 25,
  });
  assert.deepEqual(reopened.leaderboard().map((row) => [row.username, row.points]), [['Aria', 25], ['Bram', 10]]);
  reopened.close();
});
