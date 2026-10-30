// Cloud / rain "density field" engine.
//
// Turns a handful of satellite / radar image frames into small numeric
// density grids (one Float32Array per frame per channel), estimates how the
// density moves between frames (block-matching optical flow), and renders a
// continuously interpolated animation by *advecting* density along that flow
// instead of cross-fading whole pictures. Cloud and rain masses therefore
// drift and morph from one frame's pattern into the next, and can be
// extrapolated a little past the newest frame (simple nowcast).
//
// Data model (also the hook for future 3D / paid-data work):
//   channel = { times: [ms...], grids: [Float32Array(W*H)...] }, values 0..1,
//   all channels share one W x H grid and one georeference (cell -> world px).
// Built-in channels: "cloud", "rain". Optional: "cloudTop" (shades cloud),
// "waterDensity" (modulates cloud opacity). Any other channel is simply
// interpolated and exposed through fieldsAt()/sample() for external
// renderers (e.g. a WebGL/three.js volume). Lightning strikes are point
// events drawn as decaying flashes on a separate canvas.
//
// Pure maths lives in CloudField.Core (no DOM) so it can be unit-tested.
(function (root) {
  "use strict";

  // ---------- Core (DOM-free) ----------
  const CLOUD_LO = 112; // Himawari Band 13 gray: clear sea ~100-115, cold tops ~197
  const CLOUD_HI = 185;
  const CLOUD_MIN_VALID = 60; // near-black = hot land / off-disk, not cloud

  function smoothstep(a, b, v) {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // Colder (brighter) IR cloud tops = thicker / higher cloud.
  // GIBS paints the very coldest tops in colour (cyan -> navy) instead of gray.
  function isColoured(r, g, b) { return Math.max(r, g, b) - Math.min(r, g, b) > 25 && b > r; }
  function cloudFromIR(r, a, g, b) {
    if (a < 8) return 0;
    if (g != null && isColoured(r, g, b)) return 1;
    if (r < CLOUD_MIN_VALID) return 0;
    return smoothstep(CLOUD_LO, CLOUD_HI, r);
  }
  // Heavy convective cloud ("rain" look): cyan = cold, navy = coldest.
  function rainFromIR(r, g, b, a) {
    if (a < 8 || !isColoured(r, g, b)) return 0;
    return Math.max(0.15, Math.min(1, 1.15 - (g + b) / 480));
  }

  // RainViewer "Universal Blue" palette: light cyan = drizzle, deepening blue
  // = moderate, then green/yellow/red = heavy. Returns approx. intensity 0..1.
  function rainFromRGBA(r, g, b, a) {
    if (a < 8) return 0;
    const al = a / 255;
    let i;
    if (b >= g && b >= r && r <= 140) {
      i = 0.12 + 0.43 * (1 - r / 140);
    } else {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      let hue = 0;
      if (mx !== mn) {
        if (mx === r) hue = 60 * (((g - b) / (mx - mn) + 6) % 6);
        else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
        else hue = 60 * ((r - g) / (mx - mn) + 4);
      }
      i = hue <= 120 ? 0.6 + 0.4 * (1 - hue / 120) : 1;
    }
    return Math.min(1, i) * al;
  }

  // Block-matching optical flow from grid A to grid B. Vectors are in grid
  // cells per A->B interval. Low-texture blocks get no vote of their own and
  // are filled from confident neighbours by weighted smoothing.
  function blockFlow(A, B, W, H, opts) {
    const bs = (opts && opts.block) || 8;
    const range = (opts && opts.range) || 5;
    const bw = Math.ceil(W / bs);
    const bh = Math.ceil(H / bs);
    let vx = new Float32Array(bw * bh);
    let vy = new Float32Array(bw * bh);
    let wt = new Float32Array(bw * bh);
    const side = 2 * range + 1;
    const sad = new Float32Array(side * side);

    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const x0 = bx * bs;
        const y0 = by * bs;
        const x1 = Math.min(W, x0 + bs);
        const y1 = Math.min(H, y0 + bs);
        const cnt = (x1 - x0) * (y1 - y0);
        let sumA = 0;
        let sumB = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) { sumA += A[y * W + x]; sumB += B[y * W + x]; }
        }
        if (sumA + sumB < 0.04 * cnt) continue; // empty sky in both frames

        let best = Infinity;
        let bi = range * side + range;
        for (let dy = -range; dy <= range; dy++) {
          for (let dx = -range; dx <= range; dx++) {
            let s = 0;
            let n = 0;
            for (let y = y0; y < y1; y++) {
              const yy = y + dy;
              if (yy < 0 || yy >= H) continue;
              for (let x = x0; x < x1; x++) {
                const xx = x + dx;
                if (xx < 0 || xx >= W) continue;
                s += Math.abs(A[y * W + x] - B[yy * W + xx]);
                n++;
              }
            }
            // Blocks sliding off the edge are penalised; small bias to rest.
            s = n ? s * (cnt / n) : 1e9;
            s += 0.003 * cnt * (dx * dx + dy * dy);
            const k = (dy + range) * side + dx + range;
            sad[k] = s;
            if (s < best) { best = s; bi = k; }
          }
        }
        const sad0 = sad[range * side + range];
        let mdx = (bi % side) - range;
        let mdy = Math.floor(bi / side) - range;
        // Parabolic sub-cell refinement.
        const cx = bi % side;
        const cy = Math.floor(bi / side);
        if (cx > 0 && cx < side - 1) {
          const l = sad[bi - 1];
          const r = sad[bi + 1];
          const d = l - 2 * best + r;
          if (d > 1e-6) mdx += Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d)));
        }
        if (cy > 0 && cy < side - 1) {
          const u = sad[bi - side];
          const dn = sad[bi + side];
          const d = u - 2 * best + dn;
          if (d > 1e-6) mdy += Math.max(-0.5, Math.min(0.5, (u - dn) / (2 * d)));
        }
        const k = by * bw + bx;
        vx[k] = mdx;
        vy[k] = mdy;
        // Confidence: how much better than "no motion" the best match is.
        wt[k] = Math.max(0.02, (sad0 - best) / cnt * 20);
      }
    }

    // Two passes of weighted 3x3 smoothing: removes outliers and spreads
    // motion into texture-less blocks.
    for (let pass = 0; pass < 2; pass++) {
      const nvx = new Float32Array(bw * bh);
      const nvy = new Float32Array(bw * bh);
      const nwt = new Float32Array(bw * bh);
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          let sx = 0;
          let sy = 0;
          let sw = 0;
          let cnt = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const x = bx + i;
              const y = by + j;
              if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
              const w = wt[y * bw + x];
              sx += vx[y * bw + x] * w;
              sy += vy[y * bw + x] * w;
              sw += w;
              cnt++;
            }
          }
          const k = by * bw + bx;
          if (sw > 0) { nvx[k] = sx / sw; nvy[k] = sy / sw; nwt[k] = sw / cnt; }
        }
      }
      vx = nvx; vy = nvy; wt = nwt;
    }
    return { bs, bw, bh, vx, vy };
  }

  // Upsample the block flow to one vector per cell (bilinear).
  function denseFlow(flow, W, H) {
    const out = new Float32Array(W * H * 2);
    const { bs, bw, bh, vx, vy } = flow;
    for (let y = 0; y < H; y++) {
      const gy = Math.max(0, Math.min(bh - 1, y / bs - 0.5));
      const y0 = Math.floor(gy);
      const y1 = Math.min(bh - 1, y0 + 1);
      const fy = gy - y0;
      for (let x = 0; x < W; x++) {
        const gx = Math.max(0, Math.min(bw - 1, x / bs - 0.5));
        const x0 = Math.floor(gx);
        const x1 = Math.min(bw - 1, x0 + 1);
        const fx = gx - x0;
        const a = y0 * bw + x0;
        const b = y0 * bw + x1;
        const c = y1 * bw + x0;
        const d = y1 * bw + x1;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const o = (y * W + x) * 2;
        out[o] = vx[a] * w00 + vx[b] * w10 + vx[c] * w01 + vx[d] * w11;
        out[o + 1] = vy[a] * w00 + vy[b] * w10 + vy[c] * w01 + vy[d] * w11;
      }
    }
    return out;
  }

  function bilinear(G, W, H, x, y) {
    if (x < 0) x = 0; else if (x > W - 1) x = W - 1;
    if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
    const x0 = x | 0;
    const y0 = y | 0;
    const x1 = x0 + 1 < W ? x0 + 1 : x0;
    const y1 = y0 + 1 < H ? y0 + 1 : y0;
    const fx = x - x0;
    const fy = y - y0;
    const top = G[y0 * W + x0] * (1 - fx) + G[y0 * W + x1] * fx;
    const bot = G[y1 * W + x0] * (1 - fx) + G[y1 * W + x1] * fx;
    return top * (1 - fy) + bot * fy;
  }

  // Field at fractional position t between A (t=0) and B (t=1): both frames
  // are pushed along the flow towards t, then blended, so density travels
  // rather than fading. `flowDense` is A->B in cells.
  function interpolate(out, A, B, flowDense, W, H, t) {
    const ta = t;
    const tb = 1 - t;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        const vx = flowDense[k * 2];
        const vy = flowDense[k * 2 + 1];
        const a = bilinear(A, W, H, x - ta * vx, y - ta * vy);
        const b = bilinear(B, W, H, x + tb * vx, y + tb * vy);
        out[k] = a * (1 - t) + b * t;
      }
    }
    return out;
  }

  // Past the newest frame: keep advecting it along the last flow, fading out.
  function extrapolate(out, B, flowDense, W, H, tPast, fade) {
    const f = Math.max(0, 1 - tPast / fade);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        out[k] = bilinear(B, W, H, x - tPast * flowDense[k * 2], y - tPast * flowDense[k * 2 + 1]) * (0.35 + 0.65 * f);
      }
    }
    return out;
  }

  // ---------- Channel: frames + flows + time sampling ----------
  class Channel {
    constructor(W, H, times, grids, opts) {
      this.W = W;
      this.H = H;
      this.times = times;
      this.grids = grids;
      this.flows = [];
      const o = opts || {};
      for (let i = 0; i + 1 < grids.length; i++) {
        this.flows.push(denseFlow(blockFlow(grids[i], grids[i + 1], W, H, o), W, H));
      }
      this.nowcastMs = o.nowcastMs != null ? o.nowcastMs : 30 * 60 * 1000;
    }
    get start() { return this.times[0]; }
    get end() { return this.times[this.times.length - 1]; }
    get last() { return this.grids.length - 1; }
    // Fills `out` with the field at absolute time tMs (clamped to the data
    // range plus the nowcast tail).
    fieldAt(out, tMs) {
      const n = this.grids.length;
      if (n === 1) { out.set(this.grids[0]); return out; }
      if (tMs <= this.times[0]) { out.set(this.grids[0]); return out; }
      if (tMs >= this.times[n - 1]) {
        const dt = this.times[n - 1] - this.times[n - 2];
        const past = Math.min(tMs - this.times[n - 1], this.nowcastMs);
        if (past <= 0 || !this.nowcastMs) { out.set(this.grids[n - 1]); return out; }
        return extrapolate(out, this.grids[n - 1], this.flows[n - 2], this.W, this.H, past / dt, this.nowcastMs / dt * 1.5);
      }
      let i = 0;
      while (i + 2 < n && tMs >= this.times[i + 1]) i++;
      const t = (tMs - this.times[i]) / (this.times[i + 1] - this.times[i]);
      return interpolate(out, this.grids[i], this.grids[i + 1], this.flows[i], this.W, this.H, t);
    }
  }

  // ---------- Layer (canvas renderer) ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  // rain intensity -> colour, matching the GIBS IR palette: cyan -> blue -> navy
  const RAIN_RAMP = [
    [0.0, 0, 220, 240],
    [0.35, 0, 168, 200],
    [0.6, 0, 100, 168],
    [0.8, 0, 48, 144],
    [1.0, 0, 8, 120],
  ];
  function rainColor(v, out) {
    for (let i = 1; i < RAIN_RAMP.length; i++) {
      if (v <= RAIN_RAMP[i][0] || i === RAIN_RAMP.length - 1) {
        const a = RAIN_RAMP[i - 1];
        const b = RAIN_RAMP[i];
        const t = Math.max(0, Math.min(1, (v - a[0]) / (b[0] - a[0])));
        out[0] = lerp(a[1], b[1], t);
        out[1] = lerp(a[2], b[2], t);
        out[2] = lerp(a[3], b[3], t);
        return out;
      }
    }
    return out;
  }

  // opts: { W, H, cellPx, x, y, loopMs, holdMs, minutesPerSecond, onTime, blur }
  //   W,H     grid size in cells; cellPx = CSS px per cell
  //   x,y     CSS offset of the layer's top-left inside the container
  function createLayer(container, opts) {
    const W = opts.W;
    const H = opts.H;
    const cellPx = opts.cellPx;
    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.width = W;
    cloudCanvas.height = H;
    const lightCanvas = document.createElement("canvas");
    lightCanvas.width = W * 2;
    lightCanvas.height = H * 2;
    for (const c of [cloudCanvas, lightCanvas]) {
      c.className = "cloudfield-canvas";
      c.style.cssText = `position:absolute;left:${opts.x || 0}px;top:${opts.y || 0}px;width:${W * cellPx}px;height:${H * cellPx}px;max-width:none;pointer-events:none;`;
    }
    cloudCanvas.style.filter = `blur(${opts.blur != null ? opts.blur : cellPx * 0.7}px)`;
    container.append(cloudCanvas, lightCanvas);
    const ctx = cloudCanvas.getContext("2d");
    const lctx = lightCanvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const channels = {};
    const buffers = {};
    const strikes = [];
    const rgb = [0, 0, 0];
    let raf = 0;
    let playStart = 0;
    let lastDraw = 0;
    let fixedTime = null;
    let tMin = Infinity;
    let tMax = -Infinity;
    let tEnd = -Infinity;
    const minutesPerSecond = opts.minutesPerSecond || 6;
    const holdMs = opts.holdMs != null ? opts.holdMs : 1500;

    function recomputeRange() {
      tMin = Infinity; tMax = -Infinity; tEnd = -Infinity;
      for (const k in channels) {
        const c = channels[k];
        tMin = Math.min(tMin, c.start);
        tMax = Math.max(tMax, c.end);
        tEnd = Math.max(tEnd, c.end + (c.grids.length > 1 ? c.nowcastMs : 0));
      }
    }

    // Every channel is sampled at the same instant; channels with shorter
    // history simply hold their first/last field.
    function fieldsAt(tMs) {
      const res = {};
      for (const k in channels) {
        if (!buffers[k]) buffers[k] = new Float32Array(W * H);
        res[k] = channels[k].fieldAt(buffers[k], tMs);
      }
      return res;
    }

    function draw(tMs) {
      const f = fieldsAt(tMs);
      const cloud = f.cloud;
      const rain = f.rain;
      const top = f.cloudTop;
      const water = f.waterDensity;
      const d = img.data;
      const cloudGain = opts.cloudGain != null ? opts.cloudGain : 0.95;
      for (let k = 0; k < W * H; k++) {
        let ac = cloud ? cloud[k] : 0;
        if (water) ac *= 0.5 + 0.8 * water[k];
        ac = Math.min(1, Math.pow(ac, 0.9) * cloudGain);
        const shade = top ? 225 + 30 * top[k] : 245;
        let ar = 0;
        if (rain) {
          const r = rain[k];
          ar = Math.min(1, r * 2.5);
          if (ar > 0.01) rainColor(r, rgb);
        }
        const ao = ar + ac * (1 - ar);
        const o = k * 4;
        if (ao <= 0.003) { d[o + 3] = 0; continue; }
        d[o] = (rgb[0] * ar + shade * ac * (1 - ar)) / ao;
        d[o + 1] = (rgb[1] * ar + shade * ac * (1 - ar)) / ao;
        d[o + 2] = (rgb[2] * ar + (shade + 5) * ac * (1 - ar)) / ao;
        d[o + 3] = ao * 255;
      }
      ctx.putImageData(img, 0, 0);
      drawLightning(tMs);
      if (opts.onTime) opts.onTime(tMs, tMs > tMax);
    }

    function drawLightning(tMs) {
      lctx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
      if (!strikes.length) return;
      lctx.globalCompositeOperation = "lighter";
      for (const s of strikes) {
        const age = tMs - s.t;
        if (age < 0 || age > 4 * 60 * 1000) continue;
        const a = Math.max(0, 1 - age / (4 * 60 * 1000));
        const flash = age < 2500 ? 1 : 0; // bright core for a moment
        const px = s.x * 2;
        const py = s.y * 2;
        const r = (2 + 3 * (s.energy || 0.5)) * (1 + flash);
        const g = lctx.createRadialGradient(px, py, 0, px, py, r * 2);
        g.addColorStop(0, `rgba(255,250,200,${0.25 + 0.6 * a * (flash ? 1 : 0.5)})`);
        g.addColorStop(1, "rgba(255,230,120,0)");
        lctx.fillStyle = g;
        lctx.fillRect(px - r * 2, py - r * 2, r * 4, r * 4);
      }
      lctx.globalCompositeOperation = "source-over";
    }

    function loopTime(now) {
      const spanMs = tEnd - tMin;
      const playMs = spanMs / (minutesPerSecond * 60 * 1000 / 1000);
      const cycle = playMs + holdMs;
      const e = (now - playStart) % cycle;
      return tMin + Math.min(e, playMs) / playMs * spanMs;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < 33) return; // ~30 fps is plenty for drifting cloud
      lastDraw = now;
      draw(fixedTime != null ? fixedTime : loopTime(now));
    }

    return {
      // Replace/add a channel. grids: array of Float32Array(W*H) at `times`.
      setChannel(name, times, grids, chOpts) {
        channels[name] = new Channel(W, H, times, grids, chOpts);
        recomputeRange();
      },
      hasChannels() { return Object.keys(channels).length > 0; },
      // Lightning: [{ t: ms, x: cellX, y: cellY, energy: 0..1 }]; cell coords
      // via the same georeference as the grids.
      setStrikes(list) { strikes.length = 0; strikes.push(...list); },
      fieldsAt,
      // Value of a channel at a grid position and time (bilinear).
      sample(name, x, y, tMs) {
        const c = channels[name];
        if (!c) return 0;
        if (!buffers[name]) buffers[name] = new Float32Array(W * H);
        return bilinear(c.fieldAt(buffers[name], tMs), W, H, x, y);
      },
      timeRange() { return { start: tMin, observedEnd: tMax, end: tEnd }; },
      drawAt(tMs) { fixedTime = tMs; draw(tMs); },
      // animate=false: show the newest observation, static.
      start(animate) {
        cancelAnimationFrame(raf);
        if (!isFinite(tMin)) return;
        if (!animate) { fixedTime = tMax; draw(tMax); return; }
        fixedTime = null;
        playStart = performance.now();
        raf = requestAnimationFrame(frame);
      },
      stop() { cancelAnimationFrame(raf); raf = 0; },
      destroy() { cancelAnimationFrame(raf); cloudCanvas.remove(); lightCanvas.remove(); },
    };
  }

  const CloudField = {
    Core: { smoothstep, cloudFromIR, rainFromIR, rainFromRGBA, blockFlow, denseFlow, interpolate, extrapolate, bilinear, Channel },
    createLayer,
  };
  root.CloudField = CloudField;
  if (typeof module !== "undefined" && module.exports) module.exports = CloudField;
})(typeof window !== "undefined" ? window : globalThis);
