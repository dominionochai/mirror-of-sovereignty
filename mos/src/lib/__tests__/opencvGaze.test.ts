import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { CalibrationManager, CALIBRATION_TARGETS, type CalibrationSample } from "../calibration";
import { EMASmooth } from "../emaSmooth";
import { HomographyCalibration } from "../homographyCalibration";
import { OneEuroSmooth } from "../oneEuroSmooth";
import { loadOpenCv, type OpenCv } from "../opencvVision";

const SCREEN = { width: 1440, height: 900 };

/** A projective "eye to screen" relationship, with the foreshortening a real eye shows toward the screen edges. */
function trueGaze(ix: number, iy: number) {
  const h = [1800, 120, -300, -90, 1250, -140, 0.35, 0.28, 0.55];
  const w = h[6] * ix + h[7] * iy + h[8];
  return { x: (h[0] * ix + h[1] * iy + h[2]) / w, y: (h[3] * ix + h[4] * iy + h[5]) / w };
}

/** Inverse by search: the iris ratio that lands on a target, found by Newton iterations on the true mapping. */
function irisFor(target: { x: number; y: number }) {
  let ix = 0.5;
  let iy = 0.5;
  for (let i = 0; i < 60; i += 1) {
    const g = trueGaze(ix, iy);
    const e = 1e-5;
    const gx = trueGaze(ix + e, iy);
    const gy = trueGaze(ix, iy + e);
    const a = (gx.x - g.x) / e, b = (gy.x - g.x) / e, c = (gx.y - g.y) / e, d = (gy.y - g.y) / e;
    const det = a * d - b * c;
    const rx = target.x - g.x, ry = target.y - g.y;
    ix += (d * rx - b * ry) / det;
    iy += (-c * rx + a * ry) / det;
  }
  return { ix, iy };
}

const samples: CalibrationSample[] = CALIBRATION_TARGETS.map((t) => {
  const screenX = t.x * SCREEN.width, screenY = t.y * SCREEN.height;
  const { ix, iy } = irisFor({ x: screenX, y: screenY });
  return { screenX, screenY, irisX: ix, irisY: iy };
});

describe("HomographyCalibration (OpenCV findHomography)", () => {
  let cv: OpenCv;
  before(async () => { cv = await loadOpenCv(); });

  it("is not ready until it has four samples", () => {
    const calibration = new HomographyCalibration(cv);
    samples.slice(0, 3).forEach((s) => calibration.addSample(s));
    assert.equal(calibration.isReady, false);
    assert.equal(calibration.apply(0.5, 0.5), null);
    calibration.addSample(samples[3]);
    assert.equal(calibration.isReady, true);
  });

  it("maps the calibration points back onto their targets", () => {
    const calibration = new HomographyCalibration(cv);
    samples.forEach((s) => calibration.addSample(s));
    for (const s of samples) {
      const mapped = calibration.apply(s.irisX, s.irisY)!;
      assert.ok(Math.hypot(mapped.x - s.screenX, mapped.y - s.screenY) < 1, `${mapped.x},${mapped.y} vs ${s.screenX},${s.screenY}`);
    }
  });

  it("beats the affine fit away from the calibration points", () => {
    const homography = new HomographyCalibration(cv);
    const affine = new CalibrationManager();
    samples.forEach((s) => { homography.addSample(s); affine.addSample(s); });

    const error = (apply: (x: number, y: number) => { x: number; y: number } | null) => {
      let total = 0, count = 0, worst = 0;
      for (let tx = 0.05; tx <= 0.95; tx += 0.1) {
        for (let ty = 0.05; ty <= 0.95; ty += 0.1) {
          const target = { x: tx * SCREEN.width, y: ty * SCREEN.height };
          const { ix, iy } = irisFor(target);
          const mapped = apply(ix, iy)!;
          const e = Math.hypot(mapped.x - target.x, mapped.y - target.y);
          total += e; count += 1; worst = Math.max(worst, e);
        }
      }
      return { mean: total / count, worst };
    };
    const h = error((x, y) => homography.apply(x, y));
    const a = error((x, y) => affine.apply(x, y));
    console.log(`calibration error over a 10x10 grid (px): homography mean ${h.mean.toFixed(1)} / worst ${h.worst.toFixed(1)}; affine mean ${a.mean.toFixed(1)} / worst ${a.worst.toFixed(1)}`);
    assert.ok(h.mean < a.mean, "homography should be more accurate on a projective mapping");
    assert.ok(h.mean < 5, `homography mean ${h.mean}`);
  });

  it("resets", () => {
    const calibration = new HomographyCalibration(cv);
    samples.forEach((s) => calibration.addSample(s));
    calibration.reset();
    assert.equal(calibration.isReady, false);
    assert.equal(calibration.sampleCount, 0);
  });
});

describe("OneEuroSmooth", () => {
  /** Gaussian noise from a seeded generator. */
  function noise(seed: number) {
    let s = seed;
    const uniform = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    return () => Math.sqrt(-2 * Math.log(uniform() + 1e-9)) * Math.cos(2 * Math.PI * uniform());
  }

  /**
   * Fixation, a fast saccade (800 px in ten frames), then another fixation, at 30 fps with 40 px of
   * tracker noise. Returns jitter while fixating and how many frames after the saccade the output
   * is within 100 px of the target.
   */
  function scenario(make: (clock: { t: number }) => { update(x: number, y: number): { x: number; y: number } }, seed: number) {
    const clock = { t: 0 };
    const smoother = make(clock);
    const gauss = noise(seed);
    let fixationSse = 0, rawSse = 0, fixationFrames = 0, settle = -1;
    for (let frame = 0; frame < 150; frame += 1) {
      clock.t = frame * (1000 / 30);
      const truth = frame < 60 ? 300 : frame < 70 ? 300 + (frame - 60) * 80 : 1100;
      const measured = truth + gauss() * 40;
      const out = smoother.update(measured, 500).x;
      if (frame < 55 || frame >= 100) {
        fixationSse += (out - truth) ** 2; rawSse += (measured - truth) ** 2; fixationFrames += 1;
      }
      if (frame >= 70 && settle < 0 && Math.abs(out - truth) < 100) settle = frame - 70;
    }
    return { jitter: Math.sqrt(fixationSse / fixationFrames), rawJitter: Math.sqrt(rawSse / fixationFrames), settle };
  }

  const average = (make: Parameters<typeof scenario>[0]) => {
    const runs = [1, 2, 3, 4, 5, 6].map((seed) => scenario(make, seed));
    const mean = (key: "jitter" | "rawJitter" | "settle") => runs.reduce((sum, run) => sum + run[key], 0) / runs.length;
    return { jitter: mean("jitter"), rawJitter: mean("rawJitter"), settle: mean("settle") };
  };

  it("hides jitter while fixating yet follows a saccade, unlike the old fixed-weight average", () => {
    const euro = average((clock) => new OneEuroSmooth({ now: () => clock.t }));
    const ema = average(() => new EMASmooth(0.12));
    console.log(`fixation jitter (px RMSE): raw ${euro.rawJitter.toFixed(1)}, EMA ${ema.jitter.toFixed(1)}, 1-Euro ${euro.jitter.toFixed(1)}; frames to catch a saccade: EMA ${ema.settle.toFixed(1)}, 1-Euro ${euro.settle.toFixed(1)}`);
    assert.ok(euro.jitter < euro.rawJitter * 0.6, "should cut jitter by at least 40%");
    assert.ok(euro.settle <= 2, `settle ${euro.settle}`);
    assert.ok(euro.settle < ema.settle / 3, "should catch a saccade much sooner than EMA");
  });

  it("restarts after a long pause and can be reset", () => {
    const clock = { t: 0 };
    const smoother = new OneEuroSmooth({ now: () => clock.t });
    smoother.update(100, 100);
    clock.t = 5000;
    assert.deepEqual(smoother.update(900, 700), { x: 900, y: 700 });
    smoother.reset();
    clock.t = 5010;
    assert.deepEqual(smoother.update(10, 20), { x: 10, y: 20 });
  });
});
