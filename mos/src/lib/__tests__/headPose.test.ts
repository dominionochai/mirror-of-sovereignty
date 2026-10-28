import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { estimateHeadPose, type Point2 } from "../headPose";
import { loadOpenCv, type OpenCv } from "../opencvVision";

const rad = (deg: number) => (deg * Math.PI) / 180;
type Matrix3 = number[][];
const mul = (a: Matrix3, b: Matrix3): Matrix3 => a.map((row, i) => b[0].map((_, j) => row.reduce((sum, _v, k) => sum + a[i][k] * b[k][j], 0)));
const rotY = (t: number): Matrix3 => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const rotX = (t: number): Matrix3 => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const rotZ = (t: number): Matrix3 => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];

const MODEL: number[][] = [[0, 0, 0], [0, 63.6, 12.5], [-43.3, -32.7, 26], [43.3, -32.7, 26], [-28.9, 28.9, 24.1], [28.9, 28.9, 24.1]];
const WIDTH = 640;
const HEIGHT = 480;

/** Projects the model with a known pose through a pinhole camera, like the app's camera. */
function project(r: Matrix3, t: [number, number, number]): Point2[] {
  return MODEL.map(([x, y, z]) => {
    const cx = r[0][0] * x + r[0][1] * y + r[0][2] * z + t[0];
    const cy = r[1][0] * x + r[1][1] * y + r[1][2] * z + t[1];
    const cz = r[2][0] * x + r[2][1] * y + r[2][2] * z + t[2];
    return { x: (WIDTH * cx) / cz + WIDTH / 2, y: (WIDTH * cy) / cz + HEIGHT / 2 };
  });
}

describe("estimateHeadPose", () => {
  let cv: OpenCv;
  before(async () => { cv = await loadOpenCv(); });

  it("reads a frontal face as roughly zero pose", () => {
    const pose = estimateHeadPose(cv, project(rotY(0), [0, 0, 600]), WIDTH, HEIGHT);
    assert.ok(pose);
    for (const angle of [pose.yaw, pose.pitch, pose.roll]) assert.ok(Math.abs(angle) < 1, `angle ${angle}`);
  });

  it("recovers single-axis rotations with the documented signs", () => {
    const yawed = estimateHeadPose(cv, project(rotY(rad(-20)), [0, 0, 650]), WIDTH, HEIGHT);
    assert.ok(yawed && Math.abs(yawed.yaw - 20) < 1 && Math.abs(yawed.pitch) < 1 && Math.abs(yawed.roll) < 1, JSON.stringify(yawed));
    const pitched = estimateHeadPose(cv, project(rotX(rad(-10)), [0, 0, 650]), WIDTH, HEIGHT);
    assert.ok(pitched && Math.abs(pitched.pitch - 10) < 1 && Math.abs(pitched.yaw) < 1 && Math.abs(pitched.roll) < 1, JSON.stringify(pitched));
    const rolled = estimateHeadPose(cv, project(rotZ(rad(5)), [0, 0, 650]), WIDTH, HEIGHT);
    assert.ok(rolled && Math.abs(rolled.roll - 5) < 1 && Math.abs(rolled.yaw) < 1 && Math.abs(rolled.pitch) < 1, JSON.stringify(rolled));
  });

  it("matches the angle definitions for a combined pose", () => {
    const r = mul(rotZ(rad(5)), mul(rotX(rad(-10)), rotY(rad(-20))));
    // Angles are defined from where the head's forward (-z) and right (+x) axes point.
    const forward = { x: -r[0][2], y: -r[1][2], z: -r[2][2] };
    const expected = {
      yaw: (Math.atan2(forward.x, -forward.z) * 180) / Math.PI,
      pitch: (Math.atan2(-forward.y, Math.hypot(forward.x, forward.z)) * 180) / Math.PI,
      roll: (Math.atan2(r[1][0], r[0][0]) * 180) / Math.PI,
    };
    const pose = estimateHeadPose(cv, project(r, [20, -10, 650]), WIDTH, HEIGHT);
    assert.ok(pose);
    for (const key of ["yaw", "pitch", "roll"] as const) {
      assert.ok(Math.abs(pose[key] - expected[key]) < 0.5, `${key}: ${pose[key]} vs ${expected[key]}`);
    }
  });

  it("stays on the upright solution when landmarks are noisy", () => {
    // Deterministic jitter of about two pixels on every point.
    let seed = 11;
    const jitter = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 4;
    const r = mul(rotZ(rad(4)), mul(rotX(rad(-8)), rotY(rad(-25))));
    for (let trial = 0; trial < 25; trial += 1) {
      const noisy = project(r, [10, 5, 620]).map((p) => ({ x: p.x + jitter(), y: p.y + jitter() }));
      const pose = estimateHeadPose(cv, noisy, WIDTH, HEIGHT);
      assert.ok(pose);
      assert.ok(Math.abs(pose.roll) < 25, `roll flipped: ${pose.roll}`);
      assert.ok(Math.abs(pose.yaw - 25) < 15, `yaw ${pose.yaw}`);
    }
  });

  it("projects the origin axis onto the nose tip", () => {
    const points = project(rotY(0), [30, 20, 600]);
    const pose = estimateHeadPose(cv, points, WIDTH, HEIGHT);
    assert.ok(pose);
    assert.ok(Math.hypot(pose.axes.origin.x - points[0].x, pose.axes.origin.y - points[0].y) < 1);
  });

  it("rejects the wrong number of points", () => {
    assert.equal(estimateHeadPose(cv, [{ x: 0, y: 0 }], WIDTH, HEIGHT), null);
  });
});
