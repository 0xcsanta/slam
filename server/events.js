// Binding Socket.IO <-> game engine.

const rooms = require('./rooms');
const game = require('./game');

function bind(io) {
  io.on('connection', (socket) => {
    socket.on('create_room', ({ pseudo, nbJoueurs } = {}, ack) => {
      pseudo = sanitizePseudo(pseudo);
      if (!pseudo) return ack?.({ error: 'Pseudo invalide (3-15 caractères).' });
      if (![1, 2, 3].includes(Number(nbJoueurs))) return ack?.({ error: 'Mode invalide.' });
      const room = rooms.createRoom(pseudo, Number(nbJoueurs), socket.id);
      socket.join(room.code);
      ack?.({ ok: true, code: room.code, room: game.publicRoom(room) });
      io.to(room.code).emit('room_update', game.publicRoom(room));
    });

    socket.on('join_room', ({ pseudo, code } = {}, ack) => {
      pseudo = sanitizePseudo(pseudo);
      if (!pseudo) return ack?.({ error: 'Pseudo invalide (3-15 caractères).' });
      if (!code) return ack?.({ error: 'Code manquant.' });
      const result = rooms.joinRoom(code.toUpperCase(), pseudo, socket.id);
      if (result.error) return ack?.({ error: result.error });
      socket.join(result.room.code);
      ack?.({ ok: true, code: result.room.code, room: game.publicRoom(result.room), reconnected: !!result.reconnected });
      io.to(result.room.code).emit('room_update', game.publicRoom(result.room));
      if (result.reconnected) {
        // resynchronise l'état complet pour le joueur qui revient
        game.broadcastState(io, result.room);
      }
    });

    socket.on('start_game', (_, ack) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (!room) return ack?.({ error: 'Pas dans une room.' });
      const j = room.joueurs.find((p) => p.socketId === socket.id);
      if (!j || j.pseudo !== room.createur) return ack?.({ error: 'Seul le créateur peut lancer.' });
      if (room.status !== 'lobby') return ack?.({ error: 'Partie déjà lancée.' });
      if (room.joueurs.length !== room.nbJoueursMax) return ack?.({ error: 'Tous les joueurs ne sont pas connectés.' });
      ack?.({ ok: true });
      game.startGame(io, room);
    });

    socket.on('buzz', () => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleBuzz(io, room, socket.id);
    });

    socket.on('answer_letter', ({ lettre } = {}) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleAnswerLetter(io, room, socket.id, lettre);
    });

    socket.on('choose_word', ({ motId } = {}) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleChooseWord(io, room, socket.id, Number(motId));
    });

    socket.on('answer_word', ({ reponse } = {}) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleAnswerWord(io, room, socket.id, reponse);
    });

    socket.on('slam_start', () => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleSlamStart(io, room, socket.id);
    });

    socket.on('slam_answers', ({ reponses } = {}) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleSlamAnswers(io, room, socket.id, reponses || {});
    });

    socket.on('choose_numbers', ({ numeros } = {}) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleChooseNumbers(io, room, socket.id, numeros);
    });

    socket.on('finale_answer', ({ motId, reponse } = {}) => {
      const room = rooms.getRoomBySocket(socket.id);
      if (room) game.handleFinaleAnswer(io, room, socket.id, Number(motId), reponse);
    });

    socket.on('leave_room', () => {
      const info = rooms.markDisconnected(socket.id);
      if (info?.room && rooms.getRoomByCode(info.room.code)) {
        io.to(info.room.code).emit('room_update', game.publicRoom(info.room));
      }
      socket.leave(rooms.getRoomBySocket?.(socket.id)?.code || '');
    });

    socket.on('disconnect', () => {
      const info = rooms.markDisconnected(socket.id);
      if (info?.room && rooms.getRoomByCode(info.room.code)) {
        io.to(info.room.code).emit('room_update', game.publicRoom(info.room));
        io.to(info.room.code).emit('player_left', { pseudo: info.joueur.pseudo });
      }
    });
  });
}

function sanitizePseudo(p) {
  if (typeof p !== 'string') return null;
  const clean = p.trim().replace(/[<>"'&]/g, '').slice(0, 15);
  if (clean.length < 3) return null;
  return clean;
}

module.exports = { bind };
