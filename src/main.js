import './style.css';
import './animations.css';
import { io } from 'socket.io-client';

const state = {
  view: 'home', game: null, player: null, selected: null, joinedAt: 0,
  answering: false, created: false, lastQuestionAt: 0, answerDeadline: 0, timeLeft: 30, resumeToken: null
};
const socket = io();
const $ = (selector) => document.querySelector(selector);
const icons = ['▲', '◆', '●', '■'];
const SESSION_KEY = 'huddleup-player-session';
let timerInterval;

function setGame(game) {
  const enteredQuestion = state.game?.phase !== 'question' && game.phase === 'question';
  state.game = game; state.answerDeadline = game.answerDeadline || 0;
  if (state.player) state.player = game.players.find(player => player.id === state.player.id) || state.player;
  if (enteredQuestion) { state.answering = false; state.selected = null; }
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
    if (next === 0) render();
  };
  tick(); timerInterval = setInterval(tick, 250);
}
function savedSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify({ code: state.game.code, name: state.player.name, resumeToken: state.resumeToken })); }
function resumeSession() {
  const session = savedSession(); if (!session || state.created) return;
  socket.emit('game:join', session, result => {
    if (!result.ok) { localStorage.removeItem(SESSION_KEY); return; }
    state.player = result.player; state.resumeToken = result.resumeToken; state.created = false; state.view = 'player-lobby'; setGame(result.game); render();
  });
}

function createGame() {
  socket.emit('game:create', result => {
    if (!result.ok) return;
    state.game = result.game; state.created = true; state.player = null; state.view = 'host'; render();
  });
}

function joinGame(name, code) {
  socket.emit('game:join', { name, code }, result => {
    if (!result.ok) { $('#error').textContent = result.error; return; }
    state.player = result.player; state.resumeToken = result.resumeToken; state.created = false; state.view = 'player-lobby'; setGame(result.game); saveSession(); render();
  });
}

function startQuestion() {
  socket.emit('game:start', { code: state.game.code });
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

socket.on('connect', resumeSession);
socket.on('game:update', game => { setGame(game); render(); });
socket.on('game:ended', () => { clearInterval(timerInterval); localStorage.removeItem(SESSION_KEY); state.view = 'home'; state.game = null; state.player = null; state.created = false; render(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.game && !state.created) socket.emit('game:sync', { code: state.game.code }, result => { if (result?.ok) { setGame(result.game); render(); } });
});

function render() {
  const app = $('#app');
  if (state.view === 'home') app.innerHTML = home();
  else if (state.view === 'host') app.innerHTML = host();
  else if (state.view === 'player-lobby' && state.game?.phase === 'lobby') app.innerHTML = playerLobby();
  else app.innerHTML = playerGame();
  bind();
}

function logo() { return `<a class="logo" href="#"><span class="logo-mark">✦</span> huddle<span>up</span></a>`; }
function home() { const pin = new URLSearchParams(location.search).get('pin') || ''; return `<main class="home"><nav>${logo()}<div class="nav-links"><a href="#how">How it works</a><a href="#play">For teams</a></div><button class="text-btn" id="host-link">Host a game <span>→</span></button></nav><section class="hero"><div class="eyebrow"><i></i> LIVE, TOGETHER</div><h1>Bring your<br><em>room</em> to life.</h1><p>HuddleUp turns everyday questions into a shared rush. Make a game, invite your people, and see who takes the crown.</p><div class="join-card"><div><label>YOUR NAME</label><input id="name" maxlength="18" placeholder="e.g. Maya" /></div><div><label>GAME PIN</label><input id="pin" maxlength="6" inputmode="numeric" value="${pin.replace(/\D/g, '').slice(0, 6)}" placeholder="6-digit code" /></div><button class="primary" id="join">Join now <span>→</span></button><small id="error"></small></div><div class="micro-copy"><span>✦ No downloads</span><span>◉ Live scoring</span><span>⌁ Up to 100 players</span></div><button class="host-cta" id="create"><span class="spark">✦</span><span><b>Host a new game</b><small>Start a free room in under a minute</small></span><strong>→</strong></button></section><aside class="game-preview"><div class="preview-top"><span><i></i> LIVE ROOM</span><b>24 players</b></div><p>Who is most likely to win a pop quiz?</p><div class="preview-options"><span>▲ Alex</span><span>◆ You</span><span>● Sam</span><span>■ Taylor</span></div><div class="preview-bottom"><div class="tiny-avatars"><i>J</i><i>M</i><i>R</i><i>+</i></div><b>Answers coming in…</b></div></aside><aside class="floating-card"><b>+12</b><span>joined just now</span></aside><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="grid-glow"></div></main>`; }
function host() {
  const g = state.game, q = g.questions?.[g.questionIndex], count = Object.keys(g.answers).length;
  if (g.phase === 'lobby') { const link = `${location.origin}/?pin=${g.code}`; return `<main class="room host-room"><header>${logo()}<span class="status"><i></i> LIVE ROOM</span></header><section class="lobby"><div class="pin-label">GAME PIN</div><div class="big-pin">${g.code}</div><p>Share the room link or have players enter the PIN.</p><button class="share-link" id="copy-link" data-link="${link}"><span>↗</span><b>${link.replace(/^https?:\/\//, '')}</b><em>Copy link</em></button><div class="people player-list">${g.players.length ? g.players.map((p,i)=>`<span class="player-chip"><i class="av a${i % 5}">${p.name[0].toUpperCase()}</i><b>${p.name}</b></span>`).join('') : '<span class="empty-players">Waiting for players to join…</span>'}</div><b class="player-total">${g.players.length} player${g.players.length === 1 ? '' : 's'} in the room</b><button class="primary massive" id="start" ${g.players.length ? '' : 'disabled'}>Start the game <span>→</span></button><small class="hint">${g.players.length ? 'Everyone is ready. Let’s go!' : 'Waiting for your first player…'}</small></section></main>`; }
  if (g.phase === 'question') return `<main class="room host-room"><header>${logo()}<span class="round">QUESTION ${g.questionIndex + 1} / ${g.questionCount}</span></header><section class="host-question"><div class="q-meta"><span class="q-pill">LIVE QUESTION</span><span class="answer-progress"><b>${count}</b> / ${g.players.length} ANSWERED <em>· ${Math.max(0, g.players.length - count)} ANSWERING</em></span></div><h2>${q.question}</h2><div class="answer-grid mini">${q.answers.map((a,i)=>`<div class="answer ${q.colors[i]}"><b>${icons[i]}</b>${a}</div>`).join('')}</div><button class="primary reveal" id="reveal">Reveal answers <span>→</span></button></section></main>`;
  return results(true);
}
function playerLobby() { return `<main class="room player-room"><header>${logo()}<span class="status"><i></i> CONNECTED</span></header><section class="waiting"><div class="waiting-icon">✦</div><div class="eyebrow">YOU’RE IN!</div><h2>Hey, ${state.player.name}.</h2><p>Get comfortable — the host will start the game any moment.</p><div class="game-chip"><span>HuddleUp Trivia</span><b>PIN ${state.game.code}</b></div><div class="pulse-row"><i></i><i></i><i></i></div></section></main>`; }
function playerGame() {
  const g = state.game;
  if (g.phase === 'lobby') return playerLobby();
  if (g.phase === 'complete' || g.phase === 'leaderboard') return results(false);
  const q = g.questions?.[g.questionIndex];
  return `<main class="room player-room"><header>${logo()}<span class="round">${g.questionIndex + 1} / ${g.questionCount}</span><span class="score">${state.player.score} pts</span></header><section class="question"><div class="timer ${state.timeLeft <= 5 ? 'urgent' : ''}"><span>${state.answering ? '✓' : state.timeLeft}</span></div><p class="question-count">QUESTION ${g.questionIndex + 1} · ${state.timeLeft ? 'ANSWER FAST' : 'TIME IS UP'}</p><h2 class="phone-prompt">Choose the color<br>of the right answer</h2><div class="answer-grid player-answers">${q.answers.map((_,i)=>`<button aria-label="Choose ${q.colors[i]} option" class="answer ${q.colors[i]} ${state.selected === i ? 'picked' : ''}" data-answer="${i}" ${state.answering || state.timeLeft <= 0 ? 'disabled' : ''}><b>${icons[i]}</b></button>`).join('')}</div>${state.answering ? `<p class="answered">Answer locked in — nice and quick!</p>` : state.timeLeft ? '<p class="choose">Match the color on the host screen</p>' : '<p class="choose">Waiting for the host to reveal the answer</p>'}</section></main>`;
}
function results(isHost) {
  const g = state.game, sorted = [...g.players].sort((a,b)=>b.score-a.score), done = g.phase === 'complete';
  return `<main class="room results"><header>${logo()}<span class="status"><i></i> ${done ? 'GAME COMPLETE' : 'ROUND RESULTS'}</span></header><section><div class="celebrate">${done ? '🏆' : '⚡'}</div><div class="eyebrow">${done ? 'FINAL LEADERBOARD' : 'SCORES UPDATED'}</div><h2>${done ? 'That was a huddle!' : 'Here’s how it stands'}</h2><div class="podium">${sorted.slice(0,5).map((p,i)=>`<div class="rank ${i===0?'winner':''}"><span>${i+1}</span><i class="av a${i}">${p.name[0].toUpperCase()}</i><b>${p.name}${p.id === state.player?.id ? ' (you)' : ''}</b><em>${p.score.toLocaleString()} pts</em></div>`).join('')}</div>${isHost ? `<button class="primary massive" id="${done ? 'again' : 'next'}">${done ? 'Play again' : 'Next question'} <span>→</span></button>` : `<p class="wait-next">${done ? 'Thanks for playing HuddleUp.' : 'Waiting for the host to continue…'}</p>`}</section></main>`;
}
function bind() {
  $('#host-link')?.addEventListener('click', createGame); $('#create')?.addEventListener('click', createGame);
  $('#join')?.addEventListener('click', () => joinGame($('#name').value, $('#pin').value.trim()));
  $('#pin')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#join').click(); });
  $('#start')?.addEventListener('click', startQuestion); $('#reveal')?.addEventListener('click', showLeaderboard); $('#next')?.addEventListener('click', nextQuestion); $('#again')?.addEventListener('click', createGame);
  $('#copy-link')?.addEventListener('click', async () => { const button = $('#copy-link'); await navigator.clipboard.writeText(button.dataset.link); button.querySelector('em').textContent = 'Copied!'; });
  document.querySelectorAll('[data-answer]').forEach(b => b.addEventListener('click', () => submitAnswer(Number(b.dataset.answer))));
}
render();
