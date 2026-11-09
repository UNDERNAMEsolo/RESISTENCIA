// Cidade Dorme - servidor para rede local (sem dependências). Uso: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const WOLF = 'lobisomem', DOC = 'médico', SEER = 'vidente', VIL = 'morador';

let players = [], nid = 0, chatId = 0;
let g = { phase: 'lobby', round: 0, msg: '', winner: null, wolf: {}, doc: null, seer: null, seen: [], votes: {}, chat: [] };

const alive = () => players.filter(p => p.alive);
const wolves = () => alive().filter(p => p.role === WOLF);
const byId = id => players.find(p => p.id === +id);
const count = o => Object.keys(o).length;
const needs = r => alive().some(p => p.role === r);
const nightDone = () => wolves().every(w => w.id in g.wolf) && (!needs(DOC) || g.doc !== null) && (!needs(SEER) || g.seer !== null);
const canChat = p => g.phase === 'lobby' || g.phase === 'over' || ((g.phase === 'day' || g.phase === 'dayresult') && p.alive);

// Estado personalizado: cada jogador só recebe o que pode saber
function view(p) {
  const over = g.phase === 'over', isW = p.role === WOLF;
  const v = {
    phase: g.phase, round: g.round, msg: g.msg, winner: g.winner,
    me: { id: p.id, name: p.name, role: p.role, alive: p.alive, host: players[0] === p },
    players: players.map(x => ({
      id: x.id, name: x.name, alive: x.alive,
      role: (over || !x.alive || x === p || (isW && x.role === WOLF)) ? x.role : undefined
    })),
    nvoted: count(g.votes), nalive: alive().length, chat: g.chat, canChat: canChat(p)
  };
  if (g.phase === 'night') {
    v.done = !p.alive || (isW ? p.id in g.wolf : p.role === DOC ? g.doc !== null : p.role === SEER ? g.seer !== null : true);
    if (isW) v.wolfPicks = g.wolf;
  }
  if (g.phase === 'day') v.voted = p.id in g.votes;
  if (p.role === SEER) v.seen = g.seen;
  return v;
}

function send() {
  for (const p of players) if (p.res) p.res.write('data: ' + JSON.stringify(view(p)) + '\n\n');
}

function startNight() {
  Object.assign(g, { phase: 'night', msg: '', wolf: {}, doc: null, seer: null, votes: {} });
  g.round++;
}

function check() {
  const w = wolves().length, o = alive().length - w;
  if (!w) { g.phase = 'over'; g.winner = 'cidade'; }
  else if (w >= o) { g.phase = 'over'; g.winner = 'lobisomens'; }
}

function resolveNight() {
  const c = {};
  Object.values(g.wolf).forEach(i => c[i] = (c[i] || 0) + 1);
  const m = Math.max(...Object.values(c));
  const top = Object.keys(c).filter(k => c[k] === m);
  const vic = byId(top[Math.floor(Math.random() * top.length)]);
  if (vic.id !== g.doc) { vic.alive = false; g.msg = `☀️ Amanheceu. ${vic.name} foi morto(a) pelos lobisomens. Era ${vic.role}.`; }
  else g.msg = '☀️ Amanheceu. Ninguém morreu esta noite.';
  g.phase = 'day'; g.votes = {}; check();
}

function tally() {
  const c = {};
  Object.values(g.votes).forEach(i => c[i] = (c[i] || 0) + 1);
  const m = Math.max(0, ...Object.values(c));
  const top = Object.keys(c).filter(k => c[k] === m);
  if (top.length === 1) {
    const v = byId(top[0]); v.alive = false;
    g.msg = `A cidade votou: ${v.name} foi eliminado(a). Era ${v.role}.`;
  } else g.msg = 'Empate na votação. Ninguém foi eliminado.';
  g.phase = 'dayresult'; check();
}

function act(p, b) {
  const host = players[0] === p, t = byId(b.target), n = players.length;
  switch (b.a) {
    case 'say': {
      const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text || !canChat(p)) return;
      const now = Date.now();
      if (now - (p.lastSay || 0) < 700) return;
      p.lastSay = now;
      g.chat.push({ id: ++chatId, pid: p.id, name: p.name, text });
      if (g.chat.length > 60) g.chat.shift();
      break;
    }
    case 'start': {
      if (!host || g.phase !== 'lobby' || n < 4) return;
      const max = Math.max(1, Math.floor((n - 1) / 2));
      const nw = Math.min(max, Math.max(1, +b.wolves || Math.floor(n / 4)));
      const roles = [...Array(nw).fill(WOLF), DOC, SEER, ...Array(n - nw - 2).fill(VIL)];
      for (let i = roles.length; i > 1;) { const j = Math.floor(Math.random() * i--); [roles[i], roles[j]] = [roles[j], roles[i]]; }
      players.forEach((x, i) => { x.role = roles[i]; x.alive = true; });
      Object.assign(g, { round: 0, winner: null, seen: [], chat: [] });
      startNight(); break;
    }
    case 'pick': {
      if (g.phase !== 'night' || !p.alive || !t || !t.alive) return;
      if (p.role === WOLF) { if (t.role === WOLF || p.id in g.wolf) return; g.wolf[p.id] = t.id; }
      else if (p.role === DOC) { if (g.doc !== null) return; g.doc = t.id; }
      else if (p.role === SEER) { if (g.seer !== null || t === p) return; g.seer = t.id; g.seen.push({ name: t.name, wolf: t.role === WOLF }); }
      else return;
      if (nightDone()) resolveNight();
      break;
    }
    case 'vote':
      if (g.phase !== 'day' || !p.alive || !t || !t.alive || t === p || p.id in g.votes) return;
      g.votes[p.id] = t.id;
      if (count(g.votes) === alive().length) tally();
      break;
    case 'tally': if (host && g.phase === 'day') tally(); break;
    case 'next': if (host && g.phase === 'dayresult') startNight(); break;
    case 'reset':
      if (!host) return;
      players = players.filter(x => x.res);
      players.forEach(x => { x.role = undefined; x.alive = true; });
      Object.assign(g, { phase: 'lobby', round: 0, msg: '', winner: null, chat: [] });
      break;
    default: return;
  }
  send();
}

const J = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d)); } catch { r({}); } }); });
const drop = p => { if (!p.res && g.phase === 'lobby') { players = players.filter(x => x !== p); send(); } };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  if (req.method === 'GET' && u.pathname === '/events') {
    const p = players.find(x => x.t === u.searchParams.get('t'));
    if (!p) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    p.res = res; res.write('retry: 2000\n\n'); send();
    const ka = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ka); if (p.res === res) p.res = null; setTimeout(drop, 15000, p); });
    return;
  }
  if (req.method === 'POST') {
    const b = await readBody(req);
    if (u.pathname === '/join') {
      let p = players.find(x => x.t === b.t);
      if (!p) {
        const name = String(b.name || '').trim().slice(0, 16);
        if (g.phase !== 'lobby') return J(res, 403, { error: 'Partida em andamento. Aguarde a próxima.' });
        if (!name) return J(res, 400, { error: 'Digite seu nome para entrar.' });
        if (players.some(x => x.name.toLowerCase() === name.toLowerCase())) return J(res, 409, { error: 'Esse nome já está em uso.' });
        p = { id: ++nid, t: crypto.randomBytes(8).toString('hex'), name, alive: true };
        players.push(p);
      }
      return J(res, 200, { t: p.t });
    }
    if (u.pathname === '/act') {
      const p = players.find(x => x.t === b.t);
      if (p) act(p, b);
      return J(res, 200, {});
    }
  }
  res.writeHead(404); res.end();
}).listen(PORT, '0.0.0.0', () => {
  console.log('🌙 Cidade Dorme no ar! Abra um destes endereços nos celulares/computadores da mesma rede:');
  for (const l of Object.values(os.networkInterfaces()))
    for (const i of l) if ((i.family === 'IPv4' || i.family === 4) && !i.internal) console.log(`   http://${i.address}:${PORT}`);
  console.log('O primeiro jogador a entrar é o anfitrião e inicia a partida.');
});
