// Turn an image's white sheet into transparency, optionally thickening linework
// first so drawings stay legible on the page's paper colour once downscaled.
//
// Per-crop options (crops.json):
//   "background": "clear"   every near-white neutral pixel becomes transparent,
//                           with a soft ramp so anti-aliased edges stay smooth.
//                           For 2D drawings, where white is only the paper.
//   "background": "cutout"  only near-white pixels connected to the image border
//                           become transparent, so white surfaces inside an object
//                           (a white roof, white massing) keep their colour.
//                           For 3D views, renders and photos on a white backdrop.
//   "cutoutMin": v          lowest channel value counted as backdrop in "cutout"
//                           (default 240; lower it for an off-white photo backdrop).
//   "thicken": n            before clearing, grow dark linework by n px per side
//                           (each pixel takes its darkest neighbour within n px;
//                           no new colours are introduced).
//
// Colours are never changed: pixels keep their RGB, only alpha is added, and
// coloured fills stay fully opaque. Works on raw RGB buffers.

const NEUTRAL = 12; // max channel spread for a pixel to count as grey/white

/** Each pixel takes the RGB of its darkest neighbour within r px (separable). */
export function thicken(data, width, height, r) {
  if (!r) return data;
  const lum = (buf, i) => buf[i] * 299 + buf[i + 1] * 587 + buf[i + 2] * 114;
  const pass = (src, horizontal) => {
    const out = Buffer.alloc(src.length);
    const len = horizontal ? width : height;
    const lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < len; k++) {
        let best = -1;
        let bestLum = Infinity;
        for (let d = Math.max(0, k - r); d <= Math.min(len - 1, k + r); d++) {
          const i = (horizontal ? line * width + d : d * width + line) * 3;
          const l = lum(src, i);
          if (l < bestLum) {
            bestLum = l;
            best = i;
          }
        }
        const o = (horizontal ? line * width + k : k * width + line) * 3;
        out[o] = src[best];
        out[o + 1] = src[best + 1];
        out[o + 2] = src[best + 2];
      }
    }
    return out;
  };
  return pass(pass(data, true), false);
}

/** RGB buffer -> RGBA buffer with the white sheet made transparent. */
export function clearWhite(data, width, height, mode, cutoutMin = 240) {
  const n = width * height;
  const out = Buffer.alloc(n * 4);
  const minC = (p) => Math.min(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]);
  const spread = (p) => Math.max(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]) - minC(p);
  const alpha = new Uint8Array(n).fill(255);

  if (mode === 'clear') {
    // Fully clear at >= 250, fully opaque at <= 232 (below the paper tone).
    for (let p = 0; p < n; p++) {
      const m = minC(p);
      if (m >= 250) alpha[p] = 0;
      else if (m > 232 && spread(p) <= NEUTRAL) alpha[p] = Math.round(((250 - m) / 18) * 255);
    }
  } else if (mode === 'cutout') {
    // Flood from the border through near-white neutral pixels.
    const inBg = (p) => minC(p) >= cutoutMin && spread(p) <= NEUTRAL;
    const seen = new Uint8Array(n);
    const stack = [];
    const push = (p) => {
      if (!seen[p] && inBg(p)) {
        seen[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < width; x++) {
      push(x);
      push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      push(y * width);
      push(y * width + width - 1);
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      // Ramp from opaque at the threshold to clear at 250+.
      alpha[p] = Math.round(Math.max(0, Math.min(1, (250 - minC(p)) / (250 - cutoutMin + 1))) * 255);
      if (x > 0) push(p - 1);
      if (x < width - 1) push(p + 1);
      if (p >= width) push(p - width);
      if (p < n - width) push(p + width);
    }
  } else {
    throw new Error(`Unknown background mode "${mode}"`);
  }

  for (let p = 0; p < n; p++) {
    out[p * 4] = data[p * 3];
    out[p * 4 + 1] = data[p * 3 + 1];
    out[p * 4 + 2] = data[p * 3 + 2];
    out[p * 4 + 3] = alpha[p];
  }
  return out;
}

/**
 * Apply a crop's background/thicken options to an opaque image.
 * Takes and returns { data, info } raw buffers (3 channels in, 4 out).
 */
export function applyBackground({ data, info }, crop) {
  if (!crop.background) return { data, info };
  const rgb = thicken(data, info.width, info.height, crop.thicken ?? 0);
  return {
    data: clearWhite(rgb, info.width, info.height, crop.background, crop.cutoutMin),
    info: { width: info.width, height: info.height, channels: 4 },
  };
}
