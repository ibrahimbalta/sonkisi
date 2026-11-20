import { Client, Room } from 'colyseus.js';
import {
  CLIENT_MESSAGES,
  DisasterKind,
  EliminatedPayload,
  EliminationFeedPayload,
  EmojiBroadcast,
  GamePhase,
  KnockoutCreditPayload,
  MatchWinnerPayload,
  PowerUpKind,
  PowerUpPickedPayload,
  SERVER_MESSAGES,
} from '../../../shared/src/index';

export interface PlayerSnapshot {
  sessionId: string;
  name: string;
  avatar: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  alive: boolean;
  eliminatedRank: number;
  roundsSurvived: number;
  connected: boolean;
  hasShield: boolean;
  speedBoost: boolean;
  hasDoubleJump: boolean;
  hasPushPower: boolean;
  hasBomb: boolean;
  kills: number;
  score: number;
  dashCooldown: number;
}

export interface MeteorSnapshot {
  id: string;
  x: number;
  y: number;
  radius: number;
  timeLeft: number;
}

export interface PowerUpSnapshot {
  id: string;
  kind: PowerUpKind;
  x: number;
  y: number;
}

export interface ObstacleSnapshot {
  id: string;
  kind: 'pillar' | 'bumper' | 'slider' | 'orbiter' | 'sweeper';
  x: number;
  y: number;
  radius: number;
  width: number;
  height: number;
  angle: number;
}

export interface RoomStateSnapshot {
  phase: GamePhase;
  roomCode: string;
  isPrivate: boolean;
  hostSessionId: string;
  round: number;
  level: number;
  startingLevel: number;
  matchTimeSec: number;
  shrinkStage: number;
  finalDuel: boolean;
  disaster: DisasterKind;
  windX: number;
  windY: number;
  safeColor: number;
  phaseTimeLeft: number;
  phaseDuration: number;
  minPlayersToStart: number;
  maxPlayers: number;
  aliveCount: number;
  totalMatchPlayers: number;
  winnerSessionId: string;
  winnerName: string;
  winnerAvatar: string;
  tiles: number[];
  obstacles: ObstacleSnapshot[];
  powerUps: PowerUpSnapshot[];
  meteors: MeteorSnapshot[];
  players: Map<string, PlayerSnapshot>;
}

export interface NetworkCallbacks {
  onStateUpdate: (state: RoomStateSnapshot) => void;
  onEliminated: (payload: EliminatedPayload) => void;
  onMatchWinner: (payload: MatchWinnerPayload) => void;
  onEmoji: (payload: EmojiBroadcast) => void;
  onPlayerDashed?: (payload: { sessionId: string; x: number; y: number }) => void;
  onPowerUpPicked?: (payload: PowerUpPickedPayload) => void;
  onEliminationFeed?: (payload: EliminationFeedPayload) => void;
  onMeteorImpact?: (payload: { x: number; y: number }) => void;
  onBombExploded?: (payload: { x: number; y: number; victimName: string }) => void;
  onKnockoutCredit?: (payload: KnockoutCreditPayload) => void;
  onDisconnected: (reconnecting: boolean) => void;
  onReconnected: () => void;
  onRoomLeft: (reason?: string) => void;
}

function getDefaultServerUrl(): string {
  const envUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  const host = window.location.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.startsWith('192.168.') ||
    host.startsWith('10.');
  if (isLocal) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${host}:2567`;
  }
  return 'wss://sonkisi-server.onrender.com';
}

export class NetworkManager {
  private client: Client;
  private room: Room | null = null;
  private callbacks: NetworkCallbacks;
  private lastInputX = 0;
  private lastInputY = 0;
  private lastInputSentAt = 0;
  private intentionalLeave = false;
  private reconnectionToken: string | null = null;
  private serverUrl: string;

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    this.serverUrl = getDefaultServerUrl();
    this.client = new Client(this.serverUrl);
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get isConnected(): boolean {
    return this.room !== null;
  }

  get endpoint(): string {
    return this.serverUrl;
  }

  async joinPublic(name: string, avatar: string): Promise<void> {
    await this.leaveRoom();
    this.intentionalLeave = false;
    const room = await this.client.joinOrCreate('sonkisi_public', {
      name,
      avatar,
      isPrivate: false,
    });
    this.attachRoom(room);
  }

  async createPrivate(name: string, avatar: string): Promise<string> {
    await this.leaveRoom();
    this.intentionalLeave = false;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let roomCode = '';
    for (let i = 0; i < 6; i++) {
      roomCode += chars[Math.floor(Math.random() * chars.length)];
    }

    const room = await this.client.create('sonkisi_private', {
      name,
      avatar,
      isPrivate: true,
      roomCode,
    });
    this.attachRoom(room);
    return roomCode;
  }

  async joinPrivate(roomCode: string, name: string, avatar: string): Promise<void> {
    await this.leaveRoom();
    this.intentionalLeave = false;
    const normalized = roomCode.trim().toUpperCase();
    const room = await this.client.join('sonkisi_private', {
      name,
      avatar,
      isPrivate: true,
      roomCode: normalized,
    });
    this.attachRoom(room);
  }

  async leaveRoom(): Promise<void> {
    if (!this.room) return;
    this.intentionalLeave = true;
    this.reconnectionToken = null;
    try {
      await this.room.leave(true);
    } catch {
      // Ignore
    }
    this.room = null;
  }

  sendInput(dx: number, dy: number) {
    if (!this.room) return;
    const now = performance.now();
    const changed =
      Math.abs(dx - this.lastInputX) > 0.04 || Math.abs(dy - this.lastInputY) > 0.04;
    const stopped = dx === 0 && dy === 0 && (this.lastInputX !== 0 || this.lastInputY !== 0);

    if (!changed && !stopped && now - this.lastInputSentAt < 250) {
      return;
    }

    this.lastInputX = dx;
    this.lastInputY = dy;
    this.lastInputSentAt = now;
    this.room.send(CLIENT_MESSAGES.INPUT, {
      dx: Math.round(dx * 100) / 100,
      dy: Math.round(dy * 100) / 100,
    });
  }

  sendEmoji(emoji: string) {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.EMOJI, { emoji });
  }

  sendStartPrivate() {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.START_PRIVATE);
  }

  sendPlayAgainPrivate() {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.PLAY_AGAIN);
  }

  sendSelectLevel(level: number) {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.SELECT_LEVEL, { level });
  }

  sendDash() {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.DASH);
  }

  sendJump() {
    if (!this.room) return;
    this.room.send(CLIENT_MESSAGES.JUMP);
  }

  private attachRoom(room: Room) {
    this.room = room;
    this.reconnectionToken = room.reconnectionToken;

    room.onStateChange((rawState: any) => {
      const snapshot = this.extractSnapshot(rawState);
      this.callbacks.onStateUpdate(snapshot);
    });

    room.onMessage(SERVER_MESSAGES.ELIMINATED, (payload: EliminatedPayload) => {
      this.callbacks.onEliminated(payload);
    });

    room.onMessage(SERVER_MESSAGES.MATCH_WINNER, (payload: MatchWinnerPayload) => {
      this.callbacks.onMatchWinner(payload);
    });

    room.onMessage(SERVER_MESSAGES.EMOJI, (payload: EmojiBroadcast) => {
      this.callbacks.onEmoji(payload);
    });

    room.onMessage(
      SERVER_MESSAGES.PLAYER_DASHED,
      (payload: { sessionId: string; x: number; y: number }) => {
        this.callbacks.onPlayerDashed?.(payload);
      }
    );

    room.onMessage(SERVER_MESSAGES.POWERUP_PICKED, (payload: PowerUpPickedPayload) => {
      this.callbacks.onPowerUpPicked?.(payload);
    });

    room.onMessage(
      SERVER_MESSAGES.ELIMINATION_FEED,
      (payload: EliminationFeedPayload) => {
        this.callbacks.onEliminationFeed?.(payload);
      }
    );

    room.onMessage(
      SERVER_MESSAGES.METEOR_IMPACT,
      (payload: { x: number; y: number }) => {
        this.callbacks.onMeteorImpact?.(payload);
      }
    );

    room.onMessage(
      SERVER_MESSAGES.BOMB_EXPLODED,
      (payload: { x: number; y: number; victimName: string }) => {
        this.callbacks.onBombExploded?.(payload);
      }
    );

    room.onMessage(
      SERVER_MESSAGES.KNOCKOUT_CREDIT,
      (payload: KnockoutCreditPayload) => {
        this.callbacks.onKnockoutCredit?.(payload);
      }
    );

    room.onLeave(async (code) => {
      if (this.intentionalLeave) {
        this.room = null;
        return;
      }

      // Unexpected disconnect — try to reconnect automatically
      const token = this.reconnectionToken;
      if (token && code !== 1000) {
        this.callbacks.onDisconnected(true);
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const reconnected = await this.client.reconnect(token);
            this.attachRoom(reconnected);
            this.callbacks.onReconnected();
            return;
          } catch {
            // Retry
          }
        }
      }

      this.room = null;
      this.reconnectionToken = null;
      this.callbacks.onDisconnected(false);
      this.callbacks.onRoomLeft('Sunucu bağlantısı kesildi.');
    });
  }

  private extractSnapshot(raw: any): RoomStateSnapshot {
    const players = new Map<string, PlayerSnapshot>();
    if (raw.players && typeof raw.players.forEach === 'function') {
      raw.players.forEach((p: any, key: string) => {
        players.set(key, {
          sessionId: p.sessionId ?? key,
          name: p.name ?? 'Oyuncu',
          avatar: p.avatar ?? 'cat',
          x: Number(p.x ?? 0),
          y: Number(p.y ?? 0),
          z: Number(p.z ?? 0),
          vx: Number(p.vx ?? 0),
          vy: Number(p.vy ?? 0),
          alive: Boolean(p.alive),
          eliminatedRank: Number(p.eliminatedRank ?? 0),
          roundsSurvived: Number(p.roundsSurvived ?? 0),
          connected: Boolean(p.connected),
          hasShield: Boolean(p.hasShield),
          speedBoost: Boolean(p.speedBoost),
          hasDoubleJump: Boolean(p.hasDoubleJump),
          hasPushPower: Boolean(p.hasPushPower),
          hasBomb: Boolean(p.hasBomb),
          kills: Number(p.kills ?? 0),
          score: Number(p.score ?? 0),
          dashCooldown: Number(p.dashCooldown ?? 0),
        });
      });
    }

    const tiles: number[] = [];
    if (raw.tiles && typeof raw.tiles.length === 'number') {
      for (let i = 0; i < raw.tiles.length; i++) {
        tiles.push(Number(raw.tiles[i]));
      }
    }

    const obstacles: ObstacleSnapshot[] = [];
    if (raw.obstacles && typeof raw.obstacles.length === 'number') {
      for (let i = 0; i < raw.obstacles.length; i++) {
        const o = raw.obstacles[i];
        obstacles.push({
          id: String(o.id ?? `obs_${i}`),
          kind: (o.kind ?? 'pillar') as ObstacleSnapshot['kind'],
          x: Number(o.x ?? 0),
          y: Number(o.y ?? 0),
          radius: Number(o.radius ?? 28),
          width: Number(o.width ?? 0),
          height: Number(o.height ?? 0),
          angle: Number(o.angle ?? 0),
        });
      }
    }

    const powerUps: PowerUpSnapshot[] = [];
    if (raw.powerUps && typeof raw.powerUps.length === 'number') {
      for (let i = 0; i < raw.powerUps.length; i++) {
        const pu = raw.powerUps[i];
        powerUps.push({
          id: String(pu.id ?? `pu_${i}`),
          kind: (pu.kind ?? 'speed') as PowerUpKind,
          x: Number(pu.x ?? 0),
          y: Number(pu.y ?? 0),
        });
      }
    }

    const meteors: MeteorSnapshot[] = [];
    if (raw.meteors && typeof raw.meteors.length === 'number') {
      for (let i = 0; i < raw.meteors.length; i++) {
        const m = raw.meteors[i];
        meteors.push({
          id: String(m.id ?? `met_${i}`),
          x: Number(m.x ?? 0),
          y: Number(m.y ?? 0),
          radius: Number(m.radius ?? 72),
          timeLeft: Number(m.timeLeft ?? 1),
        });
      }
    }

    return {
      phase: (raw.phase ?? 'lobby') as GamePhase,
      roomCode: String(raw.roomCode ?? ''),
      isPrivate: Boolean(raw.isPrivate),
      hostSessionId: String(raw.hostSessionId ?? ''),
      round: Number(raw.round ?? 0),
      level: Number(raw.level ?? 1),
      startingLevel: Number(raw.startingLevel ?? 1),
      matchTimeSec: Number(raw.matchTimeSec ?? 0),
      shrinkStage: Number(raw.shrinkStage ?? 0),
      finalDuel: Boolean(raw.finalDuel),
      disaster: (raw.disaster ?? 'none') as DisasterKind,
      windX: Number(raw.windX ?? 0),
      windY: Number(raw.windY ?? 0),
      safeColor: Number(raw.safeColor ?? -1),
      phaseTimeLeft: Number(raw.phaseTimeLeft ?? 0),
      phaseDuration: Number(raw.phaseDuration ?? 0),
      minPlayersToStart: Number(raw.minPlayersToStart ?? 10),
      maxPlayers: Number(raw.maxPlayers ?? 50),
      aliveCount: Number(raw.aliveCount ?? 0),
      totalMatchPlayers: Number(raw.totalMatchPlayers ?? 0),
      winnerSessionId: String(raw.winnerSessionId ?? ''),
      winnerName: String(raw.winnerName ?? ''),
      winnerAvatar: String(raw.winnerAvatar ?? ''),
      tiles,
      obstacles,
      powerUps,
      meteors,
      players,
    };
  }
}
