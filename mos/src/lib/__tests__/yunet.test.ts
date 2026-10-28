import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { loadOpenCv, type OpenCv } from "../opencvVision";
import { normalizeYuNetFace, parseYuNetRows, YuNetDetector } from "../yunet";

const MODEL = readFileSync("public/models/face_detection_yunet_2023mar.onnx");

describe("parseYuNetRows", () => {
  // One real detection row from YuNet on a 512x512 photo of a face.
  const row = [207.8, 183, 145.7, 206.4, 271.7, 269.4, 328.5, 276.3, 309.6, 313, 270.7, 341.9, 311.2, 348.4, 0.9];

  it("maps columns to a face", () => {
    const [face] = parseYuNetRows(row, 1);
    assert.deepEqual(face.box, { x: 207.8, y: 183, width: 145.7, height: 206.4 });
    assert.deepEqual(face.rightEye, { x: 271.7, y: 269.4 });
    assert.deepEqual(face.leftEye, { x: 328.5, y: 276.3 });
    assert.deepEqual(face.nose, { x: 309.6, y: 313 });
    assert.equal(face.score, 0.9);
  });

  it("scales coordinates back up but never the score", () => {
    const [face] = parseYuNetRows(row, 1, 2);
    assert.equal(face.box.x, 415.6);
    assert.equal(face.leftMouth.y, 696.8);
    assert.equal(face.score, 0.9);
  });

  it("normalises a face to fractions of the image", () => {
    const [face] = parseYuNetRows(row, 1);
    const unit = normalizeYuNetFace(face, 512, 512);
    assert.ok(Math.abs(unit.box.x - 207.8 / 512) < 1e-12 && Math.abs(unit.nose.y - 313 / 512) < 1e-12);
    assert.equal(unit.score, 0.9);
  });

  it("reads several rows", () => {
    assert.equal(parseYuNetRows([...row, ...row], 2).length, 2);
    assert.deepEqual(parseYuNetRows([], 0), []);
  });
});

describe("YuNetDetector (OpenCV FaceDetectorYN)", () => {
  let cv: OpenCv;
  before(async () => { cv = await loadOpenCv(); });

  it("loads the bundled model and finds no face in a blank frame", () => {
    const detector = YuNetDetector.create(cv, new Uint8Array(MODEL));
    const blank = new cv.Mat(120, 160, cv.CV_8UC3, new cv.Scalar(128, 128, 128));
    try {
      assert.deepEqual(detector.detectMat(blank), []);
      // A second call at the same size reuses the input size.
      assert.deepEqual(detector.detectMat(blank), []);
    } finally {
      blank.delete();
      detector.dispose();
    }
  });

  it("copes with a changing frame size", () => {
    const detector = YuNetDetector.create(cv, new Uint8Array(MODEL));
    const small = new cv.Mat(96, 128, cv.CV_8UC3, new cv.Scalar(40, 40, 40));
    const large = new cv.Mat(240, 320, cv.CV_8UC3, new cv.Scalar(200, 200, 200));
    try {
      assert.deepEqual(detector.detectMat(small), []);
      assert.deepEqual(detector.detectMat(large), []);
    } finally {
      small.delete();
      large.delete();
      detector.dispose();
    }
  });

  it("reports a clear error when the OpenCV build lacks the detector", () => {
    const withoutDetector = { ...cv, FaceDetectorYN: undefined } as unknown as OpenCv;
    assert.throws(() => YuNetDetector.create(withoutDetector, new Uint8Array(MODEL)), /FaceDetectorYN/);
  });
});
