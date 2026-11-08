'use strict';

const { randomInt, randomBytes, createHash } = require('node:crypto');
const { GameError } = require('./errors');
const { isValidAvatar } = require('./public/avatar');
const WORDS = require('./words');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const MAX_ROOMS = 500;
const MAX_ROUNDS = 10;
const MAX_WORD_LENGTH = 24;
const POINTS_CORRECT_VOTE = 10;
const POINTS_IMPOSTER_WIN = 25;
const HOST_GRACE_MS = 20_000;
const LOBBY_GRACE_MS = 60_000;
const ROOM_IDLE_MS = 30 * 60_000;
const MAX_NAME_LENGTH = 16;
const MAX_GUESS_LENGTH = 40;
const TURN_MS = 30_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I und O (Verwechslungsgefahr)

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new GameError('Bitte gib einen Namen ein.');
  if (name.length > MAX_NAME_LENGTH) throw new GameError(`Der Name darf höchstens ${MAX_NAME_LENGTH} Zeichen haben.`);
  return name;
}

function normalizeWord(text) {
  return String(text).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

// Erkennt nur Schreibweisen und kleine Tippfehler. Ob etwas inhaltlich passt
// (h2o und Wasser), entscheiden die Spieler, die das Wort kennen.
function isSameWord(guess, word) {
  const a = normalizeWord(guess);
  const b = normalizeWord(word);
  if (!a) return false;
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const allowedTypos = shorter >= 10 ? 2 : shorter >= 5 ? 1 : 0;
  return editDistance(a, b) <= allowedTypos;
}

function requireValidAvatar(avatar) {
  if (!isValidAvatar(avatar)) throw new GameError('Ungültiger Avatar.');
  return avatar;
}

// Es gibt kein Login: Der Browser merkt sich eine geheime, zufällige Kennung. Mitspieler
// sehen nur ihren Hash, können sich also nicht als jemand anderes ausgeben.
function identify({ clientId, name, avatar }) {
  if (typeof clientId !== 'string' || clientId.length < 16 || clientId.length > 100) {
    throw new GameError('Ungültige Anfrage.');
  }
  return {
    id: createHash('sha256').update(clientId).digest('hex').slice(0, 16),
    username: cleanName(name),
    avatar: requireValidAvatar(avatar),
  };
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Mindestens ein Spieler muss das Wort kennen, sonst gibt es nichts zu erraten.
function maxImposters(playerCount) {
  return Math.max(1, playerCount - 1);
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
    this.phase = 'lobby'; // lobby | play | vote | reveal | final
    this.settings = { category: 'alle', imposters: 1, rounds: 3, impostersKnow: false };
    this.match = null;
    this.round = null;
    this.result = null;
    this.notice = null;
    this.roundCounter = 0;
    this.usedWords = new Set();
    this.lastActivity = Date.now();
  }

  // --- Spieler ---------------------------------------------------------

  requireFreeName(name, ownId) {
    const taken = [...this.players.values()].some(
      (p) => p.id !== ownId && !p.left && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) throw new GameError('Dieser Name ist in dem Raum schon vergeben.', 409);
  }

  addPlayer(account) {
    this.requireFreeName(account.username, account.id);
    const existing = this.players.get(account.id);
    if (existing) {
      // Wer die Verbindung verloren oder den Tab geschlossen hat, kommt auf seinen Platz zurück.
      existing.left = false;
      existing.name = account.username;
      existing.avatar = account.avatar;
      return existing;
    }
    const present = [...this.players.values()].filter((p) => !p.left);
    if (present.length >= MAX_PLAYERS) throw new GameError('Der Raum ist voll.', 409);

    const player = {
      id: account.id,
      token: randomBytes(18).toString('hex'),
      name: account.username,
      avatar: account.avatar,
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

  updateProfile(player, { name, avatar }) {
    this.requirePhase('lobby');
    const cleaned = cleanName(name);
    this.requireFreeName(cleaned, player.id);
    player.avatar = requireValidAvatar(avatar);
    player.name = cleaned;
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
    this.checkGuessComplete();
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
      this.stopTurnTimer();
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
    if (this.phase === 'reveal' || this.phase === 'final') return;

    round.votes.delete(player.id);
    for (const [voter, target] of round.votes) {
      if (target === player.id) round.votes.delete(voter);
    }
    round.sus.delete(player.id);
    for (const markers of round.sus.values()) markers.delete(player.id);
    round.guess?.verdicts.delete(player.id);

    const remaining = this.activeRoundPlayers();
    const imposterLeft = remaining.some((p) => round.imposters.has(p.id));
    if (remaining.length < MIN_PLAYERS || !imposterLeft) {
      this.backToLobby(
        remaining.length < MIN_PLAYERS
          ? 'Spiel abgebrochen: Es sind zu wenige Spieler übrig.'
          : 'Spiel abgebrochen: Der Imposter hat das Spiel verlassen.',
      );
      return;
    }
    if (this.phase === 'play' && round.order[round.position] === player.id) {
      this.moveToNextSpeaker();
    }
    this.checkVoteComplete();
    this.checkGuessComplete();
  }

  transferHost() {
    const next = [...this.players.values()].find((p) => p.conn && !p.left);
    if (next) this.hostId = next.id;
  }

  // Alle aus der Runde, die noch da sind, auch wenn sie rausgewählt wurden.
  roundMembers() {
    return this.round.order.map((id) => this.players.get(id)).filter((p) => p && !p.left);
  }

  // Wer noch mitspielt: nicht gegangen und nicht rausgewählt.
  activeRoundPlayers() {
    return this.roundMembers().filter((p) => !this.round.kicked.has(p.id));
  }

  // --- Spielablauf -----------------------------------------------------

  requireHost(player) {
    if (this.hostId !== player.id) throw new GameError('Das darf nur der Host.', 403);
  }

  requirePhase(...phases) {
    if (!phases.includes(this.phase)) throw new GameError('Das geht gerade nicht.', 409);
  }

  updateSettings(player, { category, imposters, rounds, impostersKnow }) {
    this.requireHost(player);
    this.requirePhase('lobby');
    if (category !== undefined) {
      if (category !== 'alle' && !Object.hasOwn(WORDS, category)) throw new GameError('Unbekannte Kategorie.');
      this.settings.category = category;
    }
    if (imposters !== undefined) {
      const count = Number(imposters);
      if (!Number.isInteger(count) || count < 1 || count > MAX_PLAYERS) {
        throw new GameError('Ungültige Anzahl Imposter.');
      }
      this.settings.imposters = count;
    }
    if (rounds !== undefined) {
      const count = Number(rounds);
      if (!Number.isInteger(count) || count < 1 || count > MAX_ROUNDS) {
        throw new GameError(`Ihr könnt 1 bis ${MAX_ROUNDS} Runden spielen.`);
      }
      this.settings.rounds = count;
    }
    if (impostersKnow !== undefined) this.settings.impostersKnow = impostersKnow === true;
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

  onlineParticipants() {
    this.purgeLeftPlayers();
    const participants = [...this.players.values()].filter((p) => p.conn);
    if (participants.length < MIN_PLAYERS) {
      throw new GameError(`Ihr braucht mindestens ${MIN_PLAYERS} Spieler, die online sind.`);
    }
    return participants;
  }

  startMatch(player) {
    this.requireHost(player);
    this.requirePhase('lobby', 'final');
    const participants = this.onlineParticipants();
    this.match = {
      total: this.settings.rounds,
      current: 0,
      scores: new Map(),
      participants: new Set(),
      winners: [],
    };
    this.beginRound(participants);
  }

  nextRound(player) {
    this.requireHost(player);
    this.requirePhase('reveal');
    if (this.match.current >= this.match.total) throw new GameError('Das war die letzte Runde.', 409);
    this.beginRound(this.onlineParticipants());
  }

  showFinal(player) {
    this.requireHost(player);
    this.requirePhase('reveal');
    if (this.match.current < this.match.total) throw new GameError('Es gibt noch weitere Runden.', 409);
    this.phase = 'final';
  }

  beginRound(participants) {
    const imposterCount = Math.min(this.settings.imposters, maxImposters(participants.length));
    const ids = participants.map((p) => p.id);

    this.match.current++;
    for (const id of ids) this.match.participants.add(id);
    this.round = {
      id: ++this.roundCounter,
      word: this.pickWord(),
      imposters: new Set(shuffle(ids).slice(0, imposterCount)),
      order: shuffle(ids), // Der Erste in dieser Liste fängt an.
      position: 0,
      lap: 1,
      turn: 0,
      words: [],
      votes: new Map(),
      sus: new Map(),
      guess: null,
      kicked: new Map(),       // Rausgewählte: id -> { shown: Rolle gezeigt? }
      kick: null,              // Ergebnis der letzten Abstimmung, solange es angezeigt wird
      lastTally: [],
      votesCast: new Map(),    // Punkte gibt es erst am Ende, sonst verrät die Rangliste Rollen.
      correctVotes: new Map(),
    };
    this.result = null;
    this.notice = null;
    this.phase = 'play';
    this.startTurnTimer();
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
      const id = round.order[round.position];
      if (!this.players.get(id)?.left && !round.kicked.has(id)) break;
    }
    this.startTurnTimer();
  }

  // Nach einer Abstimmung geht es mit einem neuen Durchgang von vorn weiter.
  continueRound(player) {
    this.requireHost(player);
    this.requirePhase('kicked');
    const round = this.round;
    round.kick = null;
    round.lap++;
    round.position = -1;
    this.phase = 'play';
    // moveToNextSpeaker zählt den Durchgang nur beim Überlauf, Position -1 startet am Anfang.
    this.moveToNextSpeaker();
  }

  chooseRoleReveal(player, show) {
    this.requirePhase('kicked');
    const { kick } = this.round;
    if (kick.playerId !== player.id) throw new GameError('Das entscheidet nur, wer rausgewählt wurde.', 403);
    if (kick.choice !== null) throw new GameError('Du hast dich schon entschieden.', 409);
    kick.choice = show === true ? 'shown' : 'hidden';
    this.round.kicked.get(player.id).shown = show === true;
  }

  startTurnTimer() {
    this.stopTurnTimer();
    this.turnEndsAt = Date.now() + TURN_MS;
    this.turnTimer = setTimeout(() => this.handleTurnTimeout(), TURN_MS);
    this.turnTimer.unref?.();
  }

  stopTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  // Wer die Zeit verstreichen lässt, wird übersprungen.
  handleTurnTimeout() {
    if (this.phase !== 'play') return;
    const round = this.round;
    round.words.push({ playerId: round.order[round.position], lap: round.lap, word: null, reason: 'timeout' });
    this.moveToNextSpeaker();
    this.broadcast();
  }

  submitWord(player, rawWord, turn) {
    this.requirePhase('play');
    const round = this.round;
    if (round.order[round.position] !== player.id) {
      throw new GameError('Du bist gerade nicht dran.', 403);
    }
    // Ein doppelt abgeschicktes Formular zählt nur einmal.
    if (turn !== round.turn) return;

    const word = String(rawWord ?? '').trim();
    if (!word) throw new GameError('Schreib dein Wort auf, bevor du weitergibst.');
    if (/\s/.test(word)) throw new GameError('Bitte nur ein einzelnes Wort.');
    if (word.length > MAX_WORD_LENGTH) throw new GameError('Das Wort ist zu lang.');

    round.words.push({ playerId: player.id, lap: round.lap, word });
    this.moveToNextSpeaker();
  }

  // Für Spieler, die nicht reagieren: Der Host kann sie überspringen.
  skipSpeaker(player, turn) {
    this.requireHost(player);
    this.requirePhase('play');
    const round = this.round;
    if (turn !== round.turn) return;
    round.words.push({ playerId: round.order[round.position], lap: round.lap, word: null, reason: 'skip' });
    this.moveToNextSpeaker();
  }

  startVote(player) {
    this.requireHost(player);
    this.requirePhase('play');
    this.stopTurnTimer();
    this.phase = 'vote';
    this.round.votes.clear();
  }

  // Jeder Mitspieler kann andere als verdächtig markieren, alle sehen die Markierungen.
  toggleSus(player, targetId) {
    this.requirePhase('play', 'vote');
    const active = this.activeRoundPlayers();
    if (!active.some((p) => p.id === player.id)) {
      throw new GameError('Du spielst in dieser Runde nicht mit.', 403);
    }
    if (targetId === player.id) throw new GameError('Du kannst dich nicht selbst markieren.');
    if (!active.some((p) => p.id === targetId)) throw new GameError('Ungültiger Spieler.');
    const markers = this.round.sus.get(targetId) ?? new Set();
    if (markers.has(player.id)) markers.delete(player.id);
    else markers.add(player.id);
    this.round.sus.set(targetId, markers);
  }

  guessJudges() {
    return this.activeRoundPlayers().filter((p) => !this.round.imposters.has(p.id));
  }

  // Der Imposter hat einen Versuch. Danach ist die Runde so oder so vorbei.
  submitGuess(player, rawGuess) {
    this.requirePhase('play', 'vote');
    const round = this.round;
    if (!round.imposters.has(player.id)) throw new GameError('Nur Imposter können das Wort raten.', 403);
    if (round.kicked.has(player.id)) throw new GameError('Du wurdest rausgewählt und kannst nicht mehr raten.', 403);
    const text = String(rawGuess ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new GameError('Schreib deinen Tipp auf.');
    if (text.length > MAX_GUESS_LENGTH) throw new GameError('Der Tipp ist zu lang.');

    this.stopTurnTimer();
    round.votes.clear();
    round.guess = { playerId: player.id, text, verdicts: new Map() };
    if (isSameWord(text, round.word)) {
      this.finishGuess(true, false);
      return;
    }
    this.phase = 'guess';
    this.checkGuessComplete();
  }

  judgeGuess(player, accepted) {
    this.requirePhase('guess');
    if (!this.guessJudges().some((p) => p.id === player.id)) {
      throw new GameError('Das entscheiden die Spieler, die das Wort kennen.', 403);
    }
    this.round.guess.verdicts.set(player.id, Boolean(accepted));
    this.checkGuessComplete();
  }

  checkGuessComplete() {
    if (this.phase !== 'guess') return;
    const judges = this.guessJudges().filter((p) => p.conn);
    if (judges.every((p) => this.round.guess.verdicts.has(p.id))) this.resolveGuess();
  }

  // Bei Gleichstand zählt der Tipp. Ohne eine einzige Zustimmung ist er falsch.
  resolveGuess() {
    const verdicts = [...this.round.guess.verdicts.values()];
    const yes = verdicts.filter(Boolean).length;
    this.finishGuess(yes > 0 && yes >= verdicts.length - yes, true);
  }

  finishGuess(correct, judged) {
    const { guess } = this.round;
    const summary = { playerId: guess.playerId, text: guess.text, correct, judged };
    this.finishRound(correct ? null : guess.playerId, !correct, summary);
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

  voteCounts() {
    const counts = new Map();
    for (const target of this.round.votes.values()) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  }

  finishVote() {
    const counts = this.voteCounts();
    const highest = Math.max(0, ...counts.values());
    const leaders = [...counts].filter(([, count]) => count === highest).map(([id]) => id);
    // Bei Gleichstand fliegt niemand raus.
    const accusedId = leaders.length === 1 ? leaders[0] : null;
    const round = this.round;

    round.lastTally = round.order
      .map((id) => ({
        id,
        count: counts.get(id) ?? 0,
        voters: [...round.votes].filter(([, target]) => target === id).map(([voter]) => voter),
      }))
      .sort((a, b) => b.count - a.count);
    for (const [voter, target] of round.votes) {
      round.votesCast.set(voter, (round.votesCast.get(voter) ?? 0) + 1);
      if (round.imposters.has(target)) round.correctVotes.set(voter, (round.correctVotes.get(voter) ?? 0) + 1);
    }
    round.votes.clear();

    if (accusedId !== null) {
      round.kicked.set(accusedId, { shown: false });
      const active = this.activeRoundPlayers();
      const impostersLeft = active.filter((p) => round.imposters.has(p.id)).length;
      if (impostersLeft === 0) {
        this.finishRound(accusedId, true, null);
        return;
      }
      if (impostersLeft >= active.length - impostersLeft) {
        this.finishRound(accusedId, false, null);
        return;
      }
    }
    round.kick = { playerId: accusedId, tally: round.lastTally, choice: null };
    this.phase = 'kicked';
  }

  finishRound(accusedId, caught, guess) {
    const round = this.round;
    this.stopTurnTimer();

    const entries = this.roundMembers().map((player) => {
      const wasImposter = round.imposters.has(player.id);
      const correctVotes = round.correctVotes.get(player.id) ?? 0;
      const imposterWon = wasImposter && !caught;
      const points = correctVotes * POINTS_CORRECT_VOTE + (imposterWon ? POINTS_IMPOSTER_WIN : 0);
      return {
        id: player.id,
        wasImposter,
        imposterWon,
        votesCast: round.votesCast.get(player.id) ?? 0,
        correctVotes,
        points,
      };
    });
    for (const entry of entries) {
      this.match.scores.set(entry.id, (this.match.scores.get(entry.id) ?? 0) + entry.points);
    }

    this.result = {
      accusedId,
      caught,
      guess,
      gains: entries,
      tally: round.lastTally,
    };
    round.kick = null;
    this.phase = 'reveal';
    if (this.match.current >= this.match.total) this.finishMatch();
  }

  finishMatch() {
    const { match } = this;
    const contenders = [...match.participants].filter((id) => {
      const player = this.players.get(id);
      return player && !player.left;
    });
    const top = Math.max(0, ...contenders.map((id) => match.scores.get(id) ?? 0));
    match.winners = top > 0 ? contenders.filter((id) => (match.scores.get(id) ?? 0) === top) : [];
  }

  backToLobby(notice = null) {
    this.stopTurnTimer();
    this.phase = 'lobby';
    this.match = null;
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
      case 'profile': this.updateProfile(player, payload); break;
      case 'start': this.startMatch(player); break;
      case 'nextRound': this.nextRound(player); break;
      case 'showFinal': this.showFinal(player); break;
      case 'word': this.submitWord(player, payload.word, payload.turn); break;
      case 'skip': this.skipSpeaker(player, payload.turn); break;
      case 'startVote': this.startVote(player); break;
      case 'vote': this.castVote(player, payload.target); break;
      case 'revealRole': this.chooseRoleReveal(player, payload.show); break;
      case 'continueRound': this.continueRound(player); break;
      case 'sus': this.toggleSus(player, payload.target); break;
      case 'guess': this.submitGuess(player, payload.guess); break;
      case 'judgeGuess': this.judgeGuess(player, payload.accepted); break;
      case 'finishGuess':
        this.requireHost(player);
        this.requirePhase('guess');
        this.resolveGuess();
        break;
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

  matchView() {
    const { match } = this;
    if (!match) return null;
    const leaderboard = [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        online: Boolean(p.conn),
        left: p.left,
        points: match.scores.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'de'));
    return { current: match.current, total: match.total, leaderboard, winners: match.winners };
  }

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
        avatar: p.avatar,
        online: Boolean(p.conn),
        left: p.left,
      })),
      settings: this.settings,
      categories: Object.entries(WORDS).map(([id, entry]) => ({ id, label: entry.label })),
      maxImposters: maxImposters(online),
      maxRounds: MAX_ROUNDS,
      maxWordLength: MAX_WORD_LENGTH,
      minPlayers: MIN_PLAYERS,
      onlineCount: online,
      notice: this.notice,
      match: this.matchView(),
      round: null,
    };

    if (!this.round || this.phase === 'final') return view;

    const round = this.round;
    const inRound = round.order.includes(player.id);
    view.round = {
      id: round.id,
      order: round.order,
      inRound,
      words: round.words,
      sus: [...round.sus].map(([id, markers]) => ({ id, by: [...markers] })).filter((entry) => entry.by.length > 0),
      card: !inRound ? null
        : round.imposters.has(player.id) ? { type: 'imposter' }
        : { type: 'word', word: round.word },
      imposterCount: round.imposters.size,
      youKicked: round.kicked.has(player.id),
      // Die Rolle sieht man nur, wenn sie gezeigt wurde oder die Runde vorbei ist.
      kicked: [...round.kicked].map(([id, state]) => ({
        id,
        role: state.shown || this.phase === 'reveal' ? (round.imposters.has(id) ? 'imposter' : 'word') : null,
      })),
    };
    if (this.settings.impostersKnow && round.imposters.has(player.id)) {
      view.round.partners = [...round.imposters].filter((id) => id !== player.id);
    }
    if (this.phase === 'kicked') view.round.kick = round.kick;

    if (this.phase === 'play') {
      view.round.currentId = round.order[round.position];
      view.round.lap = round.lap;
      view.round.turn = round.turn;
      view.round.isFirstTurn = round.turn === 0;
      view.round.turnEndsIn = Math.max(0, this.turnEndsAt - Date.now());
      view.round.turnLength = TURN_MS;
    }
    if (this.phase === 'guess') {
      const judges = this.guessJudges();
      view.round.guess = {
        playerId: round.guess.playerId,
        text: round.guess.text,
        judges: judges.map((p) => p.id),
        doneCount: judges.filter((p) => round.guess.verdicts.has(p.id)).length,
        yours: round.guess.verdicts.get(player.id) ?? null,
      };
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

function createRoom(account) {
  if (rooms.size >= MAX_ROOMS) {
    throw new GameError('Gerade sind zu viele Räume offen. Versuch es gleich noch mal.', 503);
  }
  const room = new Room(generateCode());
  rooms.set(room.code, room);
  return { room, player: room.addPlayer(account) };
}

function getRoom(code) {
  const room = rooms.get(String(code ?? '').trim().toUpperCase());
  if (!room) throw new GameError('Diesen Raum gibt es nicht. Stimmt der Code?', 404);
  return room;
}

function sweepRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    const anyoneOnline = [...room.players.values()].some((p) => p.conn);
    if (!anyoneOnline && now - room.lastActivity > ROOM_IDLE_MS) {
      room.stopTurnTimer();
      rooms.delete(code);
    }
  }
}

module.exports = {
  GameError,
  isSameWord,
  TURN_MS,
  identify,
  createRoom,
  getRoom,
  sweepRooms,
  maxImposters,
  rooms,
  POINTS_CORRECT_VOTE,
  POINTS_IMPOSTER_WIN,
};
