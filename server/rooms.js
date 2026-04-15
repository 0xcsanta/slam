// Gestion des rooms SLAM (en mémoire, aucune BDD).
// Une room = une partie privée identifiée par un code court.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;      // 2h après création
const FINISHED_TTL_MS = 30 * 60 * 1000;      // 30 min après fin
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;   // passe toutes les 5 min

const rooms = new Map();        // code -> room
const socketToCode = new Map(); // socketId -> code

function generateCode() {
  let code;
  do {
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    code = `SLAM-${suffix}`;
  } while (rooms.has(code));
  return code;
}

function createRoom(pseudo, nbJoueursMax, socketId) {
  const code = generateCode();
  const room = {
    code,
    status: 'lobby', // lobby | manche1 | manche2 | finale | termine
    nbJoueursMax,
    createur: pseudo,
    joueurs: [{ pseudo, socketId, score: 0, elimine: false, connected: true }],
    // état de la manche courante
    manche: 0,
    grille: null,                // {theme, mots:[{id,mot,definition,trouve,par,grise}]}
    lettresRevelees: new Set(),
    lettresPerdues: new Set(),
    question: null,              // {id, texte, lettre, blockedPlayers:Set, currentPlayer, wordId, wordGivenAt}
    questionsRestantes: [],
    chronoTimeout: null,
    // finale
    finale: null,                // {theme, mots:[...], lettres8, lettresChoisies, chronoEnd, scoreFinale, mots_trouves}
    finalSecondsInterval: null,
    // méta
    createdAt: Date.now(),
    finishedAt: null,
  };
  rooms.set(code, room);
  socketToCode.set(socketId, code);
  return room;
}

function getRoomByCode(code) {
  return rooms.get((code || '').toUpperCase());
}

function getRoomBySocket(socketId) {
  const code = socketToCode.get(socketId);
  return code ? rooms.get(code) : null;
}

function joinRoom(code, pseudo, socketId) {
  const room = getRoomByCode(code);
  if (!room) return { error: 'Code introuvable.' };
  // reconnexion : si un joueur avec même pseudo existe et est déconnecté → remplace son socketId
  const existing = room.joueurs.find((j) => j.pseudo === pseudo);
  if (existing) {
    if (existing.connected) return { error: 'Ce pseudo est déjà pris dans cette partie.' };
    existing.socketId = socketId;
    existing.connected = true;
    socketToCode.set(socketId, code);
    return { room, reconnected: true, joueur: existing };
  }
  if (room.status !== 'lobby') return { error: 'Partie déjà lancée.' };
  if (room.joueurs.length >= room.nbJoueursMax) return { error: 'Partie pleine.' };
  const joueur = { pseudo, socketId, score: 0, elimine: false, connected: true };
  room.joueurs.push(joueur);
  socketToCode.set(socketId, code);
  return { room, joueur };
}

function markDisconnected(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) return null;
  const joueur = room.joueurs.find((j) => j.socketId === socketId);
  if (!joueur) return null;
  joueur.connected = false;
  // en lobby : retire carrément
  if (room.status === 'lobby') {
    room.joueurs = room.joueurs.filter((j) => j.socketId !== socketId);
    if (room.joueurs.length === 0) {
      rooms.delete(room.code);
    } else if (joueur.pseudo === room.createur) {
      room.createur = room.joueurs[0].pseudo;
    }
  }
  socketToCode.delete(socketId);
  return { room, joueur };
}

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const j of room.joueurs) socketToCode.delete(j.socketId);
  if (room.chronoTimeout) clearTimeout(room.chronoTimeout);
  if (room.finalSecondsInterval) clearInterval(room.finalSecondsInterval);
  rooms.delete(code);
}

// Nettoyage périodique des rooms expirées
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const born = room.createdAt;
    const fin = room.finishedAt;
    if (now - born > ROOM_TTL_MS) deleteRoom(code);
    else if (fin && now - fin > FINISHED_TTL_MS) deleteRoom(code);
  }
}, CLEANUP_INTERVAL_MS).unref?.();

module.exports = {
  createRoom, joinRoom, getRoomByCode, getRoomBySocket,
  markDisconnected, deleteRoom, rooms,
};
