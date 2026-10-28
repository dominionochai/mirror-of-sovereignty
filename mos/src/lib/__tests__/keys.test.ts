import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlausibleKey, keyHeaders, parseSettings, sanitizeKey } from "../keys";
import { declaredContentType } from "../server/youcam";

test("sanitizeKey strips quotes, Bearer, NAME= and whitespace", () => {
  assert.equal(sanitizeKey('  "abc12345XYZ"  '), "abc12345XYZ");
  assert.equal(sanitizeKey("Bearer abc12345XYZ"), "abc12345XYZ");
  assert.equal(sanitizeKey("YOUCAM_API_KEY=abc12345XYZ"), "abc12345XYZ");
  assert.equal(sanitizeKey("GROQ_API_KEY = 'gsk_abc12345'"), "gsk_abc12345");
});

test("isPlausibleKey rejects short, spaced and non-ASCII values", () => {
  assert.equal(isPlausibleKey("abc12345"), true);
  assert.equal(isPlausibleKey("short"), false);
  assert.equal(isPlausibleKey("has space inside"), false);
  assert.equal(isPlausibleKey("kéy12345678"), false);
});

test("parseSettings is defensive", () => {
  assert.deepEqual(parseSettings(null), { keys: {}, mode: "mock" });
  assert.deepEqual(parseSettings("{not json"), { keys: {}, mode: "mock" });
  const s = parseSettings(JSON.stringify({ keys: { youcam: " Bearer abcdefgh12 ", groq: 5, gemini: "x" }, mode: "youcam" }));
  assert.deepEqual(s, { keys: { youcam: "abcdefgh12" }, mode: "youcam" });
  assert.equal(parseSettings(JSON.stringify({ mode: "other" })).mode, "mock");
});

test("keyHeaders only sends valid keys", () => {
  assert.deepEqual(keyHeaders({ youcam: "abcdefgh12", groq: "bad key" }), { "x-youcam-key": "abcdefgh12" });
});

test("JPEG is declared as image/jpg for YouCam", () => {
  assert.equal(declaredContentType("image/jpeg"), "image/jpg");
  assert.equal(declaredContentType("image/png"), "image/png");
});
