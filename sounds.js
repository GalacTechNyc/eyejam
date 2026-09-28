// Instruments. Drums are synthesized; the melodic sounds are multisamples of the
// g-WAVE synth (from gWAVE-MPC) plus a couple of synthesized ones. Every sound
// is a function (A, t, midi, vel, dur) where A = { ctx, out, noise, samples },
// so the same code plays live and renders offline for export.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function gainEnv(A, t, amp, attack, hold, release) {
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + attack);
  g.gain.setValueAtTime(amp, t + attack + hold);
  g.gain.setTargetAtTime(0, t + attack + hold, release);
  return g;
}

function noiseHit(A, t, type, freq, q, amp, decay) {
  const s = A.ctx.createBufferSource();
  s.buffer = A.noise;
  const f = A.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(amp, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  s.connect(f).connect(g).connect(A.out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + decay + 0.02);
}

function tone(A, t, type, f0, f1, sweep, amp, decay) {
  const o = A.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(amp, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  o.connect(g).connect(A.out);
  o.start(t);
  o.stop(t + decay + 0.02);
}

// Soft clipping adds harmonics so low notes are audible on small speakers.
let curve;
function saturator(A, drive) {
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3) / Math.tanh(3);
    }
  }
  const pre = A.ctx.createGain();
  pre.gain.value = drive;
  const ws = A.ctx.createWaveShaper();
  ws.curve = curve;
  pre.connect(ws);
  return { input: pre, output: ws };
}

// Plays the nearest-rooted sample, repitched.
function sampled(A, name, release, t, midi, vel, dur, amp = 0.9) {
  const set = A.samples[name];
  if (!set?.length) return;
  let best = set[0];
  for (const s of set) if (Math.abs(s.root - midi) < Math.abs(best.root - midi)) best = s;
  const src = A.ctx.createBufferSource();
  src.buffer = best.buffer;
  src.playbackRate.value = Math.pow(2, (midi - best.root) / 12);
  const hold = Math.min(dur, best.buffer.duration / src.playbackRate.value);
  const g = gainEnv(A, t, amp * vel, 0.004, hold, release / 4);
  src.connect(g).connect(A.out);
  src.start(t);
  src.stop(t + hold + release * 1.5);
}

export const DRUMS = {
  kick: {
    name: 'Punch Kick',
    play(A, t, _m, v) {
      tone(A, t, 'sine', 170, 48, 0.1, v, 0.38);
      noiseHit(A, t, 'lowpass', 3000, 0.7, v * 0.25, 0.012);
    },
  },
  kick808: {
    name: '808 Kick',
    play(A, t, _m, v) {
      const sat = saturator(A, 1.6);
      sat.output.connect(A.out);
      const o = A.ctx.createOscillator();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.07);
      const g = A.ctx.createGain();
      g.gain.setValueAtTime(v * 0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(sat.input);
      o.start(t);
      o.stop(t + 0.95);
    },
  },
  snare: {
    name: 'Snare',
    play(A, t, _m, v) {
      noiseHit(A, t, 'bandpass', 1900, 0.8, v * 0.75, 0.2);
      tone(A, t, 'triangle', 190, 170, 0.05, v * 0.5, 0.09);
    },
  },
  clap: {
    name: 'Clap',
    play(A, t, _m, v) {
      for (const dt of [0, 0.011, 0.022]) noiseHit(A, t + dt, 'bandpass', 1100, 1.2, v * 0.65, 0.03);
      noiseHit(A, t + 0.03, 'bandpass', 1100, 1.2, v * 0.55, 0.18);
    },
  },
  rim: {
    name: 'Rim',
    play(A, t, _m, v) {
      tone(A, t, 'square', 1700, 1700, 0, v * 0.18, 0.03);
      noiseHit(A, t, 'bandpass', 3200, 3, v * 0.3, 0.025);
    },
  },
  hat: {
    name: 'Closed Hat',
    play(A, t, _m, v) {
      noiseHit(A, t, 'highpass', 7500, 0.7, v * 0.28, 0.04);
    },
  },
  openhat: {
    name: 'Open Hat',
    play(A, t, _m, v) {
      noiseHit(A, t, 'highpass', 7000, 0.7, v * 0.24, 0.3);
    },
  },
  shaker: {
    name: 'Shaker',
    play(A, t, _m, v) {
      noiseHit(A, t, 'bandpass', 5500, 1.5, v * 0.35, 0.06);
    },
  },
  tom: {
    name: 'Tom',
    play(A, t, _m, v) {
      tone(A, t, 'sine', 240, 120, 0.15, v * 0.7, 0.3);
    },
  },
};

export const MELODIC = {
  sub808: {
    name: '808',
    play(A, t, m, v, dur) {
      const sat = saturator(A, 2.2);
      const g = gainEnv(A, t, v * 0.55, 0.003, Math.max(0.05, dur - 0.05), 0.08);
      sat.output.connect(g).connect(A.out);
      const o = A.ctx.createOscillator();
      const hz = mtof(m);
      o.frequency.setValueAtTime(hz * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
      o.connect(sat.input);
      o.start(t);
      o.stop(t + dur + 0.5);
    },
  },
  voidbass: { name: 'Void Bass', play: (A, t, m, v, d) => sampled(A, 'bass', 0.3, t, m, v, d, 1) },
  synthbass: {
    name: 'Synth Bass',
    play(A, t, m, v, dur) {
      const o = A.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      const f = A.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(1100, t);
      f.frequency.setTargetAtTime(260, t, 0.07);
      const g = gainEnv(A, t, v * 0.4, 0.004, dur, 0.04);
      o.connect(f).connect(g).connect(A.out);
      o.start(t);
      o.stop(t + dur + 0.3);
    },
  },
  keys: { name: 'Cosmic Keys', play: (A, t, m, v, d) => sampled(A, 'keys', 0.4, t, m, v, d) },
  pluck: { name: 'Dark Pluck', play: (A, t, m, v, d) => sampled(A, 'pluck', 0.25, t, m, v, d) },
  lead: { name: 'Starfall Lead', play: (A, t, m, v, d) => sampled(A, 'lead', 0.35, t, m, v, d, 0.7) },
  stab: {
    name: 'Synth Stab',
    play(A, t, m, v, dur) {
      const f = A.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2400;
      const g = gainEnv(A, t, v * 0.12, 0.005, dur, 0.06);
      f.connect(g).connect(A.out);
      for (const det of [-9, 9]) {
        const o = A.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    },
  },
};

// g-WAVE multisamples: file root notes (see gWAVE-MPC/out/*/program.json).
const SAMPLE_SETS = {
  keys: [51, 61, 71, 81],
  bass: [28, 36, 44, 52],
  pluck: [51, 61, 71, 81],
  lead: [58, 68, 78],
};

export async function loadSamples(ctx) {
  const out = {};
  await Promise.all(
    Object.entries(SAMPLE_SETS).map(async ([name, roots]) => {
      const set = await Promise.all(
        roots.map(async (root) => {
          try {
            const res = await fetch(`samples/${name}-${root}.m4a`);
            const buffer = trimLead(await ctx.decodeAudioData(await res.arrayBuffer()));
            return { root, buffer };
          } catch {
            return null;
          }
        }),
      );
      out[name] = set.filter(Boolean);
    }),
  );
  return out;
}

// Some decoders keep the AAC encoder's lead-in silence; cut up to 60 ms of it
// so notes land on the beat.
function trimLead(buf) {
  const d = buf.getChannelData(0);
  const max = Math.min(d.length, Math.floor(buf.sampleRate * 0.06));
  let i = 0;
  while (i < max && Math.abs(d[i]) < 0.0005) i++;
  if (i === 0) return buf;
  const out = new AudioBuffer({ length: buf.length - i, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(i), c);
  return out;
}

export function makeNoise(ctx) {
  const len = ctx.sampleRate;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
