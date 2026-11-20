import './styles/main.css';
import { REACTION_EMOJIS } from '../../shared/src/index';
import { soundManager } from './audio/SoundManager';
import { ThreeArenaEngine } from './game/ThreeArenaEngine';
import { NetworkManager, RoomStateSnapshot } from './services/NetworkManager';
import { storageService } from './services/StorageService';
import { supabaseService } from './services/SupabaseService';
import { ConfettiController } from './ui/Confetti';
import { UIManager } from './ui/UIManager';

async function bootstrap() {
  // 1. Apply saved audio settings
  const initialProfile = storageService.getProfile();
  soundManager.setSettings(
    initialProfile.settings.sfxEnabled,
    initialProfile.settings.sfxVolume
  );

  // 2. Init Three.js 3D Arena & Confetti
  const phaser = new ThreeArenaEngine('game-container');
  const confetti = new ConfettiController('confetti-canvas');

  let currentRoomState: RoomStateSnapshot | null = null;
  let lastRoomWasPrivate = false;

  // 3. Init UI & Network
  let network!: NetworkManager;

  const ui = new UIManager({
    onPlayPublic: async () => {
      try {
        const p = storageService.getProfile();
        lastRoomWasPrivate = false;
        await network.joinPublic(p.username, p.avatarId);
        phaser.setLocalSessionId(network.sessionId);
        ui.setLocalSessionId(network.sessionId);
        ui.enterRoomView();
      } catch (err) {
        console.error(err);
        ui.showToast('Sunucuya bağlanılamadı. Multiplayer sunucusunun çalıştığından emin olun.', true);
      }
    },

    onCreatePrivate: async () => {
      try {
        const p = storageService.getProfile();
        lastRoomWasPrivate = true;
        const code = await network.createPrivate(p.username, p.avatarId);
        phaser.setLocalSessionId(network.sessionId);
        ui.setLocalSessionId(network.sessionId);
        ui.enterRoomView();
        ui.showToast(`Özel oda oluşturuldu! Kod: ${code}`);
      } catch (err) {
        console.error(err);
        ui.showToast('Özel oda oluşturulamadı. Sunucu bağlantısını kontrol edin.', true);
      }
    },

    onJoinPrivate: async (code: string) => {
      try {
        const p = storageService.getProfile();
        lastRoomWasPrivate = true;
        await network.joinPrivate(code, p.username, p.avatarId);
        phaser.setLocalSessionId(network.sessionId);
        ui.setLocalSessionId(network.sessionId);
        ui.enterRoomView();
        ui.showToast(`${code} odasına katıldın!`);
      } catch (err) {
        console.error(err);
        ui.showToast(`"${code}" kodlu oda bulunamadı veya oyun başlamış.`, true);
      }
    },

    onStartPrivate: () => {
      network.sendStartPrivate();
    },

    onSelectLevel: (level: number) => {
      network.sendSelectLevel(level);
    },

    onPlayAgain: async () => {
      confetti.stop();
      if (
        lastRoomWasPrivate &&
        currentRoomState?.isPrivate &&
        currentRoomState.hostSessionId === network.sessionId &&
        currentRoomState.phase === 'finished'
      ) {
        network.sendPlayAgainPrivate();
        return;
      }

      // Join a fresh public room
      try {
        const p = storageService.getProfile();
        lastRoomWasPrivate = false;
        await network.joinPublic(p.username, p.avatarId);
        phaser.setLocalSessionId(network.sessionId);
        ui.setLocalSessionId(network.sessionId);
        ui.enterRoomView();
      } catch {
        ui.showToast('Yeni odaya bağlanılamadı.', true);
      }
    },

    onLeaveRoom: async () => {
      confetti.stop();
      await network.leaveRoom();
      phaser.clearRoom();
      currentRoomState = null;
      // Remove ?room= param cleanly
      if (window.location.search.includes('room=')) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      ui.enterMenuView();
      pollServerHealth();
    },

    onSendEmoji: (emoji: string) => {
      network.sendEmoji(emoji);
    },

    onJoystickMove: (dx: number, dy: number) => {
      phaser.setJoystickVector(dx, dy);
    },

    onProfileChanged: () => {
      // Nothing extra needed while in menu
    },
  });

  network = new NetworkManager({
    onStateUpdate: (state) => {
      currentRoomState = state;
      phaser.applyState(state);
      ui.updateRoomState(state);
    },

    onEliminated: (payload) => {
      const pointsEarned =
        payload.roundsSurvived * 10 +
        Math.max(0, payload.totalPlayers - payload.rank) * 3;
      storageService.recordLocalMatch(pointsEarned, false);
      supabaseService.recordMatchResult({
        roomCode: currentRoomState?.roomCode ?? 'PUBLIC',
        placement: payload.rank,
        totalPlayers: payload.totalPlayers,
        roundsSurvived: payload.roundsSurvived,
        pointsEarned,
        won: false,
      });
      ui.showEliminated(payload, pointsEarned);
    },

    onMatchWinner: (payload) => {
      const isMe = payload.winnerSessionId === network.sessionId;
      if (isMe) {
        confetti.burst();
        storageService.recordLocalMatch(payload.pointsAwarded, true);
        supabaseService.recordMatchResult({
          roomCode: currentRoomState?.roomCode ?? 'PUBLIC',
          placement: 1,
          totalPlayers: payload.totalPlayers,
          roundsSurvived: payload.roundsPlayed,
          pointsEarned: payload.pointsAwarded,
          won: true,
        });
      }
      ui.showWinner(payload);
    },

    onEmoji: (payload) => {
      phaser.showEmoji(payload.sessionId, payload.emoji);
    },

    onDisconnected: (reconnecting) => {
      ui.setReconnecting(reconnecting);
    },

    onReconnected: () => {
      ui.setReconnecting(false);
      ui.showToast('🔄 Yeniden bağlanıldı!');
    },

    onRoomLeft: (reason) => {
      confetti.stop();
      phaser.clearRoom();
      currentRoomState = null;
      ui.enterMenuView();
      if (reason) ui.showToast(reason, true);
    },
  });

  // Wire Phaser keyboard/joystick movement -> Colyseus server
  phaser.setInputCallback((dx, dy) => {
    if (network.isConnected) {
      network.sendInput(dx, dy);
    }
  });

  // Keyboard shortcuts 1-6 for quick emojis
  window.addEventListener('keydown', (e) => {
    if (!network.isConnected) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < REACTION_EMOJIS.length) {
      network.sendEmoji(REACTION_EMOJIS[idx]);
    }
  });

  // Poll multiplayer server /health endpoint for live online player count
  const pollServerHealth = async () => {
    try {
      const httpUrl = network.endpoint
        .replace(/^wss:/, 'https:')
        .replace(/^ws:/, 'http:');
      const res = await fetch(`${httpUrl}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        ui.setServerHealth(true, Number(data.onlinePlayers ?? 0));
      } else {
        ui.setServerHealth(false, 0);
      }
    } catch {
      ui.setServerHealth(false, 0);
    }
  };

  pollServerHealth();
  setInterval(pollServerHealth, 10000);

  // Initialize Supabase session if configured
  const cloudProfile = await supabaseService.init();
  if (cloudProfile) {
    storageService.setUsername(cloudProfile.username);
    storageService.setAvatar(cloudProfile.avatar_id);
    ui.render();
  }

  // Auto-join private room if ?room=CODE invite link was opened
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('room');
  if (inviteCode && inviteCode.trim().length >= 4) {
    const p = storageService.getProfile();
    try {
      lastRoomWasPrivate = true;
      await network.joinPrivate(inviteCode.trim().toUpperCase(), p.username, p.avatarId);
      phaser.setLocalSessionId(network.sessionId);
      ui.setLocalSessionId(network.sessionId);
      ui.enterRoomView();
      ui.showToast(`Davet odasına (${inviteCode.toUpperCase()}) katıldın!`);
    } catch {
      ui.showToast(`Davet odası (${inviteCode.toUpperCase()}) bulunamadı veya oyun başlamış.`, true);
    }
  }
}

bootstrap();
