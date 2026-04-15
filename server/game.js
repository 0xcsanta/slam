// Moteur de jeu SLAM : manches, SLAM, finale.
// Toute la validation est côté serveur (anti-triche).

const fs = require('fs');
const path = require('path');
const rooms = require('./rooms');

// Chargement des données au démarrage
const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'questions.json'), 'utf8'));
const MANCHES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manches.json'), 'utf8'));
const FINALES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'finales.json'), 'utf8'));

const WORD_CHRONO_MS = 10_000;
const LETTER_CHRONO_MS = 10_000;
const FINALE_CHRONO_S = 60;
const RECONNECT_GRACE_MS = 30_000;

// ------------ Utilitaires ------------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(s) {
  return (s || '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
    .toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function activePlayers(room) {
  return room.joueurs.filter((j) => !j.elimine);
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    manche: room.manche,
    nbJoueursMax: room.nbJoueursMax,
    createur: room.createur,
    joueurs: room.joueurs.map((j) => ({
      pseudo: j.pseudo, score: j.score, elimine: j.elimine, connected: j.connected,
    })),
  };
}

function publicGrille(room) {
  if (!room.grille) return null;
  const rev = room.lettresRevelees;
  const g = room.grille;
  return {
    theme: g.theme,
    rows: g.rows,
    cols: g.cols,
    mots: g.mots.map((m) => ({
      id: m.id,
      longueur: m.mot.length,
      r: m.r, c: m.c, dir: m.dir,
      // toujours envoyer la définition pour l'affichage de la liste
      definition: m.definition,
      lettres: m.mot.split('').map((c) => {
        const up = c.toUpperCase();
        const keep = rev.has(up) || m.trouve || m.grise;
        return keep ? up : null;
      }),
      trouve: m.trouve,
      grise: m.grise,
      par: m.par || null,
    })),
    lettresRevelees: Array.from(room.lettresRevelees),
    lettresPerdues: Array.from(room.lettresPerdues),
  };
}

function publicQuestion(room) {
  const q = room.question;
  if (!q) return null;
  return {
    id: q.id,
    texte: q.texte,
    currentPlayer: q.currentPlayer ? pseudoOfSocket(room, q.currentPlayer) : null,
    phase: q.phase, // 'buzz' | 'letter' | 'word'
    wordId: q.wordId ?? null,
    wordDefinition: q.wordId != null ? room.grille.mots[q.wordId].definition : null,
  };
}

function pseudoOfSocket(room, socketId) {
  const j = room.joueurs.find((x) => x.socketId === socketId);
  return j ? j.pseudo : null;
}

function emitAll(io, room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function broadcastState(io, room) {
  emitAll(io, room, 'state', {
    room: publicRoom(room),
    grille: publicGrille(room),
    question: publicQuestion(room),
  });
}

// ------------ Lancement partie ------------
function startGame(io, room) {
  room.status = 'manche1';
  room.manche = 1;
  setupManche(room, 1);
  emitAll(io, room, 'game_starting', { manche: 1 });
  broadcastState(io, room);
  nextQuestion(io, room);
}

function setupManche(room, numManche) {
  // tailles selon guide §2
  const n = room.nbJoueursMax;
  let taille;
  if (numManche === 1) taille = n === 3 ? 10 : 8;
  else taille = n === 3 ? 12 : 10;

  const pool = MANCHES[String(taille)] || [];
  const grille = shuffle(pool)[0];
  room.grille = {
    theme: grille.theme,
    rows: grille.rows,
    cols: grille.cols,
    mots: grille.mots.map((m, id) => ({
      id, mot: normalize(m.mot), definition: m.definition,
      r: m.r, c: m.c, dir: m.dir,
      trouve: false, par: null, grise: false,
    })),
  };
  room.lettresRevelees = new Set();
  room.lettresPerdues = new Set();
  // On filtre les questions : seulement celles dont la lettre est présente dans la grille,
  // pour qu'une bonne réponse révèle TOUJOURS au moins une case.
  const lettresGrille = new Set();
  for (const m of room.grille.mots) for (const c of m.mot) lettresGrille.add(c);
  const utilisables = QUESTIONS.filter((q) => lettresGrille.has(q.lettre.toUpperCase()));
  // marge généreuse : 3x le nombre de mots (questions répétables non, mais variabilité)
  const need = Math.max(taille * 3, 12);
  room.questionsRestantes = shuffle(utilisables).slice(0, need);
  room.question = null;
  room._mancheEnded = false;
  if (room.chronoTimeout) { clearTimeout(room.chronoTimeout); room.chronoTimeout = null; }
}

// ------------ Boucle de jeu ------------
function nextQuestion(io, room) {
  if (room.chronoTimeout) { clearTimeout(room.chronoTimeout); room.chronoTimeout = null; }
  // plus de mots à trouver → manche finie
  const motsRestants = room.grille.mots.filter((m) => !m.trouve && !m.grise);
  if (motsRestants.length === 0) return endManche(io, room, 'complete');
  // plus de questions → fin (mais SLAM encore possible)
  if (room.questionsRestantes.length === 0) {
    emitAll(io, room, 'questions_exhausted', {});
    return;
  }
  const q = room.questionsRestantes.shift();
  room.question = {
    id: q.id, texte: q.texte, lettre: q.lettre.toUpperCase(), indice: q.indice,
    blockedPlayers: new Set(),
    currentPlayer: null, wordId: null, wordGivenAt: 0,
    phase: activePlayers(room).length === 1 ? 'letter' : 'buzz',
  };
  // en solo : le joueur a directement la main
  if (room.question.phase === 'letter') {
    const sole = activePlayers(room)[0];
    room.question.currentPlayer = sole.socketId;
    startLetterChrono(io, room);
  }
  emitAll(io, room, 'new_question', { id: q.id, texte: q.texte });
  broadcastState(io, room);
}

function startLetterChrono(io, room) {
  if (room.chronoTimeout) clearTimeout(room.chronoTimeout);
  emitAll(io, room, 'chrono_start', { phase: 'letter', seconds: LETTER_CHRONO_MS / 1000 });
  room.chronoTimeout = setTimeout(() => onLetterTimeout(io, room), LETTER_CHRONO_MS);
}

function onLetterTimeout(io, room) {
  if (!room.question) return;
  const current = room.question.currentPlayer;
  if (current) room.question.blockedPlayers.add(current);
  room.question.currentPlayer = null;
  tryReopenOrLose(io, room);
}

function tryReopenOrLose(io, room) {
  const remaining = activePlayers(room).filter(
    (j) => !room.question.blockedPlayers.has(j.socketId),
  );
  if (remaining.length === 0) {
    // lettre perdue
    room.lettresPerdues.add(room.question.lettre);
    emitAll(io, room, 'letter_lost', { lettre: room.question.lettre, indice: room.question.indice });
    room.question = null;
    broadcastState(io, room);
    setTimeout(() => nextQuestion(io, room), 1500);
  } else if (remaining.length === 1 && room.nbJoueursMax >= 2) {
    // un seul joueur restant : il a la main sans chrono (guide M2, on le fait dès M1)
    room.question.currentPlayer = remaining[0].socketId;
    room.question.phase = 'letter';
    emitAll(io, room, 'free_hand', { joueur: remaining[0].pseudo });
    broadcastState(io, room);
  } else {
    room.question.phase = 'buzz';
    emitAll(io, room, 'buzz_reopened', {});
    broadcastState(io, room);
  }
}

// ------------ Buzz & réponse lettre ------------
function handleBuzz(io, room, socketId) {
  const q = room.question;
  if (!q || q.phase !== 'buzz') return;
  if (q.currentPlayer) return;
  if (q.blockedPlayers.has(socketId)) return;
  const j = room.joueurs.find((x) => x.socketId === socketId);
  if (!j || j.elimine) return;
  q.currentPlayer = socketId;
  q.phase = 'letter';
  emitAll(io, room, 'buzz_result', { joueur: j.pseudo });
  startLetterChrono(io, room);
  broadcastState(io, room);
}

function handleAnswerLetter(io, room, socketId, lettre) {
  const q = room.question;
  if (!q || q.currentPlayer !== socketId) return;
  if (q.phase !== 'letter') return;
  if (room.chronoTimeout) { clearTimeout(room.chronoTimeout); room.chronoTimeout = null; }
  const guess = normalize(lettre).charAt(0);
  if (!guess) return;
  const j = room.joueurs.find((x) => x.socketId === socketId);
  const correct = guess === q.lettre;
  if (correct) {
    room.lettresRevelees.add(q.lettre);
    emitAll(io, room, 'letter_revealed', { lettre: q.lettre, joueur: j.pseudo });
    // propose les mots contenant cette lettre
    const choices = room.grille.mots
      .filter((m) => !m.trouve && !m.grise && m.mot.includes(q.lettre))
      .map((m) => ({ id: m.id, longueur: m.mot.length }));
    if (choices.length === 0) {
      // aucune parole à choisir : passe à la suite
      room.question = null;
      broadcastState(io, room);
      return setTimeout(() => nextQuestion(io, room), 1200);
    }
    q.phase = 'word_choice';
    emitAll(io, room, 'choose_word_prompt', { joueur: j.pseudo, choices });
    broadcastState(io, room);
  } else {
    q.blockedPlayers.add(socketId);
    q.currentPlayer = null;
    emitAll(io, room, 'letter_wrong', { joueur: j.pseudo, guess });
    tryReopenOrLose(io, room);
  }
}

// ------------ Choix du mot & réponse ------------
function handleChooseWord(io, room, socketId, motId) {
  const q = room.question;
  if (!q || q.phase !== 'word_choice' || q.currentPlayer !== socketId) return;
  const m = room.grille.mots[motId];
  if (!m || m.trouve || m.grise) return;
  if (!m.mot.includes(q.lettre)) return;
  q.wordId = motId;
  q.phase = 'word';
  q.wordGivenAt = Date.now();
  emitAll(io, room, 'word_prompt', {
    motId, definition: m.definition, chrono: WORD_CHRONO_MS / 1000,
  });
  room.chronoTimeout = setTimeout(() => onWordTimeout(io, room), WORD_CHRONO_MS);
  broadcastState(io, room);
}

function onWordTimeout(io, room) {
  const q = room.question;
  if (!q || q.wordId == null) return;
  const m = room.grille.mots[q.wordId];
  // Règle SLAM TV : le mot raté reste découvrable, on ne révèle rien.
  emitAll(io, room, 'word_failed', { motId: m.id, raison: 'timeout' });
  room.question = null;
  broadcastState(io, room);
  setTimeout(() => nextQuestion(io, room), 1500);
}

function handleAnswerWord(io, room, socketId, reponse) {
  const q = room.question;
  if (!q || q.phase !== 'word' || q.currentPlayer !== socketId) return;
  if (room.chronoTimeout) { clearTimeout(room.chronoTimeout); room.chronoTimeout = null; }
  const m = room.grille.mots[q.wordId];
  if (!m || m.trouve || m.grise) return;
  const j = room.joueurs.find((x) => x.socketId === socketId);
  const guess = normalize(reponse);
  if (guess === m.mot) {
    m.trouve = true;
    m.par = j.pseudo;
    // révèle toutes les lettres de ce mot
    for (const c of m.mot) room.lettresRevelees.add(c);
    const points = m.mot.length;
    j.score += points;
    emitAll(io, room, 'word_found', {
      motId: m.id, mot: m.mot, joueur: j.pseudo, points, score: j.score,
    });
  } else {
    // Mauvaise réponse : on NE révèle PAS le mot. Il reste disponible.
    emitAll(io, room, 'word_failed', {
      motId: m.id, raison: 'wrong', joueur: j.pseudo,
    });
  }
  room.question = null;
  broadcastState(io, room);
  setTimeout(() => nextQuestion(io, room), 1500);
}

// ------------ SLAM ------------
function handleSlamStart(io, room, socketId) {
  if (!['manche1', 'manche2'].includes(room.status)) return;
  const j = room.joueurs.find((x) => x.socketId === socketId);
  if (!j || j.elimine) return;
  // on annule la question en cours
  if (room.chronoTimeout) { clearTimeout(room.chronoTimeout); room.chronoTimeout = null; }
  room.question = null;
  const remaining = room.grille.mots.filter((m) => !m.trouve && !m.grise);
  emitAll(io, room, 'slam_attempt', {
    joueur: j.pseudo,
    mots: remaining.map((m) => ({ id: m.id, longueur: m.mot.length })),
  });
  room._slamPlayer = socketId;
  broadcastState(io, room);
}

function handleSlamAnswers(io, room, socketId, reponses) {
  if (room._slamPlayer !== socketId) return;
  const j = room.joueurs.find((x) => x.socketId === socketId);
  if (!j) return;
  const remaining = room.grille.mots.filter((m) => !m.trouve && !m.grise);
  let reussi = true;
  const detail = [];
  for (const m of remaining) {
    const answer = normalize(reponses[m.id]);
    const ok = answer === m.mot;
    detail.push({ motId: m.id, mot: m.mot, ok });
    if (!ok) reussi = false;
  }
  const pointsRestants = remaining.reduce((s, m) => s + m.mot.length, 0);

  if (reussi) {
    for (const m of remaining) { m.trouve = true; m.par = j.pseudo; }
    j.score += pointsRestants;
    emitAll(io, room, 'slam_result', {
      joueur: j.pseudo, reussi: true, points: pointsRestants, detail,
    });
  } else {
    // marque les mots ratés comme grisés
    for (const d of detail) {
      const m = room.grille.mots[d.motId];
      if (!d.ok) m.grise = true;
    }
    // Répartition des points selon mode :
    const adversaires = activePlayers(room).filter((p) => p.socketId !== socketId);
    if (adversaires.length === 1) {
      adversaires[0].score += pointsRestants;
    } else if (adversaires.length >= 2) {
      // trio : points répartis également
      const share = Math.floor(pointsRestants / adversaires.length);
      for (const a of adversaires) a.score += share;
    }
    // solo : rien (points perdus)
    emitAll(io, room, 'slam_result', {
      joueur: j.pseudo, reussi: false, points: pointsRestants, detail,
    });
  }
  room._slamPlayer = null;
  broadcastState(io, room);
  setTimeout(() => endManche(io, room, 'slam'), 2000);
}

// ------------ Fin de manche ------------
function endManche(io, room, raison) {
  if (room._mancheEnded) return; // garde anti-double déclenchement
  room._mancheEnded = true;
  if (room.chronoTimeout) { clearTimeout(room.chronoTimeout); room.chronoTimeout = null; }
  const scores = room.joueurs.map((j) => ({
    pseudo: j.pseudo, score: j.score, elimine: j.elimine,
  }));
  emitAll(io, room, 'manche_end', { manche: room.manche, raison, scores });

  if (room.manche === 1 && room.nbJoueursMax === 3) {
    // Trio : élimine le dernier
    const ranked = activePlayers(room).slice().sort((a, b) => b.score - a.score);
    const last = ranked[ranked.length - 1];
    last.elimine = true;
    emitAll(io, room, 'player_eliminated', { pseudo: last.pseudo });
  }

  if (room.manche === 1) {
    setTimeout(() => startManche2(io, room), 2500);
  } else {
    setTimeout(() => startFinale(io, room), 2500);
  }
}

function startManche2(io, room) {
  room.status = 'manche2';
  room.manche = 2;
  setupManche(room, 2);
  emitAll(io, room, 'manche_start', { manche: 2 });
  broadcastState(io, room);
  nextQuestion(io, room);
}

// ------------ Finale ------------
function startFinale(io, room) {
  room.status = 'finale';
  // déterminer le finaliste (le meilleur score parmi actifs)
  const actifs = activePlayers(room).slice().sort((a, b) => b.score - a.score);
  const finaliste = actifs[0];
  room._finaliste = finaliste.socketId;
  // pick une grille finale au hasard
  const grille = shuffle(FINALES)[0];
  // lettres uniques de la grille
  const allLetters = new Set();
  for (const m of grille.mots) for (const c of normalize(m.mot)) allLetters.add(c);
  const uniques = shuffle(Array.from(allLetters)).slice(0, 8);
  // compléter à 8 si moins
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((x) => !uniques.includes(x));
  while (uniques.length < 8) uniques.push(shuffle(pool).pop());
  const lettresMelangees = shuffle(uniques);
  room.finale = {
    theme: grille.theme,
    rows: grille.rows,
    cols: grille.cols,
    mots: grille.mots.map((m, id) => ({
      id, mot: normalize(m.mot), definition: m.definition,
      r: m.r, c: m.c, dir: m.dir,
      trouve: false,
    })),
    lettres8: lettresMelangees, // array de 8 lettres (index 0..7 = chiffres 1..8)
    lettresChoisies: [],
    lettresReveleesSet: new Set(),
    startedAt: 0,
    chronoEnd: 0,
    scoreFinale: 0,
  };
  emitAll(io, room, 'finale_start', {
    finaliste: finaliste.pseudo,
    chiffres: [1, 2, 3, 4, 5, 6, 7, 8],
  });
  broadcastFinaleState(io, room);
}

function broadcastFinaleState(io, room) {
  const f = room.finale;
  emitAll(io, room, 'finale_state', {
    theme: f.theme,
    rows: f.rows,
    cols: f.cols,
    lettresRevelees: Array.from(f.lettresReveleesSet),
    lettresChoisies: f.lettresChoisies.map((i) => ({ chiffre: i + 1, lettre: f.lettres8[i] })),
    mots: f.mots.map((m) => ({
      id: m.id,
      longueur: m.mot.length,
      r: m.r, c: m.c, dir: m.dir,
      definition: m.trouve ? m.definition : null,
      trouve: m.trouve,
      lettres: m.mot.split('').map((c) => f.lettresReveleesSet.has(c) || m.trouve ? c : null),
    })),
    secondsLeft: f.chronoEnd ? Math.max(0, Math.ceil((f.chronoEnd - Date.now()) / 1000)) : null,
  });
}

function handleChooseNumbers(io, room, socketId, numeros) {
  if (room.status !== 'finale' || room._finaliste !== socketId) return;
  const f = room.finale;
  if (f.chronoEnd) return; // déjà lancé
  if (!Array.isArray(numeros) || numeros.length !== 5) return;
  const set = new Set();
  for (const n of numeros) {
    const idx = Number(n) - 1;
    if (idx < 0 || idx > 7 || set.has(idx)) return;
    set.add(idx);
  }
  f.lettresChoisies = Array.from(set);
  for (const idx of f.lettresChoisies) {
    f.lettresReveleesSet.add(f.lettres8[idx]);
  }
  f.startedAt = Date.now();
  f.chronoEnd = Date.now() + FINALE_CHRONO_S * 1000;
  emitAll(io, room, 'finale_grid_revealed', { theme: f.theme });
  broadcastFinaleState(io, room);
  // tick chrono (1x/s)
  if (room.finalSecondsInterval) clearInterval(room.finalSecondsInterval);
  room.finalSecondsInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((f.chronoEnd - Date.now()) / 1000));
    emitAll(io, room, 'finale_tick', { secondsLeft: remaining });
    if (remaining <= 0) {
      clearInterval(room.finalSecondsInterval);
      room.finalSecondsInterval = null;
      endFinale(io, room);
    }
  }, 1000);
}

function handleFinaleAnswer(io, room, socketId, motId, reponse) {
  if (room.status !== 'finale' || room._finaliste !== socketId) return;
  const f = room.finale;
  if (!f.chronoEnd || Date.now() > f.chronoEnd) return;
  const m = f.mots[motId];
  if (!m || m.trouve) return;
  const guess = normalize(reponse);
  if (guess === m.mot) {
    m.trouve = true;
    for (const c of m.mot) f.lettresReveleesSet.add(c);
    emitAll(io, room, 'finale_word_found', { motId, mot: m.mot });
    broadcastFinaleState(io, room);
    // si tous trouvés : fin anticipée
    if (f.mots.every((x) => x.trouve)) endFinale(io, room);
  } else {
    emitAll(io, room, 'finale_word_wrong', { motId, guess });
  }
}

function endFinale(io, room) {
  const f = room.finale;
  if (!f) return;
  if (room.finalSecondsInterval) { clearInterval(room.finalSecondsInterval); room.finalSecondsInterval = null; }
  const trouves = f.mots.filter((m) => m.trouve).length;
  let score = trouves * 100;
  if (trouves === f.mots.length) score = 2000; // bonus grille complète
  f.scoreFinale = score;
  // additionner au score total du finaliste
  const finaliste = room.joueurs.find((j) => j.socketId === room._finaliste);
  if (finaliste) finaliste.score += score;
  room.status = 'termine';
  room.finishedAt = Date.now();
  emitAll(io, room, 'finale_end', {
    scoreFinale: score,
    motsTrouves: trouves,
    totalMots: f.mots.length,
    mots: f.mots.map((m) => ({ mot: m.mot, definition: m.definition, trouve: m.trouve })),
    scores: room.joueurs.map((j) => ({ pseudo: j.pseudo, score: j.score })),
  });
}

module.exports = {
  startGame, handleBuzz, handleAnswerLetter, handleChooseWord, handleAnswerWord,
  handleSlamStart, handleSlamAnswers, handleChooseNumbers, handleFinaleAnswer,
  publicRoom, publicGrille, publicQuestion, broadcastState,
};
