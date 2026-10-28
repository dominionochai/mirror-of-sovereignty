import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { findGlint, fitPupilEllipse, loadOpenCv, type OpenCv } from "../opencvVision";

/** Node has no canvas: a fake one carries raw pixels, and `imread` is shimmed to read them. */
interface FakeCanvas {
  width: number;
  height: number;
  imageData: { data: Uint8ClampedArray; width: number; height: number };
}

function makeCrop(size: number, background: number, draw: (put: (x: number, y: number, value: number) => void) => void): FakeCanvas {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = background;
    data[i * 4 + 3] = 255;
  }
  draw((x, y, value) => {
    const i = (Math.round(y) * size + Math.round(x)) * 4;
    data[i] = data[i + 1] = data[i + 2] = value;
  });
  return { width: size, height: size, imageData: { data, width: size, height: size } };
}

const asCanvas = (crop: FakeCanvas) => crop as unknown as HTMLCanvasElement;

describe("OpenCV eye analysis", () => {
  let cv: OpenCv;
  let originalImread: unknown;
  before(async () => {
    cv = await loadOpenCv();
    const shimmed = cv as unknown as { imread: (canvas: FakeCanvas) => unknown };
    originalImread = shimmed.imread;
    shimmed.imread = (canvas) => cv.matFromImageData(canvas.imageData);
  });
  after(() => {
    (cv as unknown as { imread: unknown }).imread = originalImread;
  });

  const disc = (cx: number, cy: number, r: number, value: number) => (put: (x: number, y: number, v: number) => void) => {
    for (let y = 0; y < 28; y += 1) for (let x = 0; x < 28; x += 1) if (Math.hypot(x - cx, y - cy) <= r) put(x, y, value);
  };

  describe("fitPupilEllipse", () => {
    it("finds a dark pupil on a lighter eye", () => {
      const fit = fitPupilEllipse(cv, asCanvas(makeCrop(28, 170, disc(14, 14, 7, 25))));
      assert.ok(fit);
      assert.ok(Math.hypot(fit.cx - 14, fit.cy - 14) < 1.5, `centre ${fit.cx},${fit.cy}`);
      assert.ok(Math.abs(fit.width - 14) < 3 && Math.abs(fit.height - 14) < 3, `size ${fit.width}x${fit.height}`);
    });

    it("follows the pupil when it moves within the crop", () => {
      const fit = fitPupilEllipse(cv, asCanvas(makeCrop(28, 170, disc(17, 12, 6, 25))));
      assert.ok(fit);
      assert.ok(Math.hypot(fit.cx - 17, fit.cy - 12) < 1.5, `centre ${fit.cx},${fit.cy}`);
    });

    it("returns null for a flat crop (closed eye or bare skin)", () => {
      assert.equal(fitPupilEllipse(cv, asCanvas(makeCrop(28, 170, () => undefined))), null);
    });

    it("ignores a dark blob far from the centre", () => {
      assert.equal(fitPupilEllipse(cv, asCanvas(makeCrop(28, 170, disc(3, 3, 3, 25)))), null);
    });

    it("does not leak or throw over many calls", () => {
      const crop = makeCrop(28, 170, disc(14, 14, 7, 25));
      for (let i = 0; i < 1500; i += 1) fitPupilEllipse(cv, asCanvas(crop));
    });
  });

  describe("findGlint", () => {
    const pupilWithGlint = makeCrop(28, 150, (put) => {
      disc(14, 14, 8, 30)(put);
      for (const [x, y] of [[13, 10], [14, 10], [13, 11], [14, 11]]) put(x, y, 255);
    });

    it("locates a corneal glint at its centre", () => {
      const glint = findGlint(cv, asCanvas(pupilWithGlint));
      assert.ok(glint);
      assert.ok(Math.hypot(glint.cx - 13.5, glint.cy - 10.5) < 0.6, `glint ${glint.cx},${glint.cy}`);
    });

    it("finds nothing without a bright reflection", () => {
      assert.equal(findGlint(cv, asCanvas(makeCrop(28, 150, disc(14, 14, 8, 30)))), null);
    });

    it("rejects a single hot pixel and a large bright area", () => {
      assert.equal(findGlint(cv, asCanvas(makeCrop(28, 90, (put) => put(5, 5, 255)))), null);
      assert.equal(findGlint(cv, asCanvas(makeCrop(28, 60, (put) => { for (let y = 0; y < 14; y += 1) for (let x = 0; x < 28; x += 1) put(x, y, 250); }))), null);
    });
  });
});
