import { CHARACTERS } from '../../../shared/src/index';

export interface LocalSettings {
  sfxEnabled: boolean;
  sfxVolume: number;
  forceJoystick: boolean;
}

export interface LocalStats {
  totalGames: number;
  totalWins: number;
  totalPoints: number;
  currentStreak: number;
  bestStreak: number;
}

export interface LocalProfile {
  username: string;
  avatarId: string;
  settings: LocalSettings;
  stats: LocalStats;
}

const STORAGE_KEY = 'sonkisi_profile_v1';

const ADJECTIVES = [
  'Hızlı',
  'Süper',
  'Cesur',
  'Çılgın',
  'Şanslı',
  'Zıplayan',
  'Parlak',
  'Efsane',
  'Neşeli',
  'Kurnaz',
];

const NOUNS = [
  'Pati',
  'Penguen',
  'Tilki',
  'Kurbağa',
  'Panda',
  'Tavşan',
  'Robot',
  'Kral',
  'Civciv',
  'Yıldız',
];

function generateGuestName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 89);
  return `${a}${n}${num}`.slice(0, 16);
}

function defaultProfile(): LocalProfile {
  return {
    username: generateGuestName(),
    avatarId: CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id,
    settings: {
      sfxEnabled: true,
      sfxVolume: 0.7,
      forceJoystick: false,
    },
    stats: {
      totalGames: 0,
      totalWins: 0,
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
    },
  };
}

class StorageService {
  private profile: LocalProfile;

  constructor() {
    this.profile = this.load();
  }

  private load(): LocalProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = defaultProfile();
        this.saveRaw(fresh);
        return fresh;
      }
      const parsed = JSON.parse(raw) as Partial<LocalProfile>;
      const base = defaultProfile();
      return {
        username:
          typeof parsed.username === 'string' && parsed.username.trim().length >= 2
            ? parsed.username.trim().slice(0, 16)
            : base.username,
        avatarId:
          typeof parsed.avatarId === 'string' && CHARACTERS.some((c) => c.id === parsed.avatarId)
            ? parsed.avatarId
            : base.avatarId,
        settings: {
          ...base.settings,
          ...(parsed.settings ?? {}),
        },
        stats: {
          ...base.stats,
          ...(parsed.stats ?? {}),
        },
      };
    } catch {
      return defaultProfile();
    }
  }

  private saveRaw(p: LocalProfile) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // Ignore storage quota errors
    }
  }

  getProfile(): LocalProfile {
    return this.profile;
  }

  setUsername(name: string) {
    const cleaned = name.replace(/[<>]/g, '').trim().slice(0, 16);
    if (cleaned.length < 2) return;
    this.profile.username = cleaned;
    this.saveRaw(this.profile);
  }

  setAvatar(avatarId: string) {
    if (!CHARACTERS.some((c) => c.id === avatarId)) return;
    this.profile.avatarId = avatarId;
    this.saveRaw(this.profile);
  }

  updateSettings(partial: Partial<LocalSettings>) {
    this.profile.settings = { ...this.profile.settings, ...partial };
    this.saveRaw(this.profile);
  }

  recordLocalMatch(pointsEarned: number, won: boolean) {
    const s = this.profile.stats;
    s.totalGames += 1;
    s.totalPoints += Math.max(0, pointsEarned);
    if (won) {
      s.totalWins += 1;
      s.currentStreak += 1;
      if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
    } else {
      s.currentStreak = 0;
    }
    this.saveRaw(this.profile);
  }
}

export const storageService = new StorageService();
