import { ArraySchema } from '@colyseus/schema';
import { Obstacle, Player } from '../schema/GameState';
import { ARENA_CONFIG, ARENA_HEIGHT, ARENA_WIDTH } from '../../../shared/src/index';

export interface ObstacleMotion {
  id: string;
  baseX: number;
  baseY: number;
  ampX: number;
  ampY: number;
  orbitRadius: number;
  speed: number;
  phase: number;
}

export interface KnockbackVel {
  vx: number;
  vy: number;
}

const CX = ARENA_WIDTH / 2; // 456
const CY = ARENA_HEIGHT / 2; // 456

function addObs(
  list: ArraySchema<Obstacle>,
  motions: ObstacleMotion[],
  cfg: {
    id: string;
    kind: 'pillar' | 'bumper' | 'slider' | 'orbiter' | 'sweeper';
    x: number;
    y: number;
    radius?: number;
    width?: number;
    height?: number;
    angle?: number;
    ampX?: number;
    ampY?: number;
    orbitRadius?: number;
    speed?: number;
    phase?: number;
  }
) {
  const o = new Obstacle();
  o.id = cfg.id;
  o.kind = cfg.kind;
  o.x = Math.round(cfg.x);
  o.y = Math.round(cfg.y);
  o.radius = cfg.radius ?? 28;
  o.width = cfg.width ?? 0;
  o.height = cfg.height ?? 0;
  o.angle = cfg.angle ?? 0;
  list.push(o);

  motions.push({
    id: cfg.id,
    baseX: cfg.x,
    baseY: cfg.y,
    ampX: cfg.ampX ?? 0,
    ampY: cfg.ampY ?? 0,
    orbitRadius: cfg.orbitRadius ?? 0,
    speed: cfg.speed ?? 0,
    phase: cfg.phase ?? 0,
  });
}

export function buildObstaclesForLevel(
  level: number,
  list: ArraySchema<Obstacle>
): ObstacleMotion[] {
  list.clear();
  const motions: ObstacleMotion[] = [];
  const lv = Math.max(1, Math.min(10, Math.floor(level)));

  switch (lv) {
    case 1:
      // Bulut Tapınağı: 4 gentle corner bumpers
      for (const [i, [x, y]] of [
        [200, 200],
        [ARENA_WIDTH - 200, 200],
        [200, ARENA_HEIGHT - 200],
        [ARENA_WIDTH - 200, ARENA_HEIGHT - 200],
      ].entries()) {
        addObs(list, motions, { id: `l1_b${i}`, kind: 'bumper', x, y, radius: 30 });
      }
      break;

    case 2:
      // Büyülü Orman: 4 Stone Totem Pillars
      for (const [i, [x, y]] of [
        [260, 260],
        [ARENA_WIDTH - 260, 260],
        [260, ARENA_HEIGHT - 260],
        [ARENA_WIDTH - 260, ARENA_HEIGHT - 260],
      ].entries()) {
        addObs(list, motions, { id: `l2_p${i}`, kind: 'pillar', x, y, radius: 38 });
      }
      break;

    case 3:
      // Buzul Zirvesi: 1 Giant Rotating Ice Sweeper
      addObs(list, motions, {
        id: 'l3_sw0',
        kind: 'sweeper',
        x: CX,
        y: CY,
        width: 560,
        height: 26,
        speed: 0.95,
        phase: 0,
      });
      break;

    case 4:
      // Lav Kalesi: 4 Bouncy Magma Bumpers + Center Bumper
      addObs(list, motions, { id: 'l4_bc', kind: 'bumper', x: CX, y: CY, radius: 42 });
      for (const [i, [x, y]] of [
        [230, 230],
        [ARENA_WIDTH - 230, 230],
        [230, ARENA_HEIGHT - 230],
        [ARENA_WIDTH - 230, ARENA_HEIGHT - 230],
      ].entries()) {
        addObs(list, motions, { id: `l4_b${i}`, kind: 'bumper', x, y, radius: 34 });
      }
      break;

    case 5:
      // Siber Arena: 3 Sliding Laser Walls
      addObs(list, motions, {
        id: 'l5_s0',
        kind: 'slider',
        x: CX,
        y: 230,
        width: 150,
        height: 36,
        ampX: 250,
        speed: 1.5,
        phase: 0,
      });
      addObs(list, motions, {
        id: 'l5_s1',
        kind: 'slider',
        x: CX,
        y: CY,
        width: 150,
        height: 36,
        ampX: 250,
        speed: 1.5,
        phase: Math.PI,
      });
      addObs(list, motions, {
        id: 'l5_s2',
        kind: 'slider',
        x: CX,
        y: ARENA_HEIGHT - 230,
        width: 150,
        height: 36,
        ampX: 250,
        speed: 1.5,
        phase: 0.8,
      });
      break;

    case 6:
      // Altın Çöl: 6 Sandstone Pillars + Rotating Sweeper
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addObs(list, motions, {
          id: `l6_p${i}`,
          kind: 'pillar',
          x: CX + Math.cos(a) * 290,
          y: CY + Math.sin(a) * 290,
          radius: 32,
        });
      }
      addObs(list, motions, {
        id: 'l6_sw0',
        kind: 'sweeper',
        x: CX,
        y: CY,
        width: 460,
        height: 24,
        speed: -1.05,
        phase: 0,
      });
      break;

    case 7:
      // Kozmik Boşluk: 4 Orbiting Meteor Bumpers
      for (let i = 0; i < 4; i++) {
        const phase = (i / 4) * Math.PI * 2;
        const r = i % 2 === 0 ? 190 : 320;
        addObs(list, motions, {
          id: `l7_o${i}`,
          kind: 'orbiter',
          x: CX + Math.cos(phase) * r,
          y: CY + Math.sin(phase) * r,
          radius: 34,
          orbitRadius: r,
          speed: i % 2 === 0 ? 1.45 : -1.1,
          phase,
        });
      }
      break;

    case 8:
      // Kristal Labirent: 6 Crystal Pillars + 2 Vertical Sliders
      for (const [i, [x, y]] of [
        [200, 220],
        [ARENA_WIDTH - 200, 220],
        [200, CY],
        [ARENA_WIDTH - 200, CY],
        [200, ARENA_HEIGHT - 220],
        [ARENA_WIDTH - 200, ARENA_HEIGHT - 220],
      ].entries()) {
        addObs(list, motions, { id: `l8_p${i}`, kind: 'pillar', x, y, radius: 32 });
      }
      addObs(list, motions, {
        id: 'l8_s0',
        kind: 'slider',
        x: CX - 110,
        y: CY,
        width: 38,
        height: 150,
        ampY: 250,
        speed: 1.65,
        phase: 0,
      });
      addObs(list, motions, {
        id: 'l8_s1',
        kind: 'slider',
        x: CX + 110,
        y: CY,
        width: 38,
        height: 150,
        ampY: 250,
        speed: 1.65,
        phase: Math.PI,
      });
      break;

    case 9:
      // Fırtına Kulesi: Double Cross Rotating Sweepers + 4 Corner Bumpers
      addObs(list, motions, {
        id: 'l9_sw0',
        kind: 'sweeper',
        x: CX,
        y: CY,
        width: 600,
        height: 24,
        speed: 1.15,
        phase: 0,
      });
      addObs(list, motions, {
        id: 'l9_sw1',
        kind: 'sweeper',
        x: CX,
        y: CY,
        width: 600,
        height: 24,
        speed: 1.15,
        phase: Math.PI / 2,
      });
      for (const [i, [x, y]] of [
        [170, 170],
        [ARENA_WIDTH - 170, 170],
        [170, ARENA_HEIGHT - 170],
        [ARENA_WIDTH - 170, ARENA_HEIGHT - 170],
      ].entries()) {
        addObs(list, motions, { id: `l9_b${i}`, kind: 'bumper', x, y, radius: 32 });
      }
      break;

    case 10:
    default:
      // Ejderha Tahtı (Final Boss Arena!): Flame Sweeper + 4 Orbiting Fire Orbs + 4 Obsidian Pillars
      addObs(list, motions, {
        id: 'l10_sw0',
        kind: 'sweeper',
        x: CX,
        y: CY,
        width: 580,
        height: 26,
        speed: 1.25,
        phase: 0,
      });
      for (let i = 0; i < 4; i++) {
        const phase = (i / 4) * Math.PI * 2;
        addObs(list, motions, {
          id: `l10_o${i}`,
          kind: 'orbiter',
          x: CX + Math.cos(phase) * 280,
          y: CY + Math.sin(phase) * 280,
          radius: 32,
          orbitRadius: 280,
          speed: -1.35,
          phase,
        });
      }
      for (const [i, [x, y]] of [
        [185, 185],
        [ARENA_WIDTH - 185, 185],
        [185, ARENA_HEIGHT - 185],
        [ARENA_WIDTH - 185, ARENA_HEIGHT - 185],
      ].entries()) {
        addObs(list, motions, { id: `l10_p${i}`, kind: 'pillar', x, y, radius: 34 });
      }
      break;
  }

  return motions;
}

export function updateObstacles(
  list: ArraySchema<Obstacle>,
  motions: ObstacleMotion[],
  elapsedSec: number
) {
  for (let i = 0; i < list.length && i < motions.length; i++) {
    const o = list[i];
    const m = motions[i];
    if (!o || !m) continue;
    if (o.kind === 'slider') {
      o.x = Math.round((m.baseX + Math.sin(elapsedSec * m.speed + m.phase) * m.ampX) * 10) / 10;
      o.y = Math.round((m.baseY + Math.sin(elapsedSec * m.speed + m.phase) * m.ampY) * 10) / 10;
    } else if (o.kind === 'orbiter') {
      const a = elapsedSec * m.speed + m.phase;
      o.x = Math.round((CX + Math.cos(a) * m.orbitRadius) * 10) / 10;
      o.y = Math.round((CY + Math.sin(a) * m.orbitRadius) * 10) / 10;
    } else if (o.kind === 'sweeper') {
      o.angle = Math.round(((elapsedSec * m.speed + m.phase) % (Math.PI * 2)) * 1000) / 1000;
    }
  }
}

export function resolveObstacleCollisions(
  player: Player,
  list: ArraySchema<Obstacle>,
  knockbacks: Map<string, KnockbackVel>
) {
  const pr = ARENA_CONFIG.PLAYER_RADIUS;
  const minX = pr;
  const maxX = ARENA_WIDTH - pr;
  const minY = pr;
  const maxY = ARENA_HEIGHT - pr;

  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o) continue;

    if (o.kind === 'pillar' || o.kind === 'bumper' || o.kind === 'orbiter') {
      const dx = player.x - o.x;
      const dy = player.y - o.y;
      const minDist = pr + o.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.01;
        const nx = dx / dist;
        const ny = dy / dist;
        player.x = Math.max(minX, Math.min(maxX, o.x + nx * minDist));
        player.y = Math.max(minY, Math.min(maxY, o.y + ny * minDist));

        if (o.kind === 'bumper' || o.kind === 'orbiter') {
          const kbStrength = o.kind === 'orbiter' ? 380 : 340;
          knockbacks.set(player.sessionId, { vx: nx * kbStrength, vy: ny * kbStrength });
        }
      }
    } else if (o.kind === 'slider') {
      const hw = o.width / 2;
      const hh = o.height / 2;
      const closestX = Math.max(o.x - hw, Math.min(o.x + hw, player.x));
      const closestY = Math.max(o.y - hh, Math.min(o.y + hh, player.y));
      const dx = player.x - closestX;
      const dy = player.y - closestY;
      const distSq = dx * dx + dy * dy;
      if (distSq < pr * pr) {
        const dist = Math.sqrt(distSq) || 0.01;
        const nx = dx / dist;
        const ny = dy / dist;
        player.x = Math.max(minX, Math.min(maxX, closestX + nx * pr));
        player.y = Math.max(minY, Math.min(maxY, closestY + ny * pr));
      }
    } else if (o.kind === 'sweeper') {
      // Closest point on rotating bar segment
      const halfLen = o.width / 2;
      const cos = Math.cos(o.angle);
      const sin = Math.sin(o.angle);
      const relX = player.x - o.x;
      const relY = player.y - o.y;
      const proj = Math.max(-halfLen, Math.min(halfLen, relX * cos + relY * sin));
      const cx = o.x + cos * proj;
      const cy = o.y + sin * proj;
      const dx = player.x - cx;
      const dy = player.y - cy;
      const minDist = pr + o.height / 2;
      const distSq = dx * dx + dy * dy;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.01;
        const nx = dx / dist;
        const ny = dy / dist;
        player.x = Math.max(minX, Math.min(maxX, cx + nx * (minDist + 2)));
        player.y = Math.max(minY, Math.min(maxY, cy + ny * (minDist + 2)));
        knockbacks.set(player.sessionId, { vx: nx * 360, vy: ny * 360 });
      }
    }
  }
}
