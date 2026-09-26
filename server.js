require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const REACTIONS = require('./shared/reactions');
const { generateQuestions } = require('./questionGenerator');
const GENERATED_CATEGORIES = new Set(['general', 'ai']);

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
  logos: { title: 'Logo Quiz', questions: [
  { level: 'Easy', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/puma', answers: ['Puma', 'Adidas', 'Under Armour', 'New Balance'], correct: 0 },

  { level: 'Easy', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/bmw', answers: ['BMW', 'Audi', 'Volvo', 'Bentley'], correct: 0 },

  { level: 'Easy', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/toyota', answers: ['Toyota', 'Honda', 'Mazda', 'Suzuki'], correct: 0 },

  { level: 'Easy', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/samsung', answers: ['Samsung', 'LG', 'Sony', 'Panasonic'], correct: 0 },

  { level: 'Easy', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/spotify', answers: ['Spotify', 'Tidal', 'Deezer', 'SoundCloud'], correct: 0 },

  { level: 'Medium', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/ferrari', answers: ['Ferrari', 'Lamborghini', 'Maserati', 'Porsche'], correct: 0 },

  { level: 'Medium', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/dell', answers: ['HP', 'Lenovo', 'Dell', 'Acer'], correct: 2 },

  { level: 'Medium', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/discord', answers: ['Telegram', 'WhatsApp', 'Discord', 'Meta'], correct: 2 },

  { level: 'Medium', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/fedex', answers: ['UPS', 'DHL', 'Uber', 'FedEx'], correct: 3 },

  { level: 'Medium', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/airbnb', answers: ['Uber', 'Lyft', 'Airbnb', 'DHL'], correct: 2 },

  { level: 'Hard', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/xiaomi', answers: ['OnePlus', 'Oppo', 'Xiaomi', 'Vivo'], correct: 2 },

  { level: 'Hard', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/razer', answers: ['Asus', 'MSI', 'Razer', 'Acer'], correct: 2 },

  { level: 'Hard', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/peugeot', answers: ['Renault', 'Citroën', 'Audi', 'Peugeot'], correct: 3 },

  { level: 'Hard', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/fila', answers: ['Under Armour', 'New Balance', 'Fila', 'Puma'], correct: 2 },

  { level: 'Hard', question: 'Which brand does this logo belong to?', image: 'https://cdn.simpleicons.org/ikea', answers: ['IKEA', 'Meta', 'Shell', 'Red Bull'], correct: 0 }
] },
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const rooms = new Map();
const ANSWER_COLORS = ['coral', 'aqua', 'violet', 'sun'];
const COMPLETED_ROOM_TTL_MS = 30 * 60 * 1000;
const HOST_RECONNECT_GRACE_MS = 2 * 60 * 1000;
const ALLOWED_DURATIONS = [10, 15, 20, 30, 45, 60];
const LEVELS = ['Easy', 'Medium', 'Hard'];

app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

const makePin = () => String(Math.floor(100000 + Math.random() * 900000));
const roomQuestions = room => room.customQuestions || CATEGORIES[room.category].questions;

function validateCustomQuestions(questions) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 50) return null;
  const clean = [];
  for (const q of questions) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) return null;
    if (!Array.isArray(q.answers) || q.answers.length !== 4 || q.answers.some(a => typeof a !== 'string' || !a.trim())) return null;
    const correct = Number(q.correct);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;
    clean.push({
      level: LEVELS.includes(q.level) ? q.level : 'Custom',
      question: q.question.trim().slice(0, 200),
      answers: q.answers.map(a => String(a).trim().slice(0, 80)),
      correct,
    });
  }
  return clean;
}

function currentQuestionPayload(room) {
  if (room.phase !== 'question' && room.phase !== 'leaderboard') return undefined;
  const q = roomQuestions(room)[room.questionIndex];
  if (room.phase === 'question') { const { correct, ...rest } = q; return { ...rest, colors: room.optionColors }; }
  return { ...q, colors: room.optionColors };
}

function publicGame(room, viewerId) {
  const { hostId, hostToken, hostDisconnectTimer, answerStartedAt, answers, customQuestions, ...game } = room;
  return {
    ...game,
    players: room.players.map(({ id, name, score, connected, streak }) => ({
      id, name, score, connected, streak: streak || 0, roundResult: room.roundResults?.[id] || null,
    })),
    questionCount: roomQuestions(room).length,
    answerCount: Object.keys(answers).length,
    myAnswer: viewerId ? (answers[viewerId] || null) : null,
    question: currentQuestionPayload(room),
  };
}
function shuffledColors() { return [...ANSWER_COLORS].sort(() => Math.random() - 0.5); }
function sendGame(room) {
  const hostSocket = io.sockets.sockets.get(room.hostId);
  hostSocket?.emit('game:update', publicGame(room));
  room.players.forEach(player => {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.emit('game:update', publicGame(room, player.id));
  });
}

io.on('connection', socket => {
  socket.on('game:create', async ({ category, custom }, ack) => {
    let title, categoryKey = null, customQuestions = null;
    if (custom) {
      customQuestions = validateCustomQuestions(custom.questions);
      if (!customQuestions) return ack({ ok: false, error: 'Add at least one question with 4 filled-in answers.' });
      title = String(custom.title || 'Custom Quiz').trim().slice(0, 40) || 'Custom Quiz';
    } else {
      if (!CATEGORIES[category]) return ack({ ok: false, error: 'Choose a quiz category.' });
      categoryKey = category; title = CATEGORIES[category].title;
      if (GENERATED_CATEGORIES.has(category)) {
        const generated = await generateQuestions(category, CATEGORIES[category].questions.length);
        if (generated) customQuestions = generated;
      }
    }
    let code = makePin(); while (rooms.has(code)) code = makePin();
    const hostToken = randomUUID();
    const room = {
      code, title, category: categoryKey, customQuestions, phase: 'lobby', questionIndex: 0, players: [], answers: {}, roundResults: {},
      hostId: socket.id, hostToken, hostConnected: true, hostDisconnectTimer: null,
      questionDuration: 30000, answerStartedAt: 0, answerDeadline: 0,
    };
    rooms.set(code, room); socket.data.roomCode = room.code; socket.data.isHost = true; socket.join(code);
    ack({ ok: true, game: publicGame(room), hostToken });
  });

  socket.on('host:resume', ({ code, hostToken }, ack) => {
    const room = rooms.get(String(code));
    if (!room || !hostToken || room.hostToken !== hostToken) return ack?.({ ok: false });
    clearTimeout(room.hostDisconnectTimer); room.hostDisconnectTimer = null;
    room.hostId = socket.id; room.hostConnected = true;
    socket.data.roomCode = room.code; socket.data.isHost = true; socket.join(room.code);
    ack?.({ ok: true, game: publicGame(room), hostToken: room.hostToken });
    sendGame(room);
  });

  socket.on('game:join', ({ code, name, resumeToken }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.phase === 'complete') return ack({ ok: false, error: 'That game PIN is not active. Ask your host to check the code.' });
    let player = room.players.find(p => p.resumeToken === resumeToken);
    if (player) {
      player.socketId = socket.id; player.connected = true;
    } else {
      player = { id: randomUUID(), socketId: socket.id, resumeToken: randomUUID(), name: String(name || 'Quizzer').trim().slice(0, 18) || 'Quizzer', score: 0, streak: 0, connected: true };
      room.players.push(player);
    }
    socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.data.isHost = false; socket.join(room.code);
    ack({ ok: true, game: publicGame(room, player.id), player: { id: player.id, name: player.name, score: player.score, connected: true }, resumeToken: player.resumeToken }); sendGame(room);
  });

  socket.on('game:start', ({ code, duration }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id) return ack?.({ ok: false });
    const seconds = ALLOWED_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;
    room.questionDuration = seconds * 1000;
    room.phase = 'question'; room.answers = {}; room.roundResults = {}; room.optionColors = shuffledColors(); room.answerStartedAt = Date.now(); room.answerDeadline = room.answerStartedAt + room.questionDuration; sendGame(room); ack?.({ ok: true });
  });

  socket.on('answer:submit', ({ code, choice }, ack) => {
    const room = rooms.get(String(code));
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'question' || !player || !player.connected || room.answers[player.id] || Date.now() > room.answerDeadline) return ack?.({ ok: false });
    const selected = Number(choice); if (!Number.isInteger(selected) || selected < 0 || selected > 3) return ack?.({ ok: false });
    room.answers[player.id] = { playerId: player.id, choice: selected, elapsed: Math.max(0, (Date.now() - room.answerStartedAt) / 1000) };
    sendGame(room); ack?.({ ok: true });
  });

  socket.on('reaction:send', ({ code, emoji }, ack) => {
    const room = rooms.get(String(code));
    const player = room?.players.find(p => p.id === socket.data.playerId);
    if (!room || room.phase !== 'question' || !player || !REACTIONS.includes(emoji)) return ack?.({ ok: false });
    const now = Date.now();
    if (player.lastReactionAt && now - player.lastReactionAt < 700) return ack?.({ ok: false });
    player.lastReactionAt = now;
    io.to(room.code).emit('reaction:new', { id: `${player.id}-${now}`, emoji, name: player.name });
    ack?.({ ok: true });
  });

  socket.on('game:reveal', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id || room.phase !== 'question') return ack?.({ ok: false });
    const correct = roomQuestions(room)[room.questionIndex].correct;
    const previousRanks = new Map([...room.players].sort((a, b) => b.score - a.score).map((player, index) => [player.id, index + 1]));
    room.roundResults = {};
    room.players.forEach(player => {
      const answer = room.answers[player.id];
      const isCorrect = answer?.choice === correct;
      const points = isCorrect ? Math.max(250, Math.round(1000 - answer.elapsed * 18)) : 0;
      player.score += points;
      player.streak = isCorrect ? (player.streak || 0) + 1 : 0;
      room.roundResults[player.id] = { isCorrect, points, streak: player.streak, previousRank: previousRanks.get(player.id) };
    });
    const fastest = Object.values(room.answers)
      .filter(answer => answer.choice === correct)
      .sort((a, b) => a.elapsed - b.elapsed)[0];
    if (fastest) room.roundResults[fastest.playerId].fastestCorrect = true;
    const currentRanks = new Map([...room.players].sort((a, b) => b.score - a.score).map((player, index) => [player.id, index + 1]));
    room.players.forEach(player => {
      const result = room.roundResults[player.id];
      result.rank = currentRanks.get(player.id);
      result.rankChange = result.previousRank - result.rank;
    });
    room.phase = 'leaderboard'; sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:next', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (!room || room.hostId !== socket.id || room.phase !== 'leaderboard') return ack?.({ ok: false });
    if (room.questionIndex >= roomQuestions(room).length - 1) {
      room.phase = 'complete';
      setTimeout(() => {
        if (rooms.get(room.code) === room && room.phase === 'complete') rooms.delete(room.code);
      }, COMPLETED_ROOM_TTL_MS);
    }
    else { room.questionIndex += 1; room.phase = 'question'; room.answers = {}; room.roundResults = {}; room.optionColors = shuffledColors(); room.answerStartedAt = Date.now(); room.answerDeadline = room.answerStartedAt + room.questionDuration; }
    sendGame(room); ack?.({ ok: true });
  });

  socket.on('game:sync', ({ code }, ack) => {
    const room = rooms.get(String(code));
    if (room && socket.data.roomCode === room.code) ack?.({ ok: true, game: publicGame(room, socket.data.playerId) });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.data.isHost && room.hostId === socket.id) {
      room.hostConnected = false;
      room.hostDisconnectTimer = setTimeout(() => {
        if (rooms.get(room.code) === room && !room.hostConnected) { io.to(room.code).emit('game:ended'); rooms.delete(room.code); }
      }, HOST_RECONNECT_GRACE_MS);
      return;
    }
    const player = room.players.find(p => p.id === socket.data.playerId);
    if (player) { player.connected = false; sendGame(room); }
  });
});

const port = process.env.PORT || 3010;
server.listen(port, () => console.log(`HuddleUp server running on port ${port}`));
