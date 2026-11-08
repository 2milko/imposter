'use strict';

const { randomInt, randomBytes } = require('node:crypto');
const WORDS = require('./words');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const MAX_ROOMS = 500;
const MAX_NAME_LENGTH = 20;
const HOST_GRACE_MS = 20_000;
const LOBBY_GRACE_MS = 60_000;
const ROOM_IDLE_MS = 30 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I und O (Verwechslungsgefahr)

class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function maxImposters(playerCount) {
  return Math.max(1, Math.floor((playerCount - 1) / 2));
}

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new GameError('Bitte gib einen Namen ein.');
  return name;
}

const rooms = new Map();

function generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new GameError('Gerade ist kein Raum frei. Versuch es gleich noch mal.', 503);
}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.settings = { category: 'alle', imposters: 1 };
    this.round = null;
    this.result = null;
    this.notice = null;
    this.roundCounter = 0;
    this.usedWords = new Set();
    this.lastActivity = Date.now();
  }

  // --- Spieler ---------------------------------------------------------

  addPlayer(rawName) {
    const name = cleanName(rawName);
    const sameName = [...this.players.values()].find(
      (p) => !p.left && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (sameName) {
      if (sameName.conn) throw new GameError('Dieser Name ist in dem Raum schon vergeben.', 409);
      // Wer die Verbindung verloren oder den Tab geschlossen hat, kommt mit
      // demselben Namen wieder auf seinen Platz.
      return sameName;
    }
    const present = [...this.players.values()].filter((p) => !p.left);
    if (present.length >= MAX_PLAYERS) throw new GameError('Der Raum ist voll.', 409);

    const player = {
      id: randomBytes(6).toString('hex'),
      token: randomBytes(18).toString('hex'),
      name,
      conn: null,
      left: false,
      offlineTimer: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.touch();
    this.broadcast();
    return player;
  }

  findByToken(token) {
    return [...this.players.values()].find((p) => p.token === token && !p.left) ?? null;
  }

  attach(player, conn) {
    const previous = player.conn;
    player.conn = conn;
    clearTimeout(player.offlineTimer);
    if (previous) previous.replaced();
    this.touch();
    this.broadcast();
  }

  detach(player, conn) {
    if (player.conn !== conn) return; // Bereits durch eine neuere Verbindung ersetzt.
    player.conn = null;
    this.touch();
    clearTimeout(player.offlineTimer);
    const grace = this.phase === 'lobby' ? LOBBY_GRACE_MS : HOST_GRACE_MS;
    player.offlineTimer = setTimeout(() => this.handleOffline(player), grace);
    player.offlineTimer.unref?.();
    this.checkVoteComplete();
    this.broadcast();
  }

  handleOffline(player) {
    if (player.conn || player.left) return;
    if (this.phase === 'lobby') {
      this.players.delete(player.id);
    }
    if (this.hostId === player.id) this.transferHost();
    this.broadcast();
  }

  leave(player) {
    clearTimeout(player.offlineTimer);
    const inRound = this.round?.order.includes(player.id);
    player.conn = null;

    if (this.phase === 'lobby' || !inRound) {
      this.players.delete(player.id);
    } else {
      player.left = true;
    }
    if (this.hostId === player.id) this.transferHost();
    if (![...this.players.values()].some((p) => !p.left)) {
      rooms.delete(this.code);
      return;
    }

    if (inRound && this.phase !== 'lobby') {
      this.handlePlayerLeftRound(player);
    }
    this.touch();
    this.broadcast();
  }

  handlePlayerLeftRound(player) {
    const round = this.round;
    if (this.phase === 'reveal') return;

    round.votes.delete(player.id);
    for (const [voter, target] of round.votes) {
      if (target === player.id) round.votes.delete(voter);
    }

    const remaining = this.activeRoundPlayers();
    const imposterLeft = remaining.some((p) => round.imposters.has(p.id));
    if (remaining.length < MIN_PLAYERS || !imposterLeft) {
      this.backToLobby(
        remaining.length < MIN_PLAYERS
          ? 'Runde abgebrochen: Es sind zu wenige Spieler übrig.'
          : 'Runde abgebrochen: Der Imposter hat das Spiel verlassen.',
      );
      return;
    }
    if (this.phase === 'play' && round.order[round.position] === player.id) {
      this.moveToNextSpeaker();
    }
    this.checkVoteComplete();
  }

  transferHost() {
    const next = [...this.players.values()].find((p) => p.conn && !p.left);
    if (next) this.hostId = next.id;
  }

  activeRoundPlayers() {
    return this.round.order.map((id) => this.players.get(id)).filter((p) => p && !p.left);
  }

  // --- Spielablauf -----------------------------------------------------

  requireHost(player) {
    if (this.hostId !== player.id) throw new GameError('Das darf nur der Host.', 403);
  }

  requirePhase(...phases) {
    if (!phases.includes(this.phase)) throw new GameError('Das geht gerade nicht.', 409);
  }

  updateSettings(player, { category, imposters }) {
    this.requireHost(player);
    this.requirePhase('lobby');
    if (category !== undefined) {
      if (category !== 'alle' && !WORDS[category]) throw new GameError('Unbekannte Kategorie.');
      this.settings.category = category;
    }
    if (imposters !== undefined) {
      const count = Number(imposters);
      if (!Number.isInteger(count) || count < 1 || count > MAX_PLAYERS) {
        throw new GameError('Ungültige Anzahl Imposter.');
      }
      this.settings.imposters = count;
    }
  }

  pickWord() {
    const { category } = this.settings;
    const entries = category === 'alle' ? Object.values(WORDS) : [WORDS[category]];
    const pool = entries.flatMap((entry) => entry.words);
    let available = pool.filter((word) => !this.usedWords.has(word));
    if (available.length === 0) {
      for (const word of pool) this.usedWords.delete(word);
      available = pool;
    }
    const word = available[randomInt(available.length)];
    this.usedWords.add(word);
    return word;
  }

  purgeLeftPlayers() {
    for (const [id, player] of this.players) {
      if (player.left) this.players.delete(id);
    }
  }

  startRound(player) {
    this.requireHost(player);
    this.requirePhase('lobby', 'reveal');
    this.purgeLeftPlayers();

    const participants = [...this.players.values()].filter((p) => p.conn);
    if (participants.length < MIN_PLAYERS) {
      throw new GameError(`Ihr braucht mindestens ${MIN_PLAYERS} Spieler, die online sind.`);
    }
    const imposterCount = Math.min(this.settings.imposters, maxImposters(participants.length));
    const ids = participants.map((p) => p.id);

    this.round = {
      id: ++this.roundCounter,
      word: this.pickWord(),
      imposters: new Set(shuffle(ids).slice(0, imposterCount)),
      order: shuffle(ids), // Der Erste in dieser Liste fängt an.
      position: 0,
      lap: 1,
      turn: 0,
      votes: new Map(),
    };
    this.result = null;
    this.notice = null;
    this.phase = 'play';
  }

  moveToNextSpeaker() {
    const round = this.round;
    round.turn++;
    for (let step = 0; step < round.order.length; step++) {
      round.position++;
      if (round.position >= round.order.length) {
        round.position = 0;
        round.lap++;
      }
      if (!this.players.get(round.order[round.position])?.left) return;
    }
  }

  nextSpeaker(player, turn) {
    this.requirePhase('play');
    const round = this.round;
    const isCurrent = round.order[round.position] === player.id;
    if (!isCurrent && this.hostId !== player.id) {
      throw new GameError('Du bist gerade nicht dran.', 403);
    }
    // Falls Host und Sprecher gleichzeitig klicken, zählt nur der erste Klick.
    if (turn !== round.turn) return;
    this.moveToNextSpeaker();
  }

  startVote(player) {
    this.requireHost(player);
    this.requirePhase('play');
    this.phase = 'vote';
    this.round.votes.clear();
  }

  castVote(player, targetId) {
    this.requirePhase('vote');
    const active = this.activeRoundPlayers();
    if (!active.some((p) => p.id === player.id)) {
      throw new GameError('Du spielst in dieser Runde nicht mit.', 403);
    }
    if (targetId === player.id) throw new GameError('Du kannst nicht für dich selbst stimmen.');
    if (!active.some((p) => p.id === targetId)) throw new GameError('Ungültige Stimme.');
    this.round.votes.set(player.id, targetId);
    this.checkVoteComplete();
  }

  checkVoteComplete() {
    if (this.phase !== 'vote') return;
    const voters = this.activeRoundPlayers().filter((p) => p.conn);
    if (voters.length > 0 && voters.every((p) => this.round.votes.has(p.id))) {
      this.finishVote();
    }
  }

  finishVote() {
    const round = this.round;
    const counts = new Map();
    for (const target of round.votes.values()) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    const highest = Math.max(0, ...counts.values());
    const leaders = [...counts].filter(([, count]) => count === highest).map(([id]) => id);
    // Bei Gleichstand wird niemand rausgewählt: Das zählt als Sieg für den Imposter.
    const accusedId = leaders.length === 1 ? leaders[0] : null;

    this.result = {
      accusedId,
      caught: accusedId !== null && round.imposters.has(accusedId),
      tally: round.order
        .map((id) => ({
          id,
          count: counts.get(id) ?? 0,
          voters: [...round.votes].filter(([, target]) => target === id).map(([voter]) => voter),
        }))
        .sort((a, b) => b.count - a.count),
    };
    this.phase = 'reveal';
  }

  backToLobby(notice = null) {
    this.phase = 'lobby';
    this.round = null;
    this.result = null;
    this.notice = notice;
    this.purgeLeftPlayers();
    for (const player of [...this.players.values()]) {
      if (!player.conn) this.players.delete(player.id);
    }
    if (!this.players.get(this.hostId)) this.transferHost();
  }

  // --- Aktionen ---------------------------------------------------------

  handleAction(player, { type, ...payload }) {
    switch (type) {
      case 'settings': this.updateSettings(player, payload); break;
      case 'start': this.startRound(player); break;
      case 'next': this.nextSpeaker(player, payload.turn); break;
      case 'startVote': this.startVote(player); break;
      case 'vote': this.castVote(player, payload.target); break;
      case 'finishVote':
        this.requireHost(player);
        this.requirePhase('vote');
        this.finishVote();
        break;
      case 'lobby':
        this.requireHost(player);
        this.backToLobby();
        break;
      case 'leave': this.leave(player); return;
      default: throw new GameError('Unbekannte Aktion.');
    }
    this.touch();
    this.broadcast();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  // --- Sicht pro Spieler -------------------------------------------------

  // Jeder Spieler bekommt nur, was er wissen darf: Vor der Auflösung erfährt
  // der Imposter das Wort nicht, und niemand erfährt, wer Imposter ist.
  viewFor(player) {
    const present = [...this.players.values()].filter((p) => !p.left);
    const online = present.filter((p) => p.conn).length;
    const view = {
      code: this.code,
      phase: this.phase,
      you: { id: player.id, isHost: this.hostId === player.id },
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        online: Boolean(p.conn),
        left: p.left,
      })),
      settings: this.settings,
      categories: Object.entries(WORDS).map(([id, entry]) => ({ id, label: entry.label })),
      maxImposters: maxImposters(online),
      minPlayers: MIN_PLAYERS,
      onlineCount: online,
      notice: this.notice,
      round: null,
    };

    if (!this.round) return view;

    const round = this.round;
    const inRound = round.order.includes(player.id);
    view.round = {
      id: round.id,
      order: round.order,
      inRound,
      card: !inRound ? null
        : round.imposters.has(player.id) ? { type: 'imposter' }
        : { type: 'word', word: round.word },
      imposterCount: round.imposters.size,
    };

    if (this.phase === 'play') {
      view.round.currentId = round.order[round.position];
      view.round.lap = round.lap;
      view.round.turn = round.turn;
      view.round.isFirstTurn = round.turn === 0;
    }
    if (this.phase === 'vote') {
      const active = this.activeRoundPlayers();
      view.round.vote = {
        candidates: active.map((p) => p.id),
        votedIds: active.filter((p) => round.votes.has(p.id)).map((p) => p.id),
        yours: round.votes.get(player.id) ?? null,
      };
    }
    if (this.phase === 'reveal') {
      view.round.reveal = {
        word: round.word,
        imposterIds: [...round.imposters],
        ...this.result,
      };
    }
    return view;
  }

  broadcast() {
    for (const player of this.players.values()) {
      if (player.conn && !player.left) player.conn.send(this.viewFor(player));
    }
  }
}

function createRoom(name) {
  if (rooms.size >= MAX_ROOMS) {
    throw new GameError('Gerade sind zu viele Räume offen. Versuch es gleich noch mal.', 503);
  }
  cleanName(name);
  const room = new Room(generateCode());
  rooms.set(room.code, room);
  return { room, player: room.addPlayer(name) };
}

function getRoom(code) {
  const room = rooms.get(String(code ?? '').trim().toUpperCase());
  if (!room) throw new GameError('Diesen Raum gibt es nicht. Stimmt der Code?', 404);
  return room;
}

function sweepRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    const anyoneOnline = [...room.players.values()].some((p) => p.conn);
    if (!anyoneOnline && now - room.lastActivity > ROOM_IDLE_MS) rooms.delete(code);
  }
}

module.exports = { GameError, createRoom, getRoom, sweepRooms, maxImposters, rooms };
