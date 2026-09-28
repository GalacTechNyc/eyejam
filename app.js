import {
  Engine, STEPS, PATTERNS, SCALES, NOTE_NAMES, newProject, isEmpty, copyPattern, clearPattern,
  noteOf, noteName, soundsFor, soundOf, renderWav,
} from './engine.js';

const $ = (s) => document.querySelector(s);
const topEl = $('#top');
const gridEl = $('#grid');
const patsEl = $('#pats');
const hintEl = $('#hint');
const menuEl = $('#menu');
const menuTitle = $('#menuTitle');
const menuList = $('#menuList');

// ---------- project + saving ----------

function loadProject() {
  try {
    const p = JSON.parse(localStorage.getItem('eyejam.project'));
    if (p?.patterns?.length === PATTERNS && p.tracks?.length) return p;
  } catch {}
  return newProject();
}

let project = loadProject();
let saveTimer;
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('eyejam.project', JSON.stringify(project));
    } catch {}
  }, 400);
}

const engine = new Engine(() => project);

// ---------- ui state ----------

const TOP = ['play', 'bpm', 'swing', 'key', 'song', 'export'];
const PATS = ['p0', 'p1', 'p2', 'p3', 'copy', 'clear'];

const ui = {
  zone: 'grid', // top · grid · pats
  r: 0,
  c: 0, // -1 = track label
  top: 0,
  pat: 0,
  engaged: null, // 'step' · 'bpm' · 'swing' · 'key'
  menu: null, // { track, idx }
  lastNote: {}, // track → { deg, len } for new notes
  clearArmed: 0,
};

const pattern = () => project.patterns[project.current];

// ---------- build ----------

topEl.innerHTML = TOP.map((id) => `<div class="btn" data-id="${id}"></div>`).join('');
patsEl.innerHTML = PATS.map((id) => `<div class="btn" data-id="${id}"></div>`).join('');

const cells = [];
const labels = [];
project.tracks.forEach((t, r) => {
  const label = document.createElement('div');
  label.className = 'label';
  label.dataset.r = r;
  gridEl.appendChild(label);
  labels.push(label);
  cells.push([]);
  for (let c = 0; c < STEPS; c++) {
    const el = document.createElement('div');
    el.className = 'cell' + (c % 4 === 0 ? ' beat' : '') + (c && c % 4 === 0 ? ' bar-start' : '');
    el.dataset.r = r;
    el.dataset.c = c;
    el.style.setProperty('--c', `var(--t${r})`);
    gridEl.appendChild(el);
    cells[r].push(el);
  }
});

// ---------- render ----------

const keyName = () => `${NOTE_NAMES[project.root]} ${project.scale === 'major' ? 'maj' : project.scale === 'minor' ? 'min' : project.scale}`;

function renderTop() {
  const html = {
    play: engine.playing ? '■' : '▶',
    bpm: `${project.bpm}<small>BPM</small>`,
    swing: `${Math.round(project.swing * 100)}%<small>SWING</small>`,
    key: `${keyName()}<small>KEY</small>`,
    song: project.song ? 'SONG' : 'LOOP',
    export: '⤓',
  };
  for (const el of topEl.children) {
    const id = el.dataset.id;
    el.innerHTML = html[id];
    el.classList.toggle('on', (id === 'play' && engine.playing) || (id === 'song' && project.song));
    el.classList.toggle('cur', ui.zone === 'top' && TOP[ui.top] === id);
    el.classList.toggle('engaged', ui.engaged === id);
  }
}

function renderPats() {
  const playingPat = engine.position()?.pat;
  for (const el of patsEl.children) {
    const id = el.dataset.id;
    if (id.startsWith('p')) {
      const i = +id[1];
      el.textContent = 'ABCD'[i];
      el.classList.toggle('sel', i === project.current);
      el.classList.toggle('empty', isEmpty(project.patterns[i]));
      el.classList.toggle('playing', engine.playing && playingPat === i);
    } else if (id === 'copy') el.textContent = '⧉ Copy';
    else {
      el.textContent = ui.clearArmed > performance.now() ? 'Sure?' : '✕ Clear';
      el.classList.toggle('warn', ui.clearArmed > performance.now());
    }
    el.classList.toggle('cur', ui.zone === 'pats' && PATS[ui.pat] === id);
  }
}

function renderGrid() {
  const pat = pattern();
  project.tracks.forEach((t, r) => {
    const label = labels[r];
    label.innerHTML = `<b>${t.name}</b><small>${soundOf(t)?.name || ''}</small>`;
    label.classList.toggle('muted', t.mute);
    label.classList.toggle('solo', t.solo);
    label.classList.toggle('cur', ui.zone === 'grid' && ui.r === r && ui.c === -1);
    // Melodic notes hold for their length: mark the steps they cover.
    const tail = Array(STEPS).fill(false);
    if (t.kind === 'melodic')
      pat[r].forEach((s, c) => {
        if (s) for (let k = 1; k < s.len && c + k < STEPS && !pat[r][c + k]; k++) tail[c + k] = true;
      });
    pat[r].forEach((s, c) => {
      const el = cells[r][c];
      el.classList.toggle('on', !!s);
      el.classList.toggle('soft', !!s && (s.vel ?? 1) < 0.8);
      el.classList.toggle('tail', tail[c]);
      el.textContent = s && t.kind === 'melodic' ? noteName(noteOf(project, t, s.deg)) : '';
      el.classList.toggle('cur', ui.zone === 'grid' && ui.r === r && ui.c === c);
      el.classList.toggle('engaged', ui.engaged === 'step' && ui.r === r && ui.c === c);
    });
  });
}

function render() {
  renderTop();
  renderGrid();
  renderPats();
  if (ui.menu) renderMenu();
  updateHint();
}

// ---------- hint ----------

let toastTimer;
function toast(text) {
  hintEl.textContent = text;
  hintEl.classList.add('toast');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    hintEl.classList.remove('toast');
    updateHint();
  }, 2200);
}

function updateHint() {
  if (hintEl.classList.contains('toast')) return;
  let h = '';
  if (ui.menu) h = 'Swipe ▲▼ to pick · ◀▶ to change · back to close';
  else if (ui.engaged === 'step') h = '▲▼ note · ◀▶ length · pinch done · back deletes';
  else if (ui.engaged === 'bpm') h = '◀▶ ±1 BPM · ▲▼ ±5 · pinch done';
  else if (ui.engaged === 'swing') h = '◀▶ more or less swing · pinch done';
  else if (ui.engaged === 'key') h = '◀▶ root note · ▲▼ scale · pinch done';
  else if (ui.zone === 'grid') {
    const t = project.tracks[ui.r];
    if (ui.c === -1) h = `Pinch for ${t.name} sound, volume, mute, solo`;
    else if (t.kind === 'drum') h = 'Pinch to add or remove a hit';
    else h = pattern()[ui.r][ui.c] ? 'Pinch to edit this note' : 'Pinch to add a note';
  } else if (ui.zone === 'top') {
    h = {
      play: engine.playing ? 'Pinch to stop' : 'Pinch to play',
      bpm: 'Pinch, then swipe to change the tempo',
      swing: 'Pinch, then swipe to change the swing',
      key: 'Pinch, then swipe to change the key',
      song: project.song ? 'Song: plays every pattern with notes, A→D' : 'Loop: repeats the selected pattern',
      export: 'Pinch to export a WAV',
    }[TOP[ui.top]];
  } else {
    const id = PATS[ui.pat];
    if (id === 'copy') h = `Copy ${'ABCD'[project.current]} into ${'ABCD'[(project.current + 1) % PATTERNS]}`;
    else if (id === 'clear') h = `Pinch twice to clear pattern ${'ABCD'[project.current]}`;
    else h = `Pinch to edit pattern ${'ABCD'[+id[1]]}`;
  }
  hintEl.textContent = h;
}

// ---------- actions ----------

function activate() {
  engine.ensure(); // first gesture unlocks audio
  if (ui.zone === 'top') {
    const id = TOP[ui.top];
    if (id === 'play') engine.playing ? engine.stop() : engine.play();
    else if (id === 'song') {
      project.song = !project.song;
      changed();
    } else if (id === 'export') exportWav();
    else engage(id);
  } else if (ui.zone === 'pats') {
    const id = PATS[ui.pat];
    if (id.startsWith('p')) project.current = +id[1];
    else if (id === 'copy') {
      const next = (project.current + 1) % PATTERNS;
      project.patterns[next] = copyPattern(pattern());
      project.current = next;
      toast(`Copied into ${'ABCD'[next]}`);
    } else if (ui.clearArmed > performance.now()) {
      project.patterns[project.current] = clearPattern();
      ui.clearArmed = 0;
      toast(`Pattern ${'ABCD'[project.current]} cleared`);
    } else {
      ui.clearArmed = performance.now() + 2500;
      setTimeout(render, 2600);
    }
    changed();
  } else if (ui.c === -1) openMenu(ui.r);
  else {
    const t = project.tracks[ui.r];
    const row = pattern()[ui.r];
    if (t.kind === 'drum') {
      row[ui.c] = row[ui.c] ? null : { vel: 1 };
      if (row[ui.c]) engine.preview(ui.r, row[ui.c]);
    } else {
      if (!row[ui.c]) row[ui.c] = { deg: 0, len: 2, vel: 1, ...ui.lastNote[ui.r] };
      engine.preview(ui.r, row[ui.c]);
      engage('step');
    }
    changed();
  }
  render();
}

function engage(what) {
  ui.engaged = what;
  histPush();
}

function disengage() {
  if (ui.engaged === 'step') {
    const s = pattern()[ui.r][ui.c];
    if (s) ui.lastNote[ui.r] = { deg: s.deg, len: s.len };
  }
  ui.engaged = null;
  render();
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function engagedKey(k) {
  const dx = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
  const dy = k === 'ArrowUp' ? 1 : k === 'ArrowDown' ? -1 : 0;
  if (k === 'Enter') return disengage();
  if (ui.engaged === 'step') {
    const row = pattern()[ui.r];
    const s = row[ui.c];
    if (k === 'Escape' || k === 'Backspace') {
      row[ui.c] = null;
      changed();
      return backLater(disengage);
    }
    if (!s) return;
    if (dy) {
      s.deg = clamp(s.deg + dy, -7, 14);
      engine.preview(ui.r, s);
    }
    if (dx) s.len = clamp(s.len + dx, 1, STEPS);
  } else {
    if (k === 'Escape' || k === 'Backspace') return backLater(disengage);
    if (ui.engaged === 'bpm') project.bpm = clamp(project.bpm + dx + dy * 5, 50, 200);
    else if (ui.engaged === 'swing') project.swing = clamp(Math.round((project.swing + (dx + dy) * 0.02) * 100) / 100, 0, 0.5);
    else if (ui.engaged === 'key') {
      if (dx) project.root = (project.root + dx + 12) % 12;
      if (dy) {
        const names = Object.keys(SCALES);
        project.scale = names[(names.indexOf(project.scale) + dy + names.length) % names.length];
      }
      engine.preview(5, { deg: 0, len: 2 });
    }
  }
  changed();
  render();
}

function navKey(k) {
  if (ui.zone === 'grid') {
    if (k === 'ArrowLeft') ui.c = Math.max(-1, ui.c - 1);
    else if (k === 'ArrowRight') ui.c = Math.min(STEPS - 1, ui.c + 1);
    else if (k === 'ArrowUp') {
      if (ui.r > 0) ui.r--;
      else {
        ui.zone = 'top';
        ui.top = clamp(Math.round(((ui.c + 1) / STEPS) * (TOP.length - 1)), 0, TOP.length - 1);
      }
    } else if (k === 'ArrowDown') {
      if (ui.r < project.tracks.length - 1) ui.r++;
      else {
        ui.zone = 'pats';
        ui.pat = clamp(Math.round(((ui.c + 1) / STEPS) * (PATS.length - 1)), 0, PATS.length - 1);
      }
    }
  } else if (ui.zone === 'top') {
    if (k === 'ArrowLeft') ui.top = Math.max(0, ui.top - 1);
    else if (k === 'ArrowRight') ui.top = Math.min(TOP.length - 1, ui.top + 1);
    else if (k === 'ArrowDown') {
      ui.zone = 'grid';
      ui.r = 0;
    }
  } else {
    if (k === 'ArrowLeft') ui.pat = Math.max(0, ui.pat - 1);
    else if (k === 'ArrowRight') ui.pat = Math.min(PATS.length - 1, ui.pat + 1);
    else if (k === 'ArrowUp') {
      ui.zone = 'grid';
      ui.r = project.tracks.length - 1;
    }
  }
  render();
}

// ---------- track menu ----------

function menuRows() {
  const t = project.tracks[ui.menu.track];
  const rows = [
    { id: 'sound', label: 'Sound', value: `<span class="arrows">${soundOf(t)?.name}</span>` },
    { id: 'vol', label: 'Volume', value: `<span class="meter"><i style="width:${Math.round(t.vol * 100)}%"></i></span>` },
  ];
  if (t.kind === 'melodic') rows.push({ id: 'oct', label: 'Octave', value: `<span class="arrows">${Math.floor(t.base / 12) - 1}</span>` });
  rows.push(
    { id: 'mute', label: 'Mute', value: `<span>${t.mute ? 'On' : 'Off'}</span>` },
    { id: 'solo', label: 'Solo', value: `<span>${t.solo ? 'On' : 'Off'}</span>` },
    { id: 'clear', label: `Clear ${t.name} in pattern ${'ABCD'[project.current]}`, value: '' },
    { id: 'done', label: 'Done', value: '' },
  );
  return rows;
}

function renderMenu() {
  const t = project.tracks[ui.menu.track];
  menuTitle.textContent = t.name;
  const rows = menuRows();
  ui.menu.idx = clamp(ui.menu.idx, 0, rows.length - 1);
  menuList.innerHTML = rows
    .map((r, i) => `<li class="${i === ui.menu.idx ? 'cur' : ''}" data-i="${i}">${r.label}${r.value}</li>`)
    .join('');
}

function openMenu(track) {
  ui.menu = { track, idx: 0 };
  menuEl.hidden = false;
  histPush();
  render();
}

function closeMenu() {
  ui.menu = null;
  menuEl.hidden = true;
  render();
}

function menuKey(k) {
  const t = project.tracks[ui.menu.track];
  const row = menuRows()[ui.menu.idx];
  const dx = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
  if (k === 'ArrowUp' || k === 'ArrowDown') ui.menu.idx += k === 'ArrowDown' ? 1 : -1;
  else if (k === 'Escape' || k === 'Backspace') return backLater(closeMenu);
  else if (dx && row.id === 'sound') {
    const ids = Object.keys(soundsFor(t.kind));
    t.sound = ids[(ids.indexOf(t.sound) + dx + ids.length) % ids.length];
    engine.preview(ui.menu.track, { deg: 0, len: 2 });
  } else if (dx && row.id === 'vol') {
    t.vol = clamp(Math.round((t.vol + dx * 0.1) * 10) / 10, 0, 1);
    engine.mix();
    engine.preview(ui.menu.track, { deg: 0, len: 2 });
  } else if (dx && row.id === 'oct') {
    t.base = clamp(t.base + dx * 12, 24, 84);
    engine.preview(ui.menu.track, { deg: 0, len: 2 });
  } else if (k === 'Enter') {
    if (row.id === 'mute' || row.id === 'solo') {
      t[row.id] = !t[row.id];
      engine.mix();
    } else if (row.id === 'clear') {
      pattern()[ui.menu.track].fill(null);
      toast(`${t.name} cleared`);
    } else if (row.id === 'done') return closeMenu();
  } else return;
  changed();
  render();
}

// ---------- export ----------

let exporting = false;
async function exportWav() {
  if (exporting) return;
  exporting = true;
  toast('Rendering…');
  try {
    engine.ensure();
    await engine.samplesReady;
    const blob = await renderWav(project, engine.samples);
    const name = `eyejam-${project.bpm}bpm.wav`;
    const file = new File([blob], name, { type: 'audio/wav' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'EyeJam beat' });
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    toast(`Exported ${name}`);
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`Export failed: ${e.message || e}`);
  } finally {
    exporting = false;
  }
}

// ---------- back gesture ----------
// The glasses may deliver "back" as history navigation rather than Escape.
// While a menu or an edit is open the app keeps one spare history entry as a
// "back trap" and handles back itself.

let trapArmed = false;
let lastPopAt = -Infinity;

function histPush() {
  if (trapArmed) return;
  try {
    history.pushState({ eyejam: 'back-trap' }, '');
    trapArmed = true;
  } catch {}
}

window.addEventListener('popstate', () => {
  lastPopAt = performance.now();
  trapArmed = false;
  if (ui.menu) closeMenu();
  else if (ui.engaged) {
    if (ui.engaged === 'step') {
      pattern()[ui.r][ui.c] = null; // back deletes the note being edited
      changed();
    }
    disengage();
  }
  if (ui.menu || ui.engaged) histPush();
});

function backLater(fn) {
  const pressedAt = performance.now();
  setTimeout(() => {
    if (lastPopAt < pressedAt - 50) fn();
  }, 80);
}

// ---------- input ----------

document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (!k.startsWith('Arrow') && k !== 'Enter' && k !== 'Escape' && k !== 'Backspace' && k !== ' ') return;
  if (k === ' ') {
    // Space bar = play/stop when testing on a computer.
    e.preventDefault();
    engine.playing ? engine.stop() : engine.play();
    return render();
  }
  if (k === 'Escape' && !ui.menu && !ui.engaged) return; // let the glasses close the app
  e.preventDefault();
  if (ui.menu) menuKey(k);
  else if (ui.engaged) engagedKey(k);
  else if (k === 'Enter') activate();
  else if (k.startsWith('Arrow')) navKey(k);
});

document.addEventListener('click', (e) => {
  const li = e.target.closest('#menuList li');
  if (li) {
    ui.menu.idx = +li.dataset.i;
    return menuKey('Enter');
  }
  if (ui.engaged) return disengage();
  const btn = e.target.closest('.btn');
  const cell = e.target.closest('.cell, .label');
  if (btn && topEl.contains(btn)) Object.assign(ui, { zone: 'top', top: TOP.indexOf(btn.dataset.id) });
  else if (btn) Object.assign(ui, { zone: 'pats', pat: PATS.indexOf(btn.dataset.id) });
  else if (cell) Object.assign(ui, { zone: 'grid', r: +cell.dataset.r, c: cell.dataset.c == null ? -1 : +cell.dataset.c });
  else return;
  activate();
});

// ---------- playhead ----------

let lastNow = null;
let lastPlayingPat = null;
function frame() {
  const pos = engine.position();
  const step = pos && pos.pat === project.current ? pos.step : null;
  if (step !== lastNow) {
    for (const row of cells) {
      if (lastNow != null) row[lastNow].classList.remove('now');
      if (step != null) row[step].classList.add('now');
    }
    lastNow = step;
  }
  if ((pos?.pat ?? null) !== lastPlayingPat) {
    lastPlayingPat = pos?.pat ?? null;
    renderPats();
  }
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);

window.eyejam = { project: () => project, engine, ui }; // handy for debugging in the console
