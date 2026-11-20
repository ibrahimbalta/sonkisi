import { Room, Client } from 'colyseus';
import { GameState, Player, PowerUp } from '../schema/GameState';
import {
  buildObstaclesForLevel,
  KnockbackVel,
  ObstacleMotion,
  resolveObstacleCollisions,
  updateObstacles,
} from './LevelObstacles';
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
  REACTION_EMOJIS,
  SERVER_MESSAGES,
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
  private dashTimers = new Map<string, { timeLeft: number; dx: number; dy: number }>();
  private speedBoostTimers = new Map<string, number>();
  private shieldProtectedThisDrop = new Set<string>();
  private obstacleMotions: ObstacleMotion[] = [];
  private elapsedSec = 0;
  private lastEmojiTime = new Map<string, number>();
  private phaseTimer = 0;
  private isSoloPractice = false;

  onCreate(options: JoinOptions) {
    this.setState(new GameState());

    const isPrivate = Boolean(options?.isPrivate || options?.roomCode);
    const roomCode =
      typeof options?.roomCode === 'string' && options.roomCode.trim().length >= 4
        ? options.roomCode.trim().toUpperCase().slice(0, 8)
        : generateRoomCode();

    const envMin = parseInt(process.env.MIN_PLAYERS || '', 10);
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

    this.generateTiles(1);
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
      if (now - last < 1000) return; // Rate limit
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
    });

    this.onMessage(CLIENT_MESSAGES.DASH, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      if (player.dashCooldown > 0.05) return;

      const input = this.inputs.get(client.sessionId);
      let dx = input?.dx ?? 0;
      let dy = input?.dy ?? 0;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) {
        // Dash forward in last velocity or default upward
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

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, { dx: 0, dy: 0 });

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    this.recountAlive();
    this.checkLobbyStartCondition();

    console.log(
      `[SonKisiRoom ${this.state.roomCode}] ${player.name} (${client.sessionId}) joined. Players: ${this.state.players.size}/${this.maxClients}`
    );
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
        console.log(`[SonKisiRoom ${this.state.roomCode}] ${player.name} reconnected!`);
        return;
      }
    } catch {
      // Reconnection timed out
    }

    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
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
    } else if (
      this.state.phase === 'scramble' ||
      this.state.phase === 'warning' ||
      this.state.phase === 'drop' ||
      this.state.phase === 'round_end'
    ) {
      this.checkWinCondition();
    }
  }

  private getRandomSpawn(): { x: number; y: number } {
    const margin = ARENA_CONFIG.TILE_SIZE;
    return {
      x: Math.round((margin + Math.random() * (ARENA_WIDTH - margin * 2)) * 10) / 10,
      y: Math.round((margin + Math.random() * (ARENA_HEIGHT - margin * 2)) * 10) / 10,
    };
  }

  private generateTiles(round: number) {
    const total = ARENA_CONFIG.GRID_COLS * ARENA_CONFIG.GRID_ROWS;
    const colorCount = TILE_COLORS.length;
    const arr: number[] = new Array(total);

    for (let i = 0; i < total; i++) {
      arr[i] = Math.floor(Math.random() * colorCount);
    }

    // Ensure every color appears at least several times (scales gently down in later rounds)
    const minPerColor = Math.max(4, 14 - Math.floor((round - 1) * 1.1));
    for (let c = 0; c < colorCount; c++) {
      let count = arr.filter((v) => v === c).length;
      while (count < minPerColor) {
        const idx = Math.floor(Math.random() * total);
        if (arr[idx] !== c) {
          arr[idx] = c;
          count++;
        }
      }
    }

    if (this.state.tiles.length !== total) {
      this.state.tiles.clear();
      for (let i = 0; i < total; i++) {
        this.state.tiles.push(arr[i]);
      }
    } else {
      for (let i = 0; i < total; i++) {
        this.state.tiles[i] = arr[i];
      }
    }
  }

  private checkLobbyStartCondition() {
    if (this.state.phase !== 'lobby') return;
    if (this.state.isPrivate) return; // Private rooms start when host presses Start

    if (this.state.players.size >= this.maxClients) {
      // Room is full! Start immediately with 3s countdown
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
    this.state.round = 0;
    this.state.safeColor = -1;
    this.state.winnerSessionId = '';
    this.state.winnerName = '';
    this.state.winnerAvatar = '';
    this.state.totalMatchPlayers = this.state.players.size;

    this.state.players.forEach((p) => {
      p.alive = true;
      p.eliminatedRank = 0;
      p.roundsSurvived = 0;
      p.hasShield = false;
      p.speedBoost = false;
      p.dashCooldown = 0;
      const spawn = this.getRandomSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
    });

    this.dashTimers.clear();
    this.speedBoostTimers.clear();
    this.shieldProtectedThisDrop.clear();
    this.state.powerUps.clear();

    this.recountAlive();
    this.generateTiles(1);

    this.phaseTimer = ARENA_CONFIG.STARTING_COUNTDOWN_SEC;
    this.state.phaseDuration = ARENA_CONFIG.STARTING_COUNTDOWN_SEC;
    this.state.phaseTimeLeft = ARENA_CONFIG.STARTING_COUNTDOWN_SEC;
  }

  private spawnPowerUps() {
    this.state.powerUps.clear();
    const count = 3;
    const margin = ARENA_CONFIG.TILE_SIZE * 1.4;
    for (let i = 0; i < count; i++) {
      const pu = new PowerUp();
      pu.id = `pu_${this.state.round}_${i}_${Math.floor(Math.random() * 1000)}`;
      pu.kind = i === 0 ? 'shield' : Math.random() < 0.45 ? 'shield' : 'speed';
      pu.x = Math.round(margin + Math.random() * (ARENA_WIDTH - margin * 2));
      pu.y = Math.round(margin + Math.random() * (ARENA_HEIGHT - margin * 2));
      this.state.powerUps.push(pu);
    }
  }

  private startNextRound() {
    this.state.round += 1;
    const nextLevel = ((this.state.startingLevel - 1 + (this.state.round - 1)) % 10) + 1;
    this.state.level = nextLevel;
    this.obstacleMotions = buildObstaclesForLevel(nextLevel, this.state.obstacles);
    this.knockbacks.clear();
    this.shieldProtectedThisDrop.clear();
    this.generateTiles(this.state.round);
    this.spawnPowerUps();

    // Pick a random safe color that definitely exists on the board
    const safeColor = Math.floor(Math.random() * TILE_COLORS.length);
    this.state.safeColor = safeColor;

    const roundTime = Math.max(
      ARENA_CONFIG.MIN_ROUND_TIME_SEC,
      ARENA_CONFIG.INITIAL_ROUND_TIME_SEC - (this.state.round - 1) * ARENA_CONFIG.ROUND_TIME_DECAY_SEC
    );
    const scrambleTime = Math.max(0.55, roundTime - ARENA_CONFIG.WARNING_DURATION_SEC);

    this.state.phase = 'scramble';
    this.phaseTimer = scrambleTime;
    this.state.phaseDuration = roundTime;
    this.state.phaseTimeLeft = Number(roundTime.toFixed(2));
  }

  private startWarningPhase() {
    this.state.phase = 'warning';
    this.phaseTimer = ARENA_CONFIG.WARNING_DURATION_SEC;
    this.state.phaseTimeLeft = ARENA_CONFIG.WARNING_DURATION_SEC;
  }

  private startDropPhase() {
    this.state.phase = 'drop';
    this.phaseTimer = ARENA_CONFIG.DROP_DURATION_SEC;
    this.state.phaseDuration = ARENA_CONFIG.DROP_DURATION_SEC;
    this.state.phaseTimeLeft = ARENA_CONFIG.DROP_DURATION_SEC;

    // Remove all non-safe tiles
    for (let i = 0; i < this.state.tiles.length; i++) {
      if (this.state.tiles[i] !== this.state.safeColor) {
        this.state.tiles[i] = -1;
      }
    }

    // Immediate elimination check
    this.evaluateEliminations();
  }

  private startRoundEndPhase() {
    // Consume shields that saved players during this drop
    this.shieldProtectedThisDrop.forEach((sid) => {
      const p = this.state.players.get(sid);
      if (p) p.hasShield = false;
    });
    this.shieldProtectedThisDrop.clear();

    // Award surviving players +1 round survived
    this.state.players.forEach((p) => {
      if (p.alive) {
        p.roundsSurvived = this.state.round;
      }
    });

    if (this.checkWinCondition()) {
      return;
    }

    this.state.phase = 'round_end';
    this.state.safeColor = -1;
    this.phaseTimer = ARENA_CONFIG.ROUND_END_DURATION_SEC;
    this.state.phaseDuration = ARENA_CONFIG.ROUND_END_DURATION_SEC;
    this.state.phaseTimeLeft = ARENA_CONFIG.ROUND_END_DURATION_SEC;
  }

  private resetToLobby() {
    this.unlock();
    this.isSoloPractice = false;
    this.state.phase = 'lobby';
    this.state.round = 0;
    this.state.safeColor = -1;
    this.state.phaseTimeLeft = 0;
    this.state.phaseDuration = 0;
    this.state.winnerSessionId = '';
    this.state.winnerName = '';
    this.state.winnerAvatar = '';
    this.phaseTimer = 0;

    this.state.players.forEach((p) => {
      p.alive = true;
      p.eliminatedRank = 0;
      p.roundsSurvived = 0;
      p.hasShield = false;
      p.speedBoost = false;
      p.dashCooldown = 0;
      const spawn = this.getRandomSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
    });

    this.dashTimers.clear();
    this.speedBoostTimers.clear();
    this.shieldProtectedThisDrop.clear();
    this.state.powerUps.clear();

    this.generateTiles(1);
    this.recountAlive();
  }

  private update(dt: number) {
    this.elapsedSec += dt;
    updateObstacles(this.state.obstacles, this.obstacleMotions, this.elapsedSec);

    // 1. Simulate player movement (authoritative)
    const canMove =
      this.state.phase === 'lobby' ||
      this.state.phase === 'countdown' ||
      this.state.phase === 'scramble' ||
      this.state.phase === 'warning' ||
      this.state.phase === 'drop' ||
      this.state.phase === 'round_end';

    if (canMove) {
      this.simulateMovement(dt);
    }

    // 2. Continuous fall check during drop phase (in case someone steps off safe tile)
    if (this.state.phase === 'drop') {
      this.evaluateEliminations();
    }

    // 3. Phase state machine
    if (this.state.phase === 'lobby' || this.state.phase === 'finished') {
      return;
    }

    this.phaseTimer -= dt;

    if (this.state.phase === 'scramble') {
      this.state.phaseTimeLeft = Math.max(
        0,
        Number((this.phaseTimer + ARENA_CONFIG.WARNING_DURATION_SEC).toFixed(2))
      );
      if (this.phaseTimer <= 0) {
        this.startWarningPhase();
      }
    } else if (this.state.phase === 'warning') {
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.phaseTimer <= 0) {
        this.startDropPhase();
      }
    } else if (this.state.phase === 'drop') {
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.phaseTimer <= 0) {
        this.startRoundEndPhase();
      }
    } else if (this.state.phase === 'round_end') {
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.phaseTimer <= 0) {
        this.startNextRound();
      }
    } else if (this.state.phase === 'countdown') {
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.state.players.size >= this.maxClients || this.phaseTimer <= 0) {
        this.startStartingPhase();
      }
    } else if (this.state.phase === 'starting') {
      this.state.phaseTimeLeft = Math.max(0, Number(this.phaseTimer.toFixed(2)));
      if (this.phaseTimer <= 0) {
        this.startNextRound();
      }
    }
  }

  private simulateMovement(dt: number) {
    const speed = ARENA_CONFIG.PLAYER_SPEED;
    const minX = ARENA_CONFIG.PLAYER_RADIUS;
    const maxX = ARENA_WIDTH - ARENA_CONFIG.PLAYER_RADIUS;
    const minY = ARENA_CONFIG.PLAYER_RADIUS;
    const maxY = ARENA_HEIGHT - ARENA_CONFIG.PLAYER_RADIUS;

    const activePlayers: Player[] = [];

    this.state.players.forEach((player) => {
      if (!player.alive) {
        player.vx = 0;
        player.vy = 0;
        return;
      }
      const input = this.inputs.get(player.sessionId);
      let dx = input?.dx ?? 0;
      let dy = input?.dy ?? 0;

      // Update dash cooldown
      if (player.dashCooldown > 0) {
        player.dashCooldown = Math.max(0, Math.round((player.dashCooldown - dt) * 10) / 10);
      }

      // Update speed boost timer
      const sbLeft = this.speedBoostTimers.get(player.sessionId);
      if (sbLeft !== undefined) {
        const nextSb = sbLeft - dt;
        if (nextSb <= 0) {
          this.speedBoostTimers.delete(player.sessionId);
          player.speedBoost = false;
        } else {
          this.speedBoostTimers.set(player.sessionId, nextSb);
        }
      }

      // Apply active dash velocity override
      let speedMult = player.speedBoost ? 1.38 : 1.0;
      const dash = this.dashTimers.get(player.sessionId);
      if (dash) {
        dx = dash.dx;
        dy = dash.dy;
        speedMult = DASH_CONFIG.SPEED_MULTIPLIER;
        dash.timeLeft -= dt;
        if (dash.timeLeft <= 0) {
          this.dashTimers.delete(player.sessionId);
        }
      }

      player.vx = Math.round(dx * 100) / 100;
      player.vy = Math.round(dy * 100) / 100;

      const kb = this.knockbacks.get(player.sessionId);
      const kbVx = kb?.vx ?? 0;
      const kbVy = kb?.vy ?? 0;

      if (dx !== 0 || dy !== 0 || Math.abs(kbVx) > 2 || Math.abs(kbVy) > 2) {
        let nx = player.x + (dx * speed * speedMult + kbVx) * dt;
        let ny = player.y + (dy * speed * speedMult + kbVy) * dt;
        nx = Math.max(minX, Math.min(maxX, nx));
        ny = Math.max(minY, Math.min(maxY, ny));
        player.x = Math.round(nx * 10) / 10;
        player.y = Math.round(ny * 10) / 10;
      }

      if (kb) {
        kb.vx *= Math.pow(0.05, dt);
        kb.vy *= Math.pow(0.05, dt);
        if (Math.hypot(kb.vx, kb.vy) < 8) {
          this.knockbacks.delete(player.sessionId);
        }
      }

      resolveObstacleCollisions(player, this.state.obstacles, this.knockbacks);
      player.x = Math.round(player.x * 10) / 10;
      player.y = Math.round(player.y * 10) / 10;

      // Check Power-Up pickups
      for (let i = this.state.powerUps.length - 1; i >= 0; i--) {
        const pu = this.state.powerUps[i];
        if (!pu) continue;
        if (Math.hypot(player.x - pu.x, player.y - pu.y) < ARENA_CONFIG.PLAYER_RADIUS + 24) {
          if (pu.kind === 'shield') {
            player.hasShield = true;
          } else {
            player.speedBoost = true;
            this.speedBoostTimers.set(player.sessionId, 4.5);
          }
          this.broadcast(SERVER_MESSAGES.POWERUP_PICKED, {
            sessionId: player.sessionId,
            kind: pu.kind,
            x: pu.x,
            y: pu.y,
          });
          this.state.powerUps.splice(i, 1);
        }
      }

      activePlayers.push(player);
    });

    // Gentle soft separation so players don't stack invisibly on the same pixel
    const minDist = ARENA_CONFIG.PLAYER_RADIUS * 1.35;
    const minDistSq = minDist * minDist;
    for (let i = 0; i < activePlayers.length; i++) {
      const a = activePlayers[i];
      for (let j = i + 1; j < activePlayers.length; j++) {
        const b = activePlayers[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > 0.001 && distSq < minDistSq) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.25;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x = Math.round(Math.max(minX, Math.min(maxX, a.x - nx * overlap)) * 10) / 10;
          a.y = Math.round(Math.max(minY, Math.min(maxY, a.y - ny * overlap)) * 10) / 10;
          b.x = Math.round(Math.max(minX, Math.min(maxX, b.x + nx * overlap)) * 10) / 10;
          b.y = Math.round(Math.max(minY, Math.min(maxY, b.y + ny * overlap)) * 10) / 10;
        }
      }
    }
  }

  private isOnSafeTile(x: number, y: number): boolean {
    const tileSize = ARENA_CONFIG.TILE_SIZE;
    // Check center + 4 small forgiving offsets (5px) so touching edge of safe tile feels fair
    const offsets = [
      [0, 0],
      [5, 0],
      [-5, 0],
      [0, 5],
      [0, -5],
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
        if (this.state.tiles[idx] === this.state.safeColor) {
          return true;
        }
      }
    }
    return false;
  }

  private distanceToNearestSafeTile(x: number, y: number): number {
    const tileSize = ARENA_CONFIG.TILE_SIZE;
    let best = Infinity;
    for (let i = 0; i < this.state.tiles.length; i++) {
      if (this.state.tiles[i] === this.state.safeColor) {
        const col = i % ARENA_CONFIG.GRID_COLS;
        const row = Math.floor(i / ARENA_CONFIG.GRID_COLS);
        const cx = col * tileSize + tileSize / 2;
        const cy = row * tileSize + tileSize / 2;
        const d = Math.hypot(x - cx, y - cy);
        if (d < best) best = d;
      }
    }
    return best;
  }

  private evaluateEliminations() {
    const falling: Player[] = [];
    let aliveBefore = 0;

    this.state.players.forEach((p) => {
      if (p.alive) {
        aliveBefore++;
        if (!this.isOnSafeTile(p.x, p.y)) {
          if (p.hasShield) {
            // Magic shield saves the player from falling during this drop!
            this.shieldProtectedThisDrop.add(p.sessionId);
          } else {
            falling.push(p);
          }
        }
      }
    });

    if (falling.length === 0) return;

    // If everyone left in a multi-player match would be eliminated on the exact same tick,
    // spare the one closest to a safe tile so there's always a thrilling winner!
    if (!this.isSoloPractice && falling.length === aliveBefore && aliveBefore > 1) {
      falling.sort(
        (a, b) =>
          this.distanceToNearestSafeTile(a.x, a.y) -
          this.distanceToNearestSafeTile(b.x, b.y)
      );
      const spared = falling.shift();
      if (spared) {
        console.log(
          `[SonKisiRoom ${this.state.roomCode}] Simultaneous wipeout — ${spared.name} was closest to safe tile and wins!`
        );
      }
    }

    const rankForBatch = aliveBefore;
    for (const p of falling) {
      p.alive = false;
      p.eliminatedRank = rankForBatch;
      p.roundsSurvived = Math.max(0, this.state.round - 1);

      const client = this.clients.find((c) => c.sessionId === p.sessionId);
      if (client) {
        client.send(SERVER_MESSAGES.ELIMINATED, {
          sessionId: p.sessionId,
          rank: p.eliminatedRank,
          totalPlayers: this.state.totalMatchPlayers,
          roundsSurvived: p.roundsSurvived,
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

  private checkWinCondition(): boolean {
    if (this.state.phase === 'finished' || this.state.phase === 'lobby') {
      return false;
    }

    // In solo practice mode, match only ends when the solo player falls
    if (this.isSoloPractice) {
      if (this.state.aliveCount === 0) {
        this.state.phase = 'finished';
        this.state.phaseTimeLeft = 0;
        this.state.winnerSessionId = '';
        this.state.winnerName = '';
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
      this.state.phaseTimeLeft = 0;

      if (winner) {
        const w = winner as Player;
        w.eliminatedRank = 1;
        w.roundsSurvived = this.state.round;
        this.state.winnerSessionId = w.sessionId;
        this.state.winnerName = w.name;
        this.state.winnerAvatar = w.avatar;

        const pointsAwarded =
          100 + this.state.totalMatchPlayers * 10 + this.state.round * 15;

        this.broadcast(SERVER_MESSAGES.MATCH_WINNER, {
          winnerSessionId: w.sessionId,
          winnerName: w.name,
          winnerAvatar: w.avatar,
          pointsAwarded,
          totalPlayers: this.state.totalMatchPlayers,
          roundsPlayed: this.state.round,
        });
      }

      return true;
    }

    return false;
  }
}
