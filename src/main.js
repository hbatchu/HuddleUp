import './style.css';
import './animations.css';
import './categories.css';
import './features.css';
import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import REACTIONS from '../shared/reactions.js';

const state = {
  view: 'home', game: null, player: null, selected: null, joinedAt: 0,
  answering: false, created: false, lastQuestionAt: 0, answerDeadline: 0, timeLeft: 30, resumeToken: null, reactions: [],
  hostToken: null, muted: false, creatingGame: false,
};
const socket = io();
const $ = (selector) => document.querySelector(selector);
const icons = ['▲', '◆', '●', '■'];
const safeText = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const playerInitial = name => safeText(String(name).charAt(0).toUpperCase());
const SESSION_KEY = 'huddleup-player-session';
const HOST_SESSION_KEY = 'huddleup-host-session';
const MUTE_KEY = 'huddleup-muted';
const DURATIONS = [10, 15, 20, 30, 45, 60];
let timerInterval;

try { state.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage unavailable */ }

// --- sound ---
let audioCtx;
function beep(freq, duration = 0.12, type = 'sine', gain = 0.05, delay = 0) {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq; g.gain.value = gain;
    osc.connect(g); g.connect(audioCtx.destination);
    const startAt = audioCtx.currentTime + delay;
    osc.start(startAt); osc.stop(startAt + duration);
  } catch { /* audio unsupported or blocked */ }
}
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio unsupported */ }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
const playTick = () => beep(880, 0.05, 'square', 0.035);
const playStart = () => { beep(523, 0.1); beep(659, 0.1, 'sine', 0.05, 0.1); beep(784, 0.14, 'sine', 0.05, 0.2); };
const playReveal = () => { beep(660, 0.15); beep(880, 0.18, 'sine', 0.05, 0.12); };
const playCorrect = () => { beep(784, 0.1); beep(988, 0.16, 'sine', 0.05, 0.1); };
const playWrong = () => beep(220, 0.22, 'sawtooth', 0.04);

function setGame(game) {
  const previous = state.game;
  const questionChanged = previous?.questionIndex !== game.questionIndex || previous?.phase !== game.phase;
  const enteredQuestion = previous?.phase !== 'question' && game.phase === 'question';
  const enteredLeaderboard = previous?.phase !== 'leaderboard' && game.phase === 'leaderboard';
  state.game = game; state.answerDeadline = game.answerDeadline || 0;
  if (state.player) state.player = game.players.find(player => player.id === state.player.id) || state.player;
  if (game.phase === 'question') {
    state.answering = !!game.myAnswer;
    state.selected = game.myAnswer ? game.myAnswer.choice : null;
  }
  if (questionChanged) state.reactions = [];
  if (enteredQuestion && previous) playStart();
  if (enteredLeaderboard) {
    playReveal();
    const me = state.player && game.players.find(p => p.id === state.player.id);
    if (me?.roundResult) setTimeout(() => (me.roundResult.isCorrect ? playCorrect() : playWrong()), 450);
  }
  syncTimer();
}
function syncTimer() {
  clearInterval(timerInterval);
  if (state.game?.phase !== 'question' || !state.answerDeadline) return;
  const tick = () => {
    const next = Math.max(0, Math.ceil((state.answerDeadline - Date.now()) / 1000));
    if (next === state.timeLeft) return;
    state.timeLeft = next;
    const timer = $('.timer');
    const timerValue = $('.timer span');
    if (timerValue && !state.answering) timerValue.textContent = next;
    if (timer) timer.classList.toggle('urgent', next <= 5);
    if (next > 0 && next <= 5 && !state.answering) playTick();
    if (next === 0) render();
  };
  tick(); timerInterval = setInterval(tick, 250);
}
function savedSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function saveSession() { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ code: state.game.code, name: state.player.name, resumeToken: state.resumeToken })); } catch { /* storage unavailable */ } }
function savedHostSession() { try { return JSON.parse(localStorage.getItem(HOST_SESSION_KEY)); } catch { return null; } }
function saveHostSession() { try { localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ code: state.game.code, hostToken: state.hostToken })); } catch { /* storage unavailable */ } }
function clearSessions() {
  try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(HOST_SESSION_KEY); } catch { /* storage unavailable */ }
}
function resumePlayerSession() {
  const session = savedSession(); if (!session || state.created) return;
  socket.emit('game:join', session, result => {
    if (!result.ok) { try { localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ } return; }
    state.player = result.player; state.resumeToken = result.resumeToken; state.created = false; state.view = 'player-lobby'; setGame(result.game); render();
  });
}
function resumeSession() {
  const hostSession = savedHostSession();
  if (hostSession && !state.created) {
    socket.emit('host:resume', hostSession, result => {
      if (result?.ok) {
        state.hostToken = result.hostToken; state.created = true; state.player = null; state.view = 'host'; setGame(result.game); render();
      } else {
        try { localStorage.removeItem(HOST_SESSION_KEY); } catch { /* storage unavailable */ }
        resumePlayerSession();
      }
    });
    return;
  }
  resumePlayerSession();
}

function setBuilderBusy(busy) {
  document.querySelectorAll('#quiz-rows input, #quiz-rows select, #quiz-title, #add-question, #back-category').forEach(el => { el.disabled = busy; });
  const btn = $('#build-start'), label = $('#build-start-label');
  if (btn) btn.disabled = busy;
  if (label) label.textContent = busy ? 'Creating…' : 'Create & start game';
}
function createGame(category, custom) {
  if (state.creatingGame) return;
  state.creatingGame = true;
  // Avoid a full render() while on the builder view — it would regenerate
  // fresh empty question rows and wipe whatever the host already typed.
  if (state.view === 'build') setBuilderBusy(true); else render();
  socket.emit('game:create', custom ? { custom } : { category }, result => {
    state.creatingGame = false;
    if (!result.ok) {
      if (custom) { const err = $('#quiz-error'); if (err) err.textContent = result.error || 'Could not create that quiz.'; }
      if (state.view === 'build') setBuilderBusy(false); else render();
      return;
    }
    state.game = result.game; state.created = true; state.player = null; state.hostToken = result.hostToken; saveHostSession(); state.view = 'host'; render();
  });
}

function joinGame(name, code) {
  socket.emit('game:join', { name, code }, result => {
    if (!result.ok) { $('#error').textContent = result.error; return; }
    state.player = result.player; state.resumeToken = result.resumeToken; state.created = false; state.view = 'player-lobby'; setGame(result.game); saveSession(); render();
  });
}

function startQuestion() {
  const duration = Number($('#duration')?.value) || 30;
  socket.emit('game:start', { code: state.game.code, duration });
}
function showLeaderboard() {
  socket.emit('game:reveal', { code: state.game.code });
}
function nextQuestion() {
  socket.emit('game:next', { code: state.game.code });
}
function submitAnswer(choice) {
  if (state.answering || state.game.phase !== 'question' || state.timeLeft <= 0) return;
  state.answering = true; state.selected = choice;
  socket.emit('answer:submit', { code: state.game.code, choice }, result => {
    if (!result.ok) { state.answering = false; state.selected = null; }
    render();
  });
  render();
}
function sendReaction(emoji) {
  if (state.game?.phase !== 'question') return;
  socket.emit('reaction:send', { code: state.game.code, emoji });
}
function reactionShelf(showControls = true) {
  const recent = state.reactions.slice(-6);
  return `<div class="reaction-area"><div class="reaction-feed" aria-live="polite">${recent.map(reaction => `<span class="reaction-pop" title="${safeText(reaction.name)} reacted">${reaction.emoji}</span>`).join('')}</div>${showControls ? `<div class="reaction-bar" aria-label="Send a reaction">${REACTIONS.map(emoji => `<button class="reaction-button" data-reaction="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join('')}</div>` : ''}</div>`;
}
function hostWarning(g) { return g.hostConnected === false ? `<div class="host-warning">⚠ Host disconnected — hang tight, they may reconnect any moment.</div>` : ''; }

socket.on('connect', resumeSession);
socket.on('game:update', game => { setGame(game); render(); });
socket.on('reaction:new', reaction => {
  state.reactions.push(reaction);
  state.reactions = state.reactions.slice(-6);
  render();
  setTimeout(() => {
    state.reactions = state.reactions.filter(item => item.id !== reaction.id);
    if (state.game?.phase === 'question') render();
  }, 2600);
});
socket.on('game:ended', () => { clearInterval(timerInterval); clearSessions(); state.view = 'home'; state.game = null; state.player = null; state.created = false; state.hostToken = null; render(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.game && !state.created) socket.emit('game:sync', { code: state.game.code }, result => { if (result?.ok) { setGame(result.game); render(); } });
});

function render() {
  const app = $('#app');
  if (state.view === 'home') app.innerHTML = home();
  else if (state.view === 'category') app.innerHTML = categoryPicker();
  else if (state.view === 'build') app.innerHTML = quizBuilder();
  else if (state.view === 'host') app.innerHTML = host();
  else if (state.view === 'player-lobby' && state.game?.phase === 'lobby') app.innerHTML = playerLobby();
  else app.innerHTML = playerGame();
  bind();
}

function muteToggle() { return `<button type="button" class="mute-toggle" id="mute-toggle" aria-label="${state.muted ? 'Unmute sound' : 'Mute sound'}" aria-pressed="${state.muted}">${state.muted ? '🔇' : '🔊'}</button>`; }
function logo() { return `<div class="brand-row"><a class="logo" href="#"><span class="logo-mark">✦</span> huddle<span>up</span></a>${muteToggle()}</div>`; }
function categoryPicker() {
  const busy = state.creatingGame;
  return `<main class="room category-room"><header>${logo()}<button class="text-btn" id="back-home" ${busy ? 'disabled' : ''}>← Back</button></header><section class="category-picker"><div class="eyebrow">CREATE A LIVE GAME</div><h2>Choose your quiz</h2><p>Ready-made sets built for an exciting crowd, or build your own from scratch.</p>${busy ? '<div class="creating-status">✦ Generating fresh questions with AI…</div>' : ''}<div class="category-grid"><button class="category-card general" data-category="general" ${busy ? 'disabled' : ''}><span class="category-icon">◌</span><em>12 QUESTIONS · EASY → HARD</em><b>General<br>Knowledge</b><small>Ideas, science, economics, culture</small><strong>Start game →</strong></button><button class="category-card ai" data-category="ai" ${busy ? 'disabled' : ''}><span class="category-icon">✦</span><em>12 QUESTIONS · EASY → HARD</em><b>AI</b><small>LLMs, agents, data, and modern ML</small><strong>Start game →</strong></button><button class="category-card logos" data-category="logos" ${busy ? 'disabled' : ''}><span class="category-icon">◆</span><em>15 QUESTIONS · EASY → HARD</em><b>Logo<br>Quiz</b><small>Food, cars, tech, footwear &amp; more</small><strong>Start game →</strong></button><button class="category-card custom" id="build-own" ${busy ? 'disabled' : ''}><span class="category-icon">✎</span><em>YOUR QUESTIONS · ANY LENGTH</em><b>Build<br>your own</b><small>Write your own questions and answers</small><strong>Start building →</strong></button></div></section></main>`;
}
function home() { const pin = new URLSearchParams(location.search).get('pin') || ''; return `<main class="home"><nav>${logo()}<div class="nav-links"><a href="#how">How it works</a><a href="#play">For teams</a></div><button class="text-btn" id="host-link">Host a game <span>→</span></button></nav><section class="hero"><div class="eyebrow"><i></i> LIVE, TOGETHER</div><h1>Bring your<br><em>room</em> to life.</h1><p>HuddleUp turns everyday questions into a shared rush. Make a game, invite your people, and see who takes the crown.</p><div class="join-card"><div><label>YOUR NAME</label><input id="name" maxlength="18" placeholder="e.g. Maya" /></div><div><label>GAME PIN</label><input id="pin" maxlength="6" inputmode="numeric" value="${pin.replace(/\D/g, '').slice(0, 6)}" placeholder="6-digit code" /></div><button class="primary" id="join">Join now <span>→</span></button><small id="error"></small></div><div class="micro-copy"><span>✦ No downloads</span><span>◉ Live scoring</span><span>⌁ Up to 100 players</span></div><button class="host-cta" id="create"><span class="spark">✦</span><span><b>Host a new game</b><small>Start a free room in under a minute</small></span><strong>→</strong></button></section><aside class="game-preview"><div class="preview-top"><span><i></i> LIVE ROOM</span><b>24 players</b></div><p>Who is most likely to win a pop quiz?</p><div class="preview-options"><span>▲ Alex</span><span>◆ You</span><span>● Sam</span><span>■ Taylor</span></div><div class="preview-bottom"><div class="tiny-avatars"><i>J</i><i>M</i><i>R</i><i>+</i></div><b>Answers coming in…</b></div></aside><aside class="floating-card"><b>+12</b><span>joined just now</span></aside><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="grid-glow"></div></main>`; }
function durationPicker() { return `<div class="duration-picker"><span>Time per question</span><select id="duration" aria-label="Time per question">${DURATIONS.map(d => `<option value="${d}" ${d === 30 ? 'selected' : ''}>${d}s</option>`).join('')}</select></div>`; }
function host() {
  const g = state.game, q = g.question, count = g.answerCount;
  if (g.phase === 'lobby') { const link = `${location.origin}/?pin=${g.code}`; return `<main class="room host-room"><header>${logo()}<span class="status"><i></i> LIVE ROOM</span></header><section class="lobby"><div class="eyebrow">${safeText(g.title).toUpperCase()}</div><div class="pin-label">GAME PIN</div><div class="big-pin">${g.code}</div><p>Share the room link or have players enter the PIN.</p><div class="join-methods"><button class="share-link" id="copy-link" data-link="${link}"><span>↗</span><b>${link.replace(/^https?:\/\//, '')}</b><em>Copy link</em></button><canvas id="join-qr" class="join-qr" aria-label="QR code that opens the join link"></canvas></div><div class="people player-list">${g.players.length ? g.players.map((p,i)=>`<span class="player-chip"><i class="av a${i % 5}">${playerInitial(p.name)}</i><b>${safeText(p.name)}</b></span>`).join('') : '<span class="empty-players">Waiting for players to join…</span>'}</div><b class="player-total">${g.players.length} player${g.players.length === 1 ? '' : 's'} in the room</b>${durationPicker()}<button class="primary massive" id="start" ${g.players.length ? '' : 'disabled'}>Start the game <span>→</span></button><small class="hint">${g.players.length ? 'Everyone is ready. Let’s go!' : 'Waiting for your first player…'}</small></section></main>`; }
  if (g.phase === 'question') return `<main class="room host-room"><header>${logo()}<span class="round">QUESTION ${g.questionIndex + 1} / ${g.questionCount}</span></header><section class="host-question"><div class="q-meta"><span class="q-pill">${q.level.toUpperCase()} · ${safeText(g.title).toUpperCase()}</span><span class="answer-progress"><b>${count}</b> / ${g.players.length} ANSWERED <em>· ${Math.max(0, g.players.length - count)} ANSWERING</em></span></div><h2>${safeText(q.question)}</h2>${q.image ? `<img class="question-image" src="${q.image}" alt="Visual cue for the question">` : ''}<div class="answer-grid mini">${q.answers.map((a,i)=>`<div class="answer ${q.colors[i]}"><b>${icons[i]}</b>${safeText(a)}</div>`).join('')}</div>${reactionShelf(false)}<button class="primary reveal" id="reveal">Reveal answers <span>→</span></button></section></main>`;
  return results(true);
}
function playerLobby() { return `<main class="room player-room"><header>${logo()}<span class="status"><i></i> CONNECTED</span></header><section class="waiting">${hostWarning(state.game)}<div class="waiting-icon">✦</div><div class="eyebrow">YOU’RE IN!</div><h2>Hey, ${safeText(state.player.name)}.</h2><p>Get comfortable — the host will start the game any moment.</p><div class="game-chip"><span>${safeText(state.game.title)}</span><b>PIN ${state.game.code}</b></div><div class="pulse-row"><i></i><i></i><i></i></div></section></main>`; }
function playerGame() {
  const g = state.game;
  if (g.phase === 'lobby') return playerLobby();
  if (g.phase === 'complete' || g.phase === 'leaderboard') return results(false);
  const q = g.question;
  return `<main class="room player-room"><header>${logo()}<span class="round">${g.questionIndex + 1} / ${g.questionCount}</span><span class="score">${state.player.score} pts</span></header><section class="question">${hostWarning(g)}<div class="timer ${state.timeLeft <= 5 ? 'urgent' : ''}"><span>${state.answering ? '✓' : state.timeLeft}</span></div><p class="question-count">QUESTION ${g.questionIndex + 1} · ${state.timeLeft ? 'ANSWER FAST' : 'TIME IS UP'}</p><h2 class="phone-prompt">${safeText(q.question)}</h2><p class="answer-instruction">Choose the color of the right answer</p><div class="answer-grid player-answers">${q.answers.map((_,i)=>`<button aria-label="Choose ${q.colors[i]} option" class="answer ${q.colors[i]} ${state.selected === i ? 'picked' : ''}" data-answer="${i}" ${state.answering || state.timeLeft <= 0 ? 'disabled' : ''}><b>${icons[i]}</b></button>`).join('')}</div>${state.answering ? `<p class="answered">Answer locked in — nice and quick!</p>` : state.timeLeft ? '<p class="choose">Match the color on the host screen</p>' : '<p class="choose">Waiting for the host to reveal the answer</p>'}${reactionShelf()}</section></main>`;
}
function finalPodium(players) {
  const positions = [2, 1, 0].filter(index => players[index]);
  return `<div class="final-podium" aria-label="Final standings">${positions.map(index => {
    const player = players[index];
    const place = index + 1;
    const label = place === 1 ? '1st' : place === 2 ? '2nd' : '3rd';
    return `<div class="podium-place place-${place}"><div class="podium-player"><span class="place-medal">${label}</span><i class="av a${index}">${playerInitial(player.name)}</i><b>${safeText(player.name)}${player.id === state.player?.id ? ' <small>(you)</small>' : ''}</b><em>${player.score.toLocaleString()} pts</em></div><div class="podium-step"><span>${place}</span></div></div>`;
  }).join('')}</div>`;
}
function correctReveal(g) {
  if (!g.question || typeof g.question.correct !== 'number') return '';
  return `<div class="correct-reveal"><span>Correct answer</span><div class="answer ${g.question.colors[g.question.correct]}"><b>${icons[g.question.correct]}</b>${safeText(g.question.answers[g.question.correct])}</div></div>`;
}
function results(isHost) {
  const g = state.game, sorted = [...g.players].sort((a,b)=>b.score-a.score), done = g.phase === 'complete';
  const me = g.players.find(player => player.id === state.player?.id);
  const feedback = !done && me?.roundResult ? `<div class="round-feedback ${me.roundResult.isCorrect ? 'correct' : 'incorrect'}"><strong>${me.roundResult.isCorrect ? '✓ Correct!' : '✕ Not this time'}</strong><span>${me.roundResult.isCorrect ? `+${me.roundResult.points} points` : '+0 points'}</span>${me.roundResult.fastestCorrect ? '<em>⚡ Fastest correct!</em>' : ''}${me.roundResult.streak >= 2 ? `<em>🔥 ${me.roundResult.streak}-answer streak!</em>` : ''}</div>` : '';
  const movement = result => !result ? '' : result.rankChange > 0 ? `<small class="rank-move up">↑ ${result.rankChange}</small>` : result.rankChange < 0 ? `<small class="rank-move down">↓ ${Math.abs(result.rankChange)}</small>` : `<small class="rank-move same">—</small>`;
  const standings = done ? finalPodium(sorted) : `<div class="podium">${sorted.slice(0,5).map((p,i)=>`<div class="rank ${i===0?'winner':''}"><span>${i+1}</span><i class="av a${i}">${playerInitial(p.name)}</i><b>${safeText(p.name)}${p.id === state.player?.id ? ' (you)' : ''}<small class="rank-detail">${p.roundResult?.isCorrect ? `✓ +${p.roundResult.points}` : '✕ +0'}${p.roundResult?.fastestCorrect ? ' · ⚡ fastest' : ''}${p.streak >= 2 ? ` · 🔥 ${p.streak}` : ''}</small></b>${movement(p.roundResult)}<em>${p.score.toLocaleString()} pts</em></div>`).join('')}</div>`;
  return `<main class="room results ${done ? 'final-results' : ''}"><header>${logo()}<span class="status"><i></i> ${done ? 'GAME COMPLETE' : 'ROUND RESULTS'}</span></header><section>${!isHost ? hostWarning(g) : ''}<div class="celebrate">${done ? '🏆' : '⚡'}</div><div class="eyebrow">${done ? 'FINAL LEADERBOARD' : 'SCORES UPDATED'}</div><h2>${done ? 'That was a huddle!' : 'Here’s how it stands'}</h2>${feedback}${!done ? correctReveal(g) : ''}${standings}${isHost ? `<button class="primary massive" id="${done ? 'again' : 'next'}">${done ? 'Play again' : 'Next question'} <span>→</span></button>` : `<p class="wait-next">${done ? 'Thanks for playing HuddleUp.' : 'Waiting for the host to continue…'}</p>`}</section></main>`;
}

// --- quiz builder ---
let quizRowSeq = 0;
function quizRowTemplate() {
  const uid = ++quizRowSeq;
  return `<div class="quiz-row" data-row><div class="quiz-row-head"><b class="row-num"></b><select class="q-level" aria-label="Difficulty"><option>Easy</option><option selected>Medium</option><option>Hard</option></select><button type="button" class="text-btn remove-row" aria-label="Remove question">Remove</button></div><input type="text" class="q-text" placeholder="Type your question…" maxlength="200" />${[0,1,2,3].map(i => `<label class="q-answer-row"><input type="radio" name="correct-${uid}" class="q-correct" value="${i}" ${i === 0 ? 'checked' : ''} /><input type="text" class="q-answer" placeholder="Answer ${i + 1}" maxlength="80" /></label>`).join('')}</div>`;
}
function renumberRows() { document.querySelectorAll('.quiz-row .row-num').forEach((el, i) => { el.textContent = `Question ${i + 1}`; }); }
function quizBuilder() {
  const startRows = Array.from({ length: 3 }, quizRowTemplate).join('');
  return `<main class="room category-room"><header>${logo()}<button class="text-btn" id="back-category">← Back</button></header><section class="category-picker quiz-builder"><div class="eyebrow">BUILD YOUR OWN</div><h2>Create a quiz</h2><p>Add your questions, mark the correct answer, then start the game.</p><input type="text" id="quiz-title" class="quiz-title-input" maxlength="40" placeholder="Quiz title (optional)" /><div id="quiz-rows">${startRows}</div><button type="button" class="text-btn add-row" id="add-question">+ Add question</button><small id="quiz-error"></small><button class="primary massive" id="build-start"><b id="build-start-label">Create &amp; start game</b> <span>→</span></button></section></main>`;
}
function readCustomQuiz() {
  const rows = document.querySelectorAll('.quiz-row');
  const questions = [];
  for (const row of rows) {
    const question = row.querySelector('.q-text').value.trim();
    const level = row.querySelector('.q-level').value;
    const answers = [...row.querySelectorAll('.q-answer')].map(input => input.value.trim());
    const correctInput = row.querySelector('.q-correct:checked');
    if (!question || answers.some(a => !a) || !correctInput) return null;
    questions.push({ question, level, answers, correct: Number(correctInput.value) });
  }
  return questions;
}
function submitCustomQuiz() {
  const questions = readCustomQuiz();
  const errorEl = $('#quiz-error');
  if (!questions || !questions.length) { errorEl.textContent = 'Fill in every question and all 4 answers before starting.'; return; }
  errorEl.textContent = '';
  createGame(null, { title: $('#quiz-title').value.trim(), questions });
}

function bind() {
  $('#host-link')?.addEventListener('click', () => { state.view = 'category'; render(); }); $('#create')?.addEventListener('click', () => { state.view = 'category'; render(); }); $('#back-home')?.addEventListener('click', () => { state.view = 'home'; render(); });
  $('#mute-toggle')?.addEventListener('click', () => { state.muted = !state.muted; try { localStorage.setItem(MUTE_KEY, state.muted ? '1' : '0'); } catch { /* storage unavailable */ } render(); });
  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => createGame(button.dataset.category)));
  $('#build-own')?.addEventListener('click', () => { state.view = 'build'; render(); });
  $('#back-category')?.addEventListener('click', () => { state.view = 'category'; render(); });
  $('#join')?.addEventListener('click', () => joinGame($('#name').value, $('#pin').value.trim()));
  $('#pin')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#join').click(); });
  $('#start')?.addEventListener('click', startQuestion); $('#reveal')?.addEventListener('click', showLeaderboard); $('#next')?.addEventListener('click', nextQuestion); $('#again')?.addEventListener('click', () => { state.view = 'category'; render(); });
  $('#copy-link')?.addEventListener('click', async () => { const button = $('#copy-link'); await navigator.clipboard.writeText(button.dataset.link); button.querySelector('em').textContent = 'Copied!'; });
  document.querySelectorAll('[data-answer]').forEach(b => b.addEventListener('click', () => submitAnswer(Number(b.dataset.answer))));
  document.querySelectorAll('[data-reaction]').forEach(button => button.addEventListener('click', () => sendReaction(button.dataset.reaction)));
  const qrCanvas = $('#join-qr'), linkButton = $('#copy-link');
  if (qrCanvas && linkButton) QRCode.toCanvas(qrCanvas, linkButton.dataset.link, { width: 128, margin: 1, color: { dark: '#211a3c', light: '#00000000' } }).catch(() => {});
  const rowsContainer = $('#quiz-rows');
  if (rowsContainer) {
    renumberRows();
    $('#add-question')?.addEventListener('click', () => { rowsContainer.insertAdjacentHTML('beforeend', quizRowTemplate()); renumberRows(); });
    rowsContainer.addEventListener('click', e => {
      const removeBtn = e.target.closest('.remove-row'); if (!removeBtn) return;
      if (document.querySelectorAll('.quiz-row').length <= 1) return;
      removeBtn.closest('.quiz-row').remove(); renumberRows();
    });
    $('#build-start')?.addEventListener('click', submitCustomQuiz);
  }
}
render();
