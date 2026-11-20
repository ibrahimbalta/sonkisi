import { Room, Client } from 'colyseus';
import { GameState, Meteor, Player, PowerUp } from '../schema/GameState';
import {
  buildObstaclesForLevel,
  KnockbackVel,
  ObstacleMotion,
  resolveObstacleCollisions,
  updateObstacles,
} from './LevelObstacles';
import { isTileActiveInLevel } from './LevelShapes';
import {
  ARENA_CONFIG,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CHARACTERS,
  CLIENT_MESSAGES,
  DASH_CONFIG,
  EmojiBroadcast,
  EmojiPayload,
  InputPayload,
  PodiumEntry,
  PowerUpKind,
  REACTION_EMOJIS,
  SERVER_MESSAGES,
  SURVIVAL_CONFIG,
  TILE_COLORS,
} from '../../../shared/src/index';

interface JoinOptions {
  name?: string;
  avatar?: string;
  roomCode?: string;
  isPrivate?: boolean;
}

interface PlayerInput {
  dx: number;
  dy: number;
}

const VALID_AVATAR_IDS = new Set(CHARACTERS.map((c) => c.id));
const VALID_EMOJIS = new Set<string>(REACTION_EMOJIS);

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Oyuncu';
  const cleaned = raw.replace(/[<>]/g, '').trim().slice(0, 16);
  return cleaned.length >= 2 ? cleaned : `Oyuncu${Math.floor(100 + Math.random() * 900)}`;
}

function sanitizeAvatar(raw: unknown): string {
  if (typeof raw === 'string' && VALID_AVATAR_IDS.has(raw)) {
    return raw;
  }
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;
}

export class SonKisiRoom extends Room<GameState> {
  maxClients = ARENA_CONFIG.MAX_PLAYERS;

  private inputs = new Map<string, PlayerInput>();
  private knockbacks = new Map<string, KnockbackVel>();
  private verticalVel = new Map<string, number>();
  private jumpsUsed = new Map<string, number>();
  private lastPushedBy = new Map<string, { pusherId: string; at: number }>();
  private dashTimers = new Map<string, { timeLeft: number; dx: number; dy: number }>();
  private shieldTimers = new Map<string, number>();
  private speedTimers = new Map<string, number>();
  private doubleJumpTimers = new Map<string, number>();
  private pushPowerTimers = new Map<string, number>();
  private tileCrackTimers = new Map<number, number>();
  private electricTileIndices = new Set<number>();
  private electricShockCooldown = new Map<string, number>();

  private obstacleMotions: ObstacleMotion[] = [];
  private elapsedSec = 0;
  private lastEmojiTime = new Map<string, number>();
  private phaseTimer = 0;
  private isSoloPractice = false;

  // Survival mode timers
  private lastSurvivalPointBucket = 0;
  private nextEventAtSec = SURVIVAL_CONFIG.EVENT_INTERVAL_SEC;
  private eventEndAtSec = 0;
  private meteorSpawnTimer = 0;
  private powerUpSpawnTimer = 4;

  onCreate(options: JoinOptions) {
    this.setState(new GameState());

    const isPrivate = Boolean(options?.isPrivate || options?.roomCode);
    const roomCode =
      typeof options?.roomCode === 'string' && options.roomCode.trim().length >= 4
        ? options.roomCode.trim().toUpperCase().slice(0, 8)
        : generateRoomCode();

    const envMin = parseInt(process.env.FORCE_MIN_PLAYERS || '', 10);
    const minPlayers =
      Number.isFinite(envMin) && envMin >= 2 && envMin <= 50
        ? envMin
        : ARENA_CONFIG.DEFAULT_MIN_PLAYERS;

    this.state.isPrivate = isPrivate;
    this.state.roomCode = roomCode;
    this.state.minPlayersToStart = isPrivate ? 2 : minPlayers;
    this.state.maxPlayers = ARENA_CONFIG.MAX_PLAYERS;
    this.state.phase = 'lobby';
    this.state.safeColor = -1;
    this.state.level = 1;
    this.state.startingLevel = 1;

    this.generateTiles();
    this.obstacleMotions = buildObstaclesForLevel(1, this.state.obstacles);

    this.onMessage(CLIENT_MESSAGES.INPUT, (client, payload: InputPayload) => {
      if (!payload || typeof payload !== 'object') return;
      const dx = Number(payload.dx);
      const dy = Number(payload.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

      const len = Math.hypot(dx, dy);
      if (len > 1) {
        this.inputs.set(client.sessionId, { dx: dx / len, dy: dy / len });
      } else if (len < 0.05) {
        this.inputs.set(client.sessionId, { dx: 0, dy: 0 });
      } else {
        this.inputs.set(client.sessionId, { dx, dy });
      }
    });

    this.onMessage(CLIENT_MESSAGES.EMOJI, (client, payload: EmojiPayload) => {
      if (!payload || typeof payload.emoji !== 'string') return;
      if (!VALID_EMOJIS.has(payload.emoji)) return;

      const now = Date.now();
      const last = this.lastEmojiTime.get(client.sessionId) ?? 0;
      if (now - last < 1000) return;
      this.lastEmojiTime.set(client.sessionId, now);

      const broadcastPayload: EmojiBroadcast = {
        sessionId: client.sessionId,
        emoji: payload.emoji,
      };
      this.broadcast(SERVER_MESSAGES.EMOJI, broadcastPayload);
    });

    this.onMessage(CLIENT_MESSAGES.START_PRIVATE, (client) => {
      if (!this.state.isPrivate) return;
      if (this.state.hostSessionId !== client.sessionId) return;
      if (this.state.phase !== 'lobby' && this.state.phase !== 'countdown') return;
      if (this.state.players.size < 1) return;

      this.isSoloPractice = this.state.players.size === 1;
      this.startStartingPhase();
    });

    this.onMessage(CLIENT_MESSAGES.PLAY_AGAIN, (client) => {
      if (!this.state.isPrivate) return;
      if (this.state.hostSessionId !== client.sessionId) return;
      if (this.state.phase !== 'finished') return;
      this.resetToLobby();
    });

    this.onMessage(CLIENT_MESSAGES.SELECT_LEVEL, (client, payload: { level?: number }) => {
      if (!this.state.isPrivate) return;
      if (this.state.hostSessionId !== client.sessionId) return;
      if (this.state.phase !== 'lobby') return;
      const lv = Math.max(1, Math.min(10, Math.floor(Number(payload?.level ?? 1))));
      this.state.startingLevel = lv;
      this.state.level = lv;
      this.obstacleMotions = buildObstaclesForLevel(lv, this.state.obstacles);
      this.generateTiles();
    });

    // Authoritative JUMP + DOUBLE-JUMP
    this.onMessage(CLIENT_MESSAGES.JUMP, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      if (this.state.phase === 'starting' || this.state.phase === 'finished') return;

      const used = this.jumpsUsed.get(client.sessionId) ?? 0;
      const maxJumps = player.hasDoubleJump ? 2 : 1;

      if (player.z <= 0.08) {
        // Ground jump
        this.verticalVel.set(client.sessionId, 14.5);
        this.jumpsUsed.set(client.sessionId, 1);
      } else if (used < maxJumps) {
        // Mid-air Double Jump!
        this.verticalVel.set(client.sessionId, 13.8);
        this.jumpsUsed.set(client.sessionId, used + 1);
        this.broadcast(SERVER_MESSAGES.PLAYER_DASHED, {
          sessionId: client.sessionId,
          x: player.x,
          y: player.y,
        });
      }
    });

    // Authoritative DASH + Integrated PUSH POWER shockwave!
    this.onMessage(CLIENT_MESSAGES.DASH, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      if (player.dashCooldown > 0.05) return;

      const input = this.inputs.get(client.sessionId);
      let dx = input?.dx ?? 0;
      let dy = input?.dy ?? 0;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) {
        dx = 0;
        dy = -1;
      } else {
        dx /= len;
        dy /= len;
      }

      player.dashCooldown = DASH_CONFIG.COOLDOWN_SEC;
      this.dashTimers.set(client.sessionId, {
        timeLeft: DASH_CONFIG.DURATION_SEC,
        dx,
        dy,
      });

      // If Push Power is active, unleash a 360° Shockwave Push Blast!
      if (player.hasPushPower) {
        this.state.players.forEach((other) => {
          if (!other.alive || other.sessionId === player.sessionId) return;
          const ox = other.x - player.x;
          const oy = other.y - player.y;
          const dist = Math.hypot(ox, oy);
          if (dist < 175 && dist > 0.1) {
            const nx = ox / dist;
            const ny = oy / dist;
            this.knockbacks.set(other.sessionId, { vx: nx * 740, vy: ny * 740 });
            this.lastPushedBy.set(other.sessionId, {
              pusherId: player.sessionId,
              at: this.elapsedSec,
            });
          }
        });
      }

      this.broadcast(SERVER_MESSAGES.PLAYER_DASHED, {
        sessionId: client.sessionId,
        x: player.x,
        y: player.y,
      });
    });

    const tickMs = Math.round(1000 / ARENA_CONFIG.TICK_RATE_HZ);
    this.setSimulationInterval((deltaTime) => this.update(deltaTime / 1000), tickMs);
    this.setPatchRate(tickMs);

    console.log(
      `[SonKisiRoom] Created ${isPrivate ? 'PRIVATE' : 'PUBLIC'} room ${this.roomId} (code=${roomCode}, minPlayers=${this.state.minPlayersToStart})`
    );
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = sanitizeName(options?.name);
    player.avatar = sanitizeAvatar(options?.avatar);
    player.alive = true;
    player.connected = true;

    const spawn = this.getRandomSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = 0;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { dx: 0, dy: 0 });
    this.verticalVel.set(client.sessionId, 0);
    this.jumpsUsed.set(client.sessionId, 0);

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    this.recountAlive();
    this.checkLobbyStartCondition();
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.connected = false;
    this.inputs.set(client.sessionId, { dx: 0, dy: 0 });

    try {
      if (!consented && this.state.phase !== 'finished') {
        await this.allowReconnection(client, 15);
        player.connected = true;
        return;
      }
    } catch {
      // Timed out
    }

    // If they leave mid-match while alive, mark eliminated cleanly so podium stays accurate
    if (this.state.phase === 'scramble' && player.alive) {
      player.alive = false;
      player.eliminatedRank = this.state.aliveCount;
    }

    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.verticalVel.delete(client.sessionId);
    this.jumpsUsed.delete(client.sessionId);
    this.lastEmojiTime.delete(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const nextHost = this.state.players.keys().next().value;
      this.state.hostSessionId = nextHost ?? '';
    }

    this.recountAlive();

    if (
      this.state.phase === 'countdown' &&
      !this.state.isPrivate &&
      this.state.players.size < this.state.minPlayersToStart
    ) {
      this.state.phase = 'lobby';
      this.state.phaseTimeLeft = 0;
      this.state.phaseDuration = 0;
      this.phaseTimer = 0;
    } else if (this.state.phase === 'scramble') {
      this.checkWinCondition();
    }
  }

  private getRandomSpawn(): { x: number; y: number } {
    const tileSize = ARENA_CONFIG.TILE_SIZE;
    const valid: { x: number; y: number }[] = [];
    for (let row = 1; row < ARENA_CONFIG.GRID_ROWS - 1; row++) {
      for (let col = 1; col < ARENA_CONFIG.GRID_COLS - 1; col++) {
        if (isTileActiveInLevel(this.state.level, row, col)) {
          valid.push({
            x: col * tileSize + tileSize / 2 + (Math.random() - 0.5) * 20,
            y: row * tileSize + tileSize / 2 + (Math.random() - 0.5) * 20,
          });
        }
      }
    }
    if (valid.length > 0) {
      const pick = valid[Math.floor(Math.random() * valid.length)];
      return {
        x: Math.round(pick.x * 10) / 10,
        y: Math.round(pick.y * 10) / 10,
      };
    }
    return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 };
  }

  private generateTiles() {
    const cols = ARENA_CONFIG.GRID_COLS;
    const rows = ARENA_CONFIG.GRID_ROWS;
    const total = cols * rows;
    const colorCount = TILE_COLORS.length;
    const arr: number[] = new Array(total);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        if (isTileActiveInLevel(this.state.level, row, col)) {
          arr[i] = Math.floor(Math.random() * colorCount);
        } else {
          arr[i] = -1;
        }
      }
    }

    if (this.state.tiles.length !== total) {
      this.state.tiles.clear();
      for (let i = 0; i < total; i++) this.state.tiles.push(arr[i]);
    } else {
      for (let i = 0; i < total; i++) this.state.tiles[i] = arr[i];
    }
  }

  private checkLobbyStartCondition() {
    if (this.state.phase !== 'lobby') return;
    if (this.state.isPrivate) return;

    if (this.state.players.size >= this.maxClients) {
      this.startStartingPhase();
      return;
    }

    if (this.state.players.size >= this.state.minPlayersToStart) {
      this.state.phase = 'countdown';
      this.phaseTimer = ARENA_CONFIG.LOBBY_COUNTDOWN_SEC;
      this.state.phaseDuration = ARENA_CONFIG.LOBBY_COUNTDOWN_SEC;
      this.state.phaseTimeLeft = ARENA_CONFIG.LOBBY_COUNTDOWN_SEC;
    }
  }

  private startStartingPhase() {
    this.lock();
    this.state.phase = 'starting';
    this.state.round = 1;
    this.state.level = this.state.startingLevel;
    this.state.matchTimeSec = 0;
    this.state.shrinkStage = 0;
    this.state.finalDuel = false;
    this.state.safeColor = -1;
    this.state.disaster = 'none';
    this.state.windX = 0;
    this.state.windY = 0;
    this.state.winnerSessionId = '';
    this.state.winnerName = '';
    this.state.winnerAvatar = '';
    this.state.totalMatchPlayers = this.state.players.size;

    this.dashTimers.clear();
    this.knockbacks.clear();
    this.shieldTimers.clear();
    this.speedTimers.clear();
    this.doubleJumpTimers.clear();
    this.pushPowerTimers.clear();
    this.tileCrackTimers.clear();
    this.electricTileIndices.clear();
    this.electricShockCooldown.clear();
    this.lastPushedBy.clear();
    this.state.powerUps.clear();
    this.state.meteors.clear();

    this.lastSurvivalPointBucket = 0;
    this.nextEventAtSec = SURVIVAL_CONFIG.EVENT_INTERVAL_SEC;
    this.eventEndAtSec = 0;
    this.powerUpSpawnTimer = 3.0;

    this.generateTiles();
    this.obstacleMotions = buildObstaclesForLevel(this.state.level, this.state.obstacles);

    this.state.players.forEach((p) => {
      p.alive = true;
      p.eliminatedRank = 0;
      p.roundsSurvived = 0;
      p.hasShield = false;
      p.speedBoost = false;
      p.hasDoubleJump = false;
      p.hasPushPower = false;
      p.hasBomb = false;
      p.kills = 0;
      p.score = 0;
      p.dashCooldown = 0;
      p.z = 0;
      this.verticalVel.set(p.sessionId, 0);
      this.jumpsUsed.set(p.sessionId, 0);
      const spawn = this.getRandomSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
    });

    this.recountAlive();
    this.phaseTimer = ARENA_CONFIG.STARTING_COUNTDOWN_SEC;
    this.state.phaseDuration = ARENA_CONFIG.STARTING_COUNTDOWN_SEC;
    this.state.phaseTimeLeft = ARENA_CONFIG.STARTING_COUNTDOWN_SEC;
  }

  private beginSurvivalMatch() {
    this.state.phase = 'scramble';
    this.state.matchTimeSec = 0;
    this.state.phaseTimeLeft = 0;
    this.state.phaseDuration = 0;
    this.spawnPowerUp();
    this.spawnPowerUp();
  }

  private resetToLobby() {
    this.unlock();
    this.isSoloPractice = false;
    this.state.phase = 'lobby';
    this.state.round = 0;
    this.state.matchTimeSec = 0;
    this.state.shrinkStage = 0;
    this.state.finalDuel = false;
    this.state.disaster = 'none';
    this.state.windX = 0;
    this.state.windY = 0;
    this.state.safeColor = -1;
    this.state.phaseTimeLeft = 0;
    this.state.phaseDuration = 0;
    this.state.winnerSessionId = '';
    this.state.winnerName = '';
    this.state.winnerAvatar = '';
    this.phaseTimer = 0;
    this.tileCrackTimers.clear();
    this.electricTileIndices.clear();
    this.state.powerUps.clear();
    this.state.meteors.clear();

    this.generateTiles();
    this.obstacleMotions = buildObstaclesForLevel(this.state.level, this.state.obstacles);

    this.state.players.forEach((p) => {
      p.alive = true;
      p.eliminatedRank = 0;
      p.roundsSurvived = 0;
      p.hasShield = false;
      p.speedBoost = false;
      p.hasDoubleJump = false;
      p.hasPushPower = false;
      p.score = 0;
      p.kills = 0;
      p.z = 0;
      const spawn = this.getRandomSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
    });
    this.recountAlive();
  }

  private spawnPowerUp() {
    if (this.state.powerUps.length >= 4) return;
    const tileSize = ARENA_CONFIG.TILE_SIZE;
    const intact: number[] = [];
    for (let i = 0; i < this.state.tiles.length; i++) {
      const v = this.state.tiles[i];
      if (v !== undefined && v >= 0 && v < 10) intact.push(i);
    }
    if (intact.length === 0) return;

    const pickIdx = intact[Math.floor(Math.random() * intact.length)];
    const col = pickIdx % ARENA_CONFIG.GRID_COLS;
    const row = Math.floor(pickIdx / ARENA_CONFIG.GRID_COLS);
    const kinds: PowerUpKind[] = ['shield', 'speed', 'double_jump', 'push'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];

    const pu = new PowerUp();
    pu.id = `pu_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    pu.kind = kind;
    pu.x = Math.round(col * tileSize + tileSize / 2);
    pu.y = Math.round(row * tileSize + tileSize / 2);
    this.state.powerUps.push(pu);
  }

  private triggerArenaShrink(stage: number) {
    this.state.shrinkStage = stage;
    const cols = ARENA_CONFIG.GRID_COLS;
    const rows = ARENA_CONFIG.GRID_ROWS;
    const ringDepth = stage; // stage 1 -> outer 1 ring, stage 2 -> 2 rings, stage 3 -> 3 rings

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const isOuter =
          row < ringDepth ||
          row >= rows - ringDepth ||
          col < ringDepth ||
          col >= cols - ringDepth;
        if (!isOuter) continue;

        const idx = row * cols + col;
        const val = this.state.tiles[idx];
        if (val !== undefined && val >= 0) {
          const base = val >= 20 ? val - 20 : val >= 10 ? val - 10 : val;
          this.state.tiles[idx] = base + 10;
          // Outer ring collapses rapidly (1.3s warning!)
          const existing = this.tileCrackTimers.get(idx);
          if (existing === undefined || existing > 1.3) {
            this.tileCrackTimers.set(idx, 1.3);
          }
        }
      }
    }
  }

  private clearElectricTiles() {
    this.electricTileIndices.forEach((idx) => {
      const val = this.state.tiles[idx];
      if (val !== undefined && val >= 20) {
        this.state.tiles[idx] = val - 20;
      }
    });
    this.electricTileIndices.clear();
  }

  private triggerRandomEvent() {
    this.clearElectricTiles();
    this.state.windX = 0;
    this.state.windY = 0;

    const events = ['electric', 'meteor', 'wind', 'darkness'] as const;
    const picked = events[Math.floor(Math.random() * events.length)];
    this.state.disaster = picked;
    this.eventEndAtSec = this.state.matchTimeSec + SURVIVAL_CONFIG.EVENT_DURATION_SEC;

    if (picked === 'electric') {
      const intact: number[] = [];
      for (let i = 0; i < this.state.tiles.length; i++) {
        const v = this.state.tiles[i];
        if (v !== undefined && v >= 0 && v < 10) intact.push(i);
      }
      intact.sort(() => Math.random() - 0.5);
      const count = Math.min(12, intact.length);
      for (let i = 0; i < count; i++) {
        const idx = intact[i];
        const v = this.state.tiles[idx];
        if (v !== undefined && v >= 0 && v < 10) {
          this.state.tiles[idx] = v + 20;
          this.electricTileIndices.add(idx);
        }
      }
    } else if (picked === 'meteor') {
      this.meteorSpawnTimer = 0.2;
    } else if (picked === 'wind') {
      const a = Math.random() * Math.PI * 2;
      this.state.windX = Math.round(Math.cos(a) * 100) / 100;
      this.state.windY = Math.round(Math.sin(a) * 100) / 100;
    }
  }

  private spawnMeteorWave() {
    const intact: number[] = [];
    for (let i = 0; i < this.state.tiles.length; i++) {
      const v = this.state.tiles[i];
      if (v !== undefined && v >= 0) intact.push(i);
    }
    if (intact.length === 0) return;

    const tileSize = ARENA_CONFIG.TILE_SIZE;
    const count = Math.min(3, intact.length);
    for (let i = 0; i < count; i++) {
      const idx = intact[Math.floor(Math.random() * intact.length)];
      const col = idx % ARENA_CONFIG.GRID_COLS;
      const row = Math.floor(idx / ARENA_CONFIG.GRID_COLS);
      const m = new Meteor();
      m.id = `met_${Date.now()}_${i}_${Math.floor(Math.random() * 999)}`;
      m.x = Math.round(col * tileSize + tileSize / 2);
      m.y = Math.round(row * tileSize + tileSize / 2);
      m.radius = 74;
      m.timeLeft = 1.4;
      this.state.meteors.push(m);
    }
  }

  private updateMeteors(dt: number) {
    if (this.state.phase === 'scramble' && this.state.disaster === 'meteor') {
      this.meteorSpawnTimer -= dt;
      if (this.meteorSpawnTimer <= 0) {
        this.spawnMeteorWave();
        this.meteorSpawnTimer = 1.5;
      }
    }

    const tileSize = ARENA_CONFIG.TILE_SIZE;
    for (let i = this.state.meteors.length - 1; i >= 0; i--) {
      const m = this.state.meteors[i];
      if (!m) continue;
      m.timeLeft = Math.max(0, Math.round((m.timeLeft - dt) * 100) / 100);
      if (m.timeLeft <= 0) {
        // Destroy impacted tile permanently!
        const col = Math.floor(m.x / tileSize);
        const row = Math.floor(m.y / tileSize);
        if (
          col >= 0 &&
          col < ARENA_CONFIG.GRID_COLS &&
          row >= 0 &&
          row < ARENA_CONFIG.GRID_ROWS
        ) {
          const idx = row * ARENA_CONFIG.GRID_COLS + col;
          this.state.tiles[idx] = -1;
          this.tileCrackTimers.delete(idx);
          this.electricTileIndices.delete(idx);
        }

        // Knock back nearby players
        this.state.players.forEach((p) => {
          if (!p.alive || p.hasShield) return;
          const dx = p.x - m.x;
          const dy = p.y - m.y;
          const dist = Math.hypot(dx, dy);
          if (dist < m.radius + 36) {
            const nx = dist > 0.1 ? dx / dist : Math.cos(Math.random() * 6.28);
            const ny = dist > 0.1 ? dy / dist : Math.sin(Math.random() * 6.28);
            this.knockbacks.set(p.sessionId, { vx: nx * 580, vy: ny * 580 });
          }
        });

        this.broadcast(SERVER_MESSAGES.METEOR_IMPACT, { x: m.x, y: m.y });
        this.state.meteors.splice(i, 1);
      }
    }
  }

  private updateCrackingTiles(dt: number) {
    if (this.state.phase !== 'scramble') return;

    const tileSize = ARENA_CONFIG.TILE_SIZE;
    this.state.players.forEach((p) => {
      // Only grounded players crack tiles or get shocked by electric tiles!
      if (!p.alive || p.z > 0.15) return;

      const col = Math.floor(p.x / tileSize);
      const row = Math.floor(p.y / tileSize);
      if (
        col >= 0 &&
        col < ARENA_CONFIG.GRID_COLS &&
        row >= 0 &&
        row < ARENA_CONFIG.GRID_ROWS
      ) {
        const idx = row * ARENA_CONFIG.GRID_COLS + col;
        const val = this.state.tiles[idx];
        if (val === undefined || val < 0) return;

        // Electric tile hazard shock!
        if (val >= 20) {
          const nextShock = this.electricShockCooldown.get(p.sessionId) ?? 0;
          if (!p.hasShield && this.elapsedSec > nextShock) {
            this.electricShockCooldown.set(p.sessionId, this.elapsedSec + 0.9);
            const a = Math.random() * Math.PI * 2;
            this.knockbacks.set(p.sessionId, {
              vx: Math.cos(a) * 460,
              vy: Math.sin(a) * 460,
            });
          }
          return;
        }

        // Intact tile (0..5) -> starts 2.0s crack animation, then permanently disappears!
        if (val >= 0 && val < 10) {
          this.state.tiles[idx] = val + 10;
          this.tileCrackTimers.set(idx, SURVIVAL_CONFIG.TILE_CRACK_SEC);
          p.score += 5;
        }
      }
    });

    // Countdown cracking tiles -> permanently remove at 0
    this.tileCrackTimers.forEach((left, idx) => {
      const next = left - dt;
      if (next <= 0) {
        this.tileCrackTimers.delete(idx);
        this.state.tiles[idx] = -1;
      } else {
        this.tileCrackTimers.set(idx, next);
      }
    });
  }

  private update(dt: number) {
    this.elapsedSec += dt;
    updateObstacles(this.state.obstacles, this.obstacleMotions, this.elapsedSec);
    this.updateMeteors(dt);

    const canMove =
      this.state.phase === 'lobby' ||
      this.state.phase === 'countdown' ||
      this.state.phase === 'scramble';

    if (canMove) {
      this.simulateMovement(dt);
    }

    if (this.state.phase === 'scramble') {
      // Advance authoritative match timer
      this.state.matchTimeSec = Math.round((this.state.matchTimeSec + dt) * 10) / 10;

      // Award +20 survival points every 10 seconds!
      const bucket = Math.floor(this.state.matchTimeSec / 10);
      if (bucket > this.lastSurvivalPointBucket) {
        this.lastSurvivalPointBucket = bucket;
        this.state.players.forEach((p) => {
          if (p.alive) {
            p.score += SURVIVAL_CONFIG.POINTS_PER_10_SEC;
            p.roundsSurvived = bucket;
          }
        });
      }

      // Arena Shrink stages (30s, 60s, 90s or Final 2 Duel!)
      if (this.state.shrinkStage < 1 && this.state.matchTimeSec >= SURVIVAL_CONFIG.SHRINK_STAGE_1_SEC) {
        this.triggerArenaShrink(1);
      }
      if (this.state.shrinkStage < 2 && this.state.matchTimeSec >= SURVIVAL_CONFIG.SHRINK_STAGE_2_SEC) {
        this.triggerArenaShrink(2);
      }
      if (
        this.state.shrinkStage < 3 &&
        (this.state.matchTimeSec >= SURVIVAL_CONFIG.SHRINK_STAGE_3_SEC ||
          (!this.isSoloPractice && this.state.aliveCount === 2 && this.state.totalMatchPlayers > 2))
      ) {
        this.state.finalDuel = true;
        this.triggerArenaShrink(3);
      }

      // Random Event every 20 seconds (10s duration)
      if (this.state.disaster !== 'none' && this.state.matchTimeSec >= this.eventEndAtSec) {
        this.clearElectricTiles();
        this.state.disaster = 'none';
        this.state.windX = 0;
        this.state.windY = 0;
      }
      if (this.state.matchTimeSec >= this.nextEventAtSec) {
        this.nextEventAtSec += SURVIVAL_CONFIG.EVENT_INTERVAL_SEC;
        this.triggerRandomEvent();
      }

      // Spawn random Power-Ups periodically
      this.powerUpSpawnTimer -= dt;
      if (this.powerUpSpawnTimer <= 0) {
        this.spawnPowerUp();
        this.powerUpSpawnTimer = SURVIVAL_CONFIG.POWERUP_SPAWN_INTERVAL_SEC;
      }

      this.updateCrackingTiles(dt);
      this.evaluateFalls();
      return;
    }

    if (this.state.phase === 'countdown') {
      this.phaseTimer -= dt;
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.state.players.size >= this.maxClients || this.phaseTimer <= 0) {
        this.startStartingPhase();
      }
    } else if (this.state.phase === 'starting') {
      this.phaseTimer -= dt;
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.phaseTimer <= 0) {
        this.beginSurvivalMatch();
      }
    }
  }

  private decrementTimer(map: Map<string, number>, sid: string, dt: number): boolean {
    const left = map.get(sid);
    if (left === undefined) return false;
    const next = left - dt;
    if (next <= 0) {
      map.delete(sid);
      return false;
    }
    map.set(sid, next);
    return true;
  }

  private simulateMovement(dt: number) {
    const speed = ARENA_CONFIG.PLAYER_SPEED;
    const minX = ARENA_CONFIG.PLAYER_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_CONFIG.PLAYER_RADIUS;
    const minY = ARENA_CONFIG.PLAYER_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_CONFIG.PLAYER_RADIUS;
    const isCombat = this.state.phase === 'scramble';

    const activePlayers: Player[] = [];

    this.state.players.forEach((player) => {
      if (!player.alive) {
        player.vx = 0;
        player.vy = 0;
        return;
      }

      const sid = player.sessionId;
      const input = this.inputs.get(sid);
      let dx = input?.dx ?? 0;
      let dy = input?.dy ?? 0;

      // Cooldown & power-up timers
      if (player.dashCooldown > 0) {
        player.dashCooldown = Math.max(0, Math.round((player.dashCooldown - dt) * 10) / 10);
      }
      player.hasShield = this.decrementTimer(this.shieldTimers, sid, dt);
      player.speedBoost = this.decrementTimer(this.speedTimers, sid, dt);
      player.hasDoubleJump = this.decrementTimer(this.doubleJumpTimers, sid, dt);
      player.hasPushPower = this.decrementTimer(this.pushPowerTimers, sid, dt);

      // Jump / vertical physics
      let vz = this.verticalVel.get(sid) ?? 0;
      if (player.z > 0 || vz > 0) {
        player.z = Math.max(0, Math.round((player.z + vz * dt) * 100) / 100);
        vz -= 38 * dt;
        if (player.z <= 0) {
          player.z = 0;
          vz = 0;
          this.jumpsUsed.set(sid, 0);
        }
        this.verticalVel.set(sid, vz);
      }

      // Speed multiplier (Super Speed = +45%, Dash = 2.35x)
      let speedMult = player.speedBoost ? 1.45 : 1.0;
      const dash = this.dashTimers.get(sid);
      if (dash) {
        dx = dash.dx;
        dy = dash.dy;
        speedMult = DASH_CONFIG.SPEED_MULTIPLIER;
        dash.timeLeft -= dt;
        if (dash.timeLeft <= 0) this.dashTimers.delete(sid);
      }

      player.vx = Math.round(dx * 100) / 100;
      player.vy = Math.round(dy * 100) / 100;

      const kb = this.knockbacks.get(sid);
      const kbVx = player.hasShield ? 0 : kb?.vx ?? 0;
      const kbVy = player.hasShield ? 0 : kb?.vy ?? 0;

      const windPushX =
        isCombat && this.state.disaster === 'wind' && !player.hasShield
          ? this.state.windX * 125
          : 0;
      const windPushY =
        isCombat && this.state.disaster === 'wind' && !player.hasShield
          ? this.state.windY * 125
          : 0;

      const totalVx = dx * speed * speedMult + kbVx + windPushX;
      const totalVy = dy * speed * speedMult + kbVy + windPushY;

      if (Math.abs(totalVx) > 2 || Math.abs(totalVy) > 2) {
        let nx = player.x + totalVx * dt;
        let ny = player.y + totalVy * dt;
        if (!isCombat) {
          nx = Math.max(minX, Math.min(maxX, nx));
          ny = Math.max(minY, Math.min(maxY, ny));
        } else {
          nx = Math.max(-45, Math.min(ARENA_WIDTH + 45, nx));
          ny = Math.max(-45, Math.min(ARENA_HEIGHT + 45, ny));
        }
        player.x = Math.round(nx * 10) / 10;
        player.y = Math.round(ny * 10) / 10;
      }

      if (kb) {
        kb.vx *= Math.pow(0.05, dt);
        kb.vy *= Math.pow(0.05, dt);
        if (Math.hypot(kb.vx, kb.vy) < 8) this.knockbacks.delete(sid);
      }

      // Obstacles (can jump OVER low sweepers/sliders if high enough, pillars always collide)
      if (player.z < 1.3) {
        resolveObstacleCollisions(player, this.state.obstacles, this.knockbacks);
        player.x = Math.round(player.x * 10) / 10;
        player.y = Math.round(player.y * 10) / 10;
      }

      // Power-Up Pickups
      for (let i = this.state.powerUps.length - 1; i >= 0; i--) {
        const pu = this.state.powerUps[i];
        if (!pu) continue;
        if (Math.hypot(player.x - pu.x, player.y - pu.y) < ARENA_CONFIG.PLAYER_RADIUS + 26) {
          if (pu.kind === 'shield') {
            player.hasShield = true;
            this.shieldTimers.set(sid, SURVIVAL_CONFIG.SHIELD_DURATION_SEC);
          } else if (pu.kind === 'speed') {
            player.speedBoost = true;
            this.speedTimers.set(sid, SURVIVAL_CONFIG.SPEED_DURATION_SEC);
          } else if (pu.kind === 'double_jump') {
            player.hasDoubleJump = true;
            this.doubleJumpTimers.set(sid, SURVIVAL_CONFIG.DOUBLE_JUMP_DURATION_SEC);
          } else if (pu.kind === 'push') {
            player.hasPushPower = true;
            this.pushPowerTimers.set(sid, SURVIVAL_CONFIG.PUSH_DURATION_SEC);
          }
          this.broadcast(SERVER_MESSAGES.POWERUP_PICKED, {
            sessionId: sid,
            kind: pu.kind,
            x: pu.x,
            y: pu.y,
          });
          this.state.powerUps.splice(i, 1);
        }
      }

      activePlayers.push(player);
    });

    // Player-to-player pushing & Dash Slam
    const minDist = ARENA_CONFIG.PLAYER_RADIUS * 1.45;
    const minDistSq = minDist * minDist;
    const hitDistSq = (ARENA_CONFIG.PLAYER_RADIUS * 2.35) ** 2;

    for (let i = 0; i < activePlayers.length; i++) {
      const a = activePlayers[i];
      const aDashing = this.dashTimers.has(a.sessionId);
      for (let j = i + 1; j < activePlayers.length; j++) {
        const b = activePlayers[j];
        const bDashing = this.dashTimers.has(b.sessionId);
        // Skip collision if one is jumping high over the other
        if (Math.abs(a.z - b.z) > 1.2) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;

        if (distSq > 0.001 && distSq < hitDistSq) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;

          if (aDashing && !bDashing && !b.hasShield) {
            const power = a.hasPushPower ? 760 : 620;
            this.knockbacks.set(b.sessionId, { vx: nx * power, vy: ny * power });
            this.lastPushedBy.set(b.sessionId, { pusherId: a.sessionId, at: this.elapsedSec });
          } else if (bDashing && !aDashing && !a.hasShield) {
            const power = b.hasPushPower ? 760 : 620;
            this.knockbacks.set(a.sessionId, { vx: -nx * power, vy: -ny * power });
            this.lastPushedBy.set(a.sessionId, { pusherId: b.sessionId, at: this.elapsedSec });
          } else if (distSq < minDistSq) {
            if (Math.hypot(a.vx, a.vy) > 0.25 && !b.hasShield) {
              const curB = this.knockbacks.get(b.sessionId) ?? { vx: 0, vy: 0 };
              this.knockbacks.set(b.sessionId, { vx: curB.vx + nx * 165, vy: curB.vy + ny * 165 });
              this.lastPushedBy.set(b.sessionId, { pusherId: a.sessionId, at: this.elapsedSec });
            }
            if (Math.hypot(b.vx, b.vy) > 0.25 && !a.hasShield) {
              const curA = this.knockbacks.get(a.sessionId) ?? { vx: 0, vy: 0 };
              this.knockbacks.set(a.sessionId, { vx: curA.vx - nx * 165, vy: curA.vy - ny * 165 });
              this.lastPushedBy.set(a.sessionId, { pusherId: b.sessionId, at: this.elapsedSec });
            }
            const overlap = (minDist - dist) * 0.25;
            a.x = Math.round((a.x - nx * overlap) * 10) / 10;
            a.y = Math.round((a.y - ny * overlap) * 10) / 10;
            b.x = Math.round((b.x + nx * overlap) * 10) / 10;
            b.y = Math.round((b.y + ny * overlap) * 10) / 10;
          }
        }
      }
    }
  }

  private isOnAnySolidTile(x: number, y: number): boolean {
    if (x < -6 || x > ARENA_WIDTH + 6 || y < -6 || y > ARENA_HEIGHT + 6) {
      return false;
    }
    const tileSize = ARENA_CONFIG.TILE_SIZE;
    const offsets = [
      [0, 0],
      [6, 0],
      [-6, 0],
      [0, 6],
      [0, -6],
    ];
    for (const [ox, oy] of offsets) {
      const col = Math.floor((x + ox) / tileSize);
      const row = Math.floor((y + oy) / tileSize);
      if (
        col >= 0 &&
        col < ARENA_CONFIG.GRID_COLS &&
        row >= 0 &&
        row < ARENA_CONFIG.GRID_ROWS
      ) {
        const idx = row * ARENA_CONFIG.GRID_COLS + col;
        const val = this.state.tiles[idx];
        if (val !== undefined && val >= 0) return true;
      }
    }
    return false;
  }

  private evaluateFalls() {
    const falling: Player[] = [];
    let aliveBefore = 0;

    this.state.players.forEach((p) => {
      if (p.alive) {
        aliveBefore++;
        // Airborne players (jumping!) or 3-second Shielded players do NOT fall!
        if (p.z > 0.15 || p.hasShield) return;

        if (!this.isOnAnySolidTile(p.x, p.y)) {
          falling.push(p);
        }
      }
    });

    if (falling.length === 0) return;

    const rankForBatch = aliveBefore;
    for (const p of falling) {
      p.alive = false;
      p.eliminatedRank = rankForBatch;

      // Placement reward bonuses for 2nd & 3rd place!
      if (p.eliminatedRank === 2) p.score += SURVIVAL_CONFIG.POINTS_SECOND;
      else if (p.eliminatedRank === 3) p.score += SURVIVAL_CONFIG.POINTS_THIRD;

      // Award Knockout Credit (+50) if someone pushed them within 3.5s
      const push = this.lastPushedBy.get(p.sessionId);
      if (push && this.elapsedSec - push.at <= 3.5) {
        const killer = this.state.players.get(push.pusherId);
        if (killer && killer.sessionId !== p.sessionId) {
          killer.kills += 1;
          killer.score += SURVIVAL_CONFIG.POINTS_PER_KILL;
          this.broadcast(SERVER_MESSAGES.KNOCKOUT_CREDIT, {
            killerSessionId: killer.sessionId,
            killerName: killer.name,
            victimName: p.name,
          });
        }
      }
      this.lastPushedBy.delete(p.sessionId);

      const client = this.clients.find((c) => c.sessionId === p.sessionId);
      if (client) {
        client.send(SERVER_MESSAGES.ELIMINATED, {
          sessionId: p.sessionId,
          rank: p.eliminatedRank,
          totalPlayers: this.state.totalMatchPlayers,
          roundsSurvived: Math.floor(this.state.matchTimeSec),
        });
      }

      this.broadcast(SERVER_MESSAGES.ELIMINATION_FEED, {
        name: p.name,
        avatar: p.avatar,
        rank: p.eliminatedRank,
      });
    }

    this.recountAlive();
    this.checkWinCondition();
  }

  private recountAlive() {
    let count = 0;
    this.state.players.forEach((p) => {
      if (p.alive) count++;
    });
    this.state.aliveCount = count;
  }

  private buildTop3Podium(): PodiumEntry[] {
    const all = Array.from(this.state.players.values());
    all.sort((a, b) => {
      const ra = a.alive ? 1 : a.eliminatedRank || 999;
      const rb = b.alive ? 1 : b.eliminatedRank || 999;
      if (ra !== rb) return ra - rb;
      return b.score - a.score;
    });
    return all.slice(0, 3).map((p, idx) => ({
      rank: idx + 1,
      sessionId: p.sessionId,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      kills: p.kills,
    }));
  }

  private checkWinCondition(): boolean {
    if (this.state.phase === 'finished' || this.state.phase === 'lobby') {
      return false;
    }

    if (this.isSoloPractice) {
      if (this.state.aliveCount === 0) {
        this.state.phase = 'finished';
        return true;
      }
      return false;
    }

    if (this.state.aliveCount <= 1) {
      let winner: Player | null = null;
      this.state.players.forEach((p) => {
        if (p.alive) winner = p;
      });

      this.state.phase = 'finished';
      this.clearElectricTiles();
      this.state.disaster = 'none';

      if (winner) {
        const w = winner as Player;
        w.eliminatedRank = 1;
        w.score += SURVIVAL_CONFIG.POINTS_FIRST;
        this.state.winnerSessionId = w.sessionId;
        this.state.winnerName = w.name;
        this.state.winnerAvatar = w.avatar;

        const podium = this.buildTop3Podium();

        this.broadcast(SERVER_MESSAGES.MATCH_WINNER, {
          winnerSessionId: w.sessionId,
          winnerName: w.name,
          winnerAvatar: w.avatar,
          pointsAwarded: w.score,
          totalPlayers: this.state.totalMatchPlayers,
          roundsPlayed: this.state.shrinkStage + 1,
          matchDurationSec: Math.floor(this.state.matchTimeSec),
          podium,
        });
      }

      return true;
    }

    return false;
  }
}
