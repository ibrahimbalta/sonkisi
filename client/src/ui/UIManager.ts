import {
  CHARACTERS,
  DISASTERS,
  EliminatedPayload,
  EliminationFeedPayload,
  FUNNY_ELIMINATION_QUIPS,
  getCharacterById,
  getLevelByNumber,
  getTileColorById,
  LEVELS,
  MatchWinnerPayload,
  REACTION_EMOJIS,
} from '../../../shared/src/index';
import { soundManager } from '../audio/SoundManager';
import { RoomStateSnapshot } from '../services/NetworkManager';
import { storageService } from '../services/StorageService';
import {
  LeaderboardEntry,
  LeaderboardTab,
  supabaseService,
} from '../services/SupabaseService';
import { VirtualJoystick } from './VirtualJoystick';

export interface UIActions {
  onPlayPublic: () => Promise<void>;
  onCreatePrivate: () => Promise<void>;
  onJoinPrivate: (code: string) => Promise<void>;
  onStartPrivate: () => void;
  onSelectLevel: (level: number) => void;
  onDash: () => void;
  onPlayAgain: () => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onSendEmoji: (emoji: string) => void;
  onJoystickMove: (dx: number, dy: number) => void;
  onProfileChanged: () => void;
}

type ModalType = 'none' | 'friends' | 'characters' | 'leaderboard' | 'settings';
type ViewMode = 'menu' | 'room';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.innerWidth <= 900
  );
}

export class UIManager {
  private root: HTMLElement;
  private toastRoot: HTMLElement;
  private actions: UIActions;

  private viewMode: ViewMode = 'menu';
  private activeModal: ModalType = 'none';
  private serverOnline = false;
  private onlinePlayers = 0;
  private localSessionId = '';
  private latestState: RoomStateSnapshot | null = null;
  private reconnecting = false;

  // Result screens
  private eliminatedInfo: (EliminatedPayload & { pointsEarned: number; quip: string }) | null = null;
  private spectating = false;
  private winnerInfo: MatchWinnerPayload | null = null;

  // Leaderboard state
  private lbTab: LeaderboardTab = 'daily';
  private lbLoading = false;
  private lbEntries: LeaderboardEntry[] = [];
  private lbError: string | null = null;

  // Settings / Auth form state
  private authMode: 'login' | 'signup' = 'signup';
  private authBusy = false;

  // Persistent in-room DOM refs (so 20Hz state updates never break touch joystick)
  private roomLayerEl: HTMLElement | null = null;
  private joystick: VirtualJoystick | null = null;
  private lastCountdownInt = -1;
  private lastAnnouncedLevel = -1;
  private levelBannerTimer: number | null = null;

  constructor(actions: UIActions) {
    this.root = document.getElementById('ui-root')!;
    this.toastRoot = document.getElementById('toast-container')!;
    this.actions = actions;
    this.render();
  }

  public showToast(message: string, isError = false) {
    const el = document.createElement('div');
    el.className = `toast ${isError ? 'error' : ''}`;
    el.textContent = message;
    this.toastRoot.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, 2800);
  }

  public setServerHealth(online: boolean, players: number) {
    this.serverOnline = online;
    this.onlinePlayers = players;
    if (this.viewMode === 'menu') {
      const dot = this.root.querySelector('.status-dot');
      const txt = this.root.querySelector('.server-status-text');
      if (dot) dot.className = `status-dot ${online ? '' : 'offline'}`;
      if (txt) {
        txt.textContent = online
          ? `${players} Çevrimiçi`
          : 'Sunucu Çevrimdışı';
      }
    }
  }

  public setLocalSessionId(id: string) {
    this.localSessionId = id;
  }

  public pushEliminationFeed(payload: EliminationFeedPayload) {
    const feed = document.getElementById('elim-feed');
    if (!feed) return;
    const c = getCharacterById(payload.avatar);
    const item = document.createElement('div');
    item.className = 'elim-item';
    item.textContent = `${c.emoji} ${payload.name} uçtu! (#${payload.rank})`;
    feed.prepend(item);
    while (feed.children.length > 4) {
      feed.lastElementChild?.remove();
    }
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity 0.3s ease';
      setTimeout(() => item.remove(), 320);
    }, 3200);
  }

  public showLevelBanner(level: number) {
    const el = document.getElementById('level-banner');
    if (!el) return;
    const def = getLevelByNumber(level);
    el.innerHTML = `
      <div class="level-banner-title">${def.icon} LEVEL ${def.level} — ${escapeHtml(def.name.toUpperCase())}</div>
      <div class="level-banner-sub">${escapeHtml(def.description)}</div>
    `;
    el.style.display = 'block';
    soundManager.playLevelUp();

    if (this.levelBannerTimer !== null) {
      window.clearTimeout(this.levelBannerTimer);
    }
    this.levelBannerTimer = window.setTimeout(() => {
      el.style.display = 'none';
    }, 2000);
  }

  public enterRoomView() {
    this.viewMode = 'room';
    this.activeModal = 'none';
    this.eliminatedInfo = null;
    this.spectating = false;
    this.winnerInfo = null;
    this.reconnecting = false;
    this.lastAnnouncedLevel = -1;
    this.renderRoomShell();
  }

  public enterMenuView() {
    this.viewMode = 'menu';
    this.latestState = null;
    this.eliminatedInfo = null;
    this.spectating = false;
    this.winnerInfo = null;
    this.reconnecting = false;
    this.destroyJoystick();
    this.roomLayerEl = null;
    this.render();
  }

  public setReconnecting(reconnecting: boolean) {
    this.reconnecting = reconnecting;
    const el = document.getElementById('reconnect-banner');
    if (el) {
      el.style.display = reconnecting ? 'block' : 'none';
    }
  }

  public showEliminated(payload: EliminatedPayload, pointsEarned: number) {
    const quip =
      FUNNY_ELIMINATION_QUIPS[
        Math.floor(Math.random() * FUNNY_ELIMINATION_QUIPS.length)
      ];
    this.eliminatedInfo = { ...payload, pointsEarned, quip };
    this.spectating = false;
    setTimeout(() => {
      if (this.viewMode === 'room' && !this.winnerInfo) {
        this.renderResultOverlay();
      }
    }, 750);
  }

  public showWinner(payload: MatchWinnerPayload) {
    this.winnerInfo = payload;
    this.renderResultOverlay();
  }

  public updateRoomState(state: RoomStateSnapshot) {
    this.latestState = state;
    if (this.viewMode !== 'room' || !this.roomLayerEl) return;

    // Reset overlays if private room restarted to lobby
    if (state.phase === 'lobby' && (this.eliminatedInfo || this.winnerInfo)) {
      this.eliminatedInfo = null;
      this.winnerInfo = null;
      this.spectating = false;
      this.renderResultOverlay();
    }

    // Countdown tick sound
    if (state.phase === 'starting' || state.phase === 'countdown') {
      const sec = Math.ceil(state.phaseTimeLeft);
      if (sec > 0 && sec <= 5 && sec !== this.lastCountdownInt) {
        this.lastCountdownInt = sec;
        soundManager.playCountdownTick(sec === 1);
      }
    } else {
      this.lastCountdownInt = -1;
    }

    this.patchRoomHUD(state);
  }

  private destroyJoystick() {
    if (this.joystick) {
      this.joystick.destroy();
      this.joystick = null;
    }
  }

  // ============================================================
  // MENU & MODALS RENDER
  // ============================================================
  public render() {
    if (this.viewMode === 'room') return;

    const profile = storageService.getProfile();
    const charDef = getCharacterById(profile.avatarId);
    const cloud = supabaseService.currentProfile;
    const wins = cloud ? cloud.total_wins : profile.stats.totalWins;
    const points = cloud ? cloud.total_points : profile.stats.totalPoints;

    this.root.innerHTML = `
      <div class="menu-overlay">
        <div class="menu-topbar">
          <div class="profile-pill" id="btn-open-profile">
            <div class="avatar-circle" style="background:${charDef.bodyColor}">${charDef.emoji}</div>
            <div class="profile-meta">
              <span class="profile-name">${escapeHtml(profile.username)}</span>
              <span class="profile-sub">👑 ${wins} Galibiyet • ⭐ ${points}</span>
            </div>
          </div>

          <div class="server-pill">
            <span class="status-dot ${this.serverOnline ? '' : 'offline'}"></span>
            <span class="server-status-text">${
              this.serverOnline ? `${this.onlinePlayers} Çevrimiçi` : 'Sunucu Çevrimdışı'
            }</span>
          </div>
        </div>

        <div class="menu-center">
          <div class="logo-wrap">
            <span class="logo-crown">👑</span>
            <h1 class="logo-title">SON KİŞİ</h1>
            <div class="logo-slogan">Herkes elenir, bir kişi kazanır!</div>
          </div>

          <div class="menu-card">
            <button class="btn btn-play" id="btn-play-public">▶ OYNA</button>

            <div class="menu-grid">
              <button class="btn btn-blue" id="btn-friends">👥 Arkadaşlarınla</button>
              <button class="btn btn-gold" id="btn-leaderboard">🏆 Sıralama</button>
              <button class="btn btn-purple" id="btn-characters">🎭 Karakterler</button>
              <button class="btn btn-orange" id="btn-settings">⚙️ Ayarlar</button>
            </div>
          </div>
        </div>

        <div class="menu-footer">
          50 Kişilik Gerçek Zamanlı Arena • Bilgisayarda WASD / Yön Tuşları, Mobilde Joystick
        </div>
      </div>
      ${this.renderModalHtml()}
    `;

    this.bindMenuEvents();
  }

  private renderModalHtml(): string {
    if (this.activeModal === 'none') return '';

    if (this.activeModal === 'friends') {
      return `
        <div class="modal-backdrop" id="modal-backdrop">
          <div class="modal-card">
            <div class="modal-header">
              <div class="modal-title">👥 Arkadaşlarınla Oyna</div>
              <button class="close-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="stack">
              <p style="font-size:14px;color:var(--text-muted);line-height:1.45;">
                Özel bir 50 kişilik oda oluştur, oda kodunu veya davet bağlantısını arkadaşlarına gönder!
                Oda sahibi istediğin an oyunu başlatabilir.
              </p>
              <button class="btn btn-play" style="font-size:19px;padding:13px;" id="btn-create-private">
                ✨ Yeni Özel Oda Oluştur
              </button>

              <div style="text-align:center;color:var(--text-muted);font-weight:800;margin:4px 0;">
                — VEYA ODA KODU İLE KATIL —
              </div>

              <input
                type="text"
                id="input-room-code"
                class="input-field"
                placeholder="6 Haneli Oda Kodu (örn. K7M9P2)"
                maxlength="8"
                style="text-transform:uppercase;text-align:center;letter-spacing:3px;"
              />
              <button class="btn btn-blue" id="btn-join-private">🚀 Odaya Katıl</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'characters') {
      const profile = storageService.getProfile();
      const cards = CHARACTERS.map((c) => {
        const selected = c.id === profile.avatarId;
        return `
          <div class="char-card ${selected ? 'selected' : ''}" data-char-id="${c.id}">
            <div class="char-preview" style="background:${c.bodyColor}">${c.emoji}</div>
            <div class="char-name">${escapeHtml(c.name)}</div>
            <div class="char-tag">${selected ? '✓ Seçili' : escapeHtml(c.tagline)}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="modal-backdrop" id="modal-backdrop">
          <div class="modal-card">
            <div class="modal-header">
              <div class="modal-title">🎭 Karakter Koleksiyonu</div>
              <button class="close-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="char-grid">${cards}</div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'leaderboard') {
      const tabs: { id: LeaderboardTab; label: string }[] = [
        { id: 'daily', label: 'Günlük' },
        { id: 'weekly', label: 'Haftalık' },
        { id: 'all_time', label: 'Genel' },
        { id: 'most_wins', label: 'En Çok Kazanan' },
        { id: 'best_streak', label: 'En Yüksek Seri' },
      ];

      const tabsHtml = tabs
        .map(
          (t) =>
            `<button class="tab-btn ${this.lbTab === t.id ? 'active' : ''}" data-lb-tab="${t.id}">${t.label}</button>`
        )
        .join('');

      let bodyHtml = '';
      if (this.lbLoading) {
        bodyHtml = `<div style="text-align:center;padding:26px;color:var(--text-muted);font-weight:800;">Yükleniyor...</div>`;
      } else if (this.lbError === 'NOT_CONFIGURED') {
        const st = storageService.getProfile().stats;
        bodyHtml = `
          <div class="notice-box">
            <strong>🔌 Supabase Henüz Bağlanmadı</strong><br/>
            Gerçek Dünya Sıralaması için <code>client/.env</code> dosyasına <code>VITE_SUPABASE_URL</code> ve <code>VITE_SUPABASE_ANON_KEY</code> değerlerini ekleyip <code>supabase/schema.sql</code> dosyasını çalıştırın.<br/><br/>
            <em>Sahte sıralama verisi gösterilmemektedir.</em>
          </div>
          <div style="margin-top:14px;">
            <div style="font-weight:800;font-size:13px;color:var(--text-muted);margin-bottom:8px;">Yerel Oturum İstatistiklerin</div>
            <div class="stats-row">
              <div class="stat-box"><div class="stat-val">${st.totalPoints}</div><div class="stat-lbl">Puan</div></div>
              <div class="stat-box"><div class="stat-val">${st.totalWins}</div><div class="stat-lbl">Galibiyet</div></div>
              <div class="stat-box"><div class="stat-val">${st.bestStreak}</div><div class="stat-lbl">En İyi Seri</div></div>
            </div>
          </div>
        `;
      } else if (this.lbError) {
        bodyHtml = `<div class="notice-box">Sıralama yüklenemedi: ${escapeHtml(this.lbError)}</div>`;
      } else if (this.lbEntries.length === 0) {
        bodyHtml = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-weight:800;">Bu kategoride henüz kayıtlı skor yok. İlk şampiyon sen ol! 👑</div>`;
      } else {
        bodyHtml = this.lbEntries
          .map((e, i) => {
            const c = getCharacterById(e.avatar_id);
            const metric =
              this.lbTab === 'most_wins'
                ? `👑 ${e.wins}`
                : this.lbTab === 'best_streak'
                ? `🔥 ${e.streak} Seri`
                : `⭐ ${e.score}`;
            return `
              <div class="lb-row">
                <div class="lb-left">
                  <div class="lb-rank">#${i + 1}</div>
                  <div class="avatar-circle" style="width:32px;height:32px;font-size:17px;background:${c.bodyColor}">${c.emoji}</div>
                  <div>
                    <div style="font-weight:900;font-size:14px;">${escapeHtml(e.username)}</div>
                    <div style="font-size:11px;color:var(--text-muted);">${e.wins} galibiyet • ${e.games} oyun</div>
                  </div>
                </div>
                <div style="font-weight:900;color:var(--gold);font-size:15px;">${metric}</div>
              </div>
            `;
          })
          .join('');
      }

      return `
        <div class="modal-backdrop" id="modal-backdrop">
          <div class="modal-card">
            <div class="modal-header">
              <div class="modal-title">🏆 Dünya Sıralaması</div>
              <button class="close-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="tabs-row">${tabsHtml}</div>
            <div>${bodyHtml}</div>
          </div>
        </div>
      `;
    }

    if (this.activeModal === 'settings') {
      const profile = storageService.getProfile();
      const cloud = supabaseService.currentProfile;
      const stats = cloud
        ? {
            totalGames: cloud.total_games,
            totalWins: cloud.total_wins,
            totalPoints: cloud.total_points,
            bestStreak: cloud.best_streak,
          }
        : profile.stats;

      let accountHtml = '';
      if (!supabaseService.isConfigured) {
        accountHtml = `
          <div class="notice-box" style="font-size:12px;">
            <strong>Misafir Modu Aktif</strong><br/>
            Bulut hesap ve skor kaydı için <code>client/.env</code> içine Supabase bilgilerini ekleyin.
          </div>
        `;
      } else if (supabaseService.currentUser) {
        accountHtml = `
          <div class="setting-row">
            <div>
              <div style="font-weight:900;">☁️ Bulut Hesap Bağlı</div>
              <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(
                supabaseService.currentUser.email ?? ''
              )}</div>
            </div>
            <button class="btn btn-red btn-sm" id="btn-signout">Çıkış</button>
          </div>
        `;
      } else {
        accountHtml = `
          <div style="background:rgba(255,255,255,0.06);padding:12px;border-radius:16px;" class="stack">
            <div style="display:flex;gap:6px;">
              <button class="tab-btn ${this.authMode === 'signup' ? 'active' : ''}" id="btn-auth-tab-signup">Hesap Oluştur</button>
              <button class="tab-btn ${this.authMode === 'login' ? 'active' : ''}" id="btn-auth-tab-login">Giriş Yap</button>
            </div>
            <input type="email" id="auth-email" class="input-field" placeholder="E-posta adresi" />
            <input type="password" id="auth-password" class="input-field" placeholder="Şifre (en az 6 karakter)" />
            <button class="btn btn-blue btn-sm" id="btn-auth-submit" ${this.authBusy ? 'disabled' : ''}>
              ${this.authMode === 'signup' ? '✨ Kayıt Ol ve Skorları Kaydet' : '🔑 Giriş Yap'}
            </button>
          </div>
        `;
      }

      return `
        <div class="modal-backdrop" id="modal-backdrop">
          <div class="modal-card">
            <div class="modal-header">
              <div class="modal-title">⚙️ Ayarlar & Profil</div>
              <button class="close-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="stack">
              <div>
                <div style="font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:5px;">Kullanıcı Adı</div>
                <div style="display:flex;gap:8px;">
                  <input type="text" id="input-username" class="input-field" value="${escapeHtml(
                    profile.username
                  )}" maxlength="16" />
                  <button class="btn btn-gold btn-sm" id="btn-save-username">Kaydet</button>
                </div>
              </div>

              <div class="stats-row" style="margin-bottom:4px;">
                <div class="stat-box"><div class="stat-val">${stats.totalGames}</div><div class="stat-lbl">Oyun</div></div>
                <div class="stat-box"><div class="stat-val">${stats.totalWins}</div><div class="stat-lbl">Galibiyet</div></div>
                <div class="stat-box"><div class="stat-val">${stats.bestStreak}</div><div class="stat-lbl">En İyi Seri</div></div>
              </div>

              <div class="setting-row">
                <span style="font-weight:800;">🔊 Ses Efektleri</span>
                <input type="checkbox" id="chk-sfx" ${
                  profile.settings.sfxEnabled ? 'checked' : ''
                } style="width:22px;height:22px;cursor:pointer;" />
              </div>

              <div class="setting-row">
                <span style="font-weight:800;">🎚️ Ses Seviyesi</span>
                <input type="range" id="rng-vol" min="0" max="100" value="${Math.round(
                  profile.settings.sfxVolume * 100
                )}" style="width:140px;" />
              </div>

              <div class="setting-row">
                <span style="font-weight:800;">🕹️ Sanal Joystick (Masaüstünde de)</span>
                <input type="checkbox" id="chk-joystick" ${
                  profile.settings.forceJoystick ? 'checked' : ''
                } style="width:22px;height:22px;cursor:pointer;" />
              </div>

              ${accountHtml}
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  private bindMenuEvents() {
    const click = (id: string, fn: () => void) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          soundManager.playClick();
          fn();
        });
      }
    };

    click('btn-play-public', () => {
      this.actions.onPlayPublic();
    });
    click('btn-friends', () => {
      this.activeModal = 'friends';
      this.render();
    });
    click('btn-characters', () => {
      this.activeModal = 'characters';
      this.render();
    });
    click('btn-leaderboard', () => {
      this.activeModal = 'leaderboard';
      this.loadLeaderboard(this.lbTab);
    });
    click('btn-settings', () => {
      this.activeModal = 'settings';
      this.render();
    });
    click('btn-open-profile', () => {
      this.activeModal = 'settings';
      this.render();
    });
    click('btn-close-modal', () => {
      this.activeModal = 'none';
      this.render();
    });

    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.activeModal = 'none';
          this.render();
        }
      });
    }

    // Friends modal
    click('btn-create-private', () => {
      this.actions.onCreatePrivate();
    });
    click('btn-join-private', () => {
      const input = document.getElementById('input-room-code') as HTMLInputElement | null;
      const code = input?.value.trim().toUpperCase() ?? '';
      if (code.length < 4) {
        this.showToast('Geçerli bir oda kodu girin.', true);
        return;
      }
      this.actions.onJoinPrivate(code);
    });

    // Character cards
    this.root.querySelectorAll<HTMLElement>('[data-char-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.charId!;
        soundManager.playClick();
        storageService.setAvatar(id);
        supabaseService.syncProfileIdentity(
          storageService.getProfile().username,
          id
        );
        this.actions.onProfileChanged();
        this.render();
      });
    });

    // Leaderboard tabs
    this.root.querySelectorAll<HTMLElement>('[data-lb-tab]').forEach((el) => {
      el.addEventListener('click', () => {
        const tab = el.dataset.lbTab as LeaderboardTab;
        soundManager.playClick();
        this.loadLeaderboard(tab);
      });
    });

    // Settings controls
    click('btn-save-username', () => {
      const input = document.getElementById('input-username') as HTMLInputElement | null;
      const val = input?.value.trim() ?? '';
      if (val.length < 2) {
        this.showToast('Kullanıcı adı en az 2 karakter olmalı.', true);
        return;
      }
      storageService.setUsername(val);
      supabaseService.syncProfileIdentity(val, storageService.getProfile().avatarId);
      this.actions.onProfileChanged();
      this.showToast('Kullanıcı adı kaydedildi!');
      this.render();
    });

    const chkSfx = document.getElementById('chk-sfx') as HTMLInputElement | null;
    chkSfx?.addEventListener('change', () => {
      storageService.updateSettings({ sfxEnabled: chkSfx.checked });
      const s = storageService.getProfile().settings;
      soundManager.setSettings(s.sfxEnabled, s.sfxVolume);
    });

    const rngVol = document.getElementById('rng-vol') as HTMLInputElement | null;
    rngVol?.addEventListener('input', () => {
      const vol = Number(rngVol.value) / 100;
      storageService.updateSettings({ sfxVolume: vol });
      const s = storageService.getProfile().settings;
      soundManager.setSettings(s.sfxEnabled, s.sfxVolume);
    });

    const chkJoy = document.getElementById('chk-joystick') as HTMLInputElement | null;
    chkJoy?.addEventListener('change', () => {
      storageService.updateSettings({ forceJoystick: chkJoy.checked });
    });

    click('btn-auth-tab-signup', () => {
      this.authMode = 'signup';
      this.render();
    });
    click('btn-auth-tab-login', () => {
      this.authMode = 'login';
      this.render();
    });
    click('btn-signout', async () => {
      await supabaseService.signOut();
      this.showToast('Çıkış yapıldı.');
      this.render();
    });
    click('btn-auth-submit', async () => {
      const email = (document.getElementById('auth-email') as HTMLInputElement)?.value.trim();
      const pass = (document.getElementById('auth-password') as HTMLInputElement)?.value;
      if (!email || !pass || pass.length < 6) {
        this.showToast('Geçerli e-posta ve en az 6 karakterli şifre girin.', true);
        return;
      }
      this.authBusy = true;
      this.render();
      const prof = storageService.getProfile();
      const res =
        this.authMode === 'signup'
          ? await supabaseService.signUp(email, pass, prof.username, prof.avatarId)
          : await supabaseService.signIn(email, pass);
      this.authBusy = false;
      if (!res.ok) {
        this.showToast(res.error ?? 'İşlem başarısız.', true);
      } else {
        this.showToast(this.authMode === 'signup' ? 'Hesap oluşturuldu!' : 'Giriş yapıldı!');
        const cloud = supabaseService.currentProfile;
        if (cloud) {
          storageService.setUsername(cloud.username);
          storageService.setAvatar(cloud.avatar_id);
        }
      }
      this.render();
    });
  }

  private async loadLeaderboard(tab: LeaderboardTab) {
    this.lbTab = tab;
    this.lbLoading = true;
    this.lbError = null;
    this.render();

    const res = await supabaseService.fetchLeaderboard(tab);
    this.lbLoading = false;
    this.lbEntries = res.entries;
    this.lbError = res.error ?? null;
    if (this.activeModal === 'leaderboard') {
      this.render();
    }
  }

  // ============================================================
  // IN-ROOM SHELL & LIVE HUD PATCHING (Zero-flicker 20Hz updates)
  // ============================================================
  private renderRoomShell() {
    this.destroyJoystick();
    const showJoy = isTouchDevice() || storageService.getProfile().settings.forceJoystick;

    const emojiButtons = REACTION_EMOJIS.map(
      (e) => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`
    ).join('');

    this.root.innerHTML = `
      <div id="room-layer">
        <!-- LOBBY OVERLAY -->
        <div id="lobby-ui" style="display:none;">
          <div class="lobby-top-bar">
            <div class="lobby-badges">
              <span class="badge badge-gold" id="lobby-room-code">ODA: ------</span>
              <span class="badge" id="lobby-player-count">👥 0 / 50</span>
            </div>
            <button class="btn btn-red btn-sm" id="btn-lobby-leave">Çıkış</button>
          </div>

          <div class="lobby-bottom-bar">
            <div class="lobby-status-text" id="lobby-status-text">Oyuncular bekleniyor...</div>
            <div class="level-picker-row" id="lobby-level-picker" style="display:none;">
              ${LEVELS.map(
                (lv) =>
                  `<button class="level-chip" data-level-pick="${lv.level}">${lv.icon} Lv.${lv.level} ${lv.name}</button>`
              ).join('')}
            </div>
            <div class="lobby-players-strip" id="lobby-players-strip"></div>
            <div class="lobby-actions">
              <button class="btn btn-blue btn-sm" id="btn-lobby-invite">🔗 Arkadaş Davet Et</button>
              <button class="btn btn-play btn-sm" id="btn-lobby-start" style="display:none;width:auto;font-size:15px;padding:9px 18px;">
                ▶ Oyunu Başlat
              </button>
            </div>
          </div>
        </div>

        <!-- ACTIVE MATCH HUD -->
        <div id="game-hud" style="display:none;">
          <div class="hud-top">
            <div class="hud-pill">
              <span id="hud-level" style="color:var(--gold);">☁️ Lv.1</span>
              <span style="opacity:0.4;">|</span>
              <span id="hud-round">Tur 1</span>
              <span style="opacity:0.4;">|</span>
              <span id="hud-alive" style="color:var(--green);">👥 0 / 0</span>
            </div>

            <button class="btn btn-ghost btn-sm" id="btn-hud-leave">✕ Çık</button>
          </div>

          <!-- LIVE STANDINGS PANEL -->
          <div class="live-standings" id="live-standings">
            <div class="standings-header">
              <span>📊 CANLI SIRALAMA</span>
              <span id="standings-my-rank">#1</span>
            </div>
            <div class="standings-level-pill" id="standings-level-info"></div>
            <div id="standings-list"></div>
          </div>

          <div class="safe-color-banner" id="safe-color-banner" style="display:none;">
            <div class="safe-color-label" id="safe-color-label">GÜVENLİ RENK</div>
            <div class="safe-color-row">
              <div class="safe-swatch" id="safe-swatch">★</div>
              <div class="safe-color-name" id="safe-color-name">SARI</div>
            </div>
            <div class="safe-timer-track">
              <div class="safe-timer-fill" id="safe-timer-fill" style="width:100%;"></div>
            </div>
            <div class="safe-timer-num" id="safe-timer-num">3.0s</div>
            <div class="disaster-pill" id="disaster-pill" style="display:none;"></div>
          </div>

          <div class="center-countdown" id="center-countdown" style="display:none;">3</div>
        </div>

        <!-- VIRTUAL JOYSTICK -->
        <div class="joystick-zone" id="joystick-zone" style="display:${showJoy ? 'flex' : 'none'};">
          <div class="joystick-knob" id="joystick-knob"></div>
        </div>

        <!-- EMOJI PICKER (Compact toggle on mobile, bar on desktop) -->
        <button class="emoji-toggle-btn" id="btn-emoji-toggle" style="display:none;">😊</button>
        <div class="emoji-bar" id="emoji-bar">${emojiButtons}</div>

        <!-- DASH ACTION BUTTON -->
        <button class="dash-btn" id="btn-dash" style="display:none;">
          <span style="font-size:22px;">⚡</span>
          <span id="dash-btn-label">ATIL</span>
        </button>

        <!-- ACTIVE POWER-UP BADGES -->
        <div class="powerup-badges" id="powerup-badges"></div>

        <!-- LIVE ELIMINATION FEED -->
        <div class="elim-feed" id="elim-feed"></div>

        <!-- DRAMATIC LEVEL BANNER -->
        <div class="level-banner" id="level-banner" style="display:none;"></div>

        <!-- SPECTATE BAR -->
        <div class="spectate-bar" id="spectate-bar" style="display:none;">
          <span style="font-weight:900;color:var(--gold);">👀 İzleme Modu</span>
          <button class="btn btn-play btn-sm" id="btn-spec-again" style="width:auto;font-size:13px;padding:7px 14px;">Yeniden Oyna</button>
          <button class="btn btn-ghost btn-sm" id="btn-spec-menu">Menü</button>
        </div>

        <!-- RESULT OVERLAY SLOT -->
        <div id="result-slot"></div>

        <!-- RECONNECTING BANNER -->
        <div class="reconnect-banner" id="reconnect-banner" style="display:none;">
          🔄 Bağlantı koptu, yeniden bağlanılıyor...
        </div>
      </div>
    `;

    this.roomLayerEl = document.getElementById('room-layer');

    // Bind persistent room buttons
    document.getElementById('btn-lobby-leave')?.addEventListener('click', () => {
      soundManager.playClick();
      this.actions.onLeaveRoom();
    });
    document.getElementById('btn-hud-leave')?.addEventListener('click', () => {
      soundManager.playClick();
      this.actions.onLeaveRoom();
    });
    document.getElementById('btn-lobby-start')?.addEventListener('click', () => {
      soundManager.playClick();
      this.actions.onStartPrivate();
    });
    document.getElementById('btn-lobby-invite')?.addEventListener('click', () => {
      soundManager.playClick();
      this.copyInviteLink();
    });
    document.getElementById('btn-spec-again')?.addEventListener('click', () => {
      soundManager.playClick();
      this.actions.onPlayAgain();
    });
    document.getElementById('btn-spec-menu')?.addEventListener('click', () => {
      soundManager.playClick();
      this.actions.onLeaveRoom();
    });

    document.querySelectorAll<HTMLElement>('.emoji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji!;
        this.actions.onSendEmoji(emoji);
        document.getElementById('emoji-bar')?.classList.remove('mobile-open');
      });
    });

    document.getElementById('btn-emoji-toggle')?.addEventListener('click', () => {
      soundManager.playClick();
      document.getElementById('emoji-bar')?.classList.toggle('mobile-open');
    });

    document.querySelectorAll<HTMLElement>('[data-level-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundManager.playClick();
        const lv = Number(btn.dataset.levelPick ?? 1);
        this.actions.onSelectLevel(lv);
      });
    });

    document.getElementById('btn-dash')?.addEventListener('click', () => {
      this.actions.onDash();
    });

    const joyBase = document.getElementById('joystick-zone');
    const joyKnob = document.getElementById('joystick-knob');
    if (joyBase && joyKnob) {
      this.joystick = new VirtualJoystick(joyBase, joyKnob, (dx, dy) => {
        this.actions.onJoystickMove(dx, dy);
      });
    }
  }

  private patchRoomHUD(state: RoomStateSnapshot) {
    const lobbyUi = document.getElementById('lobby-ui');
    const gameHud = document.getElementById('game-hud');
    const joyZone = document.getElementById('joystick-zone');
    const emojiBar = document.getElementById('emoji-bar');
    const specBar = document.getElementById('spectate-bar');

    const isLobby = state.phase === 'lobby' || state.phase === 'countdown';

    if (lobbyUi) lobbyUi.style.display = isLobby ? 'block' : 'none';
    if (gameHud) gameHud.style.display = isLobby ? 'none' : 'block';

    const me = state.players.get(this.localSessionId);
    const amAlive = me ? me.alive : false;
    const isNarrowMobile = window.innerWidth <= 768;
    const showJoy =
      (isTouchDevice() || storageService.getProfile().settings.forceJoystick) &&
      (isLobby || amAlive) &&
      state.phase !== 'finished';
    if (joyZone) joyZone.style.display = showJoy ? 'flex' : 'none';

    const emojiToggle = document.getElementById('btn-emoji-toggle');
    const canReact = (amAlive || isLobby) && state.phase !== 'finished';
    if (emojiToggle) {
      emojiToggle.style.display = isNarrowMobile && canReact ? 'flex' : 'none';
    }
    if (emojiBar) {
      emojiBar.style.display = canReact ? 'flex' : 'none';
    }
    if (specBar) {
      specBar.style.display =
        !isLobby && !amAlive && this.spectating && !this.winnerInfo ? 'flex' : 'none';
    }

    // Update Dash button & active Power-Up badges
    const dashBtn = document.getElementById('btn-dash');
    const dashLabel = document.getElementById('dash-btn-label');
    if (dashBtn) {
      // On narrow mobile lobby, keep controls cleanly above/clear of lobby panel
      const showDash = (amAlive || isLobby) && state.phase !== 'finished';
      dashBtn.style.display = showDash ? 'flex' : 'none';
      const cd = me?.dashCooldown ?? 0;
      dashBtn.classList.toggle('cooldown', cd > 0.05);
      if (dashLabel) {
        dashLabel.textContent = cd > 0.05 ? `${cd.toFixed(1)}s` : 'ATIL';
      }
    }

    const puBadges = document.getElementById('powerup-badges');
    if (puBadges) {
      const pills: string[] = [];
      if (me?.alive && me.hasBomb) {
        pills.push('<div class="pu-pill bomb">💣 BOMBA SENDE! BİRİNE DOKUN!</div>');
      }
      if (me?.alive && me.hasShield) {
        pills.push('<div class="pu-pill">🛡️ BÜYÜ KALKANI</div>');
      }
      if (me?.alive && me.speedBoost) {
        pills.push('<div class="pu-pill speed">⚡ HIZ İKSİRİ</div>');
      }
      if (me && me.kills > 0) {
        pills.push(`<div class="pu-pill">🔥 ${me.kills} Eleme</div>`);
      }
      puBadges.innerHTML = pills.join('');
    }

    const disPill = document.getElementById('disaster-pill');
    if (disPill) {
      if (!isLobby && state.disaster && state.disaster !== 'none') {
        const d = DISASTERS[state.disaster] ?? DISASTERS.none;
        disPill.style.display = 'inline-block';
        disPill.style.borderColor = d.color;
        disPill.style.color = d.color;
        disPill.textContent = `${d.icon} ${d.name}`;
      } else {
        disPill.style.display = 'none';
      }
    }

    // Announce dramatic level banner when a new round/level starts
    if (!isLobby && state.round > 0 && state.level !== this.lastAnnouncedLevel) {
      this.lastAnnouncedLevel = state.level;
      this.showLevelBanner(state.level);
    }

    if (isLobby) {
      const codeEl = document.getElementById('lobby-room-code');
      const countEl = document.getElementById('lobby-player-count');
      const statusEl = document.getElementById('lobby-status-text');
      const stripEl = document.getElementById('lobby-players-strip');
      const startBtn = document.getElementById('btn-lobby-start');

      if (codeEl) {
        codeEl.textContent = `${state.isPrivate ? '🔒 ÖZEL ODA' : '🌍 ODA'}: ${state.roomCode}`;
      }
      if (countEl) {
        countEl.textContent = `👥 ${state.players.size} / ${state.maxPlayers}`;
      }

      if (statusEl) {
        if (state.phase === 'countdown') {
          statusEl.textContent = `⏱️ Oyun başlıyor: ${Math.ceil(state.phaseTimeLeft)} saniye!`;
        } else if (state.isPrivate) {
          statusEl.textContent =
            state.hostSessionId === this.localSessionId
              ? 'Arkadaşlarını davet et ve hazır olunca Oyunu Başlat!'
              : 'Oda sahibinin oyunu başlatması bekleniyor...';
        } else {
          const needed = Math.max(0, state.minPlayersToStart - state.players.size);
          statusEl.textContent =
            needed > 0
              ? `Geri sayım için ${needed} oyuncu daha bekleniyor (${state.players.size}/${state.minPlayersToStart})`
              : 'Başlamaya hazırlanıyor...';
        }
      }

      if (startBtn) {
        const canHostStart =
          state.isPrivate && state.hostSessionId === this.localSessionId;
        startBtn.style.display = canHostStart ? 'inline-flex' : 'none';
        if (canHostStart) {
          startBtn.textContent =
            state.players.size === 1
              ? '▶ Tek Kişilik Test Başlat'
              : `▶ Oyunu Başlat (${state.players.size} Oyuncu)`;
        }
      }

      const pickerEl = document.getElementById('lobby-level-picker');
      if (pickerEl) {
        const canPick = state.isPrivate && state.hostSessionId === this.localSessionId;
        pickerEl.style.display = canPick ? 'flex' : 'none';
        if (canPick) {
          pickerEl.querySelectorAll<HTMLElement>('[data-level-pick]').forEach((btn) => {
            const lv = Number(btn.dataset.levelPick ?? 1);
            btn.classList.toggle('active', lv === state.startingLevel);
          });
        }
      }

      if (stripEl) {
        const chips: string[] = [];
        state.players.forEach((p) => {
          const c = getCharacterById(p.avatar);
          chips.push(
            `<div class="lobby-player-chip"><span>${c.emoji}</span><span>${escapeHtml(
              p.name
            )}</span></div>`
          );
        });
        stripEl.innerHTML = chips.join('');
      }
      return;
    }

    // Active match HUD
    const levelDef = getLevelByNumber(state.level);
    const levelEl = document.getElementById('hud-level');
    const roundEl = document.getElementById('hud-round');
    const aliveEl = document.getElementById('hud-alive');
    const bannerEl = document.getElementById('safe-color-banner');
    const labelEl = document.getElementById('safe-color-label');
    const swatchEl = document.getElementById('safe-swatch');
    const nameEl = document.getElementById('safe-color-name');
    const fillEl = document.getElementById('safe-timer-fill');
    const numEl = document.getElementById('safe-timer-num');
    const centerCd = document.getElementById('center-countdown');

    if (levelEl) levelEl.textContent = `${levelDef.icon} Lv.${levelDef.level} ${levelDef.name}`;
    if (roundEl) roundEl.textContent = `Tur ${Math.max(1, state.round)}`;
    if (aliveEl) aliveEl.textContent = `👥 ${state.aliveCount} / ${state.totalMatchPlayers}`;

    // Live Standings panel update
    const standingsInfo = document.getElementById('standings-level-info');
    const standingsMyRank = document.getElementById('standings-my-rank');
    const standingsList = document.getElementById('standings-list');

    if (standingsInfo) {
      standingsInfo.innerHTML = `<strong>${levelDef.icon} Lv.${levelDef.level}: ${escapeHtml(
        levelDef.name
      )}</strong><br/><span style="color:var(--text-muted);">${escapeHtml(
        levelDef.description
      )}</span>`;
    }

    if (standingsList) {
      const sorted = Array.from(state.players.values()).sort((a, b) => {
        if (a.alive && !b.alive) return -1;
        if (!a.alive && b.alive) return 1;
        if (a.alive && b.alive) {
          if (b.roundsSurvived !== a.roundsSurvived) return b.roundsSurvived - a.roundsSurvived;
          return a.sessionId === this.localSessionId ? -1 : b.sessionId === this.localSessionId ? 1 : 0;
        }
        return (a.eliminatedRank || 999) - (b.eliminatedRank || 999);
      });

      const myIdx = sorted.findIndex((p) => p.sessionId === this.localSessionId);
      const myPlayer = myIdx >= 0 ? sorted[myIdx] : null;
      if (standingsMyRank && myPlayer) {
        const rankNum = myPlayer.alive ? Math.max(1, myIdx + 1) : myPlayer.eliminatedRank || myIdx + 1;
        standingsMyRank.textContent = `Sen: #${rankNum}`;
      }

      const topSlice = sorted.slice(0, 6);
      if (myPlayer && myIdx >= 6) {
        topSlice.push(myPlayer);
      }

      standingsList.innerHTML = topSlice
        .map((p) => {
          const c = getCharacterById(p.avatar);
          const isMe = p.sessionId === this.localSessionId;
          const idx = sorted.indexOf(p);
          const rankLabel = p.alive ? `#${idx + 1}` : `#${p.eliminatedRank || idx + 1}`;
          const statusIcon = p.alive ? '🟢' : '☠️';
          return `
            <div class="standings-row ${isMe ? 'me' : ''} ${!p.alive ? 'out' : ''}">
              <span style="display:flex;align-items:center;gap:5px;min-width:0;">
                <span style="color:var(--gold);min-width:24px;">${rankLabel}</span>
                <span>${c.emoji}</span>
                <span class="standings-name">${escapeHtml(p.name)}</span>
              </span>
              <span>${statusIcon}</span>
            </div>
          `;
        })
        .join('');
    }

    if (centerCd) {
      if (state.phase === 'starting') {
        centerCd.style.display = 'block';
        const sec = Math.ceil(state.phaseTimeLeft);
        centerCd.textContent = sec > 0 ? String(sec) : 'BAŞLA!';
      } else {
        centerCd.style.display = 'none';
      }
    }

    if (bannerEl) {
      if (
        (state.phase === 'scramble' ||
          state.phase === 'warning' ||
          state.phase === 'drop') &&
        state.safeColor >= 0
      ) {
        const colorDef = getTileColorById(state.safeColor);
        bannerEl.style.display = 'block';
        bannerEl.style.borderColor = colorDef.hex;

        if (labelEl) {
          labelEl.textContent =
            state.phase === 'drop'
              ? '💥 DİĞER KARELER KAYBOLDU!'
              : state.phase === 'warning'
              ? '⚠️ ACELE ET! DÜŞÜYOR!'
              : '🎯 GÜVENLİ RENGE KOŞ!';
        }
        if (swatchEl) {
          swatchEl.style.background = colorDef.hex;
          swatchEl.textContent = colorDef.symbol;
        }
        if (nameEl) {
          nameEl.textContent = colorDef.name;
          nameEl.style.color = colorDef.hex;
        }
        if (fillEl) {
          const pct =
            state.phase === 'drop'
              ? 0
              : Math.max(
                  0,
                  Math.min(100, (state.phaseTimeLeft / Math.max(0.1, state.phaseDuration)) * 100)
                );
          fillEl.style.width = `${pct}%`;
          fillEl.style.background = colorDef.hex;
        }
        if (numEl) {
          numEl.textContent =
            state.phase === 'drop'
              ? amAlive
                ? '✓ GÜVENDESİN!'
                : 'ELENDİN!'
              : `${state.phaseTimeLeft.toFixed(1)}s`;
        }
      } else if (state.phase === 'round_end') {
        bannerEl.style.display = 'block';
        bannerEl.style.borderColor = '#2ED573';
        if (labelEl) labelEl.textContent = '✨ HARİKA!';
        if (swatchEl) {
          swatchEl.style.background = '#2ED573';
          swatchEl.textContent = '✓';
        }
        if (nameEl) {
          nameEl.textContent = 'YENİ TUR!';
          nameEl.style.color = '#2ED573';
        }
        if (fillEl) fillEl.style.width = '100%';
        if (numEl) numEl.textContent = 'Kareler yenileniyor...';
      } else {
        bannerEl.style.display = 'none';
      }
    }
  }

  private renderResultOverlay() {
    const slot = document.getElementById('result-slot');
    if (!slot) return;

    // 1. Winner Screen (highest priority when match ends)
    if (this.winnerInfo) {
      const w = this.winnerInfo;
      const isMe = w.winnerSessionId === this.localSessionId;
      const winnerChar = getCharacterById(w.winnerAvatar);

      if (isMe) {
        slot.innerHTML = `
          <div class="modal-backdrop">
            <div class="modal-card">
              <div class="result-icon">👑</div>
              <div class="result-title win">KAZANDIN!</div>
              <div class="result-sub">SON KİŞİ SENSİN! Arenayı fethettin! 🎉</div>
              <div class="stats-row">
                <div class="stat-box"><div class="stat-val">#1</div><div class="stat-lbl">Sıralama</div></div>
                <div class="stat-box"><div class="stat-val">+${w.pointsAwarded}</div><div class="stat-lbl">Puan</div></div>
                <div class="stat-box"><div class="stat-val">${w.roundsPlayed}</div><div class="stat-lbl">Tur</div></div>
              </div>
              <div class="stack">
                <button class="btn btn-play" style="font-size:20px;padding:13px;" id="btn-res-again">🔄 Tekrar Oyna</button>
                <button class="btn btn-gold" id="btn-res-share">📣 Zaferini Paylaş</button>
                <button class="btn btn-ghost" id="btn-res-menu">🏠 Ana Menü</button>
              </div>
            </div>
          </div>
        `;
      } else {
        slot.innerHTML = `
          <div class="modal-backdrop">
            <div class="modal-card">
              <div class="result-icon">${winnerChar.emoji}</div>
              <div class="result-title win" style="font-size:28px;">OYUN BİTTİ!</div>
              <div class="result-sub">
                👑 Kazanan: <strong style="color:#fff;">${escapeHtml(w.winnerName)}</strong>
              </div>
              <div class="stack">
                <button class="btn btn-play" style="font-size:20px;padding:13px;" id="btn-res-again">🔄 Tekrar Oyna</button>
                <button class="btn btn-blue" id="btn-res-challenge">⚔️ Arkadaşına Meydan Oku</button>
                <button class="btn btn-ghost" id="btn-res-menu">🏠 Ana Menü</button>
              </div>
            </div>
          </div>
        `;
      }

      document.getElementById('btn-res-again')?.addEventListener('click', () => {
        soundManager.playClick();
        this.actions.onPlayAgain();
      });
      document.getElementById('btn-res-menu')?.addEventListener('click', () => {
        soundManager.playClick();
        this.actions.onLeaveRoom();
      });
      document.getElementById('btn-res-share')?.addEventListener('click', () => {
        soundManager.playClick();
        this.shareText(
          `👑 SON KİŞİ'de ${w.totalPlayers} kişi arasından 1. oldum ve +${w.pointsAwarded} puan kazandım! Beni yenebilir misin?`
        );
      });
      document.getElementById('btn-res-challenge')?.addEventListener('click', () => {
        soundManager.playClick();
        this.shareText(
          `⚔️ SON KİŞİ arenasında sana meydan okuyorum! Herkes elenir, bir kişi kazanır!`
        );
      });
      return;
    }

    // 2. Eliminated Screen (while match continues or solo ended)
    if (this.eliminatedInfo && !this.spectating) {
      const e = this.eliminatedInfo;
      const canSpectate = (this.latestState?.aliveCount ?? 0) > 0;
      slot.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal-card">
            <div class="result-icon">😵‍💫</div>
            <div class="result-title lose">ELENDİN!</div>
            <div class="result-sub">${escapeHtml(e.quip)}</div>
            <div class="stats-row">
              <div class="stat-box"><div class="stat-val">#${e.rank}</div><div class="stat-lbl">${e.totalPlayers} Kişiden</div></div>
              <div class="stat-box"><div class="stat-val">${e.roundsSurvived}</div><div class="stat-lbl">Tur Dayandın</div></div>
              <div class="stat-box"><div class="stat-val">+${e.pointsEarned}</div><div class="stat-lbl">Puan</div></div>
            </div>
            <div class="stack">
              ${
                canSpectate
                  ? `<button class="btn btn-purple" id="btn-res-spectate">👀 Kazananı İzle</button>`
                  : ''
              }
              <button class="btn btn-play" style="font-size:20px;padding:13px;" id="btn-res-again">🔄 Yeniden Oyna</button>
              <button class="btn btn-blue" id="btn-res-challenge">⚔️ Arkadaşına Meydan Oku</button>
              <button class="btn btn-ghost" id="btn-res-menu">🏠 Ana Menü</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btn-res-spectate')?.addEventListener('click', () => {
        soundManager.playClick();
        this.spectating = true;
        this.renderResultOverlay();
        if (this.latestState) this.patchRoomHUD(this.latestState);
      });
      document.getElementById('btn-res-again')?.addEventListener('click', () => {
        soundManager.playClick();
        this.actions.onPlayAgain();
      });
      document.getElementById('btn-res-menu')?.addEventListener('click', () => {
        soundManager.playClick();
        this.actions.onLeaveRoom();
      });
      document.getElementById('btn-res-challenge')?.addEventListener('click', () => {
        soundManager.playClick();
        this.shareText(
          `⚔️ SON KİŞİ'de #${e.rank} oldum! Gel arenada kapışalım!`
        );
      });
      return;
    }

    slot.innerHTML = '';
  }

  private async copyInviteLink() {
    const code = this.latestState?.roomCode ?? '';
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(code)}`;
    await this.shareText(`🎮 SON KİŞİ odama katıl! Oda Kodu: ${code}`, url);
  }

  private async shareText(text: string, customUrl?: string) {
    const url = customUrl ?? window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'SON KİŞİ', text, url });
        return;
      } catch {
        // User cancelled or unsupported — fall back to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      this.showToast('📋 Davet bağlantısı kopyalandı!');
    } catch {
      this.showToast(`${text} (${url})`);
    }
  }
}
