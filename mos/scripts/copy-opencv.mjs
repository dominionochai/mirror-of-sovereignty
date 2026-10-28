// Copies OpenCV.js into public/ so the browser can load it as a plain <script>.
// (Importing it through the bundler breaks: the bundler's module wrapper makes the
// export look like a promise whose `then` has lost its receiver.)
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const source = "node_modules/@techstark/opencv-js/dist/opencv.js";
const target = "public/opencv/opencv.js";

if (!existsSync(source)) {
  console.warn(`[copy-opencv] ${source} not found; run npm install first.`);
  process.exit(0);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[copy-opencv] ${source} -> ${target}`);
