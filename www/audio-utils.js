// Small audio helpers shared by the app and the demo backend.

export const BARS = 44;

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A believable-looking waveform for memos that don't have recorded levels.
export function seededPeaks(seed) {
  const r = rng(seed * 7919);
  const out = [];
  let v = .4;
  for (let i = 0; i < BARS; i++) {
    v = Math.min(1, Math.max(.12, v + (r() - .5) * .55));
    out.push(+(v * (.6 + r() * .4)).toFixed(3));
  }
  return out;
}

// Babble-like placeholder audio, rendered offline to a WAV blob.
export async function synthMemo(seed, seconds) {
  const rate = 22050;
  const len = Math.ceil(rate * seconds);
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const r = rng(seed * 104729);
  let buf;
  if (Ctx) {
    const ctx = new Ctx(1, len, rate);
    const out = ctx.createGain();
    out.gain.value = .5;
    out.connect(ctx.destination);
    const base = 110 + r() * 110;
    let t = .15;
    while (t < seconds - .2) {
      const syll = .08 + r() * .18;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = base * (.85 + r() * .4);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * (.9 + r() * .2), t + syll);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 500 + r() * 1800;
      formant.Q.value = 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(.6, t + .02);
      g.gain.linearRampToValueAtTime(0, t + syll);
      osc.connect(formant).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + syll + .02);
      t += syll + (r() < .15 ? .35 + r() * .4 : .02 + r() * .06);
    }
    buf = (await ctx.startRendering()).getChannelData(0);
  } else {
    buf = new Float32Array(len);
  }
  return wavBlob(buf, rate);
}

function wavBlob(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

const AVATAR_COLORS = ['#c2553a', '#3b6fb6', '#8a4fb0', '#2f8a7a', '#b5791f', '#4e6b2f', '#a3456b', '#5560b8', '#2f6b4f'];
export function colorFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
