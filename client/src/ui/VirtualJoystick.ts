export class VirtualJoystick {
  private baseEl: HTMLElement;
  private knobEl: HTMLElement;
  private activePointerId: number | null = null;
  private centerX = 0;
  private centerY = 0;
  private maxRadius = 46;
  private onMove: (dx: number, dy: number) => void;

  constructor(
    baseEl: HTMLElement,
    knobEl: HTMLElement,
    onMove: (dx: number, dy: number) => void
  ) {
    this.baseEl = baseEl;
    this.knobEl = knobEl;
    this.onMove = onMove;

    this.baseEl.addEventListener('pointerdown', this.handleDown);
    window.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    window.addEventListener('pointercancel', this.handleUp);
  }

  private handleDown = (e: PointerEvent) => {
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    const rect = this.baseEl.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;
    this.maxRadius = rect.width * 0.38;
    this.updatePosition(e.clientX, e.clientY);
  };

  private handleMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;
    this.updatePosition(e.clientX, e.clientY);
  };

  private handleUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.knobEl.style.transform = 'translate(0px, 0px)';
    this.onMove(0, 0);
  };

  private updatePosition(clientX: number, clientY: number) {
    const rawX = clientX - this.centerX;
    const rawY = clientY - this.centerY;
    const dist = Math.hypot(rawX, rawY);
    const clamped = Math.min(dist, this.maxRadius);
    const angle = Math.atan2(rawY, rawX);

    const kx = Math.cos(angle) * clamped;
    const ky = Math.sin(angle) * clamped;

    this.knobEl.style.transform = `translate(${kx}px, ${ky}px)`;

    if (clamped < 5) {
      this.onMove(0, 0);
    } else {
      const norm = clamped / this.maxRadius;
      this.onMove(Math.cos(angle) * norm, Math.sin(angle) * norm);
    }
  }

  destroy() {
    this.baseEl.removeEventListener('pointerdown', this.handleDown);
    window.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('pointercancel', this.handleUp);
  }
}
