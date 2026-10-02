/**
 * Synthesized sound (Web Audio). No audio files are downloaded. Loaded only when the
 * visitor switches Sound on. Everything is short and quiet.
 */

export type SoundName = 'click' | 'pop' | 'rustle' | 'drop' | 'whoosh' | 'stamp' | 'unscrew';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    ctx = new Ctor() as AudioContext;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 1;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function prime() {
  audio();
}

/** Expose the context for offline rendering (Twist & send records the same sounds). */
export function getContext(): AudioContext {
  return audio();
}

type Out = { ctx: BaseAudioContext; dest: AudioNode };

function env(o: Out, t: number, attack: number, decay: number, peak: number): GainNode {
  const g = o.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(o.dest);
  return g;
}

function noiseBurst(o: Out, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.002) {
  const src = o.ctx.createBufferSource();
  src.buffer = noise;
  const f = o.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(env(o, t, attack, dur, peak));
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + dur + 0.02);
}

function tone(o: Out, t: number, from: number, to: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  const osc = o.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  osc.connect(env(o, t, 0.003, dur, peak));
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Render one sound into any context/destination (live or offline). */
export function render(name: SoundName, o: Out, t: number, gain = 1) {
  const g = (v: number) => v * gain;
  switch (name) {
    case 'click': // a lid's ratchet tooth
      noiseBurst(o, t, 0.018, 'bandpass', 3400, 6, g(0.5));
      tone(o, t, 2100, 1600, 0.012, g(0.12), 'triangle');
      break;
    case 'unscrew': // thread grinding under the twist
      noiseBurst(o, t, 0.07, 'bandpass', 1800, 2.5, g(0.12), 0.01);
      break;
    case 'pop': // the lid comes free
      tone(o, t, 260, 85, 0.11, g(0.45));
      noiseBurst(o, t, 0.12, 'highpass', 2600, 0.7, g(0.18), 0.004);
      break;
    case 'rustle': // brown paper bag
      for (let i = 0; i < 6; i++) noiseBurst(o, t + i * 0.035 + Math.random() * 0.02, 0.03 + Math.random() * 0.04, 'bandpass', 2800 + Math.random() * 2400, 1.4, g(0.16 + Math.random() * 0.1));
      break;
    case 'drop': // a cookie lands in the bag
      tone(o, t, 150, 62, 0.13, g(0.4));
      noiseBurst(o, t, 0.08, 'lowpass', 900, 0.8, g(0.22));
      break;
    case 'whoosh': // aroma rising / an item leaving the bag
      {
        const src = o.ctx.createBufferSource();
        src.buffer = noise;
        const f = o.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 0.9;
        f.frequency.setValueAtTime(500, t);
        f.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
        src.connect(f).connect(env(o, t, 0.12, 0.38, g(0.16)));
        src.start(t);
        src.stop(t + 0.6);
      }
      break;
    case 'stamp': // the free-delivery seal
      tone(o, t, 120, 55, 0.16, g(0.5));
      noiseBurst(o, t + 0.005, 0.05, 'bandpass', 1200, 1.2, g(0.3));
      break;
  }
}

export function play(name: SoundName, options: { gain?: number; at?: number } = {}) {
  const c = audio();
  if (!master) return;
  render(name, { ctx: c, dest: master }, c.currentTime + (options.at ?? 0) + 0.005, options.gain ?? 1);
}
