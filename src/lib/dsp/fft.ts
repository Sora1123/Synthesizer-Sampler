/**
 * Minimal, dependency-free radix-2 Cooley–Tukey FFT plus spectrum helpers.
 * Used by both the synthesis spectrum view and the reference audio analysis.
 */

/** In-place iterative radix-2 FFT. re/im length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wpr = Math.cos(ang);
    const wpi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const iEven = i + k;
        const iOdd = i + k + len / 2;
        const tr = wr * re[iOdd] - wi * im[iOdd];
        const ti = wr * im[iOdd] + wi * re[iOdd];
        re[iOdd] = re[iEven] - tr;
        im[iOdd] = im[iEven] - ti;
        re[iEven] += tr;
        im[iEven] += ti;
        const wtemp = wr;
        wr = wr * wpr - wi * wpi;
        wi = wtemp * wpi + wi * wpr;
      }
    }
  }
}

/** Next power of two >= n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Hann window value at index i of size N. */
export function hann(i: number, N: number): number {
  return 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
}

export interface Spectrum {
  /** magnitude per bin (linear) */
  magnitudes: Float32Array;
  /** frequency of each bin in Hz */
  freqs: Float32Array;
  sampleRate: number;
  fftSize: number;
}

/**
 * Compute a single windowed magnitude spectrum from a segment of samples.
 * Applies a Hann window and zero-pads to the next power of two.
 */
export function computeSpectrum(
  samples: Float32Array,
  sampleRate: number,
  fftSize?: number,
  offset = 0,
): Spectrum {
  const desired = fftSize ?? nextPow2(Math.min(samples.length, 8192));
  const N = desired;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const count = Math.min(N, samples.length - offset);
  for (let i = 0; i < count; i++) {
    re[i] = samples[offset + i] * hann(i, N);
  }
  fft(re, im);

  const half = N / 2;
  const magnitudes = new Float32Array(half);
  const freqs = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    magnitudes[i] = Math.hypot(re[i], im[i]) / (N / 2);
    freqs[i] = (i * sampleRate) / N;
  }
  return { magnitudes, freqs, sampleRate, fftSize: N };
}

/**
 * Average magnitude spectrum over the whole signal (STFT magnitude average).
 * Gives a stable spectral picture for steady-ish notes.
 */
export function averageSpectrum(
  samples: Float32Array,
  sampleRate: number,
  fftSize = 4096,
  hop = 2048,
): Spectrum {
  const half = fftSize / 2;
  const acc = new Float32Array(half);
  let frames = 0;
  for (let off = 0; off + fftSize <= samples.length; off += hop) {
    const s = computeSpectrum(samples, sampleRate, fftSize, off);
    for (let i = 0; i < half; i++) acc[i] += s.magnitudes[i];
    frames++;
  }
  if (frames === 0) {
    // signal shorter than one frame — just do one zero-padded transform.
    return computeSpectrum(samples, sampleRate, fftSize, 0);
  }
  for (let i = 0; i < half; i++) acc[i] /= frames;
  const freqs = new Float32Array(half);
  for (let i = 0; i < half; i++) freqs[i] = (i * sampleRate) / fftSize;
  return { magnitudes: acc, freqs, sampleRate, fftSize };
}

/** Convert linear magnitude to dB (with floor). */
export function toDb(mag: number, floor = -100): number {
  const db = 20 * Math.log10(mag + 1e-12);
  return db < floor ? floor : db;
}
