// Runs every *.test.ts under src/ with Node's built-in test runner via tsx.
// Globbing is done here because shell glob support differs between Windows and Unix.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const files = findTests("src");
if (files.length === 0) {
  console.error("No test files found.");
  process.exit(1);
}

const result = spawnSync("npx", ["tsx", "--test", ...files], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
