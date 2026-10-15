// Tiny synthesised sound effects with the Web Audio API, so there are no audio files.
// The AudioContext is created on the first sound, which the browser allows only after a click.
let ctx: AudioContext | null = null;
export let soundEnabled = true;

export function setSoundEnabled(on: boolean): void {
  soundEnabled = on;
}

function tone(freq: number, ms: number, when = 0, type: OscillatorType = 'sine', gain = 0.12): void {
  if (!ctx) ctx = new AudioContext();
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

export function play(kind: 'move' | 'capture' | 'check' | 'castle' | 'end'): void {
  if (!soundEnabled) return;
  try {
    switch (kind) {
      case 'move':
        tone(520, 60, 0, 'triangle');
        break;
      case 'capture':
        tone(180, 120, 0, 'square', 0.08);
        break;
      case 'check':
        tone(660, 90);
        tone(880, 120, 0.09);
        break;
      case 'castle':
        tone(330, 90, 0, 'triangle');
        tone(440, 90, 0.1, 'triangle');
        break;
      case 'end':
        tone(523, 160);
        tone(392, 260, 0.16);
        break;
    }
  } catch {
    // Audio blocked or unsupported: the game works silently.
  }
}
