'use strict';

const appEl = document.getElementById('app');
const bannerEl = document.getElementById('banner');
const toastEl = document.getElementById('toast');
const RECONNECT_DELAY_MS = 2000;

let session = loadSession();   // { code, token }
let view = null;               // Letzter Spielstand vom Server
let source = null;             // EventSource
let cardRevealedFor = null;    // ID der Runde, deren Karte aufgedeckt ist
let lastScreen = null;
let landingMessage = null;
let showCreateInstead = false;
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
  try { return JSON.parse(storageGet(sessionStorage, 'imposter-session')); } catch { return null; }
}
function saveSession(value) {
  session = value;
  storageSet(sessionStorage, 'imposter-session', value ? JSON.stringify(value) : null);
}

// --- DOM-Helfer -------------------------------------------------------------

// Baut Elemente immer über textContent auf, damit Spielernamen kein HTML einschleusen können.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'key') el.dataset.key = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else if (key === 'disabled' || key === 'selected' || key === 'required' || key === 'hidden') el[key] = Boolean(value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

function setBanner(message) {
  bannerEl.textContent = message ?? '';
  bannerEl.hidden = !message;
}

// --- Server -----------------------------------------------------------------

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

async function act(type, payload = {}) {
  try {
    await post('/api/action', { code: session.code, token: session.token, type, ...payload });
  } catch (error) {
    toast(error.message);
  }
}

function connect() {
  closeSource();
  const params = new URLSearchParams({ code: session.code, token: session.token });
  source = new EventSource(`/api/events?${params}`);

  source.addEventListener('state', (event) => {
    setBanner(null);
    view = JSON.parse(event.data);
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
      resetToLanding('Dieser Raum existiert nicht mehr. Erstellt einfach einen neuen.');
    } else {
      setTimeout(recoverConnection, RECONNECT_DELAY_MS);
    }
  }
}

function closeSource() {
  if (source) source.close();
  source = null;
}

function resetToLanding(message = null) {
  closeSource();
  saveSession(null);
  view = null;
  landingMessage = message;
  setBanner(null);
  document.title = 'Imposter';
  history.replaceState(null, '', '/');
  renderLanding();
}

async function leaveRoom() {
  await post('/api/action', { code: session.code, token: session.token, type: 'leave' }).catch(() => {});
  resetToLanding();
}

// --- Rendering --------------------------------------------------------------

// Bei jedem Update wird neu gezeichnet. Fokus und Einblend-Animation bleiben
// dabei erhalten, damit die Seite nicht bei jedem Klick eines Mitspielers springt.
function mount(screenKey, node) {
  const focusedKey = document.activeElement?.dataset?.key;
  const isNewScreen = screenKey !== lastScreen;
  lastScreen = screenKey;
  if (isNewScreen) {
    node.classList.add('enter');
    window.scrollTo(0, 0);
  }
  appEl.replaceChildren(node);
  if (focusedKey) appEl.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
}

function nameOf(id) {
  return view.players.find((p) => p.id === id)?.name ?? 'Unbekannt';
}
function playerOf(id) {
  return view.players.find((p) => p.id === id);
}

function render() {
  switch (view.phase) {
    case 'lobby': renderLobby(); break;
    case 'play': renderPlay(); break;
    case 'vote': renderVote(); break;
    case 'reveal': renderReveal(); break;
  }
}

function topbar(meta) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-brand' }, 'Impos', h('span', {}, 'ter')),
    h('div', { class: 'topbar-meta' }, meta));
}

// --- Startseite ---------------------------------------------------------------

function renderLanding() {
  document.title = 'Imposter';
  const inviteCode = new URLSearchParams(location.search).get('r')?.toUpperCase() ?? '';
  const invited = Boolean(inviteCode) && !showCreateInstead;

  const nameInput = h('input', {
    id: 'name', maxlength: 20, autocomplete: 'nickname', placeholder: 'Wie sollen dich alle nennen?',
    value: storageGet(localStorage, 'imposter-name') ?? '',
  });
  const codeInput = h('input', {
    id: 'code', class: 'code-input', maxlength: 4, autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', placeholder: 'ABCD', value: inviteCode,
  });

  const submit = (path, withCode) => async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      toast('Bitte gib einen Namen ein.');
      nameInput.focus();
      return;
    }
    if (withCode && codeInput.value.trim().length !== 4) {
      toast('Der Raumcode hat 4 Buchstaben.');
      codeInput.focus();
      return;
    }
    storageSet(localStorage, 'imposter-name', name);
    try {
      const body = withCode ? { name, code: codeInput.value } : { name };
      const { code, token } = await post(path, body);
      saveSession({ code, token });
      landingMessage = null;
      history.replaceState(null, '', `/?r=${code}`);
      connect();
    } catch (error) {
      toast(error.message);
    }
  };

  const join = h('form', { class: 'join-row', onsubmit: submit('/api/join', true) },
    h('div', { class: 'field' }, h('label', { for: 'code' }, 'Raumcode'), codeInput),
    h('button', { class: invited ? 'btn btn-primary' : 'btn', type: 'submit' }, 'Beitreten'));

  const create = h('button', {
    class: 'btn btn-primary btn-wide', type: 'button', onclick: submit('/api/create', false),
  }, 'Neuen Raum erstellen');

  mount('landing', h('div', { class: 'screen' },
    h('section', { class: 'hero' },
      h('h1', { class: 'wordmark' }, 'Impos', h('span', {}, 'ter')),
      h('p', { class: 'tagline' }, 'Alle bekommen dasselbe Wort, nur einer nicht. Sagt reihum ein Wort dazu und findet heraus, wer blufft.')),
    landingMessage && h('p', { class: 'notice' }, landingMessage),
    h('section', { class: 'panel' },
      h('div', { class: 'field' }, h('label', { for: 'name' }, 'Dein Name'), nameInput),
      invited
        ? [join, h('button', {
            class: 'btn-link', type: 'button',
            onclick: () => { showCreateInstead = true; renderLanding(); },
          }, 'Stattdessen einen neuen Raum erstellen')]
        : [create, h('div', { class: 'divider' }, 'oder einem Raum beitreten'), join])));
}

function renderReplaced() {
  setBanner(null);
  document.title = 'Imposter';
  mount('replaced', h('div', { class: 'screen' },
    h('section', { class: 'hero' }, h('h1', { class: 'wordmark' }, 'Impos', h('span', {}, 'ter'))),
    h('section', { class: 'panel' },
      h('p', {}, 'Du spielst jetzt in einem anderen Tab weiter.'),
      h('button', { class: 'btn btn-primary btn-wide', onclick: connect }, 'Stattdessen hier weiterspielen'))));
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

function renderLobby() {
  document.title = `Raum ${view.code} · Imposter`;
  const isHost = view.you.isHost;
  const present = view.players.filter((p) => !p.left);
  const missing = view.minPlayers - view.onlineCount;
  const imposters = Math.min(view.settings.imposters, view.maxImposters);
  const categoryLabel = view.settings.category === 'alle'
    ? 'Alle gemischt'
    : view.categories.find((c) => c.id === view.settings.category)?.label;

  const settings = isHost
    ? h('div', { class: 'settings' },
        h('div', { class: 'field' },
          h('label', { for: 'category' }, 'Kategorie'),
          h('select', {
            id: 'category', key: 'category',
            onchange: (event) => act('settings', { category: event.target.value }),
          },
            h('option', { value: 'alle', selected: view.settings.category === 'alle' }, 'Alle gemischt'),
            view.categories.map((c) => h('option', { value: c.id, selected: view.settings.category === c.id }, c.label)))),
        h('div', { class: 'field' },
          h('label', { for: 'imposters' }, 'Imposter'),
          h('select', {
            id: 'imposters', key: 'imposters',
            onchange: (event) => act('settings', { imposters: Number(event.target.value) }),
          },
            Array.from({ length: view.maxImposters }, (_, i) => i + 1).map((n) =>
              h('option', { value: n, selected: imposters === n }, String(n))))))
    : h('p', { class: 'settings-readout' },
        'Kategorie: ', h('b', {}, categoryLabel), ' · Imposter: ', h('b', {}, String(imposters)));

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
          h('span', { class: 'dot' }),
          h('span', { class: 'player-name' }, p.name),
          p.id === view.you.id && h('span', { class: 'tag' }, 'Du'),
          p.id === view.hostId && h('span', { class: 'tag tag-host' }, 'Host')))),
      settings),
    h('div', { class: 'actions' },
      isHost
        ? h('button', {
            class: 'btn btn-primary btn-wide', key: 'start', disabled: missing > 0,
            onclick: () => act('start'),
          }, missing > 0 ? `Noch ${missing} Spieler ${missing === 1 ? 'fehlt' : 'fehlen'}` : 'Spiel starten')
        : h('p', { class: 'hint' }, missing > 0
            ? `Es ${missing === 1 ? 'fehlt' : 'fehlen'} noch ${missing} Spieler. Schick den Link in euren Discord.`
            : `Warte, bis ${nameOf(view.hostId)} das Spiel startet.`),
      h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen'))));
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

function renderPlay() {
  const round = view.round;
  const isHost = view.you.isHost;
  const isYourTurn = round.currentId === view.you.id;
  const current = nameOf(round.currentId);
  document.title = isYourTurn ? '▶ Du bist dran! · Imposter' : `${current} ist dran · Imposter`;

  mount(`play-${round.id}`, h('div', { class: 'screen' },
    topbar(`Durchgang ${round.lap}`),
    round.card
      ? renderCard(round)
      : h('p', { class: 'notice' }, 'Du bist mitten in der Runde dazugekommen und spielst ab der nächsten mit.'),
    h('section', { class: `speaker${isYourTurn ? ' is-you' : ''}`, 'aria-live': 'polite' },
      h('div', { class: 'panel-title' }, round.isFirstTurn ? 'Per Zufall ausgewählt' : 'Gerade dran'),
      h('div', { class: 'speaker-name' }, isYourTurn
        ? (round.isFirstTurn ? 'Du fängst an!' : 'Du bist dran!')
        : (round.isFirstTurn ? `${current} fängt an` : `${current} ist dran`))),
    (isYourTurn || isHost) && h('button', {
      class: isYourTurn ? 'btn btn-primary btn-wide' : 'btn btn-wide',
      key: 'next',
      onclick: () => act('next', { turn: round.turn }),
    }, isYourTurn ? 'Wort gesagt, weiter' : `${current} überspringen`),
    h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Reihenfolge'),
      h('ol', { class: 'order' }, round.order.map((id) => {
        const player = playerOf(id);
        return h('li', {
          class: `${id === round.currentId ? 'is-current' : ''}${player?.left ? ' has-left' : ''}`,
          'aria-current': id === round.currentId ? 'true' : undefined,
        },
          h('span', { class: 'order-name' }, nameOf(id)),
          id === view.you.id && h('span', { class: 'tag' }, 'Du'),
          player && !player.online && !player.left && h('span', { class: 'tag' }, 'offline'));
      }))),
    isHost
      ? h('div', { class: 'actions-row' },
          h('button', { class: 'btn btn-primary', key: 'startVote', onclick: () => act('startVote') }, 'Abstimmung starten'),
          h('button', { class: 'btn', key: 'abort', onclick: () => act('lobby') }, 'Runde abbrechen'))
      : h('p', { class: 'hint' }, `${nameOf(view.hostId)} startet die Abstimmung, sobald ihr bereit seid.`),
    h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen')));
}

// --- Abstimmung ---------------------------------------------------------------

function renderVote() {
  const round = view.round;
  const { candidates, votedIds, yours } = round.vote;
  const canVote = candidates.includes(view.you.id);
  document.title = 'Abstimmung · Imposter';

  mount(`vote-${round.id}`, h('div', { class: 'screen' },
    topbar(`${votedIds.length} von ${candidates.length} abgestimmt`),
    h('section', { class: 'speaker' },
      h('div', { class: 'panel-title' }, 'Abstimmung'),
      h('h1', { class: 'speaker-name' }, round.imposterCount > 1 ? 'Wer sind die Imposter?' : 'Wer ist Imposter?')),
    round.card?.type === 'word' && h('p', { class: 'hint' }, 'Euer Wort: ', h('b', {}, round.card.word)),
    canVote
      ? h('div', { class: 'vote-list' }, candidates.map((id) => {
          const isSelf = id === view.you.id;
          const isSelected = yours === id;
          return h('button', {
            class: `vote-option${isSelected ? ' is-selected' : ''}`,
            key: `vote-${id}`,
            disabled: isSelf,
            'aria-pressed': String(isSelected),
            onclick: () => act('vote', { target: id }),
          },
            h('span', {}, nameOf(id)),
            h('span', { class: 'vote-state' }, isSelf ? 'Du' : isSelected ? 'Deine Stimme' : votedIds.includes(id) ? 'hat abgestimmt' : ''));
        }))
      : h('p', { class: 'notice' }, 'Du schaust in dieser Runde nur zu.'),
    canVote && h('p', { class: 'hint' }, yours
      ? 'Du kannst deine Stimme noch ändern, bis alle abgestimmt haben.'
      : 'Bei Gleichstand gewinnt der Imposter.'),
    view.you.isHost && h('button', {
      class: 'btn btn-wide', key: 'finishVote', onclick: () => act('finishVote'),
    }, 'Jetzt auswerten')));
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
  document.title = 'Auflösung · Imposter';

  let detail;
  if (reveal.accusedId === null) detail = 'Ihr konntet euch auf niemanden einigen.';
  else if (groupWon) detail = `${nameOf(reveal.accusedId)} wurde enttarnt.`;
  else detail = `Ihr habt ${nameOf(reveal.accusedId)} verdächtigt. Falsch!`;

  mount(`reveal-${round.id}`, h('div', { class: 'screen' },
    topbar('Auflösung'),
    h('section', { class: `verdict${groupWon ? ' group-won' : ''}` },
      h('h1', { class: 'verdict-title' }, groupWon
        ? (youWereImposter ? 'Erwischt!' : 'Die Gruppe gewinnt!')
        : (youWereImposter ? 'Du hast gewonnen!' : (plural ? 'Die Imposter gewinnen!' : 'Der Imposter gewinnt!'))),
      h('p', {}, detail)),
    h('section', { class: 'panel reveal-facts' },
      h('div', { class: 'fact' },
        h('div', { class: 'panel-title' }, 'Das Wort'),
        h('div', { class: 'fact-value' }, reveal.word)),
      h('div', { class: 'fact' },
        h('div', { class: 'panel-title' }, plural ? 'Die Imposter' : 'Imposter'),
        h('div', { class: 'fact-value' }, imposterNames))),
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
    view.you.isHost
      ? h('div', { class: 'actions-row' },
          h('button', { class: 'btn btn-primary', key: 'again', onclick: () => act('start') }, 'Neue Runde'),
          h('button', { class: 'btn', key: 'toLobby', onclick: () => act('lobby') }, 'Zurück zur Lobby'))
      : h('p', { class: 'hint' }, `${nameOf(view.hostId)} startet die nächste Runde.`),
    h('button', { class: 'btn-link', onclick: leaveRoom }, 'Raum verlassen')));

  // Die Breite wird per JS gesetzt, weil die Sicherheitsregeln (CSP) Inline-Styles im HTML blockieren.
  for (const bar of appEl.querySelectorAll('.tally-fill')) {
    bar.style.width = `${bar.dataset.width}%`;
  }
}

// --- Start ----------------------------------------------------------------------

if (session?.code && session?.token) {
  connect();
} else {
  renderLanding();
}
