// SLAM — serveur principal : Express + Socket.IO.
// Sert le frontend statique depuis /public et gère les WebSocket pour le jeu.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const events = require('./events');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

// petite route santé (utile pour UptimeRobot)
app.get('/ping', (_req, res) => res.type('text/plain').send('pong'));

// fallback : sert index.html pour toute route inconnue (SPA-friendly)
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 60000,
});

events.bind(io);

server.listen(PORT, () => {
  console.log(`[SLAM] Serveur démarré sur http://localhost:${PORT}`);
});
