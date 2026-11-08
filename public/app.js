'use strict';

const { PARTS, avatarMarkup, swatchColor, isValidAvatar, randomAvatar } = window.ImposterAvatar;
const Sound = window.ImposterSound;

const appEl = document.getElementById('app');
const bannerEl = document.getElementById('banner');
const toastEl = document.getElementById('toast');
const soundToggleEl = document.getElementById('sound-toggle');
const RECONNECT_DELAY_MS = 2000;
const SESSION_KEY = 'imposter-session';
const SLOT_KEY = 'imposter-slot';

// Mit ?spieler=2 in der Adresse bekommt ein Tab ein eigenes Profil. So lässt sich
// eine Runde mit mehreren Spielern in einem einzigen Browser üben.
const slot = new URLSearchParams(location.search).get('spieler') ?? storageGet(sessionStorage, SLOT_KEY);
if (slot) storageSet(sessionStorage, SLOT_KEY, slot);
const PROFILE_KEY = slot ? `imposter-profile-${slot}` : 'imposter-profile';

const profile = loadProfile(); // Name, Avatar und Stats dieses Browsers
let session = loadSession();   // Raumsitzung: { code, token }
let view = null;               // Letzter Spielstand vom Server
let source = null;             // EventSource
let profileOpen = false;       // Profil liegt über Startseite oder Lobby
let profileDraft = null;       // Name und Avatar, die gerade bearbeitet werden
let cardRevealedFor = null;    // ID der Runde, deren Karte aufgedeckt ist
let wordDraft = '';            // Halb getipptes Wort übersteht neue Spielstände
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

function randomClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function emptyStats() {
  return {
    matchesPlayed: 0,
    matchesWon: 0,
    roundsPlayed: 0,
    imposterRounds: 0,
    imposterWins: 0,
    votesCast: 0,
    correctVotes: 0,
    points: 0,
  };
}

function loadProfile() {
  let stored = null;
  try { stored = JSON.parse(storageGet(localStorage, PROFILE_KEY)); } catch { /* Dann neu anlegen. */ }
  const loaded = {
    clientId: typeof stored?.clientId === 'string' ? stored.clientId : randomClientId(),
    name: typeof stored?.name === 'string' ? stored.name : '',
    avatar: isValidAvatar(stored?.avatar) ? stored.avatar : randomAvatar(),
    stats: { ...emptyStats(), ...stored?.stats },
    lastRoundKey: stored?.lastRoundKey ?? null,
  };
  storageSet(localStorage, PROFILE_KEY, JSON.stringify(loaded));
  return loaded;
}

function saveProfile() {
  storageSet(localStorage, PROFILE_KEY, JSON.stringify(profile));
}

function identity() {
  return { clientId: profile.clientId, name: profile.name, avatar: profile.avatar };
}

// Trägt jede Runde genau einmal in die Stats ein, auch wenn man bei der Auflösung neu lädt.
function recordStats(current) {
  if (current.phase !== 'reveal') return;
  const roundKey = `${current.code}:${current.round.id}`;
  if (profile.lastRoundKey === roundKey) return;
  const gain = current.round.reveal.gains.find((entry) => entry.id === current.you.id);
  if (!gain) return;

  const { stats } = profile;
  stats.roundsPlayed++;
  stats.points += gain.points;
  if (gain.wasImposter) stats.imposterRounds++;
  if (gain.imposterWon) stats.imposterWins++;
  if (gain.voted) stats.votesCast++;
  if (gain.correctVote) stats.correctVotes++;
  if (current.match.current >= current.match.total) {
    stats.matchesPlayed++;
    if (current.match.winners.includes(current.you.id)) stats.matchesWon++;
  }
  profile.lastRoundKey = roundKey;
  saveProfile();
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
    else if (key === 'disabled' || key === 'selected' || key === 'required') el[key] = Boolean(value);
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
    recordStats(view);
    playTransitionSounds(previous, view);
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
}

async function leaveRoom() {
  await post('/api/action', { code: session.code, token: session.token, type: 'leave' }).catch(() => {});
  Sound.play('leave');
  resetToHome();
}

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
  if (next.phase === 'reveal' && previous.phase === 'vote') {
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
  if (target.tagName === 'INPUT') target.setSelectionRange(target.value.length, target.value.length);
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

// --- Startseite ---------------------------------------------------------------

function renderHome() {
  if (!profile.name) {
    openProfile();
    return;
  }
  document.title = 'Imposter';
  const inviteCode = new URLSearchParams(location.search).get('r')?.toUpperCase() ?? '';
  const codeInput = h('input', {
    id: 'code', class: 'code-input', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', placeholder: 'ABCD', value: inviteCode,
  });

  const enterRoom = async (path, body) => {
    try {
      const { code, token } = await post(path, { ...identity(), ...body });
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
      avatarNode(profile.avatar, 'md'),
      h('div', { class: 'account-bar-text' },
        h('div', { class: 'account-bar-name' }, profile.name),
        h('button', { class: 'btn-link', type: 'button', onclick: openProfile }, 'Profil bearbeiten'))),
    h('section', { class: 'panel' },
      inviteCode ? [join, h('div', { class: 'divider' }, 'oder'), create]
        : [create, h('div', { class: 'divider' }, 'oder einem Raum beitreten'), join])));
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

// --- Profil -------------------------------------------------------------------

function openProfile() {
  profileOpen = true;
  profileDraft = { name: profile.name, avatar: { ...profile.avatar } };
  renderProfile();
}

function closeProfile() {
  profileOpen = false;
  profileDraft = null;
  if (view) render();
  else renderHome();
}

function percent(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)} %` : '–';
}

async function saveProfileDraft() {
  const name = profileDraft.name.trim();
  if (!name) {
    fail('Bitte gib einen Namen ein.');
    document.getElementById('profile-name')?.focus();
    return;
  }
  // In einer Lobby muss der Raum den neuen Namen erst bestätigen, er könnte schon vergeben sein.
  if (view && !(await act('profile', { name, avatar: profileDraft.avatar }))) return;
  profile.name = name;
  profile.avatar = profileDraft.avatar;
  saveProfile();
  Sound.play('points');
  closeProfile();
}

function renderProfile() {
  const isSetup = !profile.name;
  document.title = isSetup ? 'Willkommen · Imposter' : 'Profil · Imposter';
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

  const { stats } = profile;
  const stat = (label, value) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, String(value)));

  mount('profile', h('div', { class: 'screen' },
    isSetup
      ? h('section', { class: 'hero' },
          wordmark(),
          h('p', { class: 'tagline' }, 'Wähl einen Namen und bau dir deinen Charakter, dann kann es losgehen.'))
      : topbar('Profil'),
    h('form', {
      class: 'panel',
      onsubmit: (event) => {
        event.preventDefault();
        saveProfileDraft();
      },
    },
      h('div', { class: 'field' },
        h('label', { for: 'profile-name' }, 'Dein Name'),
        h('input', {
          id: 'profile-name',
          key: 'profile-name',
          maxlength: 16,
          autocomplete: 'nickname',
          value: profileDraft.name,
          oninput: (event) => { profileDraft.name = event.target.value; },
        })),
      h('div', { class: 'avatar-preview' }, avatarNode(avatar, 'lg')),
      Object.keys(PARTS).map(partPicker),
      h('button', { class: 'btn btn-primary btn-wide', type: 'submit', key: 'save' }, isSetup ? 'Los geht’s' : 'Speichern')),
    !isSetup && h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Deine Stats'),
      h('dl', { class: 'stats' },
        stat('Punkte', stats.points),
        stat('Spiele gewonnen', stats.matchesWon),
        stat('Spiele gespielt', stats.matchesPlayed),
        stat('Runden gespielt', stats.roundsPlayed),
        stat('Imposter-Siege', `${stats.imposterWins} von ${stats.imposterRounds}`),
        stat('Richtige Stimmen', percent(stats.correctVotes, stats.votesCast))),
      h('p', { class: 'hint' }, 'Name, Charakter und Stats sind in diesem Browser gespeichert.')),
    !isSetup && h('button', { class: 'btn-link', type: 'button', onclick: closeProfile }, 'Zurück')));
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
      onchange: (event) => act('settings', { [key]: key === 'category' ? event.target.value : Number(event.target.value) }),
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

  const settings = isHost
    ? h('div', { class: 'settings' },
        settingSelect('rounds', 'Runden', 'rounds', numberOptions(view.maxRounds, view.settings.rounds)),
        settingSelect('imposters', 'Imposter', 'imposters', numberOptions(view.maxImposters, imposters)),
        settingSelect('category', 'Kategorie', 'category', [
          h('option', { value: 'alle', selected: view.settings.category === 'alle' }, 'Alle gemischt'),
          ...view.categories.map((c) => h('option', { value: c.id, selected: view.settings.category === c.id }, c.label)),
        ]))
    : h('p', { class: 'settings-readout' },
        'Runden: ', h('b', {}, String(view.settings.rounds)),
        ' · Imposter: ', h('b', {}, String(imposters)),
        ' · Kategorie: ', h('b', {}, categoryLabel));

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

function renderWordLog(round, { showCurrent = false } = {}) {
  return h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Gesagte Wörter'),
    h('ol', { class: 'order' }, round.order.map((id, index) => {
      const player = playerOf(id);
      const isCurrent = showCurrent && id === round.currentId;
      const words = round.words.filter((entry) => entry.playerId === id);
      const classes = ['order-row'];
      if (isCurrent) classes.push('is-current');
      if (player?.left) classes.push('has-left');
      return h('li', { class: classes.join(' '), 'aria-current': isCurrent ? 'true' : null },
        h('span', { class: 'order-number' }, String(index + 1)),
        player ? avatarNode(player.avatar) : h('span'),
        h('div', { class: 'order-main' },
          h('div', { class: 'order-head' },
            h('span', { class: 'order-name' }, nameOf(id)),
            id === view.you.id && h('span', { class: 'tag' }, 'Du'),
            player && !player.online && !player.left && h('span', { class: 'tag' }, 'offline')),
          words.length > 0
            ? h('ul', { class: 'word-chips' }, words.map((entry) => (
                entry.word === null
                  ? h('li', { class: 'word-chip is-skipped', title: `Durchgang ${entry.lap}: übersprungen` }, 'übersprungen')
                  : h('li', { class: 'word-chip', title: `Durchgang ${entry.lap}` }, entry.word)
              )))
            : h('span', { class: 'no-words' }, 'Noch kein Wort')));
    })));
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
      },
    },
      h('span', { class: 'card-face card-back' },
        h('span', { class: 'card-back-mark' }, '?'),
        h('span', { class: 'card-back-text' }, 'Deine Karte aufdecken'),
        h('span', { class: 'card-back-hint' }, 'Pass auf, falls du deinen Bildschirm teilst')),
      h('span', { class: `card-face card-front${isImposter ? ' is-imposter' : ''}` },
        h('span', { class: 'card-front-label' }, isImposter ? 'Pssst …' : 'Dein Wort'),
        h('span', { class: 'card-word', lang: 'de' }, isImposter ? 'Du bist Imposter' : round.card.word),
        h('span', { class: 'card-front-hint' }, isImposter ? 'Hör gut zu und tu so, als wüsstest du das Wort' : 'Tippen zum Verdecken'))));
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
    count === 1 ? ' Imposter ist unter euch' : ' Imposter sind unter euch');
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
    h('section', { class: `speaker${isYourTurn ? ' is-you' : ''}`, 'aria-live': 'polite' },
      h('div', { class: 'panel-title' }, round.isFirstTurn ? 'Per Zufall ausgewählt' : 'Gerade dran'),
      h('div', { class: 'speaker-name' }, isYourTurn
        ? (round.isFirstTurn ? 'Du fängst an!' : 'Du bist dran!')
        : (round.isFirstTurn ? `${current} fängt an` : `${current} ist dran`))),
    isYourTurn && h('section', { class: 'panel' }, renderWordForm(round)),
    renderWordLog(round, { showCurrent: true }),
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
            h('span', { class: 'vote-state' }, isSelf ? 'Du' : isSelected ? 'Deine Stimme' : votedIds.includes(id) ? 'hat abgestimmt' : ''));
        }))
      : h('p', { class: 'notice' }, 'Du schaust in dieser Runde nur zu.'),
    canVote && h('p', { class: 'hint' }, yours
      ? 'Du kannst deine Stimme noch ändern, bis alle abgestimmt haben.'
      : 'Richtig abgestimmt gibt 10 Punkte. Bei Gleichstand gewinnt der Imposter.'),
    view.you.isHost && h('button', {
      class: 'btn btn-wide', key: 'finishVote', onclick: () => act('finishVote'),
    }, 'Jetzt auswerten'),
    renderWordLog(round),
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
  const highest = Math.max(1, ...reveal.tally.map((row) => row.count));
  const isLastRound = view.match.current >= view.match.total;
  const yourGain = reveal.gains.find((g) => g.id === view.you.id);
  document.title = 'Auflösung · Imposter';

  let detail;
  if (reveal.accusedId === null) detail = 'Ihr konntet euch auf niemanden einigen.';
  else if (groupWon) detail = `${nameOf(reveal.accusedId)} wurde enttarnt.`;
  else detail = `Ihr habt ${nameOf(reveal.accusedId)} verdächtigt. Falsch!`;

  gameLayout(`reveal-${round.id}`, [
    gameTopbar('Auflösung'),
    h('section', { class: `verdict${groupWon ? ' group-won' : ''}` },
      h('h1', { class: 'verdict-title' }, groupWon
        ? (youWereImposter ? 'Erwischt!' : 'Die Gruppe gewinnt!')
        : (youWereImposter ? 'Du hast gewonnen!' : (plural ? 'Die Imposter gewinnen!' : 'Der Imposter gewinnt!'))),
      h('p', {}, detail)),
    yourGain && h('section', { class: 'panel' },
      yourGain.points > 0
        ? h('p', { class: 'gain-line' }, `+${yourGain.points} Punkte`,
            h('span', { class: 'hint' }, ` (${[
              yourGain.imposterWon && 'Imposter-Sieg',
              yourGain.correctVote && 'richtige Stimme',
            ].filter(Boolean).join(', ')})`))
        : h('p', { class: 'gain-line is-zero' }, 'Diese Runde keine Punkte für dich.')),
    h('section', { class: 'panel reveal-facts' },
      h('div', { class: 'fact' },
        h('div', { class: 'panel-title' }, 'Das Wort'),
        h('div', { class: 'fact-value' }, reveal.word)),
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
    h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Stimmen'),
      h('div', { class: 'tally' }, reveal.tally.map((row) =>
        h('div', { class: `tally-row${reveal.imposterIds.includes(row.id) ? ' is-imposter' : ''}` },
          h('div', { class: 'tally-head' },
            h('span', {}, nameOf(row.id)),
            h('span', { class: 'tally-count' }, String(row.count))),
          h('div', { class: 'tally-bar' },
            h('span', { class: 'tally-fill', 'data-width': String((row.count / highest) * 100) })),
          row.voters.length > 0 && h('div', { class: 'tally-voters' }, `von ${row.voters.map(nameOf).join(', ')}`))))),
    renderWordLog(round),
    h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen'),
  ], reveal.gains);

  // Die Breite wird per JS gesetzt, weil die Sicherheitsregeln (CSP) Inline-Styles im HTML blockieren.
  for (const bar of appEl.querySelectorAll('.tally-fill')) {
    bar.style.width = `${bar.dataset.width}%`;
  }
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
      h('p', {}, 'Deine Stats sind gespeichert.')),
    h('ol', { class: 'podium panel' }, rows),
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
}

soundToggleEl.addEventListener('click', () => {
  Sound.setMuted(!Sound.isMuted());
  updateSoundToggle();
});

// Dezenter Klick für alle Buttons, die keinen eigenen Sound haben.
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('button');
  if (button && !button.disabled && !button.dataset.silent) Sound.play('click');
});

updateSoundToggle();
if (session?.code && session?.token && profile.name) connect();
else renderHome();
