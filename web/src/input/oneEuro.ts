// One Euro filter: smooths a noisy signal (the hand's position) while staying
// responsive when it moves fast. Slow movement gets heavy smoothing (less jitter);
// fast movement raises the cutoff so the cursor keeps up.
// Reference: Casiez et al., "1€ Filter", CHI 2012.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private prev: number | null = null;
  private prevDeriv = 0;

  constructor(
    private minCutoff = 1.0, // Hz. Lower = smoother when still.
    private beta = 0.02, // Higher = less lag when moving fast.
    private dCutoff = 1.0,
  ) {}

  filter(value: number, dt: number): number {
    if (this.prev === null || dt <= 0) {
      this.prev = value;
      return value;
    }
    // Estimate how fast the signal is changing and smooth that estimate too.
    const deriv = (value - this.prev) / dt;
    const dA = alpha(this.dCutoff, dt);
    this.prevDeriv = dA * deriv + (1 - dA) * this.prevDeriv;
    // Faster movement -> higher cutoff -> less smoothing.
    const cutoff = this.minCutoff + this.beta * Math.abs(this.prevDeriv);
    const a = alpha(cutoff, dt);
    this.prev = a * value + (1 - a) * this.prev;
    return this.prev;
  }

  reset(): void {
    this.prev = null;
    this.prevDeriv = 0;
  }
}
