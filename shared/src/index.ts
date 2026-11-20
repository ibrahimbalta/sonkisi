export interface TileColorDef {
  id: number;
  key: string;
  name: string;
  hex: string;
  num: number;
  darkHex: string;
  darkNum: number;
  symbol: string;
}

export const TILE_COLORS: TileColorDef[] = [
  {
    id: 0,
    key: 'red',
    name: 'KIRMIZI',
    hex: '#FF4757',
    num: 0xff4757,
    darkHex: '#C0293B',
    darkNum: 0xc0293b,
    symbol: '♥',
  },
  {
    id: 1,
    key: 'blue',
    name: 'MAVİ',
    hex: '#1E90FF',
    num: 0x1e90ff,
    darkHex: '#1062B8',
    darkNum: 0x1062b8,
    symbol: '◆',
  },
  {
    id: 2,
    key: 'yellow',
    name: 'SARI',
    hex: '#FFD32A',
    num: 0xffd32a,
    darkHex: '#C99E08',
    darkNum: 0xc99e08,
    symbol: '★',
  },
  {
    id: 3,
    key: 'green',
    name: 'YEŞİL',
    hex: '#2ED573',
    num: 0x2ed573,
    darkHex: '#1C9E52',
    darkNum: 0x1c9e52,
    symbol: '♣',
  },
  {
    id: 4,
    key: 'purple',
    name: 'MOR',
    hex: '#A55EEA',
    num: 0xa55eea,
    darkHex: '#7335B5',
    darkNum: 0x7335b5,
    symbol: '●',
  },
  {
    id: 5,
    key: 'orange',
    name: 'TURUNCU',
    hex: '#FF7F50',
    num: 0xff7f50,
    darkHex: '#C95226',
    darkNum: 0xc95226,
    symbol: '▲',
  },
];

export const ARENA_CONFIG = {
  GRID_COLS: 12,
  GRID_ROWS: 12,
  TILE_SIZE: 76,
  TILE_GAP: 4,
  PLAYER_RADIUS: 18,
  PLAYER_SPEED: 295, // pixels per second
  MAX_PLAYERS: 50,
  DEFAULT_MIN_PLAYERS: 10,
  LOBBY_COUNTDOWN_SEC: 10,
  STARTING_COUNTDOWN_SEC: 3,
  INITIAL_ROUND_TIME_SEC: 3.0,
  MIN_ROUND_TIME_SEC: 1.25,
  ROUND_TIME_DECAY_SEC: 0.14,
  WARNING_DURATION_SEC: 0.7,
  DROP_DURATION_SEC: 1.8,
  ROUND_END_DURATION_SEC: 1.15,
  TICK_RATE_HZ: 20,
} as const;

export const ARENA_WIDTH = ARENA_CONFIG.GRID_COLS * ARENA_CONFIG.TILE_SIZE;
export const ARENA_HEIGHT = ARENA_CONFIG.GRID_ROWS * ARENA_CONFIG.TILE_SIZE;

export type GamePhase =
  | 'lobby'
  | 'countdown'
  | 'starting'
  | 'scramble'
  | 'warning'
  | 'drop'
  | 'round_end'
  | 'finished';

export interface CharacterDef {
  id: string;
  name: string;
  bodyColor: string;
  bodyNum: number;
  accentColor: string;
  accentNum: number;
  earStyle:
    | 'dragon'
    | 'wizard'
    | 'knight'
    | 'unicorn'
    | 'phoenix'
    | 'cyber'
    | 'elf'
    | 'demon'
    | 'angel'
    | 'iceking'
    | 'astronaut'
    | 'king';
  tagline: string;
  emoji: string;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'dragon',
    name: 'Alev Ejderi',
    bodyColor: '#FF4757',
    bodyNum: 0xff4757,
    accentColor: '#FFD32A',
    accentNum: 0xffd32a,
    earStyle: 'dragon',
    tagline: 'Kanatlı ateş nefesli efsane!',
    emoji: '🐉',
  },
  {
    id: 'wizard',
    name: 'Büyücü',
    bodyColor: '#3742FA',
    bodyNum: 0x3742fa,
    accentColor: '#FFD32A',
    accentNum: 0xffd32a,
    earStyle: 'wizard',
    tagline: 'Güvenli rengi kehanetle bilir.',
    emoji: '🧙',
  },
  {
    id: 'knight',
    name: 'Altın Şövalye',
    bodyColor: '#CED6E0',
    bodyNum: 0xced6e0,
    accentColor: '#FF4757',
    accentNum: 0xff4757,
    earStyle: 'knight',
    tagline: 'Zırhlı, korkusuz arena koruyucusu.',
    emoji: '🛡️',
  },
  {
    id: 'unicorn',
    name: 'Tekboynuz',
    bodyColor: '#F8F9FA',
    bodyNum: 0xf8f9fa,
    accentColor: '#FF85C0',
    accentNum: 0xff85c0,
    earStyle: 'unicorn',
    tagline: 'Altın boynuzuyla gökyüzünde parlar.',
    emoji: '🦄',
  },
  {
    id: 'phoenix',
    name: 'Anka Kuşu',
    bodyColor: '#FF7F50',
    bodyNum: 0xff7f50,
    accentColor: '#FFD32A',
    accentNum: 0xffd32a,
    earStyle: 'phoenix',
    tagline: 'Küllerinden doğan ateş kanatlı.',
    emoji: '🔥',
  },
  {
    id: 'cyber',
    name: 'Siber Golem',
    bodyColor: '#1E90FF',
    bodyNum: 0x1e90ff,
    accentColor: '#00F5D4',
    accentNum: 0x00f5d4,
    earStyle: 'cyber',
    tagline: 'Neon enerjili gelecek savaşçısı.',
    emoji: '🤖',
  },
  {
    id: 'elf',
    name: 'Orman Elfi',
    bodyColor: '#2ED573',
    bodyNum: 0x2ed573,
    accentColor: '#FFEAA7',
    accentNum: 0xffeaa7,
    earStyle: 'elf',
    tagline: 'Rüzgar kadar hızlı ve çevik!',
    emoji: '🧝',
  },
  {
    id: 'demon',
    name: 'Gölge İfrit',
    bodyColor: '#5F27CD',
    bodyNum: 0x5f27cd,
    accentColor: '#FF3F8E',
    accentNum: 0xff3f8e,
    earStyle: 'demon',
    tagline: 'Karanlık boyuttan gelen rakip.',
    emoji: '😈',
  },
  {
    id: 'angel',
    name: 'Gök Meleği',
    bodyColor: '#FFF8E7',
    bodyNum: 0xfff8e7,
    accentColor: '#FFD32A',
    accentNum: 0xffd32a,
    earStyle: 'angel',
    tagline: 'Altın haleli, ışık kanatlı şampiyon.',
    emoji: '👼',
  },
  {
    id: 'iceking',
    name: 'Buz Lordu',
    bodyColor: '#48DBFB',
    bodyNum: 0x48dbfb,
    accentColor: '#DFF9FB',
    accentNum: 0xdff9fb,
    earStyle: 'iceking',
    tagline: 'Kristal buzdan kraliyet gücü.',
    emoji: '❄️',
  },
  {
    id: 'astronaut',
    name: 'Galaksi Kaşifi',
    bodyColor: '#F1F2F6',
    bodyNum: 0xf1f2f6,
    accentColor: '#FFA502',
    accentNum: 0xffa502,
    earStyle: 'astronaut',
    tagline: 'Jetpack ile yerçekimine meydan okur.',
    emoji: '👨‍🚀',
  },
  {
    id: 'king',
    name: 'Gökyüzü Kralı',
    bodyColor: '#A55EEA',
    bodyNum: 0xa55eea,
    accentColor: '#FFD32A',
    accentNum: 0xffd32a,
    earStyle: 'king',
    tagline: 'Arenanın yüce taç sahibi.',
    emoji: '👑',
  },
];

export const REACTION_EMOJIS = ['😂', '😱', '😎', '🔥', '👋', '👑'] as const;

export const CLIENT_MESSAGES = {
  INPUT: 'input',
  EMOJI: 'emoji',
  START_PRIVATE: 'start_private',
  PLAY_AGAIN: 'play_again',
  SELECT_LEVEL: 'select_level',
  DASH: 'dash',
} as const;

export type PowerUpKind = 'speed' | 'shield';

export type DisasterKind = 'none' | 'meteor' | 'ice' | 'bomb' | 'wind';

export interface DisasterDef {
  id: DisasterKind;
  name: string;
  icon: string;
  description: string;
  color: string;
}

export const DISASTERS: Record<DisasterKind, DisasterDef> = {
  none: {
    id: 'none',
    name: 'Normal Tur',
    icon: '✨',
    description: 'Güvenli renge koş!',
    color: '#2ED573',
  },
  meteor: {
    id: 'meteor',
    name: 'METEOR YAĞMURU',
    icon: '☄️',
    description: 'Kırmızı halkalardan kaç, göktaşları savurur!',
    color: '#FF4757',
  },
  ice: {
    id: 'ice',
    name: 'BUZ ZEMİNİ',
    icon: '🧊',
    description: 'Arena buz gibi kaygan, dikkatli fren yap!',
    color: '#48DBFB',
  },
  bomb: {
    id: 'bomb',
    name: 'SICAK BOMBA',
    icon: '💣',
    description: 'Bomba sendeyse başkasına dokunup devret!',
    color: '#FFA502',
  },
  wind: {
    id: 'wind',
    name: 'FIRTINA RÜZGARI',
    icon: '🌪️',
    description: 'Güçlü rüzgar herkesi kenara sürüklüyor!',
    color: '#A55EEA',
  },
};

export const DASH_CONFIG = {
  COOLDOWN_SEC: 3.5,
  DURATION_SEC: 0.24,
  SPEED_MULTIPLIER: 2.35,
} as const;

export type ObstacleKind = 'pillar' | 'bumper' | 'slider' | 'orbiter' | 'sweeper';

export interface LevelDef {
  level: number;
  name: string;
  icon: string;
  description: string;
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fogColor: number;
  frameColor: number;
  accentColor: number;
}

export const LEVELS: LevelDef[] = [
  {
    level: 1,
    name: 'Bulut Tapınağı',
    icon: '☁️',
    description: 'Gökyüzü başlangıç arenası ve 4 köşe tamponu',
    skyTop: '#0c0b3a',
    skyMid: '#3b1f75',
    skyHorizon: '#e06d94',
    fogColor: 0x281759,
    frameColor: 0x1d1645,
    accentColor: 0xffc83d,
  },
  {
    level: 2,
    name: 'Büyülü Orman',
    icon: '🌲',
    description: '4 antik totem sütunu etrafında manevra yap',
    skyTop: '#072a24',
    skyMid: '#135e4b',
    skyHorizon: '#6de3a0',
    fogColor: 0x11473a,
    frameColor: 0x16382c,
    accentColor: 0x2ed573,
  },
  {
    level: 3,
    name: 'Buzul Zirvesi',
    icon: '❄️',
    description: 'Merkezden dönen dev buz süpürücü çubuğa dikkat!',
    skyTop: '#081f44',
    skyMid: '#1b4f8c',
    skyHorizon: '#8ce6ff',
    fogColor: 0x133863,
    frameColor: 0x1a3a5c,
    accentColor: 0x48dbfb,
  },
  {
    level: 4,
    name: 'Lav Kalesi',
    icon: '🌋',
    description: '4 zıplatan magma küresi seni itebilir!',
    skyTop: '#2b0909',
    skyMid: '#7a1c1c',
    skyHorizon: '#ff7b3b',
    fogColor: 0x4a1212,
    frameColor: 0x2e1111,
    accentColor: 0xff5252,
  },
  {
    level: 5,
    name: 'Siber Arena',
    icon: '⚡',
    description: 'Arenada devriye gezen 3 kayan lazer bloğu',
    skyTop: '#0a0426',
    skyMid: '#2a0b5e',
    skyHorizon: '#00f5d4',
    fogColor: 0x190940,
    frameColor: 0x13112e,
    accentColor: 0x00f5d4,
  },
  {
    level: 6,
    name: 'Altın Çöl',
    icon: '🏜️',
    description: '6 kumtaşı sütunu ve dönen kum fırtınası bariyeri',
    skyTop: '#331c0a',
    skyMid: '#8c4b16',
    skyHorizon: '#ffd36b',
    fogColor: 0x5c3111,
    frameColor: 0x4a2c14,
    accentColor: 0xffd32a,
  },
  {
    level: 7,
    name: 'Kozmik Boşluk',
    icon: '🌌',
    description: 'Yörüngede dönen 4 kozmik meteor tamponu',
    skyTop: '#050214',
    skyMid: '#1f0c4d',
    skyHorizon: '#a55eea',
    fogColor: 0x120730,
    frameColor: 0x180e38,
    accentColor: 0xc56cf0,
  },
  {
    level: 8,
    name: 'Kristal Labirent',
    icon: '🔮',
    description: '6 kristal sütun ve 2 kayan enerji duvarı',
    skyTop: '#1f0738',
    skyMid: '#5c188a',
    skyHorizon: '#ff85c0',
    fogColor: 0x3b105c,
    frameColor: 0x2a1045,
    accentColor: 0xff85c0,
  },
  {
    level: 9,
    name: 'Fırtına Kulesi',
    icon: '🌪️',
    description: 'Çift çapraz dönen şimşek çubuğu ve 4 tampon',
    skyTop: '#071429',
    skyMid: '#183766',
    skyHorizon: '#70a1ff',
    fogColor: 0x102547,
    frameColor: 0x14243d,
    accentColor: 0x70a1ff,
  },
  {
    level: 10,
    name: 'Ejderha Tahtı',
    icon: '👑',
    description: 'Final Arenası: Alev süpürücü, 4 meteor ve 4 sütun!',
    skyTop: '#240514',
    skyMid: '#6e0d25',
    skyHorizon: '#ffc83d',
    fogColor: 0x3d0a1a,
    frameColor: 0x260c14,
    accentColor: 0xffd32a,
  },
];

export function getLevelByNumber(level: number): LevelDef {
  const clamped = Math.max(1, Math.min(LEVELS.length, Math.floor(level)));
  return LEVELS[clamped - 1];
}

export const SERVER_MESSAGES = {
  ELIMINATED: 'eliminated',
  MATCH_WINNER: 'match_winner',
  EMOJI: 'emoji',
  ROOM_INFO: 'room_info',
  ERROR_TOAST: 'error_toast',
  PLAYER_DASHED: 'player_dashed',
  POWERUP_PICKED: 'powerup_picked',
  ELIMINATION_FEED: 'elimination_feed',
  METEOR_IMPACT: 'meteor_impact',
  BOMB_EXPLODED: 'bomb_exploded',
  KNOCKOUT_CREDIT: 'knockout_credit',
} as const;

export interface KnockoutCreditPayload {
  killerSessionId: string;
  killerName: string;
  victimName: string;
}

export interface EliminationFeedPayload {
  name: string;
  avatar: string;
  rank: number;
}

export interface PowerUpPickedPayload {
  sessionId: string;
  kind: PowerUpKind;
  x: number;
  y: number;
}

export interface InputPayload {
  dx: number;
  dy: number;
}

export interface EmojiPayload {
  emoji: string;
}

export interface EmojiBroadcast {
  sessionId: string;
  emoji: string;
}

export interface EliminatedPayload {
  sessionId: string;
  rank: number;
  totalPlayers: number;
  roundsSurvived: number;
}

export interface MatchWinnerPayload {
  winnerSessionId: string;
  winnerName: string;
  winnerAvatar: string;
  pointsAwarded: number;
  totalPlayers: number;
  roundsPlayed: number;
}

export const FUNNY_ELIMINATION_QUIPS = [
  'Yerçekimi yine kazandı! 🪂',
  'O kare aslında bir tuzaktı! 🕳️',
  'Az kalsın yetişiyordun... neredeyse! 😅',
  'Renkler birbirine girdi galiba! 🎨',
  'Bir sonraki turda intikam zamanı! 🔥',
  'Boşluğa harika bir atlayış! 10/10 puan! 🤸',
];

export function getCharacterById(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function getTileColorById(id: number): TileColorDef {
  return TILE_COLORS.find((c) => c.id === id) ?? TILE_COLORS[0];
}
