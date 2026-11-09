'use strict';

// Kleine Hilfe für den Server, z. B. wenn jemand sein Passwort vergessen hat:
//   node admin.js passwort <name> <neues-passwort>
//   node admin.js konten
const path = require('node:path');
const { AccountStore } = require('./accounts');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const store = new AccountStore(path.join(DATA_DIR, 'imposter.db'));
const [command, name, password] = process.argv.slice(2);

async function main() {
  if (command === 'passwort' && name && password) {
    const account = store.findByUsername(name);
    if (!account) throw new Error(`Kein Konto mit dem Namen ${name}.`);
    await store.setPassword(account.id, password);
    console.log(`Passwort von ${account.username} geändert. Alle Anmeldungen wurden abgemeldet.`);
  } else if (command === 'konten') {
    const rows = store.db.prepare('SELECT username, created_at FROM accounts ORDER BY created_at').all();
    for (const row of rows) console.log(`${row.username}  (seit ${new Date(row.created_at).toLocaleDateString('de-DE')})`);
    console.log(`${rows.length} Konten`);
  } else {
    console.log('Benutzung:\n  node admin.js passwort <name> <neues-passwort>\n  node admin.js konten');
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => store.close());
