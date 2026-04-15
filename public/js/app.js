// SLAM — client (vanilla JS).
// Rendu d'une grille de mots croisés 2D + UI Neobrutalism.

const socket = io({ autoConnect: true, reconnection: true });

const state = {
  pseudo: localStorage.getItem('slam_pseudo') || '',
  code: null,
  room: null,
  grille: null,
  question: null,
  manche: 0,
  myTurn: false,
  slamMode: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const show = (view) => {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
};
const toast = (msg, kind = '') => {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
};
function meInRoom() { return state.room?.joueurs.find((j) => j.pseudo === state.pseudo); }
function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ========== Accueil ==========
$('#inp-pseudo').value = state.pseudo;
$('#inp-pseudo').addEventListener('input', (e) => {
  state.pseudo = e.target.value.trim();
  localStorage.setItem('slam_pseudo', state.pseudo);
});
$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
}));

$('#btn-create').addEventListener('click', () => {
  const pseudo = $('#inp-pseudo').value.trim();
  if (pseudo.length < 3) return setMsg('Pseudo trop court (3 minimum).');
  const nb = Number($('#sel-mode').value);
  socket.emit('create_room', { pseudo, nbJoueurs: nb }, (res) => {
    if (res?.error) return setMsg(res.error);
    state.pseudo = pseudo; state.code = res.code; state.room = res.room;
    showLobby();
  });
});

$('#btn-join').addEventListener('click', () => {
  const pseudo = $('#inp-pseudo').value.trim();
  const code = $('#inp-code').value.trim().toUpperCase();
  if (pseudo.length < 3) return setMsg('Pseudo trop court (3 minimum).');
  if (!code) return setMsg('Entre un code.');
  socket.emit('join_room', { pseudo, code }, (res) => {
    if (res?.error) return setMsg(res.error);
    state.pseudo = pseudo; state.code = res.code; state.room = res.room;
    showLobby();
  });
});

$('#inp-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

function setMsg(text, ok = false) {
  const m = $('#home-msg');
  m.textContent = text;
  m.classList.toggle('ok', ok);
}

$('#link-rules').addEventListener('click', (e) => { e.preventDefault(); $('#rules-modal').classList.remove('hidden'); });
$('#btn-close-rules').addEventListener('click', () => $('#rules-modal').classList.add('hidden'));

// ========== Lobby ==========
function showLobby() {
  show('lobby');
  $('#lobby-code').textContent = state.code;
  renderLobby();
}
function renderLobby() {
  const room = state.room;
  if (!room) return;
  $('#lobby-count').textContent = `(${room.joueurs.length}/${room.nbJoueursMax})`;
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  for (const j of room.joueurs) {
    const li = document.createElement('li');
    if (j.pseudo === room.createur) li.classList.add('host');
    if (!j.connected) li.classList.add('disconnected');
    li.innerHTML = `<span>${escapeHTML(j.pseudo)}</span><span class="small">${j.connected ? '' : 'déconnecté'}</span>`;
    ul.appendChild(li);
  }
  const me = meInRoom();
  const isHost = me && me.pseudo === room.createur;
  const btn = $('#btn-start');
  btn.classList.toggle('hidden', !isHost);
  btn.disabled = room.joueurs.length !== room.nbJoueursMax;
}
$('#btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.code); toast('Code copié !', 'good'); }
  catch { toast('Impossible de copier', 'bad'); }
});
$('#btn-start').addEventListener('click', () => {
  socket.emit('start_game', {}, (res) => { if (res?.error) toast(res.error, 'bad'); });
});
$('#btn-leave').addEventListener('click', () => {
  socket.emit('leave_room');
  state.code = null; state.room = null;
  show('home');
});

// ========== Numérotation crossword ==========
function buildWordNumbers(grille) {
  // Trie les mots par (r, c) pour la numérotation classique des mots croisés
  const sorted = grille.mots.slice().sort((a, b) => a.r - b.r || a.c - b.c);
  // En pratique, plusieurs mots peuvent partager une même cellule de départ (un horizontal et un vertical)
  // Numérotation : 1, 2, 3... par ordre d'apparition. Chaque mot a son propre numéro.
  const byId = {};
  sorted.forEach((m, idx) => { byId[m.id] = idx + 1; });
  return byId;
}

// ========== JEU ==========
function renderGame() {
  const room = state.room;
  const grille = state.grille;
  if (!room || !grille) return;

  $('#manche-badge').textContent = `MANCHE ${state.manche || 1}`;
  $('#game-theme').textContent = grille.theme || '';

  // scores
  const sb = $('#scoreboard');
  sb.innerHTML = '';
  for (const j of room.joueurs) {
    const li = document.createElement('li');
    if (j.elimine) li.classList.add('eliminated');
    if (state.question?.currentPlayer === j.pseudo) li.classList.add('active');
    li.innerHTML = `${escapeHTML(j.pseudo)}<span class="score">${j.score}</span>`;
    sb.appendChild(li);
  }

  // grille 2D
  renderGrid2D($('#grid-2d'), grille);

  renderSidePanel();
}

function renderGrid2D(container, grille) {
  const numbers = buildWordNumbers(grille);
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${grille.cols}, auto)`;

  // Construire la grille de cellules : chaque cellule peut contenir une lettre (depuis n'importe quel mot)
  // ou être vide.
  const cells = Array.from({ length: grille.rows }, () =>
    Array.from({ length: grille.cols }, () => ({ letter: null, revealed: false, found: false, grise: false, num: null, motId: null }))
  );

  for (const m of grille.mots) {
    const num = numbers[m.id];
    for (let i = 0; i < m.longueur; i++) {
      const r = m.r + (m.dir === 'V' ? i : 0);
      const c = m.c + (m.dir === 'H' ? i : 0);
      if (r < 0 || r >= grille.rows || c < 0 || c >= grille.cols) continue;
      const cell = cells[r][c];
      const ch = m.lettres[i];
      if (ch) cell.letter = ch;
      // marque les cellules de début de mot
      if (i === 0) cell.num = cell.num ?? num;
      // état révélé / trouvé prioritaire (un mot trouvé l'emporte)
      if (m.trouve) cell.found = true;
      else if (ch) cell.revealed = true;
      if (m.grise && !cell.found) cell.grise = true;
      cell.motId = cell.motId ?? m.id;
    }
  }

  for (let r = 0; r < grille.rows; r++) {
    for (let c = 0; c < grille.cols; c++) {
      const cell = cells[r][c];
      const div = document.createElement('div');
      const has = cells[r][c].letter !== null || cells[r][c].num !== null
                  || cells[r][c].motId !== null
                  || (cells[r][c].letter === null && grille.mots.some((m) => {
                       for (let i = 0; i < m.longueur; i++) {
                         const rr = m.r + (m.dir === 'V' ? i : 0);
                         const cc = m.c + (m.dir === 'H' ? i : 0);
                         if (rr === r && cc === c) return true;
                       }
                       return false;
                     }));
      div.className = 'cell-2d';
      // une cellule est "réelle" si au moins un mot occupe cette case
      const isWordCell = grille.mots.some((m) => {
        for (let i = 0; i < m.longueur; i++) {
          const rr = m.r + (m.dir === 'V' ? i : 0);
          const cc = m.c + (m.dir === 'H' ? i : 0);
          if (rr === r && cc === c) return true;
        }
        return false;
      });
      if (!isWordCell) {
        div.classList.add('empty');
      } else {
        div.classList.add('letter');
        if (cell.found) div.classList.add('found');
        else if (cell.grise) div.classList.add('grise');
        else if (cell.letter) div.classList.add('revealed');
        if (cell.letter) div.textContent = cell.letter;
        if (cell.num != null) {
          const n = document.createElement('span');
          n.className = 'num';
          n.textContent = cell.num;
          div.appendChild(n);
        }
      }
      container.appendChild(div);
    }
  }
}

function renderSidePanel() {
  const q = state.question;
  const me = meInRoom();
  const iamActive = q && q.currentPlayer && q.currentPlayer === me?.pseudo;
  state.myTurn = iamActive;

  $('#question-area').classList.add('hidden');
  $('#letter-area').classList.add('hidden');
  $('#word-choice-area').classList.add('hidden');
  $('#word-answer-area').classList.add('hidden');

  if (!q) {
    $('#status-box').textContent = state.slamMode ? '⚡ SLAM EN COURS' : 'EN ATTENTE…';
    return;
  }

  $('#question-text').textContent = q.texte;
  $('#question-area').classList.remove('hidden');

  const nbActifs = state.room?.joueurs.filter((j) => !j.elimine).length || 0;
  const solo = nbActifs === 1;

  if (q.phase === 'buzz' && !solo) {
    $('#status-box').textContent = 'BUZZE POUR PRENDRE LA MAIN !';
    $('#btn-buzz').disabled = false;
    $('#btn-buzz').classList.remove('hidden');
  } else if (q.phase === 'letter') {
    $('#btn-buzz').classList.add('hidden');
    if (iamActive) {
      $('#status-box').textContent = '→ À TOI LA MAIN — UNE LETTRE';
      $('#letter-area').classList.remove('hidden');
      $('#inp-letter').value = '';
      $('#inp-letter').focus();
    } else {
      $('#status-box').textContent = `${q.currentPlayer.toUpperCase()} RÉPOND…`;
    }
  } else if (q.phase === 'word_choice') {
    $('#btn-buzz').classList.add('hidden');
    if (iamActive) {
      $('#status-box').textContent = 'CHOISIS UN MOT À DEVINER';
      $('#word-choice-area').classList.remove('hidden');
    } else {
      $('#status-box').textContent = `${q.currentPlayer.toUpperCase()} CHOISIT…`;
    }
  } else if (q.phase === 'word') {
    $('#btn-buzz').classList.add('hidden');
    // Enigme visible pour tout le monde
    $('#word-definition').textContent = q.wordDefinition || '';
    $('#word-answer-area').classList.remove('hidden');
    if (iamActive) {
      $('#status-box').textContent = '→ À TOI DE DEVINER LE MOT !';
      $('#inp-word').disabled = false;
      $('#btn-send-word').disabled = false;
      $('#inp-word').value = '';
      $('#inp-word').focus();
    } else {
      $('#status-box').textContent = `${q.currentPlayer.toUpperCase()} DEVINE…`;
      // Spectateurs : voient la définition mais ne peuvent pas taper
      $('#inp-word').disabled = true;
      $('#btn-send-word').disabled = true;
    }
  }
}

$('#btn-buzz').addEventListener('click', () => socket.emit('buzz'));
$('#btn-send-letter').addEventListener('click', () => {
  const l = $('#inp-letter').value.trim();
  if (l) socket.emit('answer_letter', { lettre: l });
});
$('#inp-letter').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-send-letter').click(); });
$('#btn-send-word').addEventListener('click', () => {
  const r = $('#inp-word').value.trim();
  if (r) socket.emit('answer_word', { reponse: r });
});
$('#inp-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-send-word').click(); });

$('#btn-slam').addEventListener('click', () => {
  if (!confirm('Lancer un SLAM ? Tu devras remplir TOUS les mots restants d\'un coup. Une erreur = échec.')) return;
  socket.emit('slam_start');
});
$('#btn-slam-submit').addEventListener('click', () => {
  const reponses = {};
  $$('#slam-inputs input').forEach((inp) => { reponses[inp.dataset.id] = inp.value.trim(); });
  socket.emit('slam_answers', { reponses });
});

let chronoInterval = null;
function startLocalChrono(seconds) {
  stopLocalChrono();
  const end = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, (end - Date.now()) / 1000);
    const el = $('#chrono-display');
    el.textContent = Math.ceil(left).toString();
    el.classList.toggle('warning', left <= 3);
    if (left <= 0) stopLocalChrono();
  };
  tick();
  chronoInterval = setInterval(tick, 100);
}
function stopLocalChrono() {
  if (chronoInterval) { clearInterval(chronoInterval); chronoInterval = null; }
  $('#chrono-display').textContent = '';
  $('#chrono-display').classList.remove('warning');
}

// ========== FINALE ==========
const finaleState = { selectedIdx: new Set() };

function renderFinalePicker(chiffres) {
  const box = $('#finale-numbers');
  box.innerHTML = '';
  finaleState.selectedIdx = new Set();
  chiffres.forEach((n) => {
    const b = document.createElement('button');
    b.className = 'num-btn';
    b.textContent = n;
    b.dataset.idx = n - 1;
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.idx);
      if (finaleState.selectedIdx.has(idx)) {
        finaleState.selectedIdx.delete(idx); b.classList.remove('selected');
      } else if (finaleState.selectedIdx.size < 5) {
        finaleState.selectedIdx.add(idx); b.classList.add('selected');
      }
      $('#btn-finale-submit-numbers').disabled = finaleState.selectedIdx.size !== 5;
      $('#finale-picker-title').textContent = `CHOISIS 5 CHIFFRES (${finaleState.selectedIdx.size}/5)`;
    });
    box.appendChild(b);
  });
}

$('#btn-finale-submit-numbers').addEventListener('click', () => {
  const nums = Array.from(finaleState.selectedIdx).map((i) => i + 1);
  socket.emit('choose_numbers', { numeros: nums });
});

function renderFinaleGrid(payload) {
  $('#finale-picker').classList.add('hidden');
  $('#finale-theme-box').classList.remove('hidden');
  $('#finale-theme').textContent = payload.theme;
  $('#finale-game').classList.remove('hidden');
  // grille 2D
  renderGrid2D($('#finale-grid-2d'), {
    rows: payload.rows, cols: payload.cols,
    mots: payload.mots,
    lettresRevelees: payload.lettresRevelees || [],
    lettresPerdues: [],
    theme: payload.theme,
  });
}

$('#btn-finale-answer').addEventListener('click', submitFinaleAnswer);
$('#inp-finale').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFinaleAnswer(); });
function submitFinaleAnswer() {
  const txt = $('#inp-finale').value.trim();
  if (!txt) return;
  const grid = window._finaleGridPayload;
  if (!grid) return;
  const candidats = grid.mots.filter((m) => !m.trouve);
  for (const m of candidats) socket.emit('finale_answer', { motId: m.id, reponse: txt });
  $('#inp-finale').value = '';
  $('#inp-finale').focus();
}

// ========== SOCKET EVENTS ==========
socket.on('connect_error', () => toast('Connexion perdue', 'bad'));

socket.on('room_update', (room) => {
  state.room = room;
  state.code = room.code;
  if (room.status === 'lobby') renderLobby();
});

socket.on('state', ({ room, grille, question }) => {
  state.room = room;
  state.grille = grille;
  state.question = question;
  state.manche = room.manche;
  if (room.status === 'lobby') { renderLobby(); return; }
  if (room.status === 'manche1' || room.status === 'manche2') { show('game'); renderGame(); }
  else if (room.status === 'finale') { show('finale'); }
});

socket.on('game_starting', ({ manche }) => { state.manche = manche; show('game'); });

socket.on('new_question', () => { stopLocalChrono(); toast('Nouvelle question !'); });
socket.on('chrono_start', ({ seconds }) => startLocalChrono(seconds));
socket.on('buzz_result', ({ joueur }) => { toast(`🔔 ${joueur} a buzzé !`); stopLocalChrono(); });
socket.on('letter_revealed', ({ lettre, joueur }) => toast(`✓ ${joueur} : la lettre est ${lettre}`, 'good'));
socket.on('letter_wrong', ({ joueur, guess }) => { toast(`✗ ${joueur} : "${guess}" est faux`, 'bad'); stopLocalChrono(); });
socket.on('letter_lost', ({ lettre, indice }) => toast(`Lettre perdue : ${lettre}${indice ? ' ('+indice+')' : ''}`, 'bad'));
socket.on('free_hand', ({ joueur }) => { toast(`${joueur} a la main sans chrono`); stopLocalChrono(); });
socket.on('buzz_reopened', () => toast('Buzz rouvert !'));

socket.on('choose_word_prompt', ({ joueur, choices }) => {
  if (state.question) {
    state.question.phase = 'word_choice';
    state.question.currentPlayer = joueur;
  }
  const numbers = buildWordNumbers(state.grille);
  const box = $('#word-choices');
  box.innerHTML = '';
  for (const c of choices) {
    const b = document.createElement('button');
    const num = numbers[c.id] || c.id + 1;
    const dirArrow = state.grille.mots.find((x) => x.id === c.id)?.dir === 'V' ? '↓' : '→';
    b.textContent = `${num}${dirArrow} (${c.longueur} lettres)`;
    b.addEventListener('click', () => socket.emit('choose_word', { motId: c.id }));
    box.appendChild(b);
  }
  renderSidePanel();
});

socket.on('word_prompt', ({ motId, definition, chrono }) => {
  if (state.question) {
    state.question.phase = 'word';
    state.question.wordId = motId;
    state.question.wordDefinition = definition;
  }
  startLocalChrono(chrono);
  renderSidePanel();
});

socket.on('word_found', ({ joueur, mot, points }) => { toast(`✓ ${joueur} trouve "${mot}" (+${points})`, 'good'); stopLocalChrono(); });
socket.on('word_failed', ({ raison }) => { toast(`✗ Mot non trouvé${raison === 'timeout' ? ' (temps écoulé)' : ''}`, 'bad'); stopLocalChrono(); });
socket.on('questions_exhausted', () => toast('Plus de questions ! Seul un SLAM peut finir la grille.'));

// SLAM
socket.on('slam_attempt', ({ joueur, mots }) => {
  stopLocalChrono();
  toast(`⚡ ${joueur} tente un SLAM !`);
  const me = meInRoom();
  state.slamMode = true;
  if (joueur === me?.pseudo) {
    $('#slam-active').classList.remove('hidden');
    const numbers = buildWordNumbers(state.grille);
    const box = $('#slam-inputs');
    box.innerHTML = '';
    for (const m of mots) {
      const num = numbers[m.id] || m.id + 1;
      const grilleM = state.grille.mots.find((x) => x.id === m.id);
      const dir = grilleM?.dir === 'V' ? '↓' : '→';
      const line = document.createElement('div');
      line.className = 'slam-line';
      line.innerHTML = `<span>${num}${dir} · ${m.longueur} l.</span>`;
      const input = document.createElement('input');
      input.dataset.id = m.id;
      input.placeholder = `Mot…`;
      line.appendChild(input);
      box.appendChild(line);
    }
  } else {
    $('#status-box').textContent = `⚡ ${joueur.toUpperCase()} SLAME…`;
  }
});

socket.on('slam_result', ({ joueur, reussi, points }) => {
  state.slamMode = false;
  $('#slam-active').classList.add('hidden');
  if (reussi) toast(`⚡✓ SLAM RÉUSSI par ${joueur} ! +${points}`, 'good');
  else toast(`⚡✗ SLAM RATÉ par ${joueur}. ${points} pts redistribués.`, 'bad');
});

socket.on('manche_end', ({ manche }) => { toast(`Fin de la Manche ${manche}`); stopLocalChrono(); });
socket.on('manche_start', ({ manche }) => { state.manche = manche; toast(`Manche ${manche} !`); });
socket.on('player_eliminated', ({ pseudo }) => toast(`${pseudo} est éliminé(e).`, 'bad'));

// FINALE
socket.on('finale_start', ({ finaliste, chiffres }) => {
  show('finale');
  $('#finale-picker').classList.remove('hidden');
  $('#finale-game').classList.add('hidden');
  $('#finale-theme-box').classList.add('hidden');
  $('#finale-chrono').textContent = '--';
  const me = meInRoom();
  const amFinaliste = me?.pseudo === finaliste;
  if (amFinaliste) {
    $('#finale-picker-title').textContent = 'CHOISIS 5 CHIFFRES (0/5)';
    renderFinalePicker(chiffres);
  } else {
    $('#finale-picker-title').textContent = `${finaliste.toUpperCase()} CHOISIT 5 CHIFFRES…`;
    const box = $('#finale-numbers');
    box.innerHTML = '';
    chiffres.forEach((n) => {
      const b = document.createElement('button');
      b.className = 'num-btn'; b.textContent = n; b.disabled = true;
      box.appendChild(b);
    });
    $('#btn-finale-submit-numbers').classList.add('hidden');
  }
});

socket.on('finale_state', (payload) => {
  window._finaleGridPayload = payload;
  if (payload.secondsLeft != null) {
    $('#finale-chrono').textContent = payload.secondsLeft;
    $('#finale-chrono').classList.toggle('warning', payload.secondsLeft <= 10);
  }
  if (payload.lettresChoisies?.length === 5) renderFinaleGrid(payload);
});

socket.on('finale_grid_revealed', ({ theme }) => {
  $('#finale-picker').classList.add('hidden');
  $('#finale-theme-box').classList.remove('hidden');
  $('#finale-theme').textContent = theme;
  $('#finale-game').classList.remove('hidden');
});

socket.on('finale_tick', ({ secondsLeft }) => {
  $('#finale-chrono').textContent = secondsLeft;
  $('#finale-chrono').classList.toggle('warning', secondsLeft <= 10);
});

socket.on('finale_word_found', ({ mot }) => toast(`✓ ${mot}`, 'good'));
socket.on('finale_word_wrong', () => toast('✗ Raté', 'bad'));

socket.on('finale_end', ({ scoreFinale, motsTrouves, totalMots, mots, scores }) => {
  show('end');
  const sorted = scores.slice().sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  let html = `<p>Finale : <strong>${motsTrouves}/${totalMots} mots</strong> trouvés (+${scoreFinale} pts)</p>`;
  html += `<div class="winner">🏆 ${escapeHTML(winner.pseudo)} — ${winner.score} pts</div>`;
  html += '<table><thead><tr><th>Joueur</th><th>Score</th></tr></thead><tbody>';
  for (const s of sorted) html += `<tr><td>${escapeHTML(s.pseudo)}</td><td>${s.score}</td></tr>`;
  html += '</tbody></table>';
  html += '<details><summary><strong>Mots de la finale</strong></summary><ul>';
  for (const m of mots) html += `<li>${m.trouve ? '✓' : '✗'} <strong>${m.mot}</strong> — ${escapeHTML(m.definition)}</li>`;
  html += '</ul></details>';
  $('#end-summary').innerHTML = html;
});

socket.on('player_left', ({ pseudo }) => toast(`${pseudo} s'est déconnecté(e).`));

$('#btn-replay').addEventListener('click', () => {
  state.code = null; state.room = null; state.grille = null; state.question = null;
  show('home');
});

show('home');
