import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';
import { ARENA_CONFIG } from '../../../shared/src/index';

export class Player extends Schema {
  @type('string') sessionId: string = '';
  @type('string') name: string = 'Oyuncu';
  @type('string') avatar: string = 'dragon';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') vx: number = 0;
  @type('number') vy: number = 0;
  @type('boolean') alive: boolean = true;
  @type('number') eliminatedRank: number = 0;
  @type('number') roundsSurvived: number = 0;
  @type('boolean') connected: boolean = true;
}

export class Obstacle extends Schema {
  @type('string') id: string = '';
  @type('string') kind: string = 'pillar'; // 'pillar' | 'bumper' | 'slider' | 'orbiter' | 'sweeper'
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') radius: number = 28;
  @type('number') width: number = 0;
  @type('number') height: number = 0;
  @type('number') angle: number = 0;
}

export class GameState extends Schema {
  @type('string') phase: string = 'lobby';
  @type('string') roomCode: string = '';
  @type('boolean') isPrivate: boolean = false;
  @type('string') hostSessionId: string = '';
  @type('number') round: number = 0;
  @type('number') level: number = 1;
  @type('number') startingLevel: number = 1;
  @type('number') safeColor: number = -1;
  @type('number') phaseTimeLeft: number = 0;
  @type('number') phaseDuration: number = 0;
  @type('number') minPlayersToStart: number = ARENA_CONFIG.DEFAULT_MIN_PLAYERS;
  @type('number') maxPlayers: number = ARENA_CONFIG.MAX_PLAYERS;
  @type('number') aliveCount: number = 0;
  @type('number') totalMatchPlayers: number = 0;
  @type('string') winnerSessionId: string = '';
  @type('string') winnerName: string = '';
  @type('string') winnerAvatar: string = '';
  @type(['int8']) tiles = new ArraySchema<number>();
  @type([Obstacle]) obstacles = new ArraySchema<Obstacle>();
  @type({ map: Player }) players = new MapSchema<Player>();
}
