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

function findSafeTileCenter(
  tiles: number[],
  safeColor: number,
  x: number,
  y: number,
  mistakeChance: number
): { cx: number; cy: number } | null {
  const cols = ARENA_CONFIG.GRID_COLS;
  const size = ARENA_CONFIG.TILE_SIZE;
  const list: { cx: number; cy: number; d: number }[] = [];

  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === safeColor) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * size + size / 2;
      const cy = row * size + size / 2;
      list.push({ cx, cy, d: Math.hypot(cx - x, cy - y) });
    }
  }
  if (list.length === 0) return null;
  list.sort((a, b) => a.d - b.d);

  if (Math.random() < mistakeChance && list.length > 3) {
    const pick = list[Math.min(list.length - 1, 3 + Math.floor(Math.random() * 4))];
    return { cx: pick.cx, cy: pick.cy };
  }
  const top = list[Math.floor(Math.random() * Math.min(2, list.length))];
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

        const skillDelayMs = 200 + Math.random() * 520;
        const mistakeChance = 0.14 + Math.random() * 0.25;
        let target: { cx: number; cy: number } | null = null;
        let lastRound = -1;
        let reactAt = 0;

        const timerId = window.setInterval(() => {
          const st = room.state as any;
          if (!st || !st.players) return;
          const me = st.players.get(room.sessionId);
          if (!me || !me.alive) {
            room.send(CLIENT_MESSAGES.INPUT, { dx: 0, dy: 0 });
            return;
          }

          if (st.phase === 'scramble' || st.phase === 'warning') {
            if (st.round !== lastRound) {
              lastRound = st.round;
              target = null;
              reactAt = Date.now() + skillDelayMs;
            }
            if (Date.now() < reactAt) {
              room.send(CLIENT_MESSAGES.INPUT, { dx: 0, dy: 0 });
              return;
            }
            if (!target && st.tiles) {
              const arr: number[] = [];
              for (let t = 0; t < st.tiles.length; t++) arr.push(Number(st.tiles[t]));
              target = findSafeTileCenter(
                arr,
                Number(st.safeColor),
                Number(me.x),
                Number(me.y),
                mistakeChance + Number(st.round) * 0.04
              );
            }
            if (target) {
              const dx = target.cx - Number(me.x);
              const dy = target.cy - Number(me.y);
              const dist = Math.hypot(dx, dy);
              if (dist > 10) {
                room.send(CLIENT_MESSAGES.INPUT, { dx: dx / dist, dy: dy / dist });
                if (dist > 150 && Math.random() < 0.06) {
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
