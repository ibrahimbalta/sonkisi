import * as THREE from 'three';
import {
  ARENA_CONFIG,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  GamePhase,
  getLevelByNumber,
  getTileColorById,
  TILE_COLORS,
} from '../../../shared/src/index';
import {
  ObstacleSnapshot,
  PowerUpSnapshot,
  RoomStateSnapshot,
} from '../services/NetworkManager';
import { soundManager } from '../audio/SoundManager';
import { ThreeCharacter } from './ThreeCharacter';

const WORLD_SIZE = 24; // 12 tiles * 2 units
const TILE_UNIT = WORLD_SIZE / ARENA_CONFIG.GRID_COLS; // 2.0
const SERVER_TO_WORLD = WORLD_SIZE / ARENA_WIDTH;

interface Obstacle3D {
  group: THREE.Group;
  kind: ObstacleSnapshot['kind'];
  targetX: number;
  targetZ: number;
  targetAngle: number;
  pulseMesh?: THREE.Object3D;
}

interface Tile3D {
  mesh: THREE.Mesh;
  baseX: number;
  baseZ: number;
  colorId: number;
  dropped: boolean;
  velY: number;
  rotVx: number;
  rotVz: number;
  respawning: boolean;
}

interface FloatingIsland {
  group: THREE.Group;
  baseY: number;
  phase: number;
  ring: THREE.Mesh;
}

interface CloudCluster {
  group: THREE.Group;
  speed: number;
}

function createTileTexture(hex: string, darkHex: string, symbol: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  // Rich glossy gradient
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, hex);
  grad.addColorStop(1, darkHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Subtle beveled border frame
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, 232, 232);

  // Inner dark groove
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 6;
  ctx.strokeRect(24, 24, 208, 208);

  // Top-left crystal sheen
  const sheen = ctx.createLinearGradient(0, 0, 0, 110);
  sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(26, 26, 204, 84);

  // Accessible symbol watermark
  ctx.font = '700 84px Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.fillText(symbol, 128, 134);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createSkyDome(): THREE.Mesh {
  const skyGeo = new THREE.SphereGeometry(140, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color('#0c0b3a') },
      midColor: { value: new THREE.Color('#3b1f75') },
      horizonColor: { value: new THREE.Color('#e06d94') },
      bottomColor: { value: new THREE.Color('#191038') },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col;
        if (h >= 0.0) {
          float t1 = smoothstep(0.0, 0.35, h);
          float t2 = smoothstep(0.25, 0.85, h);
          col = mix(horizonColor, midColor, t1);
          col = mix(col, topColor, t2);
        } else {
          col = mix(horizonColor, bottomColor, smoothstep(0.0, -0.45, h));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(skyGeo, skyMat);
}

export class ThreeArenaEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private tileMaterials: THREE.MeshStandardMaterial[] = [];
  private tiles: Tile3D[] = [];
  private players = new Map<string, ThreeCharacter>();
  private obstacles = new Map<string, Obstacle3D>();
  private powerUps = new Map<string, THREE.Group>();
  private shockwaves: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];
  private cameraShake = 0;

  // Biome-reactive materials
  private skyMat!: THREE.ShaderMaterial;
  private frameMat!: THREE.MeshStandardMaterial;
  private trimMat!: THREE.MeshStandardMaterial;
  private currentLevel = 1;

  // Fantasy environment animated props
  private cornerCrystals: THREE.Mesh[] = [];
  private cornerLights: THREE.PointLight[] = [];
  private floatingIslands: FloatingIsland[] = [];
  private clouds: CloudCluster[] = [];
  private stardust!: THREE.Points;

  // State
  private localSessionId = '';
  private currentPhase: GamePhase = 'lobby';
  private currentSafeColor = -1;
  private isInRoom = false;

  // Input
  private keysPressed = new Set<string>();
  private joystickVec = { dx: 0, dy: 0 };
  private onInputCallback: ((dx: number, dy: number) => void) | null = null;

  // Loop
  private rafId: number | null = null;
  private lastTime = performance.now();
  private ambientTimer = 0;
  private menuOrbitAngle = 0;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // Scene & Atmospheric Fog
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x281759, 0.0085);

    // Perspective Camera
    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.5,
      260
    );
    this.camera.position.set(0, 23, 22);
    this.camera.lookAt(0, -0.5, 0);

    // Build fantastical 3D world
    const skyDome = createSkyDome();
    this.skyMat = skyDome.material as THREE.ShaderMaterial;
    this.scene.add(skyDome);
    this.setupLighting();
    this.buildArenaFrame();
    this.buildTileGrid();
    this.buildFantasyEnvironment();

    // Events
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);

    this.loop();
  }

  private setupLighting() {
    const hemi = new THREE.HemisphereLight(0xc8b6ff, 0xff9e7d, 0.95);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4d6, 1.55);
    sun.position.set(16, 32, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 6;
    sun.shadow.camera.far = 75;
    const d = 17;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x74b9ff, 0.65);
    rimLight.position.set(-20, 14, -18);
    this.scene.add(rimLight);
  }

  private buildArenaFrame() {
    const half = WORLD_SIZE / 2;
    const frameGroup = new THREE.Group();

    const obsidianMat = new THREE.MeshStandardMaterial({
      color: 0x1d1645,
      roughness: 0.45,
      metalness: 0.35,
    });
    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xffc83d,
      roughness: 0.28,
      metalness: 0.78,
    });
    this.frameMat = obsidianMat;
    this.trimMat = goldTrimMat;

    // 4 sculpted floating border beams around the 12x12 tile opening
    const beamThick = 1.15;
    const beamH = 1.1;
    const horizGeo = new THREE.BoxGeometry(WORLD_SIZE + beamThick * 2, beamH, beamThick);
    const vertGeo = new THREE.BoxGeometry(beamThick, beamH, WORLD_SIZE);

    const north = new THREE.Mesh(horizGeo, obsidianMat);
    north.position.set(0, -0.35, -(half + beamThick / 2));
    north.receiveShadow = true;

    const south = new THREE.Mesh(horizGeo, obsidianMat);
    south.position.set(0, -0.35, half + beamThick / 2);
    south.receiveShadow = true;

    const west = new THREE.Mesh(vertGeo, obsidianMat);
    west.position.set(-(half + beamThick / 2), -0.35, 0);
    west.receiveShadow = true;

    const east = new THREE.Mesh(vertGeo, obsidianMat);
    east.position.set(half + beamThick / 2, -0.35, 0);
    east.receiveShadow = true;

    frameGroup.add(north, south, west, east);

    // Golden top trim strips
    const trimH = 0.16;
    const hTrimGeo = new THREE.BoxGeometry(WORLD_SIZE + beamThick * 2 + 0.1, trimH, 0.25);
    const vTrimGeo = new THREE.BoxGeometry(0.25, trimH, WORLD_SIZE + beamThick * 2 + 0.1);

    const tN = new THREE.Mesh(hTrimGeo, goldTrimMat);
    tN.position.set(0, 0.24, -(half + beamThick * 0.5));
    const tS = new THREE.Mesh(hTrimGeo, goldTrimMat);
    tS.position.set(0, 0.24, half + beamThick * 0.5);
    const tW = new THREE.Mesh(vTrimGeo, goldTrimMat);
    tW.position.set(-(half + beamThick * 0.5), 0.24, 0);
    const tE = new THREE.Mesh(vTrimGeo, goldTrimMat);
    tE.position.set(half + beamThick * 0.5, 0.24, 0);
    frameGroup.add(tN, tS, tW, tE);

    // 4 Corner Fantasy Pillars with Levitating Color-Reactive Crystals
    const pillarGeo = new THREE.CylinderGeometry(0.7, 1.0, 2.6, 6);
    const crystalGeo = new THREE.OctahedronGeometry(0.85, 0);
    const corners = [
      [-(half + 1.0), -(half + 1.0)],
      [half + 1.0, -(half + 1.0)],
      [-(half + 1.0), half + 1.0],
      [half + 1.0, half + 1.0],
    ];

    for (const [cx, cz] of corners) {
      const pillar = new THREE.Mesh(pillarGeo, obsidianMat);
      pillar.position.set(cx, 0.4, cz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      frameGroup.add(pillar);

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.82, 0.72, 0.25, 6),
        goldTrimMat
      );
      cap.position.set(cx, 1.75, cz);
      frameGroup.add(cap);

      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0x00e5ff,
        emissive: 0x00b8d4,
        emissiveIntensity: 0.9,
        roughness: 0.12,
        metalness: 0.2,
      });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);
      crystal.position.set(cx, 3.1, cz);
      crystal.scale.set(0.85, 1.45, 0.85);
      frameGroup.add(crystal);
      this.cornerCrystals.push(crystal);

      const ptLight = new THREE.PointLight(0x00e5ff, 1.6, 12);
      ptLight.position.set(cx, 3.2, cz);
      frameGroup.add(ptLight);
      this.cornerLights.push(ptLight);
    }

    this.scene.add(frameGroup);
  }

  private buildTileGrid() {
    // Pre-bake 6 glossy tile materials (reused across tiles for fast GPU batching)
    for (const c of TILE_COLORS) {
      const tex = createTileTexture(c.hex, c.darkHex, c.symbol);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.26,
        metalness: 0.1,
        emissive: new THREE.Color(c.num),
        emissiveIntensity: 0.08,
      });
      this.tileMaterials.push(mat);
    }

    const tileGeo = new THREE.BoxGeometry(TILE_UNIT - 0.12, 0.52, TILE_UNIT - 0.12);
    const half = WORLD_SIZE / 2;

    for (let row = 0; row < ARENA_CONFIG.GRID_ROWS; row++) {
      for (let col = 0; col < ARENA_CONFIG.GRID_COLS; col++) {
        const colorId = (row + col) % TILE_COLORS.length;
        const bx = -half + col * TILE_UNIT + TILE_UNIT / 2;
        const bz = -half + row * TILE_UNIT + TILE_UNIT / 2;

        // Clone material per tile so warning/safe emissive highlights can vary cleanly
        const mesh = new THREE.Mesh(tileGeo, this.tileMaterials[colorId].clone());
        mesh.position.set(bx, -0.26, bz);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.scene.add(mesh);

        this.tiles.push({
          mesh,
          baseX: bx,
          baseZ: bz,
          colorId,
          dropped: false,
          velY: 0,
          rotVx: 0,
          rotVz: 0,
          respawning: false,
        });
      }
    }
  }

  private buildFantasyEnvironment() {
    // 1. Floating Crystal Sky Islands surrounding the arena
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x3b2c6e,
      roughness: 0.85,
      flatShading: true,
    });
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x26de81,
      roughness: 0.65,
      flatShading: true,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd32a,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    const islandSpecs = [
      { x: -24, y: 2, z: -18, s: 1.5, color: 0x00d2d3 },
      { x: 25, y: 4, z: -16, s: 1.7, color: 0xff6b81 },
      { x: -28, y: -2, z: 8, s: 1.3, color: 0xa55eea },
      { x: 28, y: -1, z: 10, s: 1.4, color: 0xffd32a },
      { x: 0, y: 5, z: -32, s: 2.2, color: 0x1e90ff },
      { x: -12, y: 3, z: -28, s: 1.1, color: 0x2ed573 },
    ];

    for (let i = 0; i < islandSpecs.length; i++) {
      const sp = islandSpecs[i];
      const g = new THREE.Group();
      g.position.set(sp.x, sp.y, sp.z);
      g.scale.setScalar(sp.s);

      // Inverted rocky mountain cone
      const rock = new THREE.Mesh(new THREE.ConeGeometry(2.8, 5.2, 7), rockMat);
      rock.rotation.x = Math.PI;
      rock.position.y = -2.6;
      g.add(rock);

      // Lush top island cap
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.7, 0.7, 7), grassMat);
      top.position.y = 0.25;
      g.add(top);

      // Glowing fantasy crystal spire
      const spireMat = new THREE.MeshStandardMaterial({
        color: sp.color,
        emissive: sp.color,
        emissiveIntensity: 0.75,
        roughness: 0.15,
        flatShading: true,
      });
      const spire = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), spireMat);
      spire.scale.set(0.7, 2.2, 0.7);
      spire.position.y = 2.5;
      g.add(spire);

      // Floating golden rune ring around island
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.65, 24), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.6;
      g.add(ring);

      this.scene.add(g);
      this.floatingIslands.push({ group: g, baseY: sp.y, phase: i * 1.1, ring });
    }

    // 2. Drifting 3D Fluffy Clouds below and around the sky island
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffeef8,
      emissive: 0x5c2d6e,
      emissiveIntensity: 0.25,
      roughness: 0.92,
    });
    const puffGeo = new THREE.SphereGeometry(1, 10, 8);

    for (let i = 0; i < 22; i++) {
      const cg = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(puffGeo, cloudMat);
        const r = 1.8 + Math.random() * 2.2;
        m.scale.set(r * 1.3, r * 0.65, r);
        m.position.set((p - 1.5) * 2.1, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.6);
        cg.add(m);
      }
      cg.position.set(
        (Math.random() - 0.5) * 110,
        -9 - Math.random() * 14,
        (Math.random() - 0.5) * 90
      );
      this.scene.add(cg);
      this.clouds.push({ group: cg, speed: 0.6 + Math.random() * 1.1 });
    }

    // 3. Magical Floating Stardust / Fireflies
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 58;
      positions[i * 3 + 1] = -6 + Math.random() * 26;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 58;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xfff3a3,
      size: 0.26,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.stardust = new THREE.Points(dustGeo, dustMat);
    this.scene.add(this.stardust);
  }

  private serverToWorld(sx: number, sy: number): { x: number; z: number } {
    return {
      x: (sx / ARENA_WIDTH - 0.5) * WORLD_SIZE,
      z: (sy / ARENA_HEIGHT - 0.5) * WORLD_SIZE,
    };
  }

  // ============================================================
  // PUBLIC BRIDGE API (Matches previous PhaserGameBridge 1:1)
  // ============================================================
  public setInputCallback(cb: (dx: number, dy: number) => void) {
    this.onInputCallback = cb;
  }

  public setJoystickVector(dx: number, dy: number) {
    this.joystickVec.dx = dx;
    this.joystickVec.dy = dy;
  }

  public setLocalSessionId(id: string) {
    this.localSessionId = id;
  }

  public clearRoom() {
    this.isInRoom = false;
    this.currentPhase = 'lobby';
    this.currentSafeColor = -1;
    this.players.forEach((p) => p.dispose(this.scene));
    this.players.clear();
    this.clearObstacles();
    this.clearPowerUps();
    this.applyLevelBiome(1);

    // Restore tiles for ambient menu orbit
    this.tiles.forEach((t, idx) => {
      this.setTileColorAndState(t, idx % TILE_COLORS.length, false, false);
    });
    this.updateCornerCrystalColor(0x00e5ff);
  }

  private clearObstacles() {
    this.obstacles.forEach((o) => this.scene.remove(o.group));
    this.obstacles.clear();
  }

  private clearPowerUps() {
    this.powerUps.forEach((g) => this.scene.remove(g));
    this.powerUps.clear();
  }

  private syncPowerUps(list: PowerUpSnapshot[]) {
    const seen = new Set<string>();
    for (const pu of list) {
      seen.add(pu.id);
      if (!this.powerUps.has(pu.id)) {
        const g = new THREE.Group();
        const pos = this.serverToWorld(pu.x, pu.y);
        g.position.set(pos.x, 1.05, pos.z);

        const color = pu.kind === 'shield' ? 0xffd32a : 0x00f5d4;
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.55, 0),
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.9,
            roughness: 0.12,
            metalness: 0.25,
          })
        );
        crystal.scale.set(0.85, 1.25, 0.85);
        g.add(crystal);

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.75, 0.06, 8, 24),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 })
        );
        ring.rotation.x = Math.PI / 2;
        g.add(ring);

        this.scene.add(g);
        this.powerUps.set(pu.id, g);
      }
    }
    this.powerUps.forEach((g, id) => {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.powerUps.delete(id);
      }
    });
  }

  public spawnShockwave(serverX: number, serverY: number, colorHex: number, shake = 0) {
    const pos = this.serverToWorld(serverX, serverY);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.65, 28), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.14, pos.z);
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, life: 0.45, maxLife: 0.45 });
    if (shake > 0) {
      this.cameraShake = Math.max(this.cameraShake, shake);
    }
  }

  private applyLevelBiome(level: number) {
    this.currentLevel = level;
    const def = getLevelByNumber(level);
    this.skyMat.uniforms.topColor.value.set(def.skyTop);
    this.skyMat.uniforms.midColor.value.set(def.skyMid);
    this.skyMat.uniforms.horizonColor.value.set(def.skyHorizon);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(def.fogColor);
    }
    this.frameMat.color.setHex(def.frameColor);
    this.trimMat.color.setHex(def.accentColor);
  }

  private createObstacleMesh(o: ObstacleSnapshot): Obstacle3D {
    const g = new THREE.Group();
    const pos = this.serverToWorld(o.x, o.y);
    g.position.set(pos.x, 0, pos.z);
    const levelDef = getLevelByNumber(this.currentLevel);
    let pulseMesh: THREE.Object3D | undefined;

    if (o.kind === 'pillar') {
      const r = o.radius * SERVER_TO_WORLD;
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.88, r, 2.6, 8),
        new THREE.MeshStandardMaterial({
          color: levelDef.frameColor,
          roughness: 0.5,
          metalness: 0.25,
        })
      );
      col.position.y = 1.3;
      col.castShadow = true;
      col.receiveShadow = true;
      g.add(col);

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.05, r * 0.92, 0.28, 8),
        new THREE.MeshStandardMaterial({
          color: levelDef.accentColor,
          emissive: levelDef.accentColor,
          emissiveIntensity: 0.5,
          roughness: 0.25,
        })
      );
      cap.position.y = 2.65;
      g.add(cap);
      pulseMesh = cap;
    } else if (o.kind === 'bumper' || o.kind === 'orbiter') {
      const r = o.radius * SERVER_TO_WORLD;
      const isOrbiter = o.kind === 'orbiter';
      const orbColor = isOrbiter ? 0xff3f8e : 0xff6b35;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(r, 18, 14),
        new THREE.MeshStandardMaterial({
          color: orbColor,
          emissive: orbColor,
          emissiveIntensity: 0.65,
          roughness: 0.2,
          metalness: 0.3,
        })
      );
      sphere.position.y = r + 0.12;
      sphere.castShadow = true;
      g.add(sphere);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.15, 0.08, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd32a })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = r + 0.12;
      g.add(ring);
      pulseMesh = ring;
    } else if (o.kind === 'slider') {
      const w = o.width * SERVER_TO_WORLD;
      const d = o.height * SERVER_TO_WORLD;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(w, 1.35, d),
        new THREE.MeshStandardMaterial({
          color: 0x161238,
          emissive: levelDef.accentColor,
          emissiveIntensity: 0.45,
          roughness: 0.25,
          metalness: 0.5,
        })
      );
      block.position.y = 0.72;
      block.castShadow = true;
      block.receiveShadow = true;
      g.add(block);

      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.08, 0.18, d + 0.08),
        new THREE.MeshBasicMaterial({ color: levelDef.accentColor })
      );
      strip.position.y = 1.38;
      g.add(strip);
    } else if (o.kind === 'sweeper') {
      const len = o.width * SERVER_TO_WORLD;
      const thick = o.height * SERVER_TO_WORLD;

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.85, 1.5, 12),
        new THREE.MeshStandardMaterial({
          color: 0x1e1848,
          metalness: 0.6,
          roughness: 0.3,
        })
      );
      hub.position.y = 0.75;
      hub.castShadow = true;
      g.add(hub);

      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.65, thick),
        new THREE.MeshStandardMaterial({
          color: levelDef.accentColor,
          emissive: levelDef.accentColor,
          emissiveIntensity: 0.8,
          roughness: 0.15,
          metalness: 0.3,
        })
      );
      bar.position.y = 0.78;
      bar.castShadow = true;
      g.add(bar);
      g.rotation.y = -o.angle;
    }

    this.scene.add(g);
    return {
      group: g,
      kind: o.kind,
      targetX: pos.x,
      targetZ: pos.z,
      targetAngle: -o.angle,
      pulseMesh,
    };
  }

  private syncObstacles(list: ObstacleSnapshot[]) {
    const seen = new Set<string>();
    for (const o of list) {
      seen.add(o.id);
      const pos = this.serverToWorld(o.x, o.y);
      let vis = this.obstacles.get(o.id);
      if (!vis) {
        vis = this.createObstacleMesh(o);
        this.obstacles.set(o.id, vis);
      }
      vis.targetX = pos.x;
      vis.targetZ = pos.z;
      vis.targetAngle = -o.angle;
    }
    this.obstacles.forEach((vis, id) => {
      if (!seen.has(id)) {
        this.scene.remove(vis.group);
        this.obstacles.delete(id);
      }
    });
  }

  public applyState(state: RoomStateSnapshot) {
    this.isInRoom = true;
    const prevPhase = this.currentPhase;
    this.currentPhase = state.phase;
    this.currentSafeColor = state.safeColor;

    if (state.level && state.level !== this.currentLevel) {
      this.applyLevelBiome(state.level);
    }
    this.syncObstacles(state.obstacles ?? []);
    this.syncPowerUps(state.powerUps ?? []);

    // Trigger dramatic camera shake when tiles drop!
    if (prevPhase !== 'drop' && state.phase === 'drop') {
      this.cameraShake = 0.55;
    }

    // Audio cues on phase transitions
    if (prevPhase !== state.phase) {
      if (state.phase === 'scramble') {
        soundManager.playSafeColorAnnounce();
      } else if (state.phase === 'warning') {
        soundManager.playWarning();
      } else if (state.phase === 'drop') {
        soundManager.playTileDrop();
      } else if (state.phase === 'round_end') {
        const me = state.players.get(this.localSessionId);
        if (me?.alive) soundManager.playRoundSurvive();
      } else if (state.phase === 'finished' && state.winnerSessionId === this.localSessionId) {
        soundManager.playVictory();
      }
    }

    // Corner crystals glow with the Safe Color!
    if (
      state.safeColor >= 0 &&
      (state.phase === 'scramble' || state.phase === 'warning' || state.phase === 'drop')
    ) {
      this.updateCornerCrystalColor(getTileColorById(state.safeColor).num);
    } else {
      this.updateCornerCrystalColor(0x00e5ff);
    }

    // Update 144 3D tiles
    for (let i = 0; i < this.tiles.length && i < state.tiles.length; i++) {
      const tile = this.tiles[i];
      const newColor = state.tiles[i];
      const isDropped = newColor === -1;

      if (tile.colorId !== newColor || tile.dropped !== isDropped) {
        this.setTileColorAndState(tile, newColor, isDropped, true);
      }

      if (!isDropped) {
        const mat = tile.mesh.material as THREE.MeshStandardMaterial;
        if (
          (state.phase === 'scramble' || state.phase === 'warning') &&
          newColor === state.safeColor
        ) {
          mat.emissiveIntensity = 0.42;
        } else if (state.phase === 'warning' && newColor !== state.safeColor) {
          mat.emissiveIntensity = 0.25;
        } else {
          mat.emissiveIntensity = 0.08;
        }
      }
    }

    // Sync 3D characters
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      const pos = this.serverToWorld(p.x, p.y);
      let char = this.players.get(id);
      if (!char) {
        char = new ThreeCharacter(
          pos.x,
          pos.z,
          p.name,
          p.avatar,
          id === this.localSessionId
        );
        this.scene.add(char.group);
        this.players.set(id, char);
      }

      const wasAlive = char.alive;
      char.setTarget(pos.x, pos.z, p.vx, p.vy, p.alive);
      char.setEffects(p.hasShield, p.speedBoost);
      if (wasAlive && !p.alive && id === this.localSessionId) {
        soundManager.playFall();
        this.cameraShake = 0.7;
      }

      char.setWinnerCrown(state.phase === 'finished' && state.winnerSessionId === id);
    });

    this.players.forEach((char, id) => {
      if (!seen.has(id)) {
        char.dispose(this.scene);
        this.players.delete(id);
      }
    });
  }

  public showEmoji(sessionId: string, emoji: string) {
    const p = this.players.get(sessionId);
    if (p) {
      p.showEmoji(emoji);
      soundManager.playEmojiPop();
    }
  }

  private updateCornerCrystalColor(hexNum: number) {
    for (const c of this.cornerCrystals) {
      const m = c.material as THREE.MeshStandardMaterial;
      m.color.setHex(hexNum);
      m.emissive.setHex(hexNum);
    }
    for (const l of this.cornerLights) {
      l.color.setHex(hexNum);
    }
  }

  private setTileColorAndState(
    tile: Tile3D,
    colorId: number,
    dropped: boolean,
    animate: boolean
  ) {
    if (dropped) {
      tile.dropped = true;
      tile.colorId = -1;
      tile.respawning = false;
      tile.velY = -2 - Math.random() * 4;
      tile.rotVx = (Math.random() - 0.5) * 4.5;
      tile.rotVz = (Math.random() - 0.5) * 4.5;
    } else {
      const wasDropped = tile.dropped;
      tile.dropped = false;
      tile.colorId = colorId;
      tile.velY = 0;
      tile.rotVx = 0;
      tile.rotVz = 0;

      const template = this.tileMaterials[colorId] ?? this.tileMaterials[0];
      const mat = tile.mesh.material as THREE.MeshStandardMaterial;
      mat.map = template.map;
      mat.emissive.copy(template.emissive);
      mat.needsUpdate = true;

      tile.mesh.visible = true;
      tile.mesh.rotation.set(0, 0, 0);

      if (wasDropped && animate) {
        tile.respawning = true;
        tile.mesh.position.set(tile.baseX, -3.5 - Math.random() * 2, tile.baseZ);
      } else {
        tile.respawning = false;
        tile.mesh.position.set(tile.baseX, -0.26, tile.baseZ);
      }
    }
  }

  // ============================================================
  // INPUT & RESIZE HANDLERS
  // ============================================================
  private handleResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keysPressed.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keysPressed.delete(e.code);
  };

  private handleBlur = () => {
    this.keysPressed.clear();
  };

  // ============================================================
  // MAIN 60FPS ANIMATION LOOP
  // ============================================================
  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const nowSec = now * 0.001;

    // 1. Animate fantasy world props
    for (let i = 0; i < this.cornerCrystals.length; i++) {
      const c = this.cornerCrystals[i];
      c.rotation.y += dt * 1.4;
      c.position.y = 3.1 + Math.sin(nowSec * 2.5 + i) * 0.25;
    }

    for (const isl of this.floatingIslands) {
      isl.group.position.y = isl.baseY + Math.sin(nowSec * 0.9 + isl.phase) * 0.7;
      isl.ring.rotation.z += dt * 0.35;
    }

    for (const cl of this.clouds) {
      cl.group.position.x += cl.speed * dt;
      if (cl.group.position.x > 60) cl.group.position.x = -60;
    }

    // Float stardust upward gently
    const posAttr = this.stardust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      let y = posAttr.getY(i) + dt * 0.55;
      if (y > 20) y = -6;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;

    // 2. Tile physics (warning shake, tumbling drop, magical rise)
    for (const tile of this.tiles) {
      if (tile.dropped) {
        if (tile.mesh.visible) {
          tile.velY -= 26 * dt;
          tile.mesh.position.y += tile.velY * dt;
          tile.mesh.rotation.x += tile.rotVx * dt;
          tile.mesh.rotation.z += tile.rotVz * dt;
          if (tile.mesh.position.y < -22) {
            tile.mesh.visible = false;
          }
        }
      } else if (tile.respawning) {
        tile.mesh.position.y += (-0.26 - tile.mesh.position.y) * Math.min(1, dt * 10);
        if (Math.abs(tile.mesh.position.y + 0.26) < 0.02) {
          tile.mesh.position.y = -0.26;
          tile.respawning = false;
        }
      } else if (
        this.isInRoom &&
        this.currentPhase === 'warning' &&
        tile.colorId !== this.currentSafeColor
      ) {
        tile.mesh.position.x = tile.baseX + (Math.random() - 0.5) * 0.14;
        tile.mesh.position.z = tile.baseZ + (Math.random() - 0.5) * 0.14;
        tile.mesh.rotation.z = (Math.random() - 0.5) * 0.14;
      } else {
        tile.mesh.position.x = tile.baseX;
        tile.mesh.position.z = tile.baseZ;
        tile.mesh.rotation.set(0, 0, 0);
      }
    }

    // 3. Menu ambient orbit vs Active Room Camera
    if (!this.isInRoom) {
      this.ambientTimer += dt;
      if (this.ambientTimer > 0.25) {
        this.ambientTimer = 0;
        const idx = Math.floor(Math.random() * this.tiles.length);
        this.setTileColorAndState(
          this.tiles[idx],
          Math.floor(Math.random() * TILE_COLORS.length),
          false,
          false
        );
      }
      this.menuOrbitAngle += dt * 0.14;
      this.camera.position.set(
        Math.sin(this.menuOrbitAngle) * 24,
        19,
        Math.cos(this.menuOrbitAngle) * 24
      );
      this.camera.lookAt(0, -1, 0);
    } else {
      // Update all 3D players
      this.players.forEach((p) => p.update(dt, nowSec));

      // Smoothly interpolate 3D obstacles
      const obsLerp = Math.min(1, dt * 16);
      this.obstacles.forEach((obs) => {
        obs.group.position.x += (obs.targetX - obs.group.position.x) * obsLerp;
        obs.group.position.z += (obs.targetZ - obs.group.position.z) * obsLerp;
        if (obs.kind === 'sweeper') {
          let diff = obs.targetAngle - obs.group.rotation.y;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          obs.group.rotation.y += diff * obsLerp;
        }
        if (obs.pulseMesh) {
          obs.pulseMesh.rotation.z += dt * 2.2;
        }
      });

      // Animate floating 3D Power-Up crystals
      this.powerUps.forEach((g) => {
        g.rotation.y += dt * 2.4;
        g.position.y = 1.05 + Math.sin(nowSec * 3.8 + g.position.x) * 0.24;
      });

      // Animate expanding 3D shockwave rings
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.life -= dt;
        const progress = 1 - Math.max(0, sw.life / sw.maxLife);
        const s = 1 + progress * 4.2;
        sw.mesh.scale.set(s, s, 1);
        (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
        if (sw.life <= 0) {
          this.scene.remove(sw.mesh);
          sw.mesh.geometry.dispose();
          (sw.mesh.material as THREE.Material).dispose();
          this.shockwaves.splice(i, 1);
        }
      }

      // Responsive 3D camera framing
      const isPortrait = window.innerWidth < 760 && window.innerHeight > window.innerWidth;
      const local = this.players.get(this.localSessionId);

      let focusX = 0;
      let focusZ = 0;
      if (local && local.alive) {
        focusX = local.group.position.x;
        focusZ = local.group.position.z;
      } else {
        for (const p of this.players.values()) {
          if (p.alive) {
            focusX = p.group.position.x;
            focusZ = p.group.position.z;
            break;
          }
        }
      }

      const targetCamX = isPortrait ? focusX * 0.65 : focusX * 0.22;
      const targetCamY = isPortrait ? 20.5 : 23.5;
      const targetCamZ = isPortrait ? focusZ * 0.55 + 17.5 : focusZ * 0.2 + 22.5;

      const camLerp = Math.min(1, dt * 5);
      this.camera.position.x += (targetCamX - this.camera.position.x) * camLerp;
      this.camera.position.y += (targetCamY - this.camera.position.y) * camLerp;
      this.camera.position.z += (targetCamZ - this.camera.position.z) * camLerp;

      if (this.cameraShake > 0.01) {
        this.camera.position.x += (Math.random() - 0.5) * this.cameraShake;
        this.camera.position.y += (Math.random() - 0.5) * this.cameraShake;
        this.cameraShake *= Math.pow(0.015, dt);
      } else {
        this.cameraShake = 0;
      }

      const lookX = isPortrait ? focusX * 0.55 : focusX * 0.15;
      const lookZ = isPortrait ? focusZ * 0.55 + 0.5 : focusZ * 0.15 + 1.2;
      this.camera.lookAt(lookX, -0.8, lookZ);

      // Poll keyboard + joystick input
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        this.onInputCallback?.(0, 0);
      } else {
        let dx = this.joystickVec.dx;
        let dy = this.joystickVec.dy;
        if (Math.hypot(dx, dy) < 0.08) {
          let kx = 0;
          let ky = 0;
          if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA')) kx -= 1;
          if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD')) kx += 1;
          if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('KeyW')) ky -= 1;
          if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('KeyS')) ky += 1;
          if (kx !== 0 || ky !== 0) {
            const len = Math.hypot(kx, ky);
            dx = kx / len;
            dy = ky / len;
          }
        }
        this.onInputCallback?.(dx, dy);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  public destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
