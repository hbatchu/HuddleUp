const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');

const CATEGORIES = {
  general: { title: 'General Knowledge', questions: [
  { level: 'Easy', question: 'Which company owns Instagram and WhatsApp?', answers: ['Google', 'Meta', 'Microsoft', 'Amazon'], correct: 1 },

  { level: 'Easy', question: 'Which country hosted the 2024 Summer Olympics?', answers: ['Japan', 'France', 'Italy', 'Australia'], correct: 1 },

  { level: 'Easy', question: 'Which technology is behind ChatGPT and similar generative AI tools?', answers: ['Artificial Intelligence', 'Bluetooth', 'GPS', 'Blockchain'], correct: 0 },

  { level: 'Easy', question: 'Which Indian city is widely known as the country’s Silicon Valley?', answers: ['Mumbai', 'Hyderabad', 'Bengaluru', 'Pune'], correct: 2 },

  { level: 'Medium', question: 'Which country became the first to successfully land a spacecraft near the Moon’s south polar region in 2023?', answers: ['USA', 'India', 'China', 'Russia'], correct: 1 },

  { level: 'Medium', question: 'What does the “X” in Elon Musk’s social-media platform refer to today?', answers: ['X, formerly Twitter', 'Xtreme Social', 'X Network India', 'Xpress'], correct: 0 },

  { level: 'Medium', question: 'Which company developed the AI models behind the Gemini family?', answers: ['Apple', 'Google', 'NVIDIA', 'Tesla'], correct: 1 },

  { level: 'Medium', question: 'Which country is currently the world’s largest democracy by population?', answers: ['United States', 'India', 'Brazil', 'Indonesia'], correct: 1 },

  { level: 'Hard', question: 'Which company became the first to briefly reach a $4 trillion market valuation in 2025, driven largely by demand for AI chips?', answers: ['Apple', 'Microsoft', 'NVIDIA', 'Amazon'], correct: 2 },

  { level: 'Hard', question: 'The Strait of Hormuz is particularly important to the global economy because it is a major route for the transportation of which commodity?', answers: ['Coffee', 'Oil', 'Wheat', 'Iron ore'], correct: 1 },

  { level: 'Hard', question: 'Which country became the first in the world to pass a comprehensive national law specifically regulating artificial intelligence?', answers: ['China', 'European Union', 'United States', 'Canada'], correct: 0 },

  { level: 'Hard', question: 'If you hear the terms “Trump tariffs”, “trade war”, and “semiconductors” discussed together, which country is most commonly at the center of the US-China technology rivalry?', answers: ['Japan', 'China', 'Brazil', 'Germany'], correct: 1 }
] },
  ai: { title: 'AI', questions: [
  { level: 'Easy', question: 'Which company develops the Claude AI models?', answers: ['Anthropic', 'NVIDIA', 'Meta', 'Amazon'], correct: 0 },

  { level: 'Easy', question: 'Which company develops the Llama models?', answers: ['Google', 'Meta', 'OpenAI', 'Microsoft'], correct: 1 },

  { level: 'Easy', question: 'Which company develops Gemini?', answers: ['Google', 'Anthropic', 'xAI', 'OpenAI'], correct: 0 },

  { level: 'Easy', question: 'What does RAG help an AI model do?', answers: ['Access external knowledge', 'Train GPUs', 'Create databases', 'Compress images'], correct: 0 },

  { level: 'Medium', question: 'What makes an AI agent different from a chatbot?', answers: ['It can take actions', 'It uses no model', 'It only generates images', 'It cannot use tools'], correct: 0 },

  { level: 'Medium', question: 'Which company created the Grok AI model?', answers: ['xAI', 'Meta', 'Google', 'Anthropic'], correct: 0 },

  { level: 'Medium', question: 'What is a reasoning model optimized for?', answers: ['Complex problem solving', 'Image compression', 'Database storage', 'Network routing'], correct: 0 },

  { level: 'Medium', question: 'What does MCP enable AI applications to do?', answers: ['Connect to tools and data', 'Train GPUs faster', 'Generate electricity', 'Replace databases'], correct: 0 },

  { level: 'Hard', question: 'Why are AI agents increasingly using tool calling?', answers: ['To perform real-world tasks', 'To reduce model size', 'To eliminate prompts', 'To avoid inference'], correct: 0 },

  { level: 'Hard', question: 'Which hardware company dominates the AI GPU market?', answers: ['NVIDIA', 'Intel', 'Dell', 'Cisco'], correct: 0 },

  { level: 'Hard', question: 'What is the main purpose of AI model quantization?', answers: ['Reduce model size and compute', 'Increase training data', 'Improve internet speed', 'Create synthetic images'], correct: 0 },

  { level: 'Hard', question: 'What is the major shift from chatbots to agentic AI?', answers: ['From answering to executing', 'From text to email', 'From cloud to desktop', 'From AI to robotics'], correct: 0 }
] },
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const rooms = new Map();
const ANSWER_COLORS = ['coral', 'aqua', 'violet', 'sun'];

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

const makePin = () => String(Math.floor(100000 + Math.random() * 900000));
const roomQuestions = room => CATEGORIES[room.category].questions;
function publicGame(room) {
  const { hostId, answerStartedAt, ...game } = room;
  return {
    ...game,
    players: room.players.map(({ id, name, score, connected }) => ({ id, name, score, connected })),
    questionCount: roomQuestions(room).length,
    questions: room.phase === 'question'
      ? roomQuestions(room).map(({ correct, ...q }, index) => ({ ...q, colors: index === room.questionIndex ? room.optionColors : undefined }))
      : undefined,
  };
}
function shuffledColors() { return [...ANSWER_COLORS].sort(() => Math.random() - 0.5); }
function sendGame(room) { io.to(room.code).emit('game:update', publicGame(room)); }

io.on('connection', socket => {
  socket.on('game:create', ({ category }, ack) => {
    if (!CATEGORIES[category]) return ack({ ok: false, error: 'Choose a quiz category.' });
    let code = makePin(); while (rooms.has(code)) code = makePin();
    const room = { code, title: CATEGORIES[category].title, category, phase: 'lobby', questionIndex: 0, players: [], answers: {}, hostId: socket.id, answerStartedAt: 0, answerDeadline: 0 };
    rooms.set(code, room); socket.join(code); ack({ ok: true, game: publicGame(room) });
  });

  socket.on('game:join', ({ code, name, resumeToken }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.phase === 'complete') return ack({ ok: false, error: 'That game PIN is not active. Ask your host to check the code.' });
    let player = room.players.find(p => p.resumeToken === resumeToken);
    if (player) {
      player.socketId = socket.id; player.connected = true;
    } else {
      player = { id: randomUUID(), socketId: socket.id, resumeToken: randomUUID(), name: String(name || 'Quizzer').trim().slice(0, 18) || 'Quizzer', score: 0, connected: true };
      room.players.push(player);
    }
    socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.data.isHost = false; socket.join(room.code);
    ack({ ok: true, game: publicGame(room), player: { id: player.id, name: player.name, score: player.score, connected: true }, resumeToken: player.resumeToken }); sendGame(room);
  });

  socket.on('game:start', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id) return ack?.({ ok: false });
    room.phase = 'question'; room.answers = {}; room.optionColors = shuffledColors(); room.answerStartedAt = Date.now(); room.answerDeadline = room.answerStartedAt + 30000; sendGame(room); ack?.({ ok: true });
  });

  socket.on('answer:submit', ({ code, choice }, ack) => {
    const room = rooms.get(String(code));
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'question' || !player || !player.connected || room.answers[player.id] || Date.now() > room.answerDeadline) return ack?.({ ok: false });
    const selected = Number(choice); if (!Number.isInteger(selected) || selected < 0 || selected > 3) return ack?.({ ok: false });
    room.answers[player.id] = { playerId: player.id, choice: selected, elapsed: Math.max(0, (Date.now() - room.answerStartedAt) / 1000) };
    sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:reveal', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id || room.phase !== 'question') return ack?.({ ok: false });
    const correct = roomQuestions(room)[room.questionIndex].correct;
    Object.values(room.answers).forEach(answer => {
      const player = room.players.find(p => p.id === answer.playerId);
      if (player && answer.choice === correct) player.score += Math.max(250, Math.round(1000 - answer.elapsed * 18));
    });
    room.phase = 'leaderboard'; sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:next', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id || room.phase !== 'leaderboard') return ack?.({ ok: false });
    if (room.questionIndex >= roomQuestions(room).length - 1) room.phase = 'complete';
    else { room.questionIndex += 1; room.phase = 'question'; room.answers = {}; room.optionColors = shuffledColors(); room.answerStartedAt = Date.now(); room.answerDeadline = room.answerStartedAt + 30000; }
    sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:sync', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (room && socket.data.roomCode === room.code) ack?.({ ok: true, game: publicGame(room) });
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      if (room.hostId === socket.id) { io.to(room.code).emit('game:ended'); rooms.delete(room.code); break; }
      const player = room.players.find(p => p.id === socket.data.playerId);
      if (player) { player.connected = false; sendGame(room); }
    }
  });
});

const port = process.env.PORT || 3010;
server.listen(port, () => console.log(`HuddleUp server running on port ${port}`));
