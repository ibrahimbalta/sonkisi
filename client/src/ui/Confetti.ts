interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRot: number;
  life: number;
}

const COLORS = ['#FF4757', '#FFD32A', '#2ED573', '#1E90FF', '#A55EEA', '#FF7F50', '#FFFFFF'];

export class ConfettiController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private rafId: number | null = null;
  private running = false;

  constructor(canvasId: string) {
    const el = document.getElementById(canvasId) as HTMLCanvasElement;
    this.canvas = el;
    this.ctx = el.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  burst() {
    this.particles = [];
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (let i = 0; i < 160; i++) {
      this.particles.push({
        x: w * 0.5 + (Math.random() - 0.5) * w * 0.6,
        y: h * 0.25 + (Math.random() - 0.5) * 120,
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 11 - 2,
        size: 6 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.25,
        life: 1,
      });
    }

    if (!this.running) {
      this.running = true;
      this.loop();
    }
  }

  stop() {
    this.running = false;
    this.particles = [];
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private loop = () => {
    if (!this.running) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let alive = 0;
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.24;
      p.vx *= 0.99;
      p.rotation += p.vRot;
      p.life -= 0.0065;

      if (p.life > 0 && p.y < this.canvas.height + 40) {
        alive++;
        this.ctx.save();
        this.ctx.globalAlpha = Math.max(0, p.life);
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate(p.rotation);
        this.ctx.fillStyle = p.color;
        this.ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.65);
        this.ctx.restore();
      }
    }

    if (alive > 0) {
      this.rafId = requestAnimationFrame(this.loop);
    } else {
      this.running = false;
      this.rafId = null;
    }
  };
}
