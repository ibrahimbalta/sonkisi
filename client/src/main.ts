import './styles/main.css';
import { REACTION_EMOJIS } from '../../shared/src/index';
import { soundManager } from './audio/SoundManager';
import { ThreeArenaEngine } from './game/ThreeArenaEngine';
import { NetworkManager, RoomStateSnapshot } from './services/NetworkManager';
import { simulatorService } from './services/SimulatorService';
import { storageService } from './services/StorageService';
import { supabaseService } from './services/SupabaseService';
import { ConfettiController } from './ui/Confetti';
import { UIManager } from './ui/UIManager';

async function bootstrap() {
  // 1. Apply saved audio settings & unlock music on first user interaction
  const initialProfile = storageService.getProfile();
  soundManager.setSettings(
    initialProfile.settings.sfxEnabled,
    initialProfile.settings.sfxVolume,
    initialProfile.settings.musicEnabled
  );
  const unlockAudio = () => {
    soundManager.unlockAndStartMusic();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

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

    onSimulateMatch: async () => {
      try {
        const p = storageService.getProfile();
        lastRoomWasPrivate = true;
        const code = await network.createPrivate(p.username, p.avatarId);
        phaser.setLocalSessionId(network.sessionId);
        ui.setLocalSessionId(network.sessionId);
        ui.enterRoomView();
        ui.showToast('🤖 9 simülasyon oyuncusu arenaya katılıyor...');
        await simulatorService.spawnIntoPrivateRoom(network.endpoint, code, 9);
        network.sendStartPrivate();
      } catch (err) {
        console.error(err);
        await simulatorService.stopAll();
        ui.showToast('Simülasyon başlatılamadı. Sunucu bağlantısını kontrol edin.', true);
      }
    },

    onStartPrivate: () => {
      network.sendStartPrivate();
    },

    onSelectLevel: (level: number) => {
      network.sendSelectLevel(level);
    },

    onDash: () => {
      network.sendDash();
    },

    onJump: () => {
      network.sendJump();
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
      await simulatorService.stopAll();
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
      const isMatchActive =
        state.phase === 'scramble' ||
        state.phase === 'warning' ||
        state.phase === 'drop' ||
        state.phase === 'round_end';
      soundManager.setMusicIntensity(isMatchActive);
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

    onPlayerDashed: (payload) => {
      const isMe = payload.sessionId === network.sessionId;
      phaser.spawnShockwave(payload.x, payload.y, 0x00f5d4, isMe ? 0.28 : 0);
      if (isMe) soundManager.playDash();
    },

    onPowerUpPicked: (payload) => {
      const color =
        payload.kind === 'shield'
          ? 0xffd32a
          : payload.kind === 'double_jump'
          ? 0x2ed573
          : payload.kind === 'push'
          ? 0xff5252
          : 0x00f5d4;
      phaser.spawnShockwave(
        payload.x,
        payload.y,
        color,
        payload.sessionId === network.sessionId ? 0.2 : 0
      );
      if (payload.sessionId === network.sessionId) {
        soundManager.playPowerUp(payload.kind === 'shield' ? 'shield' : 'speed');
        const msg =
          payload.kind === 'shield'
            ? '🛡️ Koruma Kalkanı! 3 saniye düşmeye ve itmeye karşı koruma!'
            : payload.kind === 'double_jump'
            ? '🦘 Çift Zıplama! Havada bir kez daha zıplayabilirsin!'
            : payload.kind === 'push'
            ? '💥 İtme Gücü! ATIL butonun şok dalgasına dönüştü!'
            : '⚡ Süper Hız! 5 saniye ekstra hız!';
        ui.showToast(msg);
      }
    },

    onEliminationFeed: (payload) => {
      ui.pushEliminationFeed(payload);
    },

    onMeteorImpact: (payload) => {
      phaser.spawnShockwave(payload.x, payload.y, 0xff4757, 0.42);
      soundManager.playExplosion();
    },

    onBombExploded: (payload) => {
      phaser.spawnShockwave(payload.x, payload.y, 0xffa502, 0.55);
      soundManager.playExplosion();
      ui.showToast(`💥 ${payload.victimName} bombayla patladı!`, true);
    },

    onKnockoutCredit: (payload) => {
      if (payload.killerSessionId === network.sessionId) {
        soundManager.playKnockout();
        ui.showToast(`🔥 ${payload.victimName} oyuncusunu itip eledin! +50 PUAN`);
      }
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

  // Keyboard shortcuts: Space for Jump/Double-Jump, Shift/E for Dash/Push, 1-6 for emojis
  window.addEventListener('keydown', (e) => {
    if (!network.isConnected) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      network.sendJump();
      return;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') {
      e.preventDefault();
      network.sendDash();
      return;
    }
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
