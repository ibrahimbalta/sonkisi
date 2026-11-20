import { Client, Room } from 'colyseus.js';
import {
  ARENA_CONFIG,
  CHARACTERS,
  CLIENT_MESSAGES,
  REACTION_EMOJIS,
} from '../../../shared/src/index';

interface SimBot {
  room: Room;
  timerId: number;
}

const SIM_NAMES = [
  'SimEjder',
  'SimBüyücü',
  'SimŞövalye',
  'SimTekboynuz',
  'SimAnka',
  'SimGolem',
  'SimElf',
  'SimMelek',
  'SimBuz',
];

function evalMathClue(expr: string): number | null {
  if (!expr) return null;
  try {
    // Convert Turkish math symbols (×, ÷, √N) to safe arithmetic
    const normalized = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/√(\d+)/g, (_, n) => String(Math.round(Math.sqrt(Number(n)))));
    if (!/^[\d+\-*/()\s]+$/.test(normalized)) return null;
    // eslint-disable-next-line no-new-func
    const val = Number(new Function(`return (${normalized})`)());
    return Number.isFinite(val) ? Math.round(val) : null;
  } catch {
    return null;
  }
}

function findNextIntactTile(
  tiles: number[],
  clueColorId: number,
  x: number,
  y: number,
  solvedCol: number | null,
  solvedRow: number | null
): { cx: number; cy: number } | null {
  const cols = ARENA_CONFIG.GRID_COLS;
  const size = ARENA_CONFIG.TILE_SIZE;

  // If this bot finished solving the math clue, sprint toward (solvedCol, solvedRow)!
  if (
    solvedCol !== null &&
    solvedRow !== null &&
    solvedCol >= 1 &&
    solvedCol <= cols &&
    solvedRow >= 1 &&
    solvedRow <= ARENA_CONFIG.GRID_ROWS
  ) {
    return {
      cx: (solvedCol - 1) * size + size / 2,
      cy: (solvedRow - 1) * size + size / 2,
    };
  }

  const intact: { cx: number; cy: number; score: number }[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const v = tiles[i];
    if (v >= 0 && v < 10) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * size + size / 2;
      const cy = row * size + size / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < 28) continue;
      const bonus = v === clueColorId ? -45 : 0;
      intact.push({ cx, cy, score: d + bonus });
    }
  }
  if (intact.length === 0) return null;
  intact.sort((a, b) => a.score - b.score);
  const top = intact[Math.floor(Math.random() * Math.min(4, intact.length))];
  return { cx: top.cx, cy: top.cy };
}

export class SimulatorService {
  private bots: SimBot[] = [];

  public async spawnIntoPrivateRoom(
    serverUrl: string,
    roomCode: string,
    count = 9
  ): Promise<number> {
    await this.stopAll();
    const client = new Client(serverUrl);
    let joined = 0;

    for (let i = 0; i < count; i++) {
      try {
        const name = SIM_NAMES[i % SIM_NAMES.length];
        const avatar = CHARACTERS[i % CHARACTERS.length].id;
        const room = await client.join('sonkisi_private', {
          name,
          avatar,
          isPrivate: true,
          roomCode,
        });

        // Each simulated rival takes 3.5s - 9.5s to "solve" the math clue so human players can beat them!
        const mathSolveDelayMs = 3500 + i * 650 + Math.random() * 1800;
        let target: { cx: number; cy: number } | null = null;
        let lastTreasureRound = -1;
        let solveAt = 0;

        const timerId = window.setInterval(() => {
          const st = room.state as any;
          if (!st || !st.players) return;
          const me = st.players.get(room.sessionId);
          if (!me || !me.alive) {
            room.send(CLIENT_MESSAGES.INPUT, { dx: 0, dy: 0 });
            return;
          }

          if (st.phase === 'scramble') {
            if (st.treasureRound !== lastTreasureRound) {
              lastTreasureRound = st.treasureRound;
              target = null;
              solveAt = Date.now() + mathSolveDelayMs;
            }
            const solved = Date.now() >= solveAt;
            const solvedCol = solved ? evalMathClue(String(st.clueColExpr ?? '')) : null;
            const solvedRow = solved ? evalMathClue(String(st.clueRowExpr ?? '')) : null;

            const reachedTarget =
              target && Math.hypot(target.cx - Number(me.x), target.cy - Number(me.y)) < 24;
            if ((!target || reachedTarget || solved) && st.tiles) {
              const arr: number[] = [];
              for (let t = 0; t < st.tiles.length; t++) arr.push(Number(st.tiles[t]));
              target = findNextIntactTile(
                arr,
                Number(st.clueColorId ?? -1),
                Number(me.x),
                Number(me.y),
                solvedCol,
                solvedRow
              );
            }
            if (target) {
              const dx = target.cx - Number(me.x);
              const dy = target.cy - Number(me.y);
              const dist = Math.hypot(dx, dy);
              if (dist > 8) {
                room.send(CLIENT_MESSAGES.INPUT, { dx: dx / dist, dy: dy / dist });
                if (Math.random() < 0.08) {
                  room.send(CLIENT_MESSAGES.JUMP);
                }
                if (dist > 110 && Math.random() < 0.09) {
                  room.send(CLIENT_MESSAGES.DASH);
                }
              } else {
                room.send(CLIENT_MESSAGES.INPUT, { dx: 0, dy: 0 });
              }
            }
          } else if (st.phase === 'round_end') {
            target = null;
            if (Math.random() < 0.04) {
              const emoji =
                REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
              room.send(CLIENT_MESSAGES.EMOJI, { emoji });
            }
            room.send(CLIENT_MESSAGES.INPUT, { dx: 0, dy: 0 });
          } else {
            room.send(CLIENT_MESSAGES.INPUT, { dx: 0, dy: 0 });
          }
        }, 140);

        this.bots.push({ room, timerId });
        joined++;
      } catch {
        break;
      }
    }

    return joined;
  }

  public async stopAll(): Promise<void> {
    const current = [...this.bots];
    this.bots = [];
    for (const b of current) {
      window.clearInterval(b.timerId);
      try {
        await b.room.leave(true);
      } catch {
        // Ignore
      }
    }
  }
}

export const simulatorService = new SimulatorService();
