import type { OpenCv } from "./opencvVision";
import type { Point2 } from "./headPose";

/** Where the app serves the model from. */
export const YUNET_MODEL_URL = "/models/face_detection_yunet_2023mar.onnx";

/** Detection thresholds: confident faces only, with overlapping boxes merged. */
const SCORE_THRESHOLD = 0.8;
const NMS_THRESHOLD = 0.3;
const TOP_K = 5;
/** Each face is a row of: box x, y, w, h, five (x, y) landmark pairs, then the score. */
const FACE_COLUMNS = 15;

/** A face found by OpenCV's YuNet detector, in the pixel coordinates of the image that was searched. */
export interface YuNetFace {
  box: { x: number; y: number; width: number; height: number };
  /** The subject's right eye, which appears on the image's left. */
  rightEye: Point2;
  /** The subject's left eye, which appears on the image's right. */
  leftEye: Point2;
  nose: Point2;
  rightMouth: Point2;
  leftMouth: Point2;
  /** Detection confidence, 0-1. */
  score: number;
}

/**
 * Converts the detector's output rows into faces. `scale` maps from the size
 * the image was searched at back to the size it should be reported in.
 */
export function parseYuNetRows(data: ArrayLike<number>, rows: number, scale = 1): YuNetFace[] {
  const faces: YuNetFace[] = [];
  for (let row = 0; row < rows; row += 1) {
    const at = (column: number) => data[row * FACE_COLUMNS + column] * scale;
    const point = (column: number): Point2 => ({ x: at(column), y: at(column + 1) });
    faces.push({
      box: { x: at(0), y: at(1), width: at(2), height: at(3) },
      rightEye: point(4),
      leftEye: point(6),
      nose: point(8),
      rightMouth: point(10),
      leftMouth: point(12),
      score: data[row * FACE_COLUMNS + 14],
    });
  }
  return faces;
}

/** A face with every coordinate expressed as a fraction (0-1) of the image it was found in. */
export function normalizeYuNetFace(face: YuNetFace, width: number, height: number): YuNetFace {
  const point = (p: Point2): Point2 => ({ x: p.x / width, y: p.y / height });
  return {
    box: { x: face.box.x / width, y: face.box.y / height, width: face.box.width / width, height: face.box.height / height },
    rightEye: point(face.rightEye),
    leftEye: point(face.leftEye),
    nose: point(face.nose),
    rightMouth: point(face.rightMouth),
    leftMouth: point(face.leftMouth),
    score: face.score,
  };
}

/** Fetches the model file. */
export async function fetchYuNetModel(url = YUNET_MODEL_URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the YuNet model (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Minimal shape of OpenCV's `FaceDetectorYN`, which the bundled typings do not describe. */
interface FaceDetectorYN {
  setInputSize(size: unknown): void;
  detect(image: unknown, faces: unknown): number;
}
interface FaceDetectorYNConstructor {
  new (model: string, config: string, inputSize: unknown, scoreThreshold: number, nmsThreshold: number, topK: number): FaceDetectorYN;
}

let nextModelId = 0;

/** OpenCV's YuNet face detector: a face box plus eye, nose and mouth-corner landmarks. */
export class YuNetDetector {
  private size = { width: 0, height: 0 };

  private constructor(
    private readonly cv: OpenCv,
    private readonly detector: FaceDetectorYN,
    private readonly modelPath: string,
  ) {}

  /** Loads the model into OpenCV's virtual file system and creates a detector. */
  static create(cv: OpenCv, model: Uint8Array): YuNetDetector {
    const FaceDetector = (cv as unknown as { FaceDetectorYN?: FaceDetectorYNConstructor }).FaceDetectorYN;
    if (!FaceDetector) throw new Error("This OpenCV.js build does not include FaceDetectorYN.");
    const modelPath = `/yunet-${(nextModelId += 1)}.onnx`;
    (cv as unknown as { FS: { writeFile(path: string, data: Uint8Array): void } }).FS.writeFile(modelPath, model);
    const detector = new FaceDetector(modelPath, "", new cv.Size(320, 320), SCORE_THRESHOLD, NMS_THRESHOLD, TOP_K);
    return new YuNetDetector(cv, detector, modelPath);
  }

  /** Finds faces in a BGR, 8-bit, 3-channel image. */
  detectMat(bgr: InstanceType<OpenCv["Mat"]>, scale = 1): YuNetFace[] {
    if (bgr.cols !== this.size.width || bgr.rows !== this.size.height) {
      this.detector.setInputSize(new this.cv.Size(bgr.cols, bgr.rows));
      this.size = { width: bgr.cols, height: bgr.rows };
    }
    const faces = new this.cv.Mat();
    try {
      this.detector.detect(bgr, faces);
      return faces.rows > 0 ? parseYuNetRows(faces.data32F, faces.rows, scale) : [];
    } finally {
      faces.delete();
    }
  }

  /**
   * Finds faces in a canvas. Coordinates in the result are in the canvas's own
   * pixels, even if `searchWidth` makes the detector look at a smaller copy
   * (smaller is much faster; landmarks lose some precision).
   */
  detectCanvas(canvas: HTMLCanvasElement, searchWidth = canvas.width): YuNetFace[] {
    const rgba = this.cv.imread(canvas);
    const bgr = new this.cv.Mat();
    const small = new this.cv.Mat();
    try {
      this.cv.cvtColor(rgba, bgr, this.cv.COLOR_RGBA2BGR);
      const width = Math.min(searchWidth, canvas.width);
      const factor = canvas.width / width;
      if (factor === 1) return this.detectMat(bgr);
      this.cv.resize(bgr, small, new this.cv.Size(width, Math.round(canvas.height / factor)), 0, 0, this.cv.INTER_AREA);
      return this.detectMat(small, factor);
    } finally {
      rgba.delete();
      bgr.delete();
      small.delete();
    }
  }

  /** Frees the model from OpenCV's file system. */
  dispose() {
    try {
      (this.cv as unknown as { FS: { unlink(path: string): void } }).FS.unlink(this.modelPath);
    } catch {
      // Already gone.
    }
  }
}
