'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { randomBytes, scrypt, createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { GameError } = require('./errors');
const { isValidAvatar, randomAvatar } = require('./public/avatar');

const scryptAsync = promisify(scrypt);

const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,16}$/u;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 200;
const SESSION_LIFETIME_MS = 180 * 24 * 60 * 60_000;
const MAX_LOGIN_FAILURES = 10;
const LOGIN_LOCK_MS = 15 * 60_000;
const MAX_REGISTRATIONS_PER_HOUR = 20; // pro IP-Adresse, gegen massenhaft angelegte Konten
const KEY_LENGTH = 64;
const LEADERBOARD_SIZE = 20;

const STAT_FIELDS = [
  'matchesPlayed', 'matchesWon', 'roundsPlayed', 'imposterRounds',
  'imposterWins', 'votesCast', 'correctVotes', 'points',
];

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password, salt) {
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return key.toString('hex');
}

function validateUsername(raw) {
  const username = String(raw ?? '').trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new GameError('Der Name braucht 3 bis 16 Zeichen: Buchstaben, Zahlen, _ oder -.');
  }
  return username;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new GameError(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new GameError('Das Passwort ist zu lang.');
}

class AccountStore {
  constructor(filePath) {
    if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        ${STAT_FIELDS.map((field) => `${field} INTEGER NOT NULL DEFAULT 0`).join(',\n        ')}
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL
      );
    `);
    this.loginFailures = new Map();
    this.registrations = new Map();
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  }

  close() {
    this.db.close();
  }

  // --- Lesen -------------------------------------------------------------

  rowToAccount(row) {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      avatar: JSON.parse(row.avatar),
      createdAt: row.created_at,
      salt: row.salt,
      passwordHash: row.password_hash,
    };
  }

  findById(id) {
    return this.rowToAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
  }

  findByUsername(username) {
    return this.rowToAccount(this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(username));
  }

  statsFor(id) {
    const row = this.db.prepare(`SELECT ${STAT_FIELDS.join(', ')} FROM stats WHERE account_id = ?`).get(id);
    return Object.fromEntries(STAT_FIELDS.map((field) => [field, row?.[field] ?? 0]));
  }

  // Für die Anzeige: nie Passwort-Hash oder Salt nach außen geben.
  publicAccount(account) {
    return {
      id: account.id,
      username: account.username,
      avatar: account.avatar,
      createdAt: account.createdAt,
      stats: this.statsFor(account.id),
    };
  }

  leaderboard() {
    return this.db.prepare(`
      SELECT a.username, a.avatar, s.points, s.matchesWon, s.matchesPlayed
      FROM stats s JOIN accounts a ON a.id = s.account_id
      WHERE s.roundsPlayed > 0
      ORDER BY s.points DESC, s.matchesWon DESC, a.username COLLATE NOCASE
      LIMIT ?
    `).all(LEADERBOARD_SIZE).map((row) => ({ ...row, avatar: JSON.parse(row.avatar) }));
  }

  // --- Anmeldung ---------------------------------------------------------

  createSession(accountId) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions (token_hash, account_id, expires) VALUES (?, ?, ?)')
      .run(hashToken(token), accountId, Date.now() + SESSION_LIFETIME_MS);
    return token;
  }

  checkRegistrationLimit(ip) {
    const now = Date.now();
    const recent = (this.registrations.get(ip) ?? []).filter((time) => now - time < 60 * 60_000);
    if (recent.length >= MAX_REGISTRATIONS_PER_HOUR) {
      throw new GameError('Zu viele neue Konten von dieser Adresse. Versuch es später noch mal.', 429);
    }
    recent.push(now);
    this.registrations.set(ip, recent);
  }

  async register(rawUsername, password, avatar, ip = 'unbekannt') {
    const username = validateUsername(rawUsername);
    validatePassword(password);
    if (avatar !== undefined && !isValidAvatar(avatar)) throw new GameError('Ungültiger Avatar.');
    if (this.findByUsername(username)) throw new GameError('Dieser Name ist schon vergeben.', 409);
    this.checkRegistrationLimit(ip);

    const salt = randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);
    const id = randomBytes(8).toString('hex');
    try {
      this.db.prepare(`
        INSERT INTO accounts (id, username, salt, password_hash, avatar, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, username, salt, passwordHash, JSON.stringify(avatar ?? randomAvatar()), Date.now());
    } catch (error) {
      // Zwei gleichzeitige Anmeldungen mit demselben Namen: Die Datenbank lässt nur eine zu.
      if (/UNIQUE/.test(error.message)) throw new GameError('Dieser Name ist schon vergeben.', 409);
      throw error;
    }
    this.db.prepare('INSERT INTO stats (account_id) VALUES (?)').run(id);
    const account = this.findById(id);
    return { token: this.createSession(id), account };
  }

  async login(rawUsername, password) {
    const username = String(rawUsername ?? '').trim();
    const failureKey = username.toLowerCase();
    const failure = this.loginFailures.get(failureKey);
    if (failure && failure.count >= MAX_LOGIN_FAILURES && failure.until > Date.now()) {
      throw new GameError('Zu viele Fehlversuche. Versuch es in 15 Minuten noch mal.', 429);
    }

    const account = this.findByUsername(username);
    // Auch ohne Konto rechnen, damit man an der Antwortzeit nicht erkennt, ob der Name existiert.
    const hash = await hashPassword(String(password ?? ''), account?.salt ?? 'kein-konto-vorhanden');
    const matches = account !== null
      && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.passwordHash, 'hex'));

    if (!matches) {
      const count = failure && failure.until > Date.now() ? failure.count + 1 : 1;
      this.loginFailures.set(failureKey, { count, until: Date.now() + LOGIN_LOCK_MS });
      throw new GameError('Name oder Passwort stimmt nicht.', 401);
    }
    this.loginFailures.delete(failureKey);
    return { token: this.createSession(account.id), account };
  }

  authenticate(token) {
    if (typeof token !== 'string' || !token) return null;
    const session = this.db.prepare('SELECT account_id, expires FROM sessions WHERE token_hash = ?')
      .get(hashToken(token));
    if (!session) return null;
    if (session.expires <= Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return null;
    }
    return this.findById(session.account_id);
  }

  logout(token) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(String(token ?? '')));
  }

  async changePassword(account, oldPassword, newPassword) {
    const hash = await hashPassword(String(oldPassword ?? ''), account.salt);
    if (!timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.passwordHash, 'hex'))) {
      throw new GameError('Das alte Passwort stimmt nicht.', 401);
    }
    await this.setPassword(account.id, newPassword);
  }

  // Auch für das Admin-Skript, falls jemand sein Passwort vergessen hat.
  async setPassword(accountId, newPassword) {
    validatePassword(newPassword);
    const salt = randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(newPassword, salt);
    this.db.prepare('UPDATE accounts SET salt = ?, password_hash = ? WHERE id = ?').run(salt, passwordHash, accountId);
    this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
  }

  // --- Profil und Stats ----------------------------------------------------

  setAvatar(account, avatar) {
    if (!isValidAvatar(avatar)) throw new GameError('Ungültiger Avatar.');
    this.db.prepare('UPDATE accounts SET avatar = ? WHERE id = ?').run(JSON.stringify(avatar), account.id);
    account.avatar = avatar;
  }

  recordRound(entries) {
    const update = this.db.prepare(`
      UPDATE stats SET
        roundsPlayed = roundsPlayed + 1,
        points = points + ?,
        imposterRounds = imposterRounds + ?,
        imposterWins = imposterWins + ?,
        votesCast = votesCast + ?,
        correctVotes = correctVotes + ?
      WHERE account_id = ?
    `);
    for (const entry of entries) {
      update.run(
        entry.points,
        entry.wasImposter ? 1 : 0,
        entry.imposterWon ? 1 : 0,
        entry.votesCast,
        entry.correctVotes,
        entry.id,
      );
    }
  }

  recordMatch(participantIds, winnerIds) {
    const update = this.db.prepare(`
      UPDATE stats SET matchesPlayed = matchesPlayed + 1, matchesWon = matchesWon + ? WHERE account_id = ?
    `);
    for (const id of participantIds) update.run(winnerIds.includes(id) ? 1 : 0, id);
  }
}

module.exports = { AccountStore, STAT_FIELDS };
