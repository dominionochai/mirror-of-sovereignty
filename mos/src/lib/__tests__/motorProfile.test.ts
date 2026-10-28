import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_DWELL_MS, MIN_DWELL_MS, blinkSelectSafe, buildProfile, dispersion, dwellForStability, gazeStability,
  presetProfile, safeZoneFromReach, targetScaleForStability, toleranceForStability, type GazeSample,
} from "../motor/profile";

const SCREEN = { width: 1000, height: 800 };

function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Samples around (500,400) with uniform jitter of +-amplitude px, 60 Hz. */
function fixation(amplitude: number, ms: number, seed = 1): GazeSample[] {
  const random = rng(seed);
  const out: GazeSample[] = [];
  for (let t = 0; t < ms; t += 16) {
    out.push({ t, x: 500 + (random() * 2 - 1) * amplitude, y: 400 + (random() * 2 - 1) * amplitude });
  }
  return out;
}

describe("dispersion and stability", () => {
  it("is zero for a perfectly still gaze", () => {
    assert.equal(dispersion(fixation(0, 1000)), 0);
    assert.equal(gazeStability(fixation(0, 2000)), 0);
  });

  it("grows with jitter", () => {
    const steady = gazeStability(fixation(3, 2000));
    const shaky = gazeStability(fixation(40, 2000));
    assert.ok(shaky > steady * 5, `${shaky} should be much larger than ${steady}`);
  });

  it("ignores a single lost-tracking spike", () => {
    const samples = fixation(3, 3000);
    samples[100] = { t: samples[100].t, x: 5000, y: 5000 };
    assert.ok(gazeStability(samples) < 15);
  });
});

describe("adaptation curves", () => {
  it("keeps dwell within 400-1200 ms and increases with instability", () => {
    assert.equal(dwellForStability(0), MIN_DWELL_MS);
    assert.equal(dwellForStability(500), MAX_DWELL_MS);
    assert.ok(dwellForStability(30) > dwellForStability(15));
  });

  it("scales targets up for unsteady gaze", () => {
    assert.equal(targetScaleForStability(0), 1);
    assert.equal(targetScaleForStability(500), 1.6);
  });

  it("labels tolerance", () => {
    assert.equal(toleranceForStability(5), "low");
    assert.equal(toleranceForStability(30), "medium");
    assert.equal(toleranceForStability(50), "high");
  });
});

describe("blink selection", () => {
  it("is allowed when natural blinks are rare and refused when frequent", () => {
    assert.equal(blinkSelectSafe(0, 2000), true);
    assert.equal(blinkSelectSafe(1, 2000), true);
    assert.equal(blinkSelectSafe(3, 2000), false);
    assert.equal(blinkSelectSafe(0, 0), false);
  });
});

describe("safe zone", () => {
  it("falls back to the full screen without data", () => {
    assert.deepEqual(safeZoneFromReach([], SCREEN), { left: 0, top: 0, right: 1000, bottom: 800 });
  });

  it("shrinks to the area the user actually reached, never below the minimum", () => {
    const narrow: GazeSample[] = Array.from({ length: 50 }, (_, i) => ({ t: i, x: 480 + (i % 5) * 10, y: 390 + (i % 4) * 10 }));
    const zone = safeZoneFromReach(narrow, SCREEN);
    assert.ok(zone.right - zone.left >= 450 - 1e-6);
    assert.ok(zone.bottom - zone.top >= 360 - 1e-6);
  });

  it("covers a wide reach", () => {
    const wide: GazeSample[] = Array.from({ length: 100 }, (_, i) => ({ t: i, x: (i / 99) * 1000, y: (i / 99) * 800 }));
    const zone = safeZoneFromReach(wide, SCREEN);
    assert.ok(zone.right - zone.left > 800);
  });
});

describe("buildProfile and presets", () => {
  it("produces a relaxed profile for steady gaze and a protective one for tremor", () => {
    const reach = Array.from({ length: 100 }, (_, i) => ({ t: i, x: (i / 99) * 1000, y: (i / 99) * 800 }));
    const steady = buildProfile({ fixation: fixation(3, 2000), reach, spuriousBlinks: 0, fixationMs: 2000, screen: SCREEN });
    const tremor = buildProfile({ fixation: fixation(60, 2000, 7), reach, spuriousBlinks: 4, fixationMs: 2000, screen: SCREEN });
    assert.ok(steady.dwellMs < tremor.dwellMs);
    assert.ok(steady.targetScale < tremor.targetScale);
    assert.equal(steady.blinkSelect, true);
    assert.equal(tremor.blinkSelect, false);
    assert.equal(tremor.tolerance, "high");
  });

  it("presets are ordered by severity", () => {
    const a = presetProfile("steady", SCREEN);
    const b = presetProfile("moderate", SCREEN);
    const c = presetProfile("high", SCREEN);
    assert.ok(a.dwellMs < b.dwellMs && b.dwellMs < c.dwellMs);
    assert.ok(a.reachPct > b.reachPct && b.reachPct > c.reachPct);
  });
});
