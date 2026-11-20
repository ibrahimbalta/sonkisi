import { Client } from '../client/node_modules/colyseus.js/build/esm/index.mjs';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:2567';
const INITIAL_WAITING_BOTS = 9; // Keeps lobby at 9/10 until you press OYNA!
const EXTRA_JOIN_ON_COUNTDOWN = 8; // Joins during countdown so match has ~18 players!

const TILE_SIZE = 76;
const GRID_COLS = 12;
const GRID_ROWS = 12;

const AVATARS = [
  'dragon', 'wizard', 'knight', 'unicorn', 'phoenix', 'cyber',
  'elf', 'demon', 'angel', 'iceking', 'astronaut', 'king',
];

const NAMES = [
  'AlevEjder', 'MerlinTR', 'AltınŞövalye', 'KristalAt', 'AnkaKuşu',
  'SiberGolem', 'OrmanElfi', 'Gölgeİfrit', 'GökMeleği', 'BuzLordu',
  'Galaksi99', 'GökyüzüKralı', 'YıldızBüyü', 'FırtınaEjder', 'ŞimşekElf',
  'BulutMelek', 'GüneşAnka', 'KuzeyBuz', 'KızılŞövalye', 'KozmikKral',
];

const EMOJIS = ['😂', '😱', '😎', '🔥', '👋', '👑'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findNearestSafeTileCenter(tiles, safeColor, x, y, mistakeChance) {
  const candidates = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === safeColor) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const cx = col * TILE_SIZE + TILE_SIZE / 2;
      const cy = row * TILE_SIZE + TILE_SIZE / 2;
      candidates.push({ cx, cy, dist: Math.hypot(cx - x, cy - y) });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);

  // Occasionally pick a farther tile or hesitate so players get eliminated realistically
  if (Math.random() < mistakeChance && candidates.length > 3) {
    const pick = candidates[Math.min(candidates.length - 1, 3 + Math.floor(Math.random() * 5))];
    return { cx: pick.cx, cy: pick.cy };
  }
  const top = candidates[Math.floor(Math.random() * Math.min(2, candidates.length))];
  return { cx: top.cx, cy: top.cy };
}

async function spawnTestClient(index, onPhaseChange) {
  const client = new Client(SERVER_URL);
  const name = `${NAMES[index % NAMES.length]}${10 + index}`;
  const avatar = AVATARS[index % AVATARS.length];
  // Vary skill level so rounds naturally narrow down to a winner
  const skillDelayMs = 180 + Math.random() * 550;
  const mistakeChance = 0.12 + Math.random() * 0.28;

  const room = await client.joinOrCreate('sonkisi_public', {
    name,
    avatar,
    isPrivate: false,
  });

  let target = null;
  let lastRound = -1;
  let reactAt = 0;
  let wanderTarget = { x: 200 + Math.random() * 500, y: 200 + Math.random() * 500 };

  const interval = setInterval(() => {
    const state = room.state;
    if (!state || !state.players) return;
    const me = state.players.get(room.sessionId);
    if (!me || !me.alive) {
      room.send('input', { dx: 0, dy: 0 });
      return;
    }

    const phase = state.phase;
    if (onPhaseChange) onPhaseChange(phase);

    if (phase === 'lobby' || phase === 'countdown') {
      // Casually walk around the lobby
      if (Math.random() < 0.04) {
        wanderTarget = {
          x: 120 + Math.random() * (GRID_COLS * TILE_SIZE - 240),
          y: 120 + Math.random() * (GRID_ROWS * TILE_SIZE - 240),
        };
      }
      if (Math.random() < 0.01) {
        room.send('emoji', { emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] });
      }
      const dx = wanderTarget.x - me.x;
      const dy = wanderTarget.y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 20) {
        room.send('input', { dx: (dx / dist) * 0.65, dy: (dy / dist) * 0.65 });
      } else {
        room.send('input', { dx: 0, dy: 0 });
      }
      return;
    }

    if (phase === 'scramble' || phase === 'warning') {
      if (state.round !== lastRound) {
        lastRound = state.round;
        target = null;
        reactAt = Date.now() + skillDelayMs;
      }

      if (Date.now() < reactAt) {
        room.send('input', { dx: 0, dy: 0 });
        return;
      }

      if (!target) {
        const tilesArr = [];
        for (let i = 0; i < state.tiles.length; i++) tilesArr.push(state.tiles[i]);
        target = findNearestSafeTileCenter(
          tilesArr,
          state.safeColor,
          me.x,
          me.y,
          mistakeChance + state.round * 0.04
        );
      }

      if (target) {
        const dx = target.cx - me.x;
        const dy = target.cy - me.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 8) {
          room.send('input', { dx: dx / dist, dy: dy / dist });
        } else {
          room.send('input', { dx: 0, dy: 0 });
        }
      }
    } else if (phase === 'round_end') {
      target = null;
      if (Math.random() < 0.05) {
        room.send('emoji', { emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] });
      }
      room.send('input', { dx: 0, dy: 0 });
    } else {
      room.send('input', { dx: 0, dy: 0 });
    }
  }, 120);

  return {
    room,
    stop: async () => {
      clearInterval(interval);
      try {
        await room.leave(true);
      } catch {
        // Ignore
      }
    },
  };
}

async function runWave() {
  console.log(`[TestPlayers] Spawning ${INITIAL_WAITING_BOTS} real WebSocket test clients in lobby...`);
  const active = [];
  let extraSpawned = false;
  let matchFinished = false;

  const handlePhase = async (phase) => {
    if (phase === 'countdown' && !extraSpawned) {
      extraSpawned = true;
      console.log(`[TestPlayers] Countdown started! Adding ${EXTRA_JOIN_ON_COUNTDOWN} more test players...`);
      for (let i = 0; i < EXTRA_JOIN_ON_COUNTDOWN; i++) {
        await sleep(350);
        try {
          const c = await spawnTestClient(INITIAL_WAITING_BOTS + i);
          active.push(c);
        } catch {
          // Room might have locked
          break;
        }
      }
    } else if (phase === 'finished' && !matchFinished) {
      matchFinished = true;
      console.log('[TestPlayers] Match finished! Re-queuing fresh lobby in 5s...');
      await sleep(5000);
      for (const c of active) {
        await c.stop();
      }
      active.length = 0;
      setTimeout(() => runWave(), 1000);
    }
  };

  for (let i = 0; i < INITIAL_WAITING_BOTS; i++) {
    try {
      const c = await spawnTestClient(i, i === 0 ? handlePhase : undefined);
      active.push(c);
      await sleep(120);
    } catch (err) {
      console.error('[TestPlayers] Spawn error:', err.message);
    }
  }
  console.log(`[TestPlayers] Ready! ${active.length} test players waiting in public lobby (join via OYNA to trigger countdown!).`);
}

runWave();
