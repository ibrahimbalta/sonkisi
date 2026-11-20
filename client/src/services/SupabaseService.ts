import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

export type LeaderboardTab =
  | 'daily'
  | 'weekly'
  | 'all_time'
  | 'most_wins'
  | 'best_streak';

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatar_id: string;
  score: number;
  wins: number;
  games: number;
  streak: number;
}

export interface CloudProfile {
  id: string;
  username: string;
  avatar_id: string;
  total_points: number;
  total_wins: number;
  total_games: number;
  current_streak: number;
  best_streak: number;
}

const VIEW_MAP: Record<LeaderboardTab, string> = {
  daily: 'leaderboard_daily',
  weekly: 'leaderboard_weekly',
  all_time: 'leaderboard_all_time',
  most_wins: 'leaderboard_most_wins',
  best_streak: 'leaderboard_best_streak',
};

class SupabaseService {
  private client: SupabaseClient | null = null;
  private user: User | null = null;
  private profile: CloudProfile | null = null;

  constructor() {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

    if (url && anonKey && url.startsWith('http')) {
      this.client = createClient(url, anonKey);
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  get currentUser(): User | null {
    return this.user;
  }

  get currentProfile(): CloudProfile | null {
    return this.profile;
  }

  async init(): Promise<CloudProfile | null> {
    if (!this.client) return null;
    try {
      const { data } = await this.client.auth.getSession();
      this.user = data.session?.user ?? null;
      if (this.user) {
        await this.fetchOwnProfile();
      }
      return this.profile;
    } catch {
      return null;
    }
  }

  async fetchOwnProfile(): Promise<CloudProfile | null> {
    if (!this.client || !this.user) return null;
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', this.user.id)
      .single();

    if (!error && data) {
      this.profile = data as CloudProfile;
      return this.profile;
    }
    return null;
  }

  async signUp(
    email: string,
    password: string,
    username: string,
    avatarId: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) {
      return { ok: false, error: 'Supabase yapılandırılmamış.' };
    }

    const { data, error } = await this.client.auth.signUp({
      email,
      password,
    });

    if (error) return { ok: false, error: error.message };
    if (!data.user) return { ok: false, error: 'Hesap oluşturulamadı.' };

    this.user = data.user;

    const { error: profErr } = await this.client.from('profiles').upsert({
      id: data.user.id,
      username: username.trim().slice(0, 16),
      avatar_id: avatarId,
    });

    if (profErr) {
      return { ok: false, error: `Profil kaydedilemedi: ${profErr.message}` };
    }

    await this.fetchOwnProfile();
    return { ok: true };
  }

  async signIn(
    email: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) {
      return { ok: false, error: 'Supabase yapılandırılmamış.' };
    }

    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { ok: false, error: error.message };
    this.user = data.user;
    await this.fetchOwnProfile();
    return { ok: true };
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.user = null;
    this.profile = null;
  }

  async syncProfileIdentity(username: string, avatarId: string): Promise<void> {
    if (!this.client || !this.user) return;
    await this.client
      .from('profiles')
      .update({
        username: username.trim().slice(0, 16),
        avatar_id: avatarId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', this.user.id);
    await this.fetchOwnProfile();
  }

  async recordMatchResult(params: {
    roomCode: string;
    placement: number;
    totalPlayers: number;
    roundsSurvived: number;
    pointsEarned: number;
    won: boolean;
  }): Promise<void> {
    if (!this.client || !this.user) return;
    await this.client.rpc('record_match_result', {
      p_room_code: params.roomCode,
      p_placement: params.placement,
      p_total_players: params.totalPlayers,
      p_rounds_survived: params.roundsSurvived,
      p_points_earned: params.pointsEarned,
      p_won: params.won,
    });
    await this.fetchOwnProfile();
  }

  async fetchLeaderboard(
    tab: LeaderboardTab
  ): Promise<{ entries: LeaderboardEntry[]; error?: string }> {
    if (!this.client) {
      return {
        entries: [],
        error: 'NOT_CONFIGURED',
      };
    }

    const view = VIEW_MAP[tab];
    const { data, error } = await this.client.from(view).select('*').limit(50);

    if (error) {
      return { entries: [], error: error.message };
    }

    return { entries: (data ?? []) as LeaderboardEntry[] };
  }
}

export const supabaseService = new SupabaseService();
