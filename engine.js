// Project model, playback scheduler and WAV export.

import { DRUMS, MELODIC, loadSamples, makeNoise } from './sounds.js';

export const STEPS = 16;
export const PATTERNS = 4;
export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  'minor pent': [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// ---------- project ----------

const TRACKS = [
  { name: 'Kick', kind: 'drum', sound: 'kick' },
  { name: 'Snare', kind: 'drum', sound: 'snare' },
  { name: 'Hat', kind: 'drum', sound: 'hat' },
  { name: 'Perc', kind: 'drum', sound: 'openhat' },
  { name: 'Bass', kind: 'melodic', sound: 'sub808', base: 36 },
  { name: 'Keys', kind: 'melodic', sound: 'keys', base: 60 },
];

const emptyPattern = () => TRACKS.map(() => Array(STEPS).fill(null));

export function newProject() {
  const p = {
    bpm: 92,
    swing: 0.12,
    root: 9, // A
    scale: 'minor',
    song: false,
    metronome: false,
    current: 0,
    tracks: TRACKS.map((t) => ({ ...t, vol: 0.8, mute: false, solo: false })),
    patterns: Array.from({ length: PATTERNS }, emptyPattern),
  };
  // A starter boom-bap beat in pattern A so Play does something right away.
  const [kick, snare, hat, perc, bass, keys] = p.patterns[0];
  for (const s of [0, 7, 10]) kick[s] = { vel: 1 };
  for (const s of [4, 12]) snare[s] = { vel: 1 };
  for (let s = 0; s < STEPS; s += 2) hat[s] = { vel: s % 4 ? 0.6 : 1 };
  perc[14] = { vel: 0.8 };
  bass[0] = { deg: 0, len: 6, vel: 1 };
  bass[7] = { deg: 0, len: 3, vel: 1 };
  bass[10] = { deg: -2, len: 5, vel: 1 };
  keys[0] = { deg: 4, len: 4, vel: 0.8 };
  keys[4] = { deg: 2, len: 4, vel: 0.8 };
  keys[8] = { deg: 0, len: 3, vel: 0.8 };
  keys[11] = { deg: 2, len: 5, vel: 0.8 };
  return p;
}

export const isEmpty = (pat) => pat.every((row) => row.every((s) => !s));

export function copyPattern(pat) {
  return pat.map((row) => row.map((s) => (s ? { ...s } : null)));
}

export function clearPattern() {
  return emptyPattern();
}

export function noteOf(p, track, deg) {
  const sc = SCALES[p.scale] || SCALES.minor;
  const n = sc.length;
  const oct = Math.floor(deg / n);
  return track.base + p.root + sc[((deg % n) + n) % n] + 12 * oct;
}

export const noteName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12];

export const soundsFor = (kind) => (kind === 'drum' ? DRUMS : MELODIC);
export const soundOf = (track) => soundsFor(track.kind)[track.sound];

// Patterns played in song mode: every pattern with notes, in order.
export function songOrder(p) {
  if (!p.song) return [p.current];
  const order = p.patterns.map((pat, i) => (isEmpty(pat) ? -1 : i)).filter((i) => i >= 0);
  return order.length ? order : [p.current];
}

// ---------- audio graph (shared by live playback and export) ----------

function buildGraph(ctx, p) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.7;
  // Fast, hard compressor as a limiter so the mix doesn't clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  comp.connect(master).connect(limiter).connect(ctx.destination);
  const buses = p.tracks.map(() => {
    const g = ctx.createGain();
    g.connect(comp);
    return g;
  });
  const graph = { ctx, buses, master, noise: makeNoise(ctx) };
  applyMix(graph, p);
  return graph;
}

function applyMix(graph, p) {
  const anySolo = p.tracks.some((t) => t.solo);
  p.tracks.forEach((t, i) => {
    const on = !t.mute && (!anySolo || t.solo);
    graph.buses[i].gain.setTargetAtTime(on ? t.vol : 0, graph.ctx.currentTime, 0.01);
  });
}

function playStep(graph, samples, p, pat, i, step, t, sd) {
  const s = p.patterns[pat][i][step];
  if (!s) return;
  const track = p.tracks[i];
  const A = { ctx: graph.ctx, out: graph.buses[i], noise: graph.noise, samples };
  const midi = track.kind === 'melodic' ? noteOf(p, track, s.deg) : 0;
  soundOf(track)?.play(A, t, midi, s.vel ?? 1, (s.len || 1) * sd);
}

const stepDur = (p) => 60 / p.bpm / 4;
const swingAt = (p, step, sd) => (step % 2 ? p.swing * sd : 0);

// ---------- live playback ----------

export class Engine {
  constructor(getProject) {
    this.getProject = getProject;
    this.ctx = null;
    this.graph = null;
    this.samples = {};
    this.playing = false;
    this.queue = []; // { time, step, pat } for the playhead
  }

  // Must be called from a user gesture the first time (browsers block audio until then).
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.graph = buildGraph(this.ctx, this.getProject());
      this.samplesReady = loadSamples(this.ctx).then((s) => (this.samples = s));
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  mix() {
    if (this.graph) applyMix(this.graph, this.getProject());
  }

  play() {
    this.ensure();
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.pat = null;
    this.queue = [];
    this.nextTime = this.ctx.currentTime + 0.08;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.queue = [];
  }

  schedule() {
    const p = this.getProject();
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      if (this.step === 0) {
        const order = songOrder(p);
        this.pat = order[this.bar % order.length];
      }
      const sd = stepDur(p);
      const t = this.nextTime + swingAt(p, this.step, sd);
      for (let i = 0; i < p.tracks.length; i++) playStep(this.graph, this.samples, p, this.pat, i, this.step, t, sd);
      if (p.metronome && this.step % 4 === 0) this.click(t, this.step === 0);
      this.queue.push({ time: t, step: this.step, pat: this.pat });
      this.nextTime += sd;
      this.step = (this.step + 1) % STEPS;
      if (this.step === 0) this.bar++;
    }
    const now = this.ctx.currentTime;
    while (this.queue.length > 1 && this.queue[1].time <= now) this.queue.shift();
  }

  // Metronome: a short blip on every beat, higher on the downbeat. Live only,
  // never in the export.
  click(t, accent) {
    const o = this.ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1180;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.5 : 0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(this.graph.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  // What's sounding now, for the playhead.
  position() {
    if (!this.playing || !this.queue.length || this.queue[0].time > this.ctx.currentTime) return null;
    return this.queue[0];
  }

  // Hear one step right away (while editing).
  preview(trackIndex, stepObj) {
    this.ensure();
    const p = this.getProject();
    const track = p.tracks[trackIndex];
    const A = { ctx: this.ctx, out: this.graph.buses[trackIndex], noise: this.graph.noise, samples: this.samples };
    const midi = track.kind === 'melodic' ? noteOf(p, track, stepObj?.deg ?? 0) : 0;
    const dur = Math.min(0.6, (stepObj?.len || 2) * stepDur(p));
    soundOf(track)?.play(A, this.ctx.currentTime + 0.01, midi, stepObj?.vel ?? 1, dur);
  }
}

// ---------- export ----------

// Renders the song (or the current pattern, looped to at least 4 bars) to a WAV blob.
export async function renderWav(p, samples) {
  const order = songOrder(p);
  const loops = Math.max(1, Math.ceil(4 / order.length));
  const bars = order.length * loops;
  const sd = stepDur(p);
  const sr = 44100;
  const length = Math.ceil((bars * STEPS * sd + 2) * sr);
  const ctx = new OfflineAudioContext(2, length, sr);
  const graph = buildGraph(ctx, p);
  for (let bar = 0; bar < bars; bar++) {
    const pat = order[bar % order.length];
    for (let step = 0; step < STEPS; step++) {
      const t = (bar * STEPS + step) * sd + swingAt(p, step, sd) + 0.01;
      for (let i = 0; i < p.tracks.length; i++) playStep(graph, samples, p, pat, i, step, t, sd);
    }
  }
  return encodeWav(await ctx.startRendering());
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Blob([data], { type: 'audio/wav' });
}
