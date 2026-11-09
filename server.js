'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { GameError } = require('./errors');
const { createRoom, getRoom, sweepRooms, updateAvatarInRooms, events } = require('./game');
const { AccountStore } = require('./accounts');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const accounts = new AccountStore(path.join(DATA_DIR, 'imposter.db'));
events.onRound = (entries) => accounts.recordRound(entries);
events.onMatch = (participants, winners) => accounts.recordMatch(participants, winners);
const MAX_BODY_BYTES = 4096;
const HEARTBEAT_MS = 20_000;
const SWEEP_MS = 5 * 60_000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/avatar.js': ['avatar.js', 'text/javascript; charset=utf-8'],
  '/sounds.js': ['sounds.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new GameError('Anfrage zu groß.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('not an object');
        }
        resolve(data);
      } catch {
        reject(new GameError('Ungültige Anfrage.'));
      }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function requireAccount(req) {
  const account = accounts.authenticate(bearerToken(req));
  if (!account) throw new GameError('Bitte melde dich an.', 401);
  return account;
}

// Hinter dem Cloudflare Tunnel steht die echte Adresse des Besuchers in diesem Header.
function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unbekannt';
}

function authenticatePlayer(code, token) {
  const room = getRoom(code);
  const player = room.findByToken(token);
  if (!player) throw new GameError('Du bist nicht in diesem Raum.', 403);
  return { room, player };
}

function openEventStream(req, res, url) {
  const { room, player } = authenticatePlayer(url.searchParams.get('code'), url.searchParams.get('token'));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...SECURITY_HEADERS,
  });

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const conn = {
    send(view) {
      res.write(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
    },
    replaced() {
      res.write('event: replaced\ndata: {}\n\n');
    },
  };

  req.on('close', () => {
    clearInterval(heartbeat);
    room.detach(player, conn);
  });
  room.attach(player, conn);
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/events') {
    openEventStream(req, res, url);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/me') {
    sendJson(res, 200, { account: accounts.publicAccount(requireAccount(req)) });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    sendJson(res, 200, { leaderboard: accounts.leaderboard() });
    return;
  }
  if (req.method !== 'POST') throw new GameError('Nicht gefunden.', 404);

  const body = await readJson(req);
  switch (url.pathname) {
    case '/api/register': {
      const { token, account } = await accounts.register(body.username, body.password, body.avatar, clientIp(req));
      sendJson(res, 201, { token, account: accounts.publicAccount(account) });
      return;
    }
    case '/api/login': {
      const { token, account } = await accounts.login(body.username, body.password);
      sendJson(res, 200, { token, account: accounts.publicAccount(account) });
      return;
    }
    case '/api/logout': {
      accounts.logout(bearerToken(req));
      sendJson(res, 200, { ok: true });
      return;
    }
    case '/api/avatar': {
      const account = requireAccount(req);
      accounts.setAvatar(account, body.avatar);
      updateAvatarInRooms(account.id, account.avatar);
      sendJson(res, 200, { account: accounts.publicAccount(account) });
      return;
    }
    case '/api/password': {
      const account = requireAccount(req);
      await accounts.changePassword(account, body.oldPassword, body.newPassword);
      // Alle Anmeldungen wurden beendet, dieses Gerät bekommt sofort eine neue.
      sendJson(res, 200, { token: accounts.createSession(account.id) });
      return;
    }
    case '/api/create': {
      const { room, player } = createRoom(requireAccount(req));
      sendJson(res, 201, { code: room.code, token: player.token });
      return;
    }
    case '/api/join': {
      const account = requireAccount(req);
      const room = getRoom(body.code);
      const player = room.addPlayer(account);
      sendJson(res, 200, { code: room.code, token: player.token });
      return;
    }
    case '/api/check': {
      authenticatePlayer(body.code, body.token);
      sendJson(res, 200, { ok: true });
      return;
    }
    case '/api/action': {
      const { room, player } = authenticatePlayer(body.code, body.token);
      const { code: _code, token: _token, ...action } = body;
      room.handleAction(player, action);
      sendJson(res, 200, { ok: true });
      return;
    }
    default:
      throw new GameError('Nicht gefunden.', 404);
  }
}

function serveStatic(req, res, url) {
  const file = Object.hasOwn(STATIC_FILES, url.pathname) ? STATIC_FILES[url.pathname] : null;
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
    return;
  }
  fs.readFile(path.join(PUBLIC_DIR, file[0]), (error, content) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Serverfehler');
      return;
    }
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  if (url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!url.pathname.startsWith('/api/')) {
    serveStatic(req, res, url);
    return;
  }

  try {
    await handleApi(req, res, url);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof GameError) {
      sendJson(res, error.status, { error: error.message });
    } else {
      console.error(error);
      sendJson(res, 500, { error: 'Da ist etwas schiefgelaufen.' });
    }
  }
});

setInterval(sweepRooms, SWEEP_MS).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    accounts.close();
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`Imposter läuft auf http://localhost:${PORT} (Daten in ${DATA_DIR})`);
});
