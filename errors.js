'use strict';

// Fehler, deren Text direkt dem Spieler angezeigt werden darf.
class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

module.exports = { GameError };
