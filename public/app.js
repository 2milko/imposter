'use strict';

const { PARTS, avatarMarkup, swatchColor, isValidAvatar, randomAvatar } = window.ImposterAvatar;
const Sound = window.ImposterSound;
const Speech = window.ImposterSpeech;

const appEl = document.getElementById('app');
const bannerEl = document.getElementById('banner');
const toastEl = document.getElementById('toast');
const soundToggleEl = document.getElementById('sound-toggle');
const speechToggleEl = document.getElementById('speech-toggle');
const RECONNECT_DELAY_MS = 2000;
const SESSION_KEY = 'imposter-session';
const SLOT_KEY = 'imposter-slot';

// Mit ?spieler=2 in der Adresse meldet sich ein Tab mit einem eigenen Konto an. So lässt sich
// eine Runde mit mehreren Spielern in einem einzigen Browser üben.
const slot = new URLSearchParams(location.search).get('spieler') ?? storageGet(sessionStorage, SLOT_KEY);
if (slot) storageSet(sessionStorage, SLOT_KEY, slot);
const TOKEN_KEY = slot ? `imposter-token-${slot}` : 'imposter-token';
const OLD_PROFILE_KEY = slot ? `imposter-profile-${slot}` : 'imposter-profile';

let accountToken = storageGet(localStorage, TOKEN_KEY);
let account = null;            // Eigenes Konto mit Stats
let authMode = storageGet(localStorage, OLD_PROFILE_KEY) ? 'register' : 'login';
let leaderboard = null;        // Bestenliste aller Konten, wird beim Öffnen der Startseite geladen
let session = loadSession();   // Raumsitzung: { code, token }
let view = null;               // Letzter Spielstand vom Server
let source = null;             // EventSource
let profileOpen = false;       // Profil liegt über Startseite oder Lobby
let profileDraft = null;       // Avatar, der gerade bearbeitet wird
let cardRevealedFor = null;    // ID der Runde, deren Karte aufgedeckt ist
let wordDraft = '';            // Halb getipptes Wort übersteht neue Spielstände
let guessOpen = false;         // Formular zum Raten des Wortes ist offen
let guessDraft = '';
let turnDeadline = 0;          // Ende des aktuellen Zuges in der Zeit dieses Browsers
let lastTickSecond = null;
let lastScreen = null;
let landingMessage = null;
let toastTimer = null;

// --- Speicher ---------------------------------------------------------------

function storageGet(store, key) {
  try { return store.getItem(key); } catch { return null; }
}
function storageSet(store, key, value) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch { /* Ohne Speicher läuft das Spiel trotzdem. */ }
}
function loadSession() {
  try { return JSON.parse(storageGet(sessionStorage, SESSION_KEY)); } catch { return null; }
}
function saveSession(value) {
  session = value;
  storageSet(sessionStorage, SESSION_KEY, value ? JSON.stringify(value) : null);
}
function saveAccountToken(value) {
  accountToken = value;
  storageSet(localStorage, TOKEN_KEY, value);
}

// Profil aus der Zeit ohne Konten: Name und Avatar werden bei der Registrierung vorgeschlagen.
function oldProfile() {
  try {
    const stored = JSON.parse(storageGet(localStorage, OLD_PROFILE_KEY));
    return {
      name: typeof stored?.name === 'string' ? stored.name : '',
      avatar: isValidAvatar(stored?.avatar) ? stored.avatar : null,
    };
  } catch {
    return { name: '', avatar: null };
  }
}

// --- DOM-Helfer -------------------------------------------------------------

// Baut Elemente immer über textContent auf, damit Spielernamen und Wörter kein HTML einschleusen können.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'key') el.dataset.key = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else if (key === 'disabled' || key === 'selected' || key === 'required' || key === 'checked') el[key] = Boolean(value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

function avatarNode(avatar, size = 'sm') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', `avatar avatar-${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = avatarMarkup(avatar); // Nur feste Formen, keine Eingaben von Spielern.
  return svg;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

function fail(message) {
  Sound.play('error');
  toast(message);
}

function setBanner(message) {
  bannerEl.textContent = message ?? '';
  bannerEl.hidden = !message;
}

// --- Server -----------------------------------------------------------------

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accountToken) headers.Authorization = `Bearer ${accountToken}`;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Keine Verbindung zum Server.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || 'Da ist etwas schiefgelaufen.'), { status: response.status });
  }
  return data;
}

const post = (path, body = {}) => request('POST', path, body);

async function act(type, payload = {}) {
  try {
    await post('/api/action', { code: session.code, token: session.token, type, ...payload });
    return true;
  } catch (error) {
    fail(error.message);
    return false;
  }
}

function connect() {
  closeSource();
  const params = new URLSearchParams({ code: session.code, token: session.token });
  source = new EventSource(`/api/events?${params}`);

  source.addEventListener('state', (event) => {
    setBanner(null);
    const previous = view;
    view = JSON.parse(event.data);
    syncRoundState(previous, view);
    playTransitionSounds(previous, view);
    speakNewWords(previous, view);
    render();
  });

  source.addEventListener('replaced', () => {
    closeSource();
    view = null;
    renderReplaced();
  });

  source.onerror = () => {
    setBanner('Verbindung verloren. Wird wiederhergestellt …');
    if (source.readyState === EventSource.CLOSED) recoverConnection();
  };
}

// Eine geschlossene Verbindung beweist nicht, dass der Raum weg ist: Das passiert auch
// beim Neuladen der Seite oder wenn der Server kurz nicht antwortet. Darum wird die
// Sitzung nur verworfen, wenn der Server selbst sagt, dass er sie nicht mehr kennt.
async function recoverConnection() {
  closeSource();
  if (!session) return;
  try {
    await post('/api/check', { code: session.code, token: session.token });
    connect();
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      resetToHome('Dieser Raum existiert nicht mehr. Erstellt einfach einen neuen.');
    } else {
      setTimeout(recoverConnection, RECONNECT_DELAY_MS);
    }
  }
}

function closeSource() {
  if (source) source.close();
  source = null;
}

function resetToHome(message = null) {
  closeSource();
  saveSession(null);
  view = null;
  profileOpen = false;
  landingMessage = message;
  setBanner(null);
  document.title = 'Imposter';
  history.replaceState(null, '', '/');
  renderHome();
  // Nach einem Spiel haben sich Stats und Bestenliste geändert.
  if (account) {
    refreshAccount().then(() => { if (!view && !profileOpen && account) renderHome(); });
    loadLeaderboard();
  }
}

async function leaveRoom() {
  await post('/api/action', { code: session.code, token: session.token, type: 'leave' }).catch(() => {});
  Sound.play('leave');
  resetToHome();
}

// --- Abgleich mit dem Server -----------------------------------------------------

function syncRoundState(previous, next) {
  if (previous?.round?.id !== next.round?.id) {
    guessOpen = false;
    guessDraft = '';
  }
  const wasYourTurn = previous?.round?.currentId === next.you.id;
  if (wasYourTurn && next.round?.currentId !== next.you.id) wordDraft = '';
  // Der Server schickt die Restzeit statt einer Uhrzeit, weil Uhren abweichen können.
  if (next.phase === 'play' && next.round.turnEndsIn !== null) turnDeadline = Date.now() + next.round.turnEndsIn;
}

function speakNewWords(previous, next) {
  if (!previous?.round || previous.round.id !== next.round?.id) return;
  for (const entry of next.round.words.slice(previous.round.words.length)) {
    if (entry.word) Speech.speak(entry.word);
  }
  if (next.phase === 'guess' && previous.phase !== 'guess') Speech.speak(next.round.guess.text);
  if (next.phase === 'reveal' && previous.phase !== 'guess' && next.round.reveal.guess) {
    Speech.speak(next.round.reveal.guess.text);
  }
}

function updateTurnTimer() {
  const timer = appEl.querySelector('.turn-timer');
  if (!timer || view?.phase !== 'play' || !view.round.turnLength) return;
  const remaining = Math.max(0, turnDeadline - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  timer.querySelector('.turn-seconds').textContent = String(seconds);
  timer.querySelector('.turn-bar-fill').style.width = `${(remaining / view.round.turnLength) * 100}%`;
  timer.classList.toggle('is-low', seconds <= 10);
  if (view.round.currentId === view.you.id && seconds > 0 && seconds <= 5 && seconds !== lastTickSecond) {
    Sound.play('tick');
  }
  lastTickSecond = seconds;
}

setInterval(updateTurnTimer, 200);

// --- Sounds zu Spielereignissen ----------------------------------------------

function playTransitionSounds(previous, next) {
  if (!previous) return;
  const countPresent = (v) => v.players.filter((p) => !p.left).length;

  if (next.phase === 'lobby' && previous.phase === 'lobby') {
    if (countPresent(next) > countPresent(previous)) Sound.play('join');
    else if (countPresent(next) < countPresent(previous)) Sound.play('leave');
  }

  const prevRound = previous.round;
  const nextRound = next.round;
  if (next.phase === 'play' && prevRound?.id !== nextRound?.id) {
    Sound.play('roundStart');
    if (nextRound.currentId === next.you.id) Sound.play('yourTurn', 0.9);
    return;
  }
  if (next.phase === 'play' && prevRound?.currentId !== nextRound.currentId) {
    Sound.play('word');
    if (nextRound.currentId === next.you.id) Sound.play('yourTurn', 0.2);
  }
  if (next.phase === 'vote' && previous.phase === 'play') Sound.play('voteStart');
  if (next.phase === 'vote' && previous.phase === 'vote') {
    if (nextRound.vote.votedIds.length > prevRound.vote.votedIds.length) Sound.play('tick');
  }
  if (next.phase === 'guess' && previous.phase !== 'guess') Sound.play('imposterSting');
  if (next.phase === 'kicked' && previous.phase === 'vote') {
    Sound.play(nextRound.kick.playerId ? 'imposterSting' : 'leave');
  }
  if (next.phase === 'kicked' && previous.phase === 'kicked' && nextRound.kick.choice !== prevRound.kick.choice) {
    Sound.play(nextRound.kick.choice === 'shown' ? 'flip' : 'leave');
  }
  if (next.phase === 'reveal' && previous.phase !== 'reveal') {
    const { reveal } = nextRound;
    Sound.play(reveal.caught ? 'groupWin' : 'imposterWin');
    const yourGain = reveal.gains.find((g) => g.id === next.you.id)?.points ?? 0;
    if (yourGain > 0) Sound.play('points', 1.5);
  }
  if (next.phase === 'final' && previous.phase === 'reveal') Sound.play('finale');
}

// --- Rendering --------------------------------------------------------------

// Bei jedem Update wird neu gezeichnet. Fokus und Einblend-Animation bleiben
// dabei erhalten, damit die Seite nicht bei jedem Klick eines Mitspielers springt.
function mount(screenKey, node, { game = false } = {}) {
  const focusedKey = document.activeElement?.dataset?.key;
  const isNewScreen = screenKey !== lastScreen;
  lastScreen = screenKey;
  if (isNewScreen) {
    node.classList.add('enter');
    window.scrollTo(0, 0);
  }
  appEl.className = game ? 'is-game' : '';
  appEl.replaceChildren(node);
  if (!focusedKey) return;
  const target = appEl.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
  if (!target) return;
  target.focus();
  // Nur Textfelder haben einen Cursor, bei Häkchen wirft setSelectionRange einen Fehler.
  if (target.tagName === 'INPUT' && ['text', 'search', 'password', ''].includes(target.getAttribute('type') ?? '')) {
    target.setSelectionRange(target.value.length, target.value.length);
  }
}

function playerOf(id) {
  return view.players.find((p) => p.id === id);
}
function nameOf(id) {
  return playerOf(id)?.name ?? 'Unbekannt';
}

function render() {
  if (profileOpen) {
    // Das Profil bleibt offen, solange ihr in der Lobby seid. Beim Spielstart geht es zu.
    if (view.phase === 'lobby') return;
    profileOpen = false;
  }
  switch (view.phase) {
    case 'lobby': renderLobby(); break;
    case 'play': renderPlay(); break;
    case 'vote': renderVote(); break;
    case 'guess': renderGuess(); break;
    case 'kicked': renderKicked(); break;
    case 'reveal': renderReveal(); break;
    case 'final': renderFinal(); break;
  }
}

function brand() {
  return h('div', { class: 'topbar-brand' }, 'Impos', h('span', {}, 'ter'));
}

function topbar(meta) {
  return h('header', { class: 'topbar' }, brand(), h('div', { class: 'topbar-meta' }, meta));
}

function gameTopbar(extra) {
  const { current, total } = view.match;
  return topbar(`Runde ${current} von ${total}${extra ? ` · ${extra}` : ''}`);
}

function wordmark() {
  return h('h1', { class: 'wordmark' }, 'Impos', h('span', {}, 'ter'));
}

// --- Anmeldung ----------------------------------------------------------------

function renderAuth() {
  document.title = 'Imposter';
  const isRegister = authMode === 'register';
  const previous = oldProfile();
  const usernameInput = h('input', {
    id: 'username', maxlength: 16, autocomplete: 'username', required: true, spellcheck: 'false',
    value: isRegister ? previous.name.replace(/[^\p{L}\p{N}_-]/gu, '') : '',
  });
  const passwordInput = h('input', {
    id: 'password', type: 'password', required: true, maxlength: 200,
    autocomplete: isRegister ? 'new-password' : 'current-password',
  });

  const submit = async (event) => {
    event.preventDefault();
    try {
      const body = { username: usernameInput.value, password: passwordInput.value };
      if (isRegister) body.avatar = previous.avatar ?? randomAvatar();
      const result = await post(isRegister ? '/api/register' : '/api/login', body);
      saveAccountToken(result.token);
      account = result.account;
      landingMessage = null;
      Sound.play('join');
      if (isRegister) openProfile();
      else renderHome();
    } catch (error) {
      fail(error.message);
    }
  };

  const tab = (mode, label) => h('button', {
    class: `tab${authMode === mode ? ' is-active' : ''}`,
    type: 'button',
    'aria-pressed': String(authMode === mode),
    onclick: () => { authMode = mode; renderAuth(); },
  }, label);

  mount(`auth-${authMode}`, h('div', { class: 'screen' },
    h('section', { class: 'hero' },
      wordmark(),
      h('p', { class: 'tagline' }, 'Alle kennen das Wort, nur einer nicht. Sagt reihum ein Wort dazu und findet heraus, wer blufft.')),
    landingMessage && h('p', { class: 'notice' }, landingMessage),
    h('section', { class: 'panel' },
      h('div', { class: 'tabs' }, tab('login', 'Anmelden'), tab('register', 'Konto erstellen')),
      h('form', { class: 'auth-form', onsubmit: submit },
        h('div', { class: 'field' }, h('label', { for: 'username' }, 'Name'), usernameInput),
        h('div', { class: 'field' }, h('label', { for: 'password' }, 'Passwort'), passwordInput),
        isRegister && h('p', { class: 'hint' }, 'Keine E-Mail nötig. Merk dir dein Passwort gut, es lässt sich nur über den Server-Admin zurücksetzen.'),
        h('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, isRegister ? 'Konto erstellen' : 'Anmelden')))));
  (isRegister && usernameInput.value ? passwordInput : usernameInput).focus();
}

// --- Startseite ---------------------------------------------------------------

async function loadLeaderboard() {
  try {
    ({ leaderboard } = await request('GET', '/api/leaderboard'));
    if (!view && !profileOpen && account) renderHome();
  } catch { /* Dann bleibt die Bestenliste einfach weg. */ }
}

function renderLeaderboardPanel() {
  if (!leaderboard?.length) return null;
  return h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Bestenliste'),
    h('ol', { class: 'board' }, leaderboard.map((entry, index) => h('li', {
      class: `board-row${entry.username === account.username ? ' is-you' : ''}${index === 0 ? ' is-first' : ''}`,
    },
      h('span', { class: 'board-rank' }, String(index + 1)),
      avatarNode(entry.avatar),
      h('span', { class: 'board-name' }, entry.username,
        h('span', { class: 'board-sub' }, `${entry.matchesWon} von ${entry.matchesPlayed} Spielen gewonnen`)),
      h('span', { class: 'board-points' }, h('span', { class: 'board-score' }, String(entry.points)))))));
}

function renderHome() {
  if (!account) {
    renderAuth();
    return;
  }
  document.title = 'Imposter';
  const inviteCode = new URLSearchParams(location.search).get('r')?.toUpperCase() ?? '';
  const codeInput = h('input', {
    id: 'code', class: 'code-input', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', placeholder: 'ABCD', value: inviteCode,
  });

  const enterRoom = async (path, body = {}) => {
    try {
      const { code, token } = await post(path, body);
      saveSession({ code, token });
      landingMessage = null;
      history.replaceState(null, '', `/?r=${code}`);
      connect();
    } catch (error) {
      fail(error.message);
    }
  };

  const join = h('form', {
    class: 'join-row',
    onsubmit: (event) => {
      event.preventDefault();
      if (codeInput.value.trim().length !== 4) {
        fail('Der Raumcode hat 4 Buchstaben.');
        codeInput.focus();
        return;
      }
      enterRoom('/api/join', { code: codeInput.value });
    },
  },
    h('div', { class: 'field' }, h('label', { for: 'code' }, 'Raumcode'), codeInput),
    h('button', { class: inviteCode ? 'btn btn-primary' : 'btn', type: 'submit' }, 'Beitreten'));

  const create = h('button', {
    class: inviteCode ? 'btn btn-wide' : 'btn btn-primary btn-wide',
    type: 'button',
    onclick: () => enterRoom('/api/create'),
  }, 'Neuen Raum erstellen');

  mount('home', h('div', { class: 'screen' },
    h('section', { class: 'hero' },
      wordmark(),
      h('p', { class: 'tagline' }, 'Alle kennen das Wort, nur einer nicht. Sagt reihum ein Wort dazu und findet heraus, wer blufft.')),
    landingMessage && h('p', { class: 'notice' }, landingMessage),
    h('section', { class: 'panel account-bar' },
      avatarNode(account.avatar, 'md'),
      h('div', { class: 'account-bar-text' },
        h('div', { class: 'account-bar-name' }, account.username),
        h('div', { class: 'hint' }, `${account.stats.points} Punkte · ${account.stats.matchesWon} Siege`),
        h('div', { class: 'link-row link-row-start' },
          h('button', { class: 'btn-link', type: 'button', onclick: openProfile }, 'Profil & Stats'),
          h('button', { class: 'btn-link', type: 'button', onclick: logout }, 'Abmelden')))),
    h('section', { class: 'panel' },
      inviteCode ? [join, h('div', { class: 'divider' }, 'oder'), create]
        : [create, h('div', { class: 'divider' }, 'oder einem Raum beitreten'), join]),
    renderLeaderboardPanel()));
}

function renderReplaced() {
  setBanner(null);
  document.title = 'Imposter';
  mount('replaced', h('div', { class: 'screen' },
    h('section', { class: 'hero' }, wordmark()),
    h('section', { class: 'panel' },
      h('p', {}, 'Du spielst jetzt in einem anderen Tab weiter.'),
      h('button', { class: 'btn btn-primary btn-wide', onclick: connect }, 'Stattdessen hier weiterspielen'))));
}

async function logout() {
  await post('/api/logout').catch(() => {});
  saveAccountToken(null);
  account = null;
  authMode = 'login';
  resetToHome();
}

// --- Profil -------------------------------------------------------------------

async function refreshAccount() {
  try {
    ({ account } = await request('GET', '/api/me'));
  } catch { /* Dann bleiben die zuletzt bekannten Zahlen stehen. */ }
}

async function openProfile() {
  profileOpen = true;
  profileDraft = { avatar: { ...account.avatar } };
  renderProfile();
  await refreshAccount();
  if (profileOpen) renderProfile();
}

function closeProfile() {
  profileOpen = false;
  profileDraft = null;
  if (view) render();
  else {
    renderHome();
    loadLeaderboard();
  }
}

function percent(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)} %` : '–';
}

async function saveAvatar() {
  try {
    ({ account } = await post('/api/avatar', { avatar: profileDraft.avatar }));
    Sound.play('points');
    toast('Charakter gespeichert.');
    closeProfile();
  } catch (error) {
    fail(error.message);
  }
}

async function changePassword(event) {
  event.preventDefault();
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  try {
    const { token } = await post('/api/password', { oldPassword, newPassword });
    saveAccountToken(token);
    toast('Passwort geändert. Andere Geräte sind jetzt abgemeldet.');
    event.target.reset();
  } catch (error) {
    fail(error.message);
  }
}

function renderProfile() {
  document.title = 'Profil · Imposter';
  const { avatar } = profileDraft;

  const pick = (key, index) => {
    avatar[key] = index;
    Sound.play('tick');
    renderProfile();
  };

  // Farben als runde Felder, alles andere als Textauswahl.
  const partPicker = (key) => {
    const part = PARTS[key];
    const options = part.names.map((name, index) => {
      const selected = avatar[key] === index;
      const color = swatchColor(key, index);
      const option = h('button', {
        class: `${color ? 'swatch' : 'chip'}${selected ? ' is-selected' : ''}`,
        type: 'button',
        key: `${key}-${index}`,
        'data-silent': 'true',
        'aria-pressed': String(selected),
        'aria-label': color ? `${part.label}: ${name}` : null,
        title: color ? name : null,
        onclick: () => pick(key, index),
      }, color ? null : name);
      if (color) option.style.backgroundColor = color;
      return option;
    });
    return h('div', { class: 'field' },
      h('span', { class: 'field-label' }, part.label),
      h('div', { class: 'options' }, options));
  };

  const { stats } = account;
  const stat = (label, value) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, String(value)));

  mount('profile', h('div', { class: 'screen' },
    topbar(account.username),
    h('form', {
      class: 'panel',
      onsubmit: (event) => {
        event.preventDefault();
        saveAvatar();
      },
    },
      h('h2', { class: 'panel-title' }, 'Dein Charakter'),
      h('div', { class: 'avatar-preview' }, avatarNode(avatar, 'lg')),
      Object.keys(PARTS).map(partPicker),
      h('button', { class: 'btn btn-primary btn-wide', type: 'submit', key: 'save' }, 'Speichern')),
    h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Deine Stats'),
      h('dl', { class: 'stats' },
        stat('Punkte', stats.points),
        stat('Spiele gewonnen', stats.matchesWon),
        stat('Spiele gespielt', stats.matchesPlayed),
        stat('Runden gespielt', stats.roundsPlayed),
        stat('Imposter-Siege', `${stats.imposterWins} von ${stats.imposterRounds}`),
        stat('Richtige Stimmen', percent(stats.correctVotes, stats.votesCast)))),
    h('form', { class: 'panel', onsubmit: changePassword },
      h('h2', { class: 'panel-title' }, 'Passwort ändern'),
      h('div', { class: 'field' },
        h('label', { for: 'old-password' }, 'Altes Passwort'),
        h('input', { id: 'old-password', type: 'password', autocomplete: 'current-password', required: true })),
      h('div', { class: 'field' },
        h('label', { for: 'new-password' }, 'Neues Passwort'),
        h('input', { id: 'new-password', type: 'password', autocomplete: 'new-password', required: true, minlength: 6 })),
      h('button', { class: 'btn btn-wide', type: 'submit' }, 'Passwort ändern')),
    h('div', { class: 'link-row' },
      h('button', { class: 'btn-link', type: 'button', onclick: closeProfile }, 'Zurück'),
      !view && h('button', { class: 'btn-link', type: 'button', onclick: logout }, 'Abmelden'))));
}

// --- Lobby ------------------------------------------------------------------

function inviteLink() {
  return `${location.origin}/?r=${view.code}`;
}

async function copyInvite() {
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Link kopiert. Jetzt in Discord einfügen!');
  } catch {
    window.prompt('Diesen Link in Discord einfügen:', link);
  }
}

function settingSelect(id, label, key, options) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('select', {
      id, key: id,
      onchange: (event) => act('settings', {
        [key]: key === 'category' || key === 'mode' ? event.target.value : Number(event.target.value),
      }),
    }, options));
}

function renderLobby() {
  document.title = `Raum ${view.code} · Imposter`;
  const isHost = view.you.isHost;
  const present = view.players.filter((p) => !p.left);
  const missing = view.minPlayers - view.onlineCount;
  const imposters = Math.min(view.settings.imposters, view.maxImposters);
  const categoryLabel = view.settings.category === 'alle'
    ? 'Alle gemischt'
    : view.categories.find((c) => c.id === view.settings.category)?.label;
  const numberOptions = (count, selected) => Array.from({ length: count }, (_, i) => i + 1)
    .map((n) => h('option', { value: n, selected: selected === n }, String(n)));

  const undercover = view.settings.mode === 'undercover';
  const timerLabel = (seconds) => (seconds === 0 ? 'Ohne Timer' : `${seconds} Sekunden`);

  const settings = isHost
    ? [
        h('div', { class: 'settings' },
          settingSelect('rounds', 'Runden', 'rounds', numberOptions(view.maxRounds, view.settings.rounds)),
          settingSelect('imposters', 'Imposter', 'imposters', numberOptions(view.maxImposters, imposters)),
          settingSelect('category', 'Kategorie', 'category', [
            h('option', { value: 'alle', selected: view.settings.category === 'alle' }, 'Alle gemischt'),
            ...view.categories.map((c) => h('option', { value: c.id, selected: view.settings.category === c.id }, c.label)),
          ])),
        h('div', { class: 'settings settings-two' },
          settingSelect('mode', 'Modus', 'mode', [
            h('option', { value: 'classic', selected: !undercover }, 'Klassisch'),
            h('option', { value: 'undercover', selected: undercover }, 'Undercover'),
          ]),
          settingSelect('turnSeconds', 'Zeit pro Wort', 'turnSeconds', view.timerOptions.map((seconds) =>
            h('option', { value: seconds, selected: view.settings.turnSeconds === seconds }, timerLabel(seconds))))),
      ]
    : h('p', { class: 'settings-readout' },
        'Modus: ', h('b', {}, undercover ? 'Undercover' : 'Klassisch'),
        ' · Runden: ', h('b', {}, String(view.settings.rounds)),
        ' · Imposter: ', h('b', {}, String(imposters)),
        ' · Kategorie: ', h('b', {}, categoryLabel),
        ' · Zeit: ', h('b', {}, timerLabel(view.settings.turnSeconds)),
        !undercover && view.settings.imposterHint && [' · ', h('b', {}, 'Imposter sieht die Kategorie')],
        !undercover && imposters > 1 && [' · Imposter sehen sich: ', h('b', {}, view.settings.impostersKnow ? 'Ja' : 'Nein')]);

  const checkbox = (key, label) => h('label', { class: 'toggle-row' },
    h('input', {
      type: 'checkbox',
      key,
      checked: view.settings[key],
      onchange: (event) => act('settings', { [key]: event.target.checked }),
    }),
    label);

  // Im Undercover-Modus wissen die Imposter nichts von ihrer Rolle, beide Häkchen ergeben dort keinen Sinn.
  // Mit nur einem Imposter gibt es niemanden, den er sehen könnte.
  const knowSetting = isHost && !undercover && [
    checkbox('imposterHint', 'Imposter sieht die Kategorie des Wortes'),
    imposters > 1 && checkbox('impostersKnow', 'Imposter sehen sich gegenseitig'),
  ];
  const modeHint = undercover && h('p', { class: 'hint' },
    'Undercover: Die Imposter bekommen ein ähnliches Wort und wissen selbst nicht, dass sie Imposter sind.');

  mount('lobby', h('div', { class: 'screen' },
    topbar(`${present.length} Spieler`),
    view.notice && h('p', { class: 'notice' }, view.notice),
    h('section', { class: 'panel' },
      h('div', { class: 'room-code' },
        h('div', {},
          h('div', { class: 'panel-title' }, 'Raumcode'),
          h('strong', {}, view.code)),
        h('button', { class: 'btn', key: 'copy', onclick: copyInvite }, 'Einladungslink kopieren'))),
    h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Spieler'),
      h('ul', { class: 'players' }, present.map((p) =>
        h('li', { class: `player${p.online ? '' : ' is-offline'}` },
          avatarNode(p.avatar),
          h('span', { class: 'player-name' }, p.name),
          h('span', { class: 'tags' },
            p.id === view.you.id && h('span', { class: 'tag' }, 'Du'),
            p.id === view.hostId && h('span', { class: 'tag tag-host' }, 'Host'))))),
      settings,
      knowSetting,
      modeHint,
      isHost && view.maxImposters === 1 && h('p', { class: 'hint' }, 'Ab 3 Spielern kannst du mehr als einen Imposter einstellen.'),
      h('p', { class: 'hint' }, 'Richtig abgestimmt: 10 Punkte. Imposter gewinnt: 25 Punkte.')),
    h('div', { class: 'actions' },
      isHost
        ? h('button', {
            class: 'btn btn-primary btn-wide', key: 'start', disabled: missing > 0,
            onclick: () => act('start'),
          }, missing > 0 ? `Noch ${missing} Spieler ${missing === 1 ? 'fehlt' : 'fehlen'}` : 'Spiel starten')
        : h('p', { class: 'hint' }, missing > 0
            ? `Es ${missing === 1 ? 'fehlt' : 'fehlen'} noch ${missing} Spieler. Schick den Link in euren Discord.`
            : `Warte, bis ${nameOf(view.hostId)} das Spiel startet.`),
      h('div', { class: 'link-row' },
        h('button', { class: 'btn-link', onclick: openProfile }, 'Profil bearbeiten'),
        h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen')))));
}

// --- Rangliste ------------------------------------------------------------------

function renderLeaderboard(gains = []) {
  const { leaderboard, current, total } = view.match;
  let rank = 0;
  let lastPoints = null;
  const rows = leaderboard.map((entry, index) => {
    if (entry.points !== lastPoints) rank = index + 1;
    lastPoints = entry.points;
    const gain = gains.find((g) => g.id === entry.id)?.points ?? 0;
    const classes = ['board-row'];
    if (entry.id === view.you.id) classes.push('is-you');
    if (entry.left) classes.push('has-left');
    if (rank === 1 && entry.points > 0) classes.push('is-first');
    return h('li', { class: classes.join(' ') },
      h('span', { class: 'board-rank' }, String(rank)),
      avatarNode(entry.avatar),
      h('span', { class: 'board-name' }, entry.name),
      h('span', { class: 'board-points' },
        h('span', { class: 'board-score' }, String(entry.points)),
        gain > 0 && h('span', { class: 'board-gain' }, `+${gain}`)));
  });
  return h('aside', { class: 'game-side' },
    h('section', { class: 'panel', 'aria-label': 'Rangliste' },
      h('h2', { class: 'panel-title' }, `Rangliste · Runde ${current}/${total}`),
      h('ol', { class: 'board' }, rows)));
}

function gameLayout(screenKey, mainChildren, gains) {
  mount(screenKey, h('div', { class: 'game-layout' },
    h('div', { class: 'screen' }, mainChildren),
    renderLeaderboard(gains)), { game: true });
}

// --- Reihenfolge und gesagte Wörter ----------------------------------------------

function renderWordLog(round, { showCurrent = false, canMark = false } = {}) {
  const youPlay = canMark && round.inRound && !round.youKicked;
  return h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Gesagte Wörter'),
    youPlay && h('p', { class: 'hint' }, 'Klick auf einen Mitspieler, um ihn als verdächtig zu markieren.'),
    h('ol', { class: 'order' }, round.order.map((id, index) => {
      const player = playerOf(id);
      const isCurrent = showCurrent && id === round.currentId;
      const words = round.words.filter((entry) => entry.playerId === id);
      const markers = round.sus.find((entry) => entry.id === id)?.by ?? [];
      const isMine = markers.includes(view.you.id);
      const kicked = round.kicked.find((entry) => entry.id === id);
      const markable = youPlay && id !== view.you.id && player && !player.left && !kicked;
      const kickedLabel = kicked && {
        imposter: 'raus · Imposter',
        word: 'raus · kein Imposter',
      }[kicked.role];
      const toggleMark = () => {
        Sound.play('tick');
        act('sus', { target: id });
      };
      const classes = ['order-row'];
      if (isCurrent) classes.push('is-current');
      if (player?.left) classes.push('has-left');
      if (markers.length > 0) classes.push('has-sus');
      if (markable) classes.push('is-markable');
      if (kicked) classes.push('is-kicked');
      return h('li', {
        class: classes.join(' '),
        'aria-current': isCurrent ? 'true' : null,
        onclick: markable ? toggleMark : null,
      },
        h('span', { class: 'order-number' }, String(index + 1)),
        player ? avatarNode(player.avatar) : h('span'),
        h('div', { class: 'order-main' },
          h('div', { class: 'order-head' },
            // Der Klick landet über die Zeile beim Umschalten, der Button macht es per Tastatur erreichbar.
            markable
              ? h('button', {
                  class: 'order-name order-name-button',
                  type: 'button',
                  key: `sus-${id}`,
                  'data-silent': 'true',
                  'aria-pressed': String(isMine),
                  'aria-label': isMine ? `${nameOf(id)}: Markierung entfernen` : `${nameOf(id)} als verdächtig markieren`,
                }, nameOf(id))
              : h('span', { class: 'order-name' }, nameOf(id)),
            id === view.you.id && h('span', { class: 'tag' }, 'Du'),
            player && !player.online && !player.left && h('span', { class: 'tag' }, 'offline'),
            kicked && h('span', { class: 'tag tag-kicked' }, kickedLabel ?? 'raus'),
            markers.length > 0 && h('span', {
              class: 'sus-marks',
              title: `Verdächtigt von ${markers.map(nameOf).join(', ')}`,
            },
              h('span', { class: 'sus-label' }, 'sus'),
              markers.map((markerId) => {
                const marker = playerOf(markerId);
                return marker ? avatarNode(marker.avatar, 'xs') : null;
              }))),
          words.length > 0
            ? h('ul', { class: 'word-chips' }, words.map((entry) => {
                if (entry.word !== null) return h('li', { class: 'word-chip', title: `Durchgang ${entry.lap}` }, entry.word);
                const label = entry.reason === 'timeout' ? 'Zeit abgelaufen' : 'übersprungen';
                return h('li', { class: 'word-chip is-skipped', title: `Durchgang ${entry.lap}: ${label}` }, label);
              }))
            : h('span', { class: 'no-words' }, 'Noch kein Wort')));
    })));
}

// --- Wort raten ---------------------------------------------------------------

function renderGuessControl() {
  if (!guessOpen) {
    return h('button', {
      class: 'btn btn-wide',
      type: 'button',
      key: 'guess-open',
      onclick: () => {
        guessOpen = true;
        render();
        document.getElementById('guess-input')?.focus();
      },
    }, 'Wort raten');
  }
  return h('form', {
    class: 'panel',
    onsubmit: async (event) => {
      event.preventDefault();
      const guess = guessDraft.trim();
      if (!guess) {
        fail('Schreib deinen Tipp auf.');
        return;
      }
      await act('guess', { guess });
    },
  },
    h('div', { class: 'field' },
      h('label', { for: 'guess-input' }, 'Was ist das Wort?'),
      h('input', {
        id: 'guess-input',
        key: 'guess-input',
        maxlength: 40,
        autocomplete: 'off',
        spellcheck: 'false',
        value: guessDraft,
        oninput: (event) => { guessDraft = event.target.value; },
      })),
    h('p', { class: 'hint' }, 'Du hast nur einen Versuch, und alle sehen deinen Tipp. Liegst du falsch, gewinnt die Gruppe.'),
    h('div', { class: 'actions-row' },
      h('button', { class: 'btn btn-primary', type: 'submit', key: 'guess-submit' }, 'Tipp abgeben'),
      h('button', {
        class: 'btn', type: 'button', key: 'guess-cancel',
        onclick: () => { guessOpen = false; render(); },
      }, 'Abbrechen')));
}

function canGuess(round) {
  return round.card?.type === 'imposter' && !round.youKicked;
}

function renderTally(tally, imposterIds = []) {
  return h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Stimmen'),
    h('div', { class: 'tally' }, (() => {
      const highest = Math.max(1, ...tally.map((row) => row.count));
      return tally.map((row) => {
        const fill = h('span', { class: 'tally-fill' });
        // Die Breite wird per JS gesetzt, weil die Sicherheitsregeln (CSP) Inline-Styles im HTML blockieren.
        fill.style.width = `${(row.count / highest) * 100}%`;
        return h('div', { class: `tally-row${imposterIds.includes(row.id) ? ' is-imposter' : ''}` },
          h('div', { class: 'tally-head' },
            h('span', {}, nameOf(row.id)),
            h('span', { class: 'tally-count' }, String(row.count))),
          h('div', { class: 'tally-bar' }, fill),
          row.voters.length > 0 && h('div', { class: 'tally-voters' }, `von ${row.voters.map(nameOf).join(', ')}`));
      });
    })()));
}

// --- Rauswahl -------------------------------------------------------------------

function renderKicked() {
  const round = view.round;
  const { kick } = round;
  const isHost = view.you.isHost;
  const kickedId = kick.playerId;
  const isYou = kickedId === view.you.id;
  const name = kickedId ? nameOf(kickedId) : '';
  const role = round.kicked.find((entry) => entry.id === kickedId)?.role;
  document.title = kickedId ? `${name} ist raus · Imposter` : 'Niemand ist raus · Imposter';

  let headline;
  if (!kickedId) headline = 'Niemand fliegt raus';
  else headline = isYou ? 'Du wurdest rausgewählt' : `${name} wurde rausgewählt`;

  let status = null;
  if (!kickedId) {
    status = h('p', { class: 'notice' }, 'Bei Gleichstand fliegt niemand raus. Es geht weiter.');
  } else if (kick.choice === 'shown') {
    status = h('p', { class: `role-result${role === 'imposter' ? ' is-imposter' : ''}` }, role === 'imposter'
      ? `${isYou ? 'Du warst' : `${name} war`} Imposter!`
      : `${isYou ? 'Du warst' : `${name} war`} kein Imposter.`);
  } else if (kick.choice === 'hidden') {
    status = h('p', { class: 'notice' }, isYou ? 'Du behältst deine Rolle für dich.' : `${name} behält die Rolle für sich.`);
  } else if (isYou) {
    status = h('section', { class: 'panel' },
      h('p', {}, 'Willst du den anderen deine Rolle zeigen?'),
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn btn-primary', key: 'role-show', onclick: () => act('revealRole', { show: true }) }, 'Rolle zeigen'),
        h('button', { class: 'btn', key: 'role-hide', onclick: () => act('revealRole', { show: false }) }, 'Geheim halten')));
  } else {
    status = h('p', { class: 'notice' }, `${name} entscheidet, ob die Rolle gezeigt wird.`);
  }

  const waitingForChoice = kickedId && kick.choice === null;
  gameLayout(`kicked-${round.id}-${round.kicked.length}-${round.words.length}`, [
    gameTopbar('Abstimmung vorbei'),
    h('section', { class: 'speaker' },
      h('div', { class: 'panel-title' }, 'Ergebnis'),
      h('h1', { class: 'speaker-name' }, headline)),
    status,
    isHost
      ? h('button', {
          class: waitingForChoice ? 'btn btn-wide' : 'btn btn-primary btn-wide',
          key: 'continue',
          onclick: () => act('continueRound'),
        }, waitingForChoice ? 'Nicht warten, weiterspielen' : 'Weiterspielen')
      : h('p', { class: 'hint' }, `${nameOf(view.hostId)} macht gleich weiter.`),
    renderTally(kick.tally),
    renderWordLog(round),
  ]);
}

// --- Wort raten: Prüfung ----------------------------------------------------------

function renderGuess() {
  const round = view.round;
  const { playerId, text, judges, doneCount, yours } = round.guess;
  const isJudge = judges.includes(view.you.id);
  const guesser = nameOf(playerId);
  document.title = `${guesser} hat getippt · Imposter`;

  const verdictButton = (accepted, label, primary) => h('button', {
    class: `btn${primary ? ' btn-primary' : ''}${yours === accepted ? ' is-chosen' : ''}`,
    key: `judge-${accepted}`,
    'aria-pressed': String(yours === accepted),
    onclick: () => act('judgeGuess', { accepted }),
  }, label);

  gameLayout(`guess-${round.id}`, [
    gameTopbar(`${doneCount} von ${judges.length} entschieden`),
    h('section', { class: 'speaker' },
      h('div', { class: 'panel-title' }, playerId === view.you.id ? 'Dein Tipp' : `${guesser} ist Imposter und tippt`),
      h('h1', { class: 'guess-text' }, `„${text}“`)),
    isJudge
      ? h('section', { class: 'panel' },
          h('p', {}, 'Euer Wort ist ', h('b', {}, round.card.word), '. Zählt der Tipp als richtig?'),
          h('div', { class: 'actions-row' },
            verdictButton(true, 'Zählt', true),
            verdictButton(false, 'Zählt nicht', false)),
          h('p', { class: 'hint' }, 'Auch ähnliche Begriffe dürfen zählen. Bei Gleichstand ist der Tipp richtig.'))
      : h('p', { class: 'notice' }, 'Die Spieler, die das Wort kennen, entscheiden jetzt, ob der Tipp zählt.'),
    view.you.isHost && h('button', {
      class: 'btn btn-wide', key: 'finishGuess', onclick: () => act('finishGuess'),
    }, 'Jetzt auswerten'),
    renderWordLog(round),
  ]);
}

// --- Spielrunde ---------------------------------------------------------------

function renderCard(round) {
  const isImposter = round.card.type === 'imposter';
  const labelFor = (revealed) => {
    if (!revealed) return 'Karte aufdecken';
    return isImposter ? 'Du bist Imposter. Karte verdecken' : `Dein Wort ist ${round.card.word}. Karte verdecken`;
  };
  const revealed = cardRevealedFor === round.id;
  return h('div', { class: 'card-scene' },
    h('button', {
      class: `card${revealed ? ' is-revealed' : ''}`,
      key: 'card',
      type: 'button',
      'data-silent': 'true',
      'aria-pressed': String(revealed),
      'aria-label': labelFor(revealed),
      // Direkt am vorhandenen Element umschalten, sonst läuft die Dreh-Animation nicht.
      onclick: (event) => {
        const card = event.currentTarget;
        const nowRevealed = cardRevealedFor !== round.id;
        cardRevealedFor = nowRevealed ? round.id : null;
        card.classList.toggle('is-revealed', nowRevealed);
        card.setAttribute('aria-pressed', String(nowRevealed));
        card.setAttribute('aria-label', labelFor(nowRevealed));
        Sound.play('flip');
        if (nowRevealed && isImposter) Sound.play('imposterSting', 0.18);
        const slot = document.getElementById('guess-slot');
        if (slot) slot.hidden = !nowRevealed;
      },
    },
      h('span', { class: 'card-face card-back' },
        h('span', { class: 'card-back-mark' }, '?'),
        h('span', { class: 'card-back-text' }, 'Deine Karte aufdecken'),
        h('span', { class: 'card-back-hint' }, 'Pass auf, falls du deinen Bildschirm teilst')),
      h('span', { class: `card-face card-front${isImposter ? ' is-imposter' : ''}` },
        h('span', { class: 'card-front-label' }, isImposter ? 'Pssst …' : 'Dein Wort'),
        h('span', { class: 'card-word', lang: 'de' }, isImposter ? 'Du bist Imposter' : round.card.word),
        isImposter && round.card.hint && h('span', { class: 'card-front-category' }, `Kategorie: ${round.card.hint}`),
        h('span', { class: 'card-front-hint' }, imposterCardHint(round, isImposter)))));
}

function imposterCardHint(round, isImposter) {
  if (!isImposter) return 'Tippen zum Verdecken';
  if (round.partners?.length) return `Mit dir im Team: ${round.partners.map(nameOf).join(', ')}`;
  return 'Hör gut zu und tu so, als wüsstest du das Wort';
}

function renderWordForm(round) {
  const input = h('input', {
    id: 'word-input',
    key: 'word-input',
    maxlength: view.maxWordLength,
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Ein Wort …',
    value: wordDraft,
    oninput: (event) => { wordDraft = event.target.value; },
  });
  return h('form', {
    class: 'word-form',
    onsubmit: async (event) => {
      event.preventDefault();
      const word = wordDraft.trim();
      if (!word) {
        fail('Schreib dein Wort auf, bevor du weitergibst.');
        return;
      }
      if (await act('word', { word, turn: round.turn })) wordDraft = '';
    },
  },
    h('div', { class: 'field' },
      h('label', { for: 'word-input' }, 'Sag dein Wort im Voice-Chat und schreib es hier auf'),
      input),
    h('button', { class: 'btn btn-primary', key: 'word-submit', type: 'submit' }, 'Eintragen'));
}

function imposterCountNote(round) {
  const count = round.imposterCount;
  return h('p', { class: 'imposter-count' },
    h('strong', {}, String(count)),
    ' Imposter in dieser Runde',
    round.undercover && ' · Undercover: Sie haben ein ähnliches Wort');
}

function renderPlay() {
  const round = view.round;
  const isHost = view.you.isHost;
  const isYourTurn = round.currentId === view.you.id;
  const current = nameOf(round.currentId);
  document.title = isYourTurn ? '> Du bist dran! · Imposter' : `${current} ist dran · Imposter`;
  const focusedBefore = document.activeElement?.dataset?.key;

  gameLayout(`play-${round.id}`, [
    gameTopbar(`Durchgang ${round.lap}`),
    imposterCountNote(round),
    round.card
      ? renderCard(round)
      : h('p', { class: 'notice' }, 'Du bist mitten in der Runde dazugekommen und spielst ab der nächsten mit.'),
    round.youKicked && h('p', { class: 'notice' }, 'Du wurdest rausgewählt und schaust nur noch zu. Verrate bitte nichts.'),
    // Bleibt verborgen, solange die Karte zu ist, damit ein geteilter Bildschirm den Imposter nicht verrät.
    canGuess(round) && h('div', {
      id: 'guess-slot', hidden: cardRevealedFor !== round.id ? '' : null,
    }, renderGuessControl()),
    h('section', { class: 'speaker-row' },
      h('div', { class: `speaker${isYourTurn ? ' is-you' : ''}`, 'aria-live': 'polite' },
        h('div', { class: 'panel-title' }, round.isFirstTurn ? 'Per Zufall ausgewählt' : 'Gerade dran'),
        h('div', { class: 'speaker-name' }, isYourTurn
          ? (round.isFirstTurn ? 'Du fängst an!' : 'Du bist dran!')
          : (round.isFirstTurn ? `${current} fängt an` : `${current} ist dran`))),
      round.turnLength > 0 && h('div', { class: 'turn-timer', 'aria-hidden': 'true' },
        h('span', { class: 'turn-seconds' }),
        h('div', { class: 'turn-bar' }, h('span', { class: 'turn-bar-fill' })))),
    isYourTurn && h('section', { class: 'panel' }, renderWordForm(round)),
    renderWordLog(round, { showCurrent: true, canMark: true }),
    isHost
      ? h('div', { class: 'actions-row' },
          h('button', { class: 'btn btn-primary', key: 'startVote', onclick: () => act('startVote') }, 'Abstimmung starten'),
          !isYourTurn && h('button', {
            class: 'btn', key: 'skip', onclick: () => act('skip', { turn: round.turn }),
          }, `${current} überspringen`),
          h('button', { class: 'btn', key: 'abort', onclick: () => act('lobby') }, 'Spiel abbrechen'))
      : h('p', { class: 'hint' }, `${nameOf(view.hostId)} startet die Abstimmung, sobald ihr bereit seid.`),
    h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen'),
  ]);

  updateTurnTimer();
  // Wer an die Reihe kommt, kann sofort lostippen, solange kein anderes Element den Fokus hat.
  if (isYourTurn && !focusedBefore) document.getElementById('word-input')?.focus({ preventScroll: true });
}

// --- Abstimmung ---------------------------------------------------------------

function renderVote() {
  const round = view.round;
  const { candidates, votedIds, yours } = round.vote;
  const canVote = candidates.includes(view.you.id);
  document.title = 'Abstimmung · Imposter';

  gameLayout(`vote-${round.id}`, [
    gameTopbar(`${votedIds.length} von ${candidates.length} abgestimmt`),
    h('section', { class: 'speaker' },
      h('div', { class: 'panel-title' }, 'Abstimmung'),
      h('h1', { class: 'speaker-name' }, round.imposterCount > 1 ? 'Wer sind die Imposter?' : 'Wer ist Imposter?')),
    imposterCountNote(round),
    round.card?.type === 'word' && h('p', { class: 'hint' }, 'Euer Wort: ', h('b', {}, round.card.word)),
    canVote
      ? h('div', { class: 'vote-list' }, candidates.map((id) => {
          const isSelf = id === view.you.id;
          const isSelected = yours === id;
          const player = playerOf(id);
          return h('button', {
            class: `vote-option${isSelected ? ' is-selected' : ''}`,
            key: `vote-${id}`,
            'data-silent': 'true',
            disabled: isSelf,
            'aria-pressed': String(isSelected),
            onclick: () => {
              Sound.play('vote');
              act('vote', { target: id });
            },
          },
            avatarNode(player.avatar),
            h('span', { class: 'vote-name' }, player.name),
            round.partners?.includes(id) && h('span', { class: 'tag' }, 'Dein Team'),
            h('span', { class: 'vote-state' }, isSelf ? 'Du' : isSelected ? 'Deine Stimme' : votedIds.includes(id) ? 'hat abgestimmt' : ''));
        }))
      : h('p', { class: 'notice' }, 'Du schaust in dieser Runde nur zu.'),
    canVote && h('p', { class: 'hint' }, yours
      ? 'Du kannst deine Stimme noch ändern, bis alle abgestimmt haben.'
      : 'Wer die meisten Stimmen hat, fliegt raus. Bei Gleichstand niemand. Punkte gibt es am Ende der Runde.'),
    view.you.isHost && h('button', {
      class: 'btn btn-wide', key: 'finishVote', onclick: () => act('finishVote'),
    }, 'Jetzt auswerten'),
    canGuess(round) && renderGuessControl(),
    renderWordLog(round, { canMark: true }),
  ]);
}

// --- Auflösung ----------------------------------------------------------------

function renderReveal() {
  const round = view.round;
  const reveal = round.reveal;
  const groupWon = reveal.caught;
  const imposterNames = reveal.imposterIds.map(nameOf).join(', ');
  const plural = reveal.imposterIds.length > 1;
  const youWereImposter = reveal.imposterIds.includes(view.you.id);
  const isLastRound = view.match.current >= view.match.total;
  const yourGain = reveal.gains.find((g) => g.id === view.you.id);
  document.title = 'Auflösung · Imposter';

  let detail;
  if (reveal.accusedId === null) detail = 'Ihr konntet euch auf niemanden einigen.';
  else if (groupWon) detail = 'Alle Imposter sind draußen.';
  else if (reveal.imposterIds.includes(reveal.accusedId)) {
    detail = `${nameOf(reveal.accusedId)} wurde enttarnt, aber die Imposter sind in der Überzahl.`;
  } else {
    detail = `${nameOf(reveal.accusedId)} war unschuldig. Jetzt sind die Imposter in der Überzahl.`;
  }

  let title;
  if (groupWon) title = youWereImposter ? 'Erwischt!' : 'Die Gruppe gewinnt!';
  else if (youWereImposter) title = 'Du hast gewonnen!';
  else title = plural ? 'Die Imposter gewinnen!' : 'Der Imposter gewinnt!';

  const { guess } = reveal;
  if (guess) {
    const guesser = nameOf(guess.playerId);
    const isYou = guess.playerId === view.you.id;
    if (guess.correct) title = isYou ? 'Richtig geraten!' : `${guesser} hat das Wort erraten!`;
    else title = isYou ? 'Falsch geraten!' : `${guesser} hat falsch geraten!`;
    detail = `Der Tipp war „${guess.text}“.`;
    if (guess.judged) detail += guess.correct ? ' Die Gruppe lässt ihn gelten.' : ' Die Gruppe lässt ihn nicht gelten.';
  }

  gameLayout(`reveal-${round.id}`, [
    gameTopbar('Auflösung'),
    h('section', { class: `verdict${groupWon ? ' group-won' : ''}` },
      h('h1', { class: 'verdict-title' }, title),
      h('p', {}, detail)),
    yourGain && h('section', { class: 'panel' },
      yourGain.points > 0
        ? h('p', { class: 'gain-line' }, `+${yourGain.points} Punkte`,
            h('span', { class: 'hint' }, ` (${[
              yourGain.imposterWon && 'Imposter-Sieg',
              yourGain.correctVotes === 1 && 'richtige Stimme',
              yourGain.correctVotes > 1 && `${yourGain.correctVotes} richtige Stimmen`,
            ].filter(Boolean).join(', ')})`))
        : h('p', { class: 'gain-line is-zero' }, 'Diese Runde keine Punkte für dich.')),
    h('section', { class: 'panel reveal-facts' },
      h('div', { class: 'fact' },
        h('div', { class: 'panel-title' }, 'Das Wort'),
        h('div', { class: 'fact-value' }, reveal.word)),
      reveal.undercoverWord && h('div', { class: 'fact' },
        h('div', { class: 'panel-title' }, 'Wort der Imposter'),
        h('div', { class: 'fact-value' }, reveal.undercoverWord)),
      h('div', { class: 'fact' },
        h('div', { class: 'panel-title' }, plural ? 'Die Imposter' : 'Imposter'),
        h('div', { class: 'fact-value' }, imposterNames))),
    view.you.isHost
      ? h('div', { class: 'actions-row' },
          h('button', {
            class: 'btn btn-primary', key: 'again',
            onclick: () => act(isLastRound ? 'showFinal' : 'nextRound'),
          }, isLastRound ? 'Zum Endergebnis' : 'Nächste Runde'),
          !isLastRound && h('button', { class: 'btn', key: 'toLobby', onclick: () => act('lobby') }, 'Spiel beenden'))
      : h('p', { class: 'hint' }, isLastRound
          ? `${nameOf(view.hostId)} öffnet gleich das Endergebnis.`
          : `${nameOf(view.hostId)} startet die nächste Runde.`),
    reveal.tally.length > 0 && renderTally(reveal.tally, reveal.imposterIds),
    renderWordLog(round),
    h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen'),
  ], reveal.gains);
}

// --- Endergebnis ----------------------------------------------------------------

function renderFinal() {
  const { leaderboard, winners, total } = view.match;
  document.title = 'Endergebnis · Imposter';
  const youWon = winners.includes(view.you.id);
  const winnerNames = winners.map(nameOf);

  let title;
  if (winners.length === 0) title = 'Niemand hat gepunktet';
  else if (youWon && winners.length === 1) title = 'Du hast gewonnen!';
  else if (winners.length === 1) title = `${winnerNames[0]} gewinnt!`;
  else title = `Gleichstand: ${winnerNames.join(', ')}`;

  let rank = 0;
  let lastPoints = null;
  const rows = leaderboard.filter((entry) => !entry.left).map((entry, index) => {
    if (entry.points !== lastPoints) rank = index + 1;
    lastPoints = entry.points;
    return h('li', { class: `podium-row${winners.includes(entry.id) ? ' is-winner' : ''}` },
      h('span', { class: 'podium-rank' }, String(rank)),
      avatarNode(entry.avatar, 'md'),
      h('span', { class: 'podium-name' }, entry.name),
      h('span', { class: 'podium-score' }, String(entry.points)));
  });

  mount(`final-${view.code}-${winners.join()}`, h('div', { class: 'screen' },
    topbar(`Endergebnis nach ${total} ${total === 1 ? 'Runde' : 'Runden'}`),
    h('section', { class: `verdict${youWon ? ' group-won' : ''}` },
      h('h1', { class: 'verdict-title' }, title),
      h('p', {}, 'Die Stats sind in euren Konten gespeichert.')),
    h('ol', { class: 'podium panel' }, rows),
    view.match.titles.length > 0 && h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Titel des Abends'),
      h('ul', { class: 'titles' }, view.match.titles.map((entry) =>
        h('li', { class: `title-row${entry.playerIds.includes(view.you.id) ? ' is-you' : ''}` },
          h('div', { class: 'title-avatars' }, entry.playerIds.map((id) => {
            const player = playerOf(id);
            return player ? avatarNode(player.avatar) : null;
          })),
          h('div', { class: 'title-main' },
            h('div', { class: 'title-name' }, entry.title),
            h('div', { class: 'title-who' }, entry.playerIds.map(nameOf).join(', ')),
            h('div', { class: 'hint' }, `${entry.text} (${entry.value}×)`)))))),
    view.you.isHost
      ? h('div', { class: 'actions-row' },
          h('button', { class: 'btn btn-primary', key: 'rematch', onclick: () => act('start') }, 'Nochmal spielen'),
          h('button', { class: 'btn', key: 'toLobby', onclick: () => act('lobby') }, 'Zur Lobby'))
      : h('p', { class: 'hint' }, `${nameOf(view.hostId)} entscheidet, wie es weitergeht.`),
    h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen')));
}

// --- Start ----------------------------------------------------------------------

function updateSoundToggle() {
  const muted = Sound.isMuted();
  soundToggleEl.textContent = muted ? 'Ton aus' : 'Ton an';
  soundToggleEl.setAttribute('aria-pressed', String(muted));
  soundToggleEl.setAttribute('aria-label', muted ? 'Ton einschalten' : 'Ton ausschalten');

  const speechMuted = Speech.isMuted();
  speechToggleEl.textContent = speechMuted ? 'Sprache aus' : 'Sprache an';
  speechToggleEl.setAttribute('aria-pressed', String(speechMuted));
  speechToggleEl.setAttribute('aria-label', speechMuted ? 'Vorlesen einschalten' : 'Vorlesen ausschalten');
  speechToggleEl.hidden = !Speech.isSupported();
}

speechToggleEl.addEventListener('click', () => {
  Speech.setMuted(!Speech.isMuted());
  updateSoundToggle();
});

soundToggleEl.addEventListener('click', () => {
  Sound.setMuted(!Sound.isMuted());
  updateSoundToggle();
});

// Dezenter Klick für alle Buttons, die keinen eigenen Sound haben.
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('button');
  if (button && !button.disabled && !button.dataset.silent) Sound.play('click');
});

async function start() {
  updateSoundToggle();
  if (!accountToken) {
    renderAuth();
    return;
  }
  try {
    ({ account } = await request('GET', '/api/me'));
  } catch (error) {
    if (error.status === 401) saveAccountToken(null);
    else landingMessage = 'Der Server antwortet gerade nicht. Lade die Seite gleich noch mal.';
    renderAuth();
    return;
  }
  if (session?.code && session?.token) connect();
  else {
    renderHome();
    loadLeaderboard();
  }
}

start();
