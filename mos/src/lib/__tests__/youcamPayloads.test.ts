import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_FACE, faceFromLandmarks } from "../tryon/face";
import type { ResolvedLookEntry } from "../tryon/renderer";
import { buildClothBody, buildHairColorBody, buildMakeupBody, extractResultUrl } from "../tryon/youcamPayloads";

const entry = (over: Partial<ResolvedLookEntry>): ResolvedLookEntry => ({
  slot: "hair/color", categoryId: "hair", groupId: "color", optionId: "hair-auburn", label: "Auburn Red",
  color: "#8B2E1F", intensity: 60, ...over,
});

describe("hair colour body", () => {
  it("uses a full pattern with one palette and the chosen intensity", () => {
    assert.deepEqual(buildHairColorBody(entry({})), {
      pattern: { name: "full" },
      palettes: [{ color: "#8B2E1F", color_intensity: 60, shine_intensity: 30 }],
    });
  });

  it("clamps intensity and rejects non-hex colours", () => {
    assert.equal(buildHairColorBody(entry({ intensity: 250 })).palettes[0].color_intensity, 100);
    assert.throws(() => buildHairColorBody(entry({ color: "red" })));
  });
});

describe("makeup body", () => {
  it("builds the documented effect shapes for lips, eyes and blush", () => {
    const body = buildMakeupBody([
      entry({ slot: "makeup/lips", categoryId: "makeup", groupId: "lips", color: "#B3123C", intensity: 80 }),
      entry({ slot: "makeup/eyes", categoryId: "makeup", groupId: "eyes", color: "#2B2B33", intensity: 40 }),
      entry({ slot: "makeup/blush", categoryId: "makeup", groupId: "blush", color: "#F4A58A", intensity: 55 }),
    ]);
    assert.equal(body.version, "1.0");
    assert.deepEqual(body.effects, [
      { category: "lip_color", shape: { name: "original" }, style: { type: "full" }, palettes: [{ color: "#B3123C", texture: "matte", colorIntensity: 80 }] },
      { category: "eye_shadow", pattern: { name: "1color1" }, palettes: [{ color: "#2B2B33", texture: "matte", colorIntensity: 40 }] },
      { category: "blush", pattern: { name: "1color1" }, palettes: [{ color: "#F4A58A", texture: "matte", colorIntensity: 55 }] },
    ]);
  });

  it("ignores groups that are not makeup and rejects bad colours", () => {
    assert.deepEqual(buildMakeupBody([entry({ groupId: "color" })]).effects, []);
    assert.throws(() => buildMakeupBody([entry({ groupId: "lips", color: "red" })]));
  });
});

describe("helpers", () => {
  it("builds a cloth body", () => {
    assert.deepEqual(buildClothBody("https://x/y.png", "auto"), { ref_file_url: "https://x/y.png", garment_category: "auto" });
  });

  it("reads the result URL in both documented shapes", () => {
    assert.equal(extractResultUrl({ results: { url: "https://a" } }), "https://a");
    assert.equal(extractResultUrl({ results: [{ download_url: "https://b" }] }), "https://b");
    assert.equal(extractResultUrl({ results: [] }), null);
    assert.equal(extractResultUrl(null), null);
  });
});

describe("faceFromLandmarks", () => {
  it("returns null without enough landmarks", () => {
    assert.equal(faceFromLandmarks(null), null);
    assert.equal(faceFromLandmarks(new Float32Array(10)), null);
    assert.equal(faceFromLandmarks(new Float32Array(478 * 2)), null);
  });

  it("reads eyes, mouth and outline from a synthetic mesh and orders left before right", () => {
    const L = new Float32Array(478 * 2);
    const set = (i: number, x: number, y: number) => { L[2 * i] = x; L[2 * i + 1] = y; };
    // Subject's right eye (image left) around x=0.4, left eye around x=0.6, y=0.43.
    for (const i of [33, 133, 159, 145]) set(i, 0.4, 0.43);
    for (const i of [263, 362, 386, 374]) set(i, 0.6, 0.43);
    set(61, 0.57, 0.66); set(291, 0.43, 0.66); set(0, 0.5, 0.645); set(17, 0.5, 0.685);
    set(10, 0.5, 0.2); set(152, 0.5, 0.85); set(234, 0.7, 0.5); set(454, 0.3, 0.5);
    const face = faceFromLandmarks(L);
    assert.ok(face);
    assert.ok(face.leftEye.x < face.rightEye.x);
    assert.ok(face.mouth.left.x < face.mouth.right.x);
    assert.ok(face.cheekLeft.x < face.cheekRight.x);
    assert.ok(Math.abs(face.leftEye.x - 0.4) < 1e-6);
    assert.equal(face.chin.y, Math.fround(0.85));
  });

  it("has a sane default face", () => {
    assert.ok(DEFAULT_FACE.leftEye.x < DEFAULT_FACE.rightEye.x);
    assert.ok(DEFAULT_FACE.chin.y > DEFAULT_FACE.forehead.y);
  });
});
