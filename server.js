const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const QUESTIONS = [
  { question: 'Which planet is known as the Red Planet?', answers: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: 1, color: 'coral' },
  { question: 'What is the chemical symbol for water?', answers: ['O₂', 'H₂O', 'CO₂', 'NaCl'], correct: 1, color: 'aqua' },
  { question: 'Which animal is the fastest on land?', answers: ['Cheetah', 'Lion', 'Falcon', 'Horse'], correct: 0, color: 'violet' },
  { question: 'How many sides does a hexagon have?', answers: ['5', '6', '7', '8'], correct: 1, color: 'sun' },
];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

const makePin = () => String(Math.floor(100000 + Math.random() * 900000));
function publicGame(room) {
  const { hostId, answerStartedAt, ...game } = room;
  return { ...game, questionCount: QUESTIONS.length, questions: room.phase === 'question' ? QUESTIONS.map(({ correct, ...q }) => q) : undefined };
}
function sendGame(room) { io.to(room.code).emit('game:update', publicGame(room)); }

io.on('connection', socket => {
  socket.on('game:create', (ack) => {
    let code = makePin(); while (rooms.has(code)) code = makePin();
    const room = { code, title: 'HuddleUp Trivia', phase: 'lobby', questionIndex: 0, players: [], answers: {}, hostId: socket.id, answerStartedAt: 0 };
    rooms.set(code, room); socket.join(code); ack({ ok: true, game: publicGame(room) });
  });

  socket.on('game:join', ({ code, name }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.phase === 'complete') return ack({ ok: false, error: 'That game PIN is not active. Ask your host to check the code.' });
    const player = { id: socket.id, name: String(name || 'Quizzer').trim().slice(0, 18) || 'Quizzer', score: 0 };
    room.players = room.players.filter(p => p.id !== socket.id); room.players.push(player);
    socket.data.roomCode = room.code; socket.data.isHost = false; socket.join(room.code);
    ack({ ok: true, game: publicGame(room), player }); sendGame(room);
  });

  socket.on('game:start', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id) return ack?.({ ok: false });
    room.phase = 'question'; room.answers = {}; room.answerStartedAt = Date.now(); sendGame(room); ack?.({ ok: true });
  });

  socket.on('answer:submit', ({ code, choice }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.phase !== 'question' || !room.players.some(p => p.id === socket.id) || room.answers[socket.id]) return ack?.({ ok: false });
    const selected = Number(choice); if (!Number.isInteger(selected) || selected < 0 || selected > 3) return ack?.({ ok: false });
    room.answers[socket.id] = { playerId: socket.id, choice: selected, elapsed: Math.max(0, (Date.now() - room.answerStartedAt) / 1000) };
    sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:reveal', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id || room.phase !== 'question') return ack?.({ ok: false });
    const correct = QUESTIONS[room.questionIndex].correct;
    Object.values(room.answers).forEach(answer => {
      const player = room.players.find(p => p.id === answer.playerId);
      if (player && answer.choice === correct) player.score += Math.max(250, Math.round(1000 - answer.elapsed * 18));
    });
    room.phase = 'leaderboard'; sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:next', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id || room.phase !== 'leaderboard') return ack?.({ ok: false });
    if (room.questionIndex >= QUESTIONS.length - 1) room.phase = 'complete';
    else { room.questionIndex += 1; room.phase = 'question'; room.answers = {}; room.answerStartedAt = Date.now(); }
    sendGame(room); ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      if (room.hostId === socket.id) { io.to(room.code).emit('game:ended'); rooms.delete(room.code); break; }
      const before = room.players.length; room.players = room.players.filter(p => p.id !== socket.id);
      if (before !== room.players.length) sendGame(room);
    }
  });
});

const port = process.env.PORT || 3010;
server.listen(port, () => console.log(`HuddleUp server running on port ${port}`));
