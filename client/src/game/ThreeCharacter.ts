import * as THREE from 'three';
import { getCharacterById } from '../../../shared/src/index';

const CHARACTER_SCALE = 1.48;

// Shared geometries for fast 50-player 3D rendering
const bodySphereGeo = new THREE.SphereGeometry(0.45, 22, 18);
const cyberBoxGeo = new THREE.BoxGeometry(0.78, 0.78, 0.72);
const eyeWhiteGeo = new THREE.SphereGeometry(0.11, 10, 10);
const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8);
const cheekGeo = new THREE.SphereGeometry(0.075, 8, 8);
const footGeo = new THREE.SphereGeometry(0.15, 10, 8);
const hornGeo = new THREE.ConeGeometry(0.11, 0.42, 8);
const wingGeo = new THREE.BoxGeometry(0.55, 0.36, 0.08);
const haloGeo = new THREE.TorusGeometry(0.32, 0.055, 10, 24);
const ringGeo = new THREE.RingGeometry(0.68, 0.88, 32);
const crownBandGeo = new THREE.CylinderGeometry(0.28, 0.23, 0.2, 8);
const wizardHatBrimGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.08, 16);
const wizardHatConeGeo = new THREE.ConeGeometry(0.34, 0.76, 14);
const jetpackTankGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.44, 10);
const visorGeo = new THREE.BoxGeometry(0.54, 0.16, 0.12);
const capeGeo = new THREE.BoxGeometry(0.62, 0.56, 0.08);

const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x16122b, roughness: 0.3 });
const blushMat = new THREE.MeshStandardMaterial({
  color: 0xff6b81,
  roughness: 0.5,
  transparent: true,
  opacity: 0.75,
});
const goldMat = new THREE.MeshStandardMaterial({
  color: 0xffd32a,
  metalness: 0.75,
  roughness: 0.18,
  emissive: 0x664400,
  emissiveIntensity: 0.45,
});
const cyanGlowMat = new THREE.MeshStandardMaterial({
  color: 0x00f5d4,
  emissive: 0x00f5d4,
  emissiveIntensity: 0.9,
  roughness: 0.15,
});
const fireGlowMat = new THREE.MeshStandardMaterial({
  color: 0xff9f1a,
  emissive: 0xff5252,
  emissiveIntensity: 0.85,
  roughness: 0.2,
});
const iceCrystalMat = new THREE.MeshStandardMaterial({
  color: 0x81ecec,
  emissive: 0x00cec9,
  emissiveIntensity: 0.55,
  roughness: 0.12,
  metalness: 0.2,
});
const localRingMat = new THREE.MeshBasicMaterial({
  color: 0xffe066,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.92,
});

function createNameSprite(name: string, isLocal: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 256, 64);
  ctx.font = '900 29px Nunito, sans-serif';
  const textW = Math.min(232, ctx.measureText(name).width + 30);
  const x = (256 - textW) / 2;

  ctx.fillStyle = isLocal ? 'rgba(27, 20, 100, 0.92)' : 'rgba(14, 10, 36, 0.76)';
  ctx.beginPath();
  ctx.roundRect(x, 10, textW, 44, 18);
  ctx.fill();

  if (isLocal) {
    ctx.strokeStyle = '#FFD32A';
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }

  ctx.fillStyle = isLocal ? '#FFF59D' : '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33, 214);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.55, 0.64, 1);
  sprite.position.set(0, 2.45, 0);
  return sprite;
}

function createEmojiSprite(emoji: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.beginPath();
  ctx.roundRect(14, 14, 100, 96, 28);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1E1B3A';
  ctx.stroke();

  ctx.font = '58px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 65);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.35, 1.35, 1);
  return sprite;
}

const shieldBubbleGeo = new THREE.SphereGeometry(1.12, 18, 14);
const shieldBubbleMat = new THREE.MeshStandardMaterial({
  color: 0xffd32a,
  emissive: 0xffb300,
  emissiveIntensity: 0.5,
  transparent: true,
  opacity: 0.28,
  roughness: 0.1,
  metalness: 0.2,
  depthWrite: false,
});
const speedAuraMat = new THREE.MeshBasicMaterial({
  color: 0x00f5d4,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.78,
});

export class ThreeCharacter {
  public group: THREE.Group;
  public targetX: number;
  public targetZ: number;
  public targetJumpY = 0;
  public vx = 0;
  public vy = 0;
  public alive = true;

  private bodyPivot: THREE.Group;
  private leftFoot: THREE.Mesh;
  private rightFoot: THREE.Mesh;
  private leftWing: THREE.Object3D | null = null;
  private rightWing: THREE.Object3D | null = null;
  private floatingOrb: THREE.Object3D | null = null;
  private localRing: THREE.Mesh | null = null;
  private shieldBubble: THREE.Mesh;
  private speedAura: THREE.Mesh;
  private bombGroup: THREE.Group;
  private nameSprite: THREE.Sprite;
  private emojiSprite: THREE.Sprite | null = null;
  private emojiLife = 0;
  private crownMesh: THREE.Group | null = null;
  private walkPhase = Math.random() * Math.PI * 2;
  private falling = false;
  private fallVelY = 0;
  private facingAngle = 0;

  constructor(
    x: number,
    z: number,
    name: string,
    avatarId: string,
    isLocal: boolean
  ) {
    this.targetX = x;
    this.targetZ = z;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);

    // Local golden glowing locator ring
    if (isLocal) {
      this.localRing = new THREE.Mesh(ringGeo, localRingMat);
      this.localRing.rotation.x = -Math.PI / 2;
      this.localRing.position.y = 0.05;
      this.group.add(this.localRing);
    }

    // Magic Shield bubble & Speed Boost aura (toggled by server state)
    this.shieldBubble = new THREE.Mesh(shieldBubbleGeo, shieldBubbleMat);
    this.shieldBubble.position.y = 0.95;
    this.shieldBubble.visible = false;
    this.group.add(this.shieldBubble);

    this.speedAura = new THREE.Mesh(ringGeo, speedAuraMat);
    this.speedAura.rotation.x = -Math.PI / 2;
    this.speedAura.position.y = 0.09;
    this.speedAura.scale.setScalar(1.22);
    this.speedAura.visible = false;
    this.group.add(this.speedAura);

    // Floating ticking 3D Hot Bomb above character head
    this.bombGroup = new THREE.Group();
    const bombBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 12),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        emissive: 0xff2e00,
        emissiveIntensity: 0.75,
        roughness: 0.25,
      })
    );
    const bombSpark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      fireGlowMat
    );
    bombSpark.position.set(0, 0.48, 0);
    this.bombGroup.add(bombBall, bombSpark);
    this.bombGroup.position.set(0, 2.85, 0);
    this.bombGroup.visible = false;
    this.group.add(this.bombGroup);

    this.bodyPivot = new THREE.Group();
    this.bodyPivot.scale.setScalar(CHARACTER_SCALE);
    this.group.add(this.bodyPivot);

    const def = getCharacterById(avatarId);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: def.bodyNum,
      roughness: def.earStyle === 'knight' || def.earStyle === 'iceking' ? 0.2 : 0.34,
      metalness: def.earStyle === 'knight' ? 0.65 : def.earStyle === 'cyber' ? 0.35 : 0.08,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: def.accentNum,
      roughness: 0.3,
      metalness: 0.2,
    });

    // Main plump 3D body
    const bodyMesh = new THREE.Mesh(
      def.earStyle === 'cyber' ? cyberBoxGeo : bodySphereGeo,
      bodyMat
    );
    bodyMesh.position.y = 0.58;
    if (def.earStyle !== 'cyber') {
      bodyMesh.scale.set(1.04, 1.1, 0.96);
    }
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.bodyPivot.add(bodyMesh);

    // Cute animated feet
    this.leftFoot = new THREE.Mesh(footGeo, accentMat);
    this.leftFoot.position.set(-0.22, 0.14, 0.04);
    this.leftFoot.scale.set(1.05, 0.78, 1.32);
    this.leftFoot.castShadow = true;

    this.rightFoot = new THREE.Mesh(footGeo, accentMat);
    this.rightFoot.position.set(0.22, 0.14, 0.04);
    this.rightFoot.scale.set(1.05, 0.78, 1.32);
    this.rightFoot.castShadow = true;
    this.bodyPivot.add(this.leftFoot, this.rightFoot);

    // Face / Eyes (skipped for knight/cyber/astronaut who have epic visors!)
    if (
      def.earStyle !== 'knight' &&
      def.earStyle !== 'cyber' &&
      def.earStyle !== 'astronaut'
    ) {
      const eyeZ = 0.4;
      const lEye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
      lEye.position.set(-0.17, 0.67, eyeZ);
      const rEye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
      rEye.position.set(0.17, 0.67, eyeZ);

      const pupilMat = def.earStyle === 'demon' ? fireGlowMat : darkMat;
      const lPupil = new THREE.Mesh(pupilGeo, pupilMat);
      lPupil.position.set(-0.17, 0.67, eyeZ + 0.08);
      const rPupil = new THREE.Mesh(pupilGeo, pupilMat);
      rPupil.position.set(0.17, 0.67, eyeZ + 0.08);

      const lCheek = new THREE.Mesh(cheekGeo, blushMat);
      lCheek.position.set(-0.28, 0.53, eyeZ - 0.06);
      const rCheek = new THREE.Mesh(cheekGeo, blushMat);
      rCheek.position.set(0.28, 0.53, eyeZ - 0.06);

      this.bodyPivot.add(lEye, rEye, lPupil, rPupil, lCheek, rCheek);
    }

    // Build unique fantasy silhouette
    this.addFantasyGear(def.earStyle, bodyMat, accentMat);

    // Floating Nameplate
    this.nameSprite = createNameSprite(name, isLocal);
    this.group.add(this.nameSprite);
  }

  private addWings(mat: THREE.Material, yPos = 0.62) {
    const lPivot = new THREE.Group();
    lPivot.position.set(-0.36, yPos, -0.22);
    const lMesh = new THREE.Mesh(wingGeo, mat);
    lMesh.position.set(-0.24, 0.06, -0.04);
    lMesh.rotation.z = 0.25;
    lMesh.castShadow = true;
    lPivot.add(lMesh);

    const rPivot = new THREE.Group();
    rPivot.position.set(0.36, yPos, -0.22);
    const rMesh = new THREE.Mesh(wingGeo, mat);
    rMesh.position.set(0.24, 0.06, -0.04);
    rMesh.rotation.z = -0.25;
    rMesh.castShadow = true;
    rPivot.add(rMesh);

    this.bodyPivot.add(lPivot, rPivot);
    this.leftWing = lPivot;
    this.rightWing = rPivot;
  }

  private addFantasyGear(
    style: string,
    bodyMat: THREE.Material,
    accentMat: THREE.Material
  ) {
    switch (style) {
      case 'dragon': {
        // Curved golden dragon horns + fire wings
        const lh = new THREE.Mesh(hornGeo, goldMat);
        lh.position.set(-0.24, 1.08, -0.04);
        lh.rotation.set(-0.3, 0, 0.35);
        const rh = new THREE.Mesh(hornGeo, goldMat);
        rh.position.set(0.24, 1.08, -0.04);
        rh.rotation.set(-0.3, 0, -0.35);
        this.bodyPivot.add(lh, rh);
        this.addWings(fireGlowMat, 0.64);
        break;
      }

      case 'wizard': {
        // Iconic tall pointed wizard hat + floating magic orb
        const brim = new THREE.Mesh(wizardHatBrimGeo, bodyMat);
        brim.position.set(0, 1.02, 0);
        const cone = new THREE.Mesh(wizardHatConeGeo, bodyMat);
        cone.position.set(0, 1.38, -0.04);
        cone.rotation.x = -0.15;
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.36, 0.1, 14),
          goldMat
        );
        band.position.set(0, 1.08, 0);
        this.bodyPivot.add(brim, cone, band);

        const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), cyanGlowMat);
        orb.position.set(0.55, 0.85, 0.25);
        this.bodyPivot.add(orb);
        this.floatingOrb = orb;
        break;
      }

      case 'knight': {
        // Glowing visor + towering red plume + royal cape
        const visor = new THREE.Mesh(visorGeo, cyanGlowMat);
        visor.position.set(0, 0.68, 0.42);
        const plume = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.34, 0.56),
          accentMat
        );
        plume.position.set(0, 1.15, -0.04);
        const cape = new THREE.Mesh(capeGeo, accentMat);
        cape.position.set(0, 0.52, -0.44);
        cape.rotation.x = 0.18;
        this.bodyPivot.add(visor, plume, cape);
        break;
      }

      case 'unicorn': {
        // Gleaming golden unicorn horn + pastel ears
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.52, 10), goldMat);
        horn.position.set(0, 1.16, 0.24);
        horn.rotation.x = 0.35;
        const le = new THREE.Mesh(hornGeo, accentMat);
        le.scale.set(0.75, 0.65, 0.75);
        le.position.set(-0.28, 1.0, 0);
        le.rotation.z = 0.45;
        const re = new THREE.Mesh(hornGeo, accentMat);
        re.scale.set(0.75, 0.65, 0.75);
        re.position.set(0.28, 1.0, 0);
        re.rotation.z = -0.45;
        this.bodyPivot.add(horn, le, re);
        break;
      }

      case 'phoenix': {
        // Blazing crown feathers + golden fire wings
        for (let i = -1; i <= 1; i++) {
          const feather = new THREE.Mesh(hornGeo, i === 0 ? goldMat : fireGlowMat);
          feather.scale.set(0.85, 0.95, 0.85);
          feather.position.set(i * 0.16, 1.1, -0.04);
          feather.rotation.z = -i * 0.28;
          this.bodyPivot.add(feather);
        }
        this.addWings(goldMat, 0.62);
        break;
      }

      case 'cyber': {
        // Neon visor + floating holo ring
        const visor = new THREE.Mesh(visorGeo, cyanGlowMat);
        visor.position.set(0, 0.68, 0.38);
        const holo = new THREE.Mesh(haloGeo, cyanGlowMat);
        holo.rotation.x = Math.PI / 2;
        holo.position.set(0, 1.24, 0);
        this.bodyPivot.add(visor, holo);
        this.floatingOrb = holo;
        break;
      }

      case 'elf': {
        // Long pointed elf ears + golden leaf circlet
        const le = new THREE.Mesh(hornGeo, accentMat);
        le.position.set(-0.48, 0.74, 0);
        le.rotation.z = 1.25;
        const re = new THREE.Mesh(hornGeo, accentMat);
        re.position.set(0.48, 0.74, 0);
        re.rotation.z = -1.25;
        const circlet = new THREE.Mesh(haloGeo, goldMat);
        circlet.scale.set(1.18, 1.18, 0.7);
        circlet.rotation.x = Math.PI / 2;
        circlet.position.set(0, 0.95, 0);
        this.bodyPivot.add(le, re, circlet);
        break;
      }

      case 'demon': {
        // Big glowing magenta horns + shadow wings
        const hornMat = new THREE.MeshStandardMaterial({
          color: 0xff3f8e,
          emissive: 0xc2185b,
          emissiveIntensity: 0.7,
        });
        const lh = new THREE.Mesh(hornGeo, hornMat);
        lh.scale.set(1.2, 1.25, 1.2);
        lh.position.set(-0.28, 1.12, 0.05);
        lh.rotation.z = 0.42;
        const rh = new THREE.Mesh(hornGeo, hornMat);
        rh.scale.set(1.2, 1.25, 1.2);
        rh.position.set(0.28, 1.12, 0.05);
        rh.rotation.z = -0.42;
        this.bodyPivot.add(lh, rh);
        this.addWings(bodyMat, 0.6);
        break;
      }

      case 'angel': {
        // Floating golden halo + pure white angelic wings
        const halo = new THREE.Mesh(haloGeo, goldMat);
        halo.rotation.x = Math.PI / 2;
        halo.position.set(0, 1.32, 0);
        this.bodyPivot.add(halo);
        this.floatingOrb = halo;
        this.addWings(whiteMat, 0.66);
        break;
      }

      case 'iceking': {
        // Jagged ice crystal crown spikes
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const spike = new THREE.Mesh(hornGeo, iceCrystalMat);
          spike.scale.set(0.85, 1.05, 0.85);
          spike.position.set(Math.cos(a) * 0.24, 1.12, Math.sin(a) * 0.24);
          this.bodyPivot.add(spike);
        }
        break;
      }

      case 'astronaut': {
        // Reflective golden helmet visor + 3D jetpack with glowing thrusters
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.32, 14, 12),
          goldMat
        );
        dome.scale.set(1.05, 0.85, 0.55);
        dome.position.set(0, 0.68, 0.3);
        const tankL = new THREE.Mesh(jetpackTankGeo, accentMat);
        tankL.position.set(-0.16, 0.62, -0.44);
        const tankR = new THREE.Mesh(jetpackTankGeo, accentMat);
        tankR.position.set(0.16, 0.62, -0.44);
        const thrustL = new THREE.Mesh(
          new THREE.ConeGeometry(0.09, 0.24, 8),
          cyanGlowMat
        );
        thrustL.rotation.x = Math.PI;
        thrustL.position.set(-0.16, 0.3, -0.44);
        const thrustR = new THREE.Mesh(
          new THREE.ConeGeometry(0.09, 0.24, 8),
          cyanGlowMat
        );
        thrustR.rotation.x = Math.PI;
        thrustR.position.set(0.16, 0.3, -0.44);
        this.bodyPivot.add(dome, tankL, tankR, thrustL, thrustR);
        break;
      }

      case 'king':
      default: {
        // Grand royal golden crown + cape
        const band = new THREE.Mesh(crownBandGeo, goldMat);
        band.position.set(0, 1.08, 0);
        this.bodyPivot.add(band);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const sp = new THREE.Mesh(hornGeo, goldMat);
          sp.scale.set(0.6, 0.55, 0.6);
          sp.position.set(Math.cos(a) * 0.2, 1.24, Math.sin(a) * 0.2);
          this.bodyPivot.add(sp);
        }
        const cape = new THREE.Mesh(capeGeo, bodyMat);
        cape.position.set(0, 0.52, -0.44);
        cape.rotation.x = 0.16;
        this.bodyPivot.add(cape);
        break;
      }
    }
  }

  public setTarget(x: number, z: number, vx: number, vy: number, alive: boolean, jumpZ = 0) {
    this.targetX = x;
    this.targetZ = z;
    this.targetJumpY = jumpZ * 1.15;
    this.vx = vx;
    this.vy = vy;

    if (this.alive && !alive) {
      this.alive = false;
      this.falling = true;
      this.fallVelY = 3.2;
      if (this.localRing) this.localRing.visible = false;
      this.nameSprite.visible = false;
    } else if (!this.alive && alive) {
      this.alive = true;
      this.falling = false;
      this.fallVelY = 0;
      this.group.visible = true;
      this.group.position.set(x, 0, z);
      this.bodyPivot.position.set(0, 0, 0);
      this.bodyPivot.rotation.set(0, 0, 0);
      this.bodyPivot.scale.setScalar(CHARACTER_SCALE);
      if (this.localRing) this.localRing.visible = true;
      this.nameSprite.visible = true;
      this.setWinnerCrown(false);
    }
  }

  public setEffects(hasShield: boolean, speedBoost: boolean, hasBomb = false) {
    this.shieldBubble.visible = hasShield && this.alive;
    this.speedAura.visible = speedBoost && this.alive;
    this.bombGroup.visible = hasBomb && this.alive;
  }

  public setWinnerCrown(show: boolean) {
    if (show && !this.crownMesh) {
      const g = new THREE.Group();
      const band = new THREE.Mesh(crownBandGeo, goldMat);
      g.add(band);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const spike = new THREE.Mesh(hornGeo, goldMat);
        spike.scale.set(0.55, 0.55, 0.55);
        spike.position.set(Math.cos(a) * 0.2, 0.18, Math.sin(a) * 0.2);
        g.add(spike);
      }
      g.position.set(0, 2.95, 0);
      g.scale.setScalar(1.5);
      this.group.add(g);
      this.crownMesh = g;
    } else if (!show && this.crownMesh) {
      this.group.remove(this.crownMesh);
      this.crownMesh = null;
    }
  }

  public showEmoji(emoji: string) {
    if (this.emojiSprite) {
      this.group.remove(this.emojiSprite);
      this.emojiSprite.material.map?.dispose();
      this.emojiSprite.material.dispose();
    }
    this.emojiSprite = createEmojiSprite(emoji);
    this.emojiSprite.position.set(0, 3.25, 0);
    this.group.add(this.emojiSprite);
    this.emojiLife = 1.9;
  }

  public update(dt: number, nowSec: number) {
    if (this.emojiSprite) {
      this.emojiLife -= dt;
      this.emojiSprite.position.y = 3.25 + (1.9 - this.emojiLife) * 0.4;
      this.emojiSprite.material.opacity = Math.min(1, this.emojiLife * 1.4);
      if (this.emojiLife <= 0) {
        this.group.remove(this.emojiSprite);
        this.emojiSprite.material.map?.dispose();
        this.emojiSprite.material.dispose();
        this.emojiSprite = null;
      }
    }

    if (this.crownMesh) {
      this.crownMesh.rotation.y += dt * 2.4;
      this.crownMesh.position.y = 2.95 + Math.sin(nowSec * 4) * 0.14;
    }

    // Flap fantasy wings smoothly
    if (this.leftWing && this.rightWing) {
      const flap = Math.sin(nowSec * 9 + this.walkPhase) * 0.35;
      this.leftWing.rotation.y = 0.25 + flap;
      this.rightWing.rotation.y = -0.25 - flap;
    }

    // Rotate/bob floating wizard orb / angel halo / cyber holo ring
    if (this.floatingOrb) {
      this.floatingOrb.rotation.z += dt * 1.8;
      this.floatingOrb.position.y += Math.sin(nowSec * 4) * dt * 0.15;
    }

    if (this.falling) {
      this.fallVelY -= 25 * dt;
      this.group.position.y += this.fallVelY * dt;
      this.bodyPivot.rotation.x += dt * 7;
      this.bodyPivot.rotation.z += dt * 5;
      if (this.group.position.y < -18) {
        this.group.visible = false;
      }
      return;
    }

    const lerp = Math.min(1, dt * 15);
    this.group.position.x += (this.targetX - this.group.position.x) * lerp;
    this.group.position.z += (this.targetZ - this.group.position.z) * lerp;
    this.group.position.y += (this.targetJumpY - this.group.position.y) * Math.min(1, dt * 18);

    // Keep locator ring flat near tile surface so player sees landing spot during jump!
    if (this.localRing) {
      this.localRing.position.y = Math.max(-this.group.position.y + 0.05, -3.5);
    }

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 0.08) {
      const targetAngle = Math.atan2(this.vx, this.vy);
      let diff = targetAngle - this.facingAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 14);
      this.bodyPivot.rotation.y = this.facingAngle;

      this.walkPhase += dt * 16;
      this.bodyPivot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.28;
      this.bodyPivot.rotation.z = Math.sin(this.walkPhase) * 0.11;
      this.leftFoot.position.z = Math.sin(this.walkPhase) * 0.18;
      this.rightFoot.position.z = -Math.sin(this.walkPhase) * 0.18;
    } else {
      this.walkPhase += dt * 3;
      this.bodyPivot.position.y = Math.sin(this.walkPhase) * 0.05;
      this.bodyPivot.rotation.z *= 0.85;
      this.leftFoot.position.z *= 0.85;
      this.rightFoot.position.z *= 0.85;
    }

    if (this.localRing) {
      const s = 1 + Math.sin(nowSec * 5) * 0.08;
      this.localRing.scale.set(s, s, 1);
    }
    if (this.shieldBubble.visible) {
      this.shieldBubble.rotation.y += dt * 1.6;
      const bs = 1 + Math.sin(nowSec * 6) * 0.04;
      this.shieldBubble.scale.setScalar(bs);
    }
    if (this.speedAura.visible) {
      this.speedAura.rotation.z += dt * 5;
    }
    if (this.bombGroup.visible) {
      const pulse = 1 + Math.sin(nowSec * 18) * 0.18;
      this.bombGroup.scale.setScalar(pulse);
      this.bombGroup.rotation.y += dt * 4;
    }
  }

  public dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.nameSprite.material.map?.dispose();
    this.nameSprite.material.dispose();
    if (this.emojiSprite) {
      this.emojiSprite.material.map?.dispose();
      this.emojiSprite.material.dispose();
    }
  }
}
