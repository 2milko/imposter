'use strict';

// Alle Sounds werden direkt im Browser erzeugt, es gibt keine Audiodateien.
(function () {
  const STORAGE_KEY = 'imposter-muted';
  const MASTER_VOLUME = 0.7;

  // --- Bausteine -----------------------------------------------------------

  function tone(ctx, out, t, { freq, to, dur, type = 'sine', gain = 0.3, attack = 0.005, cutoff }) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    amp.gain.value = 0.0001; // Sonst knackt das erste Sample mit voller Lautstärke.
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = osc;
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      osc.connect(filter);
      last = filter;
    }
    last.connect(amp);
    amp.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(ctx, out, t, { dur, gain = 0.2, type = 'bandpass', freq = 1000, to, q = 1, attack = 0.003 }) {
    const length = Math.ceil(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const amp = ctx.createGain();
    amp.gain.value = 0.0001;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(out);
    source.start(t);
  }

  // Unharmonische Teiltöne klingen nach Kirchenglocke.
  function bell(ctx, out, t, freq, dur = 1.6, gain = 0.2) {
    [[0.5, 1], [1, 0.8], [1.19, 0.45], [1.56, 0.3], [2, 0.3], [2.74, 0.15]].forEach(([ratio, level], i) => {
      tone(ctx, out, t, {
        freq: freq * ratio,
        dur: dur / (1 + i * 0.35),
        gain: gain * level,
        attack: 0.003,
      });
    });
  }

  function drum(ctx, out, t, gain = 0.5) {
    tone(ctx, out, t, { freq: 110, to: 42, dur: 0.32, gain });
    noise(ctx, out, t, { dur: 0.07, gain: gain * 0.35, type: 'lowpass', freq: 900 });
  }

  // --- Die Sounds ----------------------------------------------------------

  const defs = {
    click(ctx, out, t) {
      tone(ctx, out, t, { freq: 190, to: 120, dur: 0.06, type: 'square', gain: 0.07, cutoff: 1200 });
    },
    tick(ctx, out, t) {
      tone(ctx, out, t, { freq: 660, dur: 0.05, type: 'triangle', gain: 0.1 });
    },
    error(ctx, out, t) {
      tone(ctx, out, t, { freq: 98, dur: 0.14, type: 'sawtooth', gain: 0.14, cutoff: 700 });
      tone(ctx, out, t + 0.15, { freq: 82, dur: 0.2, type: 'sawtooth', gain: 0.14, cutoff: 700 });
    },
    join(ctx, out, t) {
      tone(ctx, out, t, { freq: 220, dur: 0.22, type: 'triangle', gain: 0.16 });
      tone(ctx, out, t + 0.12, { freq: 330, dur: 0.35, type: 'triangle', gain: 0.16 });
    },
    leave(ctx, out, t) {
      tone(ctx, out, t, { freq: 294, dur: 0.22, type: 'triangle', gain: 0.14 });
      tone(ctx, out, t + 0.12, { freq: 196, dur: 0.4, type: 'triangle', gain: 0.14 });
    },
    // Umblättern einer alten Seite
    flip(ctx, out, t) {
      noise(ctx, out, t, { dur: 0.2, gain: 0.2, freq: 900, to: 3200, q: 0.8 });
      tone(ctx, out, t + 0.15, { freq: 120, to: 70, dur: 0.1, gain: 0.14 });
    },
    // Düsterer Akkord: Du bist Imposter
    imposterSting(ctx, out, t) {
      [55, 77.8, 110].forEach((freq) => {
        tone(ctx, out, t, { freq, dur: 1.5, type: 'sawtooth', gain: 0.12, attack: 0.02, cutoff: 650 });
      });
      bell(ctx, out, t + 0.03, 155, 1.5, 0.11);
      noise(ctx, out, t, { dur: 0.7, gain: 0.08, type: 'lowpass', freq: 420 });
    },
    roundStart(ctx, out, t) {
      drum(ctx, out, t, 0.45);
      drum(ctx, out, t + 0.22, 0.35);
      drum(ctx, out, t + 0.44, 0.55);
      bell(ctx, out, t + 0.44, 196, 1.7, 0.17);
    },
    // Glockenschlag: Du bist dran
    yourTurn(ctx, out, t) {
      bell(ctx, out, t, 440, 1.4, 0.24);
    },
    // Feder kratzt über Pergament
    word(ctx, out, t) {
      [0, 0.09, 0.17].forEach((offset, i) => {
        noise(ctx, out, t + offset, { dur: 0.07, gain: 0.1, type: 'highpass', freq: 3200 + i * 500 });
      });
    },
    // Unheilvoller Herzschlag
    voteStart(ctx, out, t) {
      [0, 0.26, 0.85, 1.11].forEach((offset, i) => {
        drum(ctx, out, t + offset, i % 2 ? 0.32 : 0.46);
      });
      tone(ctx, out, t, { freq: 65.4, dur: 1.7, type: 'sawtooth', gain: 0.07, attack: 0.3, cutoff: 320 });
      tone(ctx, out, t, { freq: 92.5, dur: 1.7, type: 'sawtooth', gain: 0.07, attack: 0.3, cutoff: 320 });
    },
    // Hammerschlag auf Holz
    vote(ctx, out, t) {
      tone(ctx, out, t, { freq: 170, to: 80, dur: 0.12, type: 'triangle', gain: 0.3 });
      noise(ctx, out, t, { dur: 0.05, gain: 0.16, freq: 1500 });
    },
    groupWin(ctx, out, t) {
      [220, 277.2, 329.6, 440].forEach((freq, i) => {
        tone(ctx, out, t + i * 0.15, { freq, dur: 0.55, type: 'sawtooth', gain: 0.11, cutoff: 1800 });
        bell(ctx, out, t + i * 0.15, freq * 2, 0.8, 0.05);
      });
      bell(ctx, out, t + 0.6, 440, 1.6, 0.17);
    },
    // Abwärts ins Dunkel, mit tiefem Grollen
    imposterWin(ctx, out, t) {
      [329.6, 261.6, 196, 155.6].forEach((freq, i) => {
        tone(ctx, out, t + i * 0.17, { freq, dur: 0.48, type: 'sawtooth', gain: 0.13, cutoff: 1100 });
      });
      tone(ctx, out, t + 0.65, { freq: 49, to: 41, dur: 1.5, type: 'sawtooth', gain: 0.18, attack: 0.05, cutoff: 300 });
      tone(ctx, out, t + 0.65, { freq: 73.4, dur: 1.5, type: 'sawtooth', gain: 0.12, attack: 0.05, cutoff: 400 });
      noise(ctx, out, t + 0.65, { dur: 1.3, gain: 0.09, type: 'lowpass', freq: 240 });
    },
    // Münzen
    points(ctx, out, t) {
      tone(ctx, out, t, { freq: 988, dur: 0.09, type: 'square', gain: 0.07 });
      tone(ctx, out, t + 0.08, { freq: 1319, dur: 0.28, type: 'square', gain: 0.07 });
    },
    finale(ctx, out, t) {
      drum(ctx, out, t, 0.5);
      drum(ctx, out, t + 0.3, 0.5);
      [[220, 0], [261.6, 0.3], [329.6, 0.6], [440, 0.9]].forEach(([freq, offset]) => {
        tone(ctx, out, t + offset, { freq, dur: 0.6, type: 'sawtooth', gain: 0.12, cutoff: 1600 });
        tone(ctx, out, t + offset, { freq: freq / 2, dur: 0.6, type: 'triangle', gain: 0.14 });
      });
      bell(ctx, out, t + 0.9, 220, 2, 0.2);
      bell(ctx, out, t + 1.3, 440, 1.8, 0.14);
    },
  };

  // --- Wiedergabe -----------------------------------------------------------

  let ctx = null;
  let output = null;
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === '1';
  } catch { /* Ohne Speicher gilt die Standardeinstellung. */ }

  function ensureContext() {
    if (ctx) return ctx;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    ctx = new AudioContextClass();
    const limiter = ctx.createDynamicsCompressor();
    const master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    limiter.connect(master);
    master.connect(ctx.destination);
    output = limiter;
    return ctx;
  }

  // Browser spielen Ton erst nach der ersten Interaktion auf der Seite ab.
  function unlock() {
    const context = ensureContext();
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function play(name, delay = 0) {
    if (muted || !Object.hasOwn(defs, name)) return;
    const context = ensureContext();
    if (!context || context.state !== 'running') return;
    defs[name](context, output, context.currentTime + delay);
  }

  function setMuted(value) {
    muted = value;
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch { /* Gilt dann nur bis zum Neuladen. */ }
  }

  window.ImposterSound = { play, setMuted, isMuted: () => muted, defs };
})();
