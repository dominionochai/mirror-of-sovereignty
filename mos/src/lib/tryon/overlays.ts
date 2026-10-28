import type { FaceGeometry, Point } from "./face";
import type { ResolvedLookEntry } from "./renderer";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read the image."));
    image.src = src;
  });
}

/** Groups that are drawn locally when no remote renderer handles them. */
export const LOCAL_GROUPS = ["color", "lips", "eyes", "blush", "outerwear", "eyewear", "earrings"] as const;

/**
 * Draws the look's layers onto an image with shapes placed from the face
 * geometry. Used for everything in the mock renderer and, in YouCam mode, for
 * layers YouCam has no API for (eyewear, earrings, and clothes without a reference).
 */
export async function composeLayers(
  baseImage: string,
  entries: ResolvedLookEntry[],
  face: FaceGeometry,
  mimeType = "image/jpeg",
): Promise<string> {
  const image = await loadImage(baseImage);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || 640;
  canvas.height = image.naturalHeight || 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  // Draw clothing first, then skin and hair, then accessories on top.
  const order = ["outerwear", "color", "blush", "eyes", "lips", "earrings", "eyewear"];
  const sorted = [...entries].sort((a, b) => order.indexOf(a.groupId) - order.indexOf(b.groupId));
  for (const entry of sorted) drawEntry(ctx, canvas.width, canvas.height, entry, face);
  return canvas.toDataURL(mimeType, 0.92);
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function drawEntry(ctx: CanvasRenderingContext2D, w: number, h: number, entry: ResolvedLookEntry, face: FaceGeometry) {
  const P = (p: Point): Point => ({ x: p.x * w, y: p.y * h });
  const leftEye = P(face.leftEye);
  const rightEye = P(face.rightEye);
  const eyeSpan = dist(leftEye, rightEye);
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const eyeMid = mid(leftEye, rightEye);
  const forehead = P(face.forehead);
  const chin = P(face.chin);
  const cheekL = P(face.cheekLeft);
  const cheekR = P(face.cheekRight);
  const faceW = dist(cheekL, cheekR);
  const faceH = dist(forehead, chin);
  const intensity = Math.max(0.05, entry.intensity / 100);

  ctx.save();
  ctx.fillStyle = entry.color;
  ctx.strokeStyle = entry.color;

  switch (entry.groupId) {
    case "color": {
      // Hair: a ring around the face (outer head outline minus the face) down to the jaw. A real try-on needs hair segmentation.
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = intensity * 0.7;
      const cx = forehead.x;
      const cy = (forehead.y + chin.y) / 2 - faceH * 0.08;
      ctx.beginPath();
      ctx.rect(0, 0, w, chin.y - faceH * 0.1);
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(cx, cy, faceW * 0.66, faceH * 0.66, 0, 0, 2 * Math.PI);
      ctx.ellipse(cx, (forehead.y + chin.y) / 2, faceW * 0.5, faceH * 0.52, 0, 0, 2 * Math.PI);
      ctx.fill("evenodd");
      break;
    }
    case "lips": {
      const m = face.mouth;
      const left = P(m.left);
      const right = P(m.right);
      const top = P(m.top);
      const bottom = P(m.bottom);
      const c = mid(mid(left, right), mid(top, bottom));
      ctx.globalAlpha = intensity * 0.8;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, dist(left, right) / 2, Math.max(dist(top, bottom) * 0.75, faceH * 0.03), roll, 0, 2 * Math.PI);
      ctx.fill();
      break;
    }
    case "eyes": {
      ctx.globalAlpha = intensity * 0.6;
      for (const eye of [leftEye, rightEye]) {
        ctx.beginPath();
        ctx.ellipse(eye.x, eye.y - eyeSpan * 0.04, eyeSpan * 0.21, eyeSpan * 0.11, roll, 0, 2 * Math.PI);
        ctx.fill();
      }
      break;
    }
    case "blush": {
      ctx.globalAlpha = intensity * 0.5;
      for (const [eye, cheek] of [[leftEye, cheekL], [rightEye, cheekR]] as const) {
        const x = eye.x + (cheek.x - eye.x) * 0.45;
        ctx.beginPath();
        ctx.ellipse(x, eye.y + faceH * 0.2, faceW * 0.12, faceH * 0.07, 0, 0, 2 * Math.PI);
        ctx.fill();
      }
      break;
    }
    case "outerwear": {
      // Keep the garment inside the frame even when the face fills most of it.
      const neckY = Math.min(chin.y + faceH * 0.12, h * 0.86);
      const shoulderY = Math.min(chin.y + faceH * 0.45, h * 0.9);
      if (entry.optionId === "scarf-silk") {
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(chin.x, neckY + faceH * 0.08, faceW * 0.55, faceH * 0.12, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(chin.x - faceW * 0.1, neckY + faceH * 0.15);
        ctx.lineTo(chin.x + faceW * 0.25, h);
        ctx.lineTo(chin.x + faceW * 0.45, h);
        ctx.lineTo(chin.x + faceW * 0.15, neckY + faceH * 0.12);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.moveTo(chin.x - faceW * 1.7, h);
        ctx.lineTo(chin.x - faceW * 1.3, shoulderY);
        ctx.lineTo(chin.x - faceW * 0.45, shoulderY - faceH * 0.05);
        ctx.lineTo(chin.x, neckY + faceH * 0.3);
        ctx.lineTo(chin.x + faceW * 0.45, shoulderY - faceH * 0.05);
        ctx.lineTo(chin.x + faceW * 1.3, shoulderY);
        ctx.lineTo(chin.x + faceW * 1.7, h);
        ctx.closePath();
        ctx.fill();
        // Lapels.
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(chin.x, neckY + faceH * 0.3);
        ctx.lineTo(chin.x - faceW * 0.45, shoulderY - faceH * 0.05);
        ctx.lineTo(chin.x - faceW * 0.2, shoulderY + faceH * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(chin.x, neckY + faceH * 0.3);
        ctx.lineTo(chin.x + faceW * 0.45, shoulderY - faceH * 0.05);
        ctx.lineTo(chin.x + faceW * 0.2, shoulderY + faceH * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "eyewear": {
      ctx.translate(eyeMid.x, eyeMid.y);
      ctx.rotate(roll);
      const half = eyeSpan / 2;
      const rx = eyeSpan * 0.3;
      const ry = entry.optionId === "glasses-black" ? rx : rx * 0.82;
      ctx.lineWidth = Math.max(2, eyeSpan * (entry.optionId === "glasses-clear" ? 0.02 : 0.04));
      ctx.globalAlpha = 0.95;
      if (entry.optionId === "glasses-clear") {
        ctx.fillStyle = "rgba(169,199,214,0.25)";
      }
      for (const cx of [-half, half]) {
        ctx.beginPath();
        if (entry.optionId === "glasses-clear") {
          // Aviator: flat top, rounded bottom.
          ctx.moveTo(cx - rx, -ry * 0.8);
          ctx.lineTo(cx + rx, -ry * 0.8);
          ctx.quadraticCurveTo(cx + rx, ry * 1.2, cx, ry * 1.1);
          ctx.quadraticCurveTo(cx - rx, ry * 1.2, cx - rx, -ry * 0.8);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.ellipse(cx, 0, rx, ry, 0, 0, 2 * Math.PI);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-half + rx, -ry * 0.1);
      ctx.quadraticCurveTo(0, -ry * 0.4, half - rx, -ry * 0.1);
      ctx.stroke();
      // Temples towards the ears.
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sign * (half + rx), -ry * 0.2);
        ctx.lineTo(sign * (half + rx + eyeSpan * 0.35), ry * 0.1);
        ctx.stroke();
      }
      break;
    }
    case "earrings": {
      const y = (leftEye.y + rightEye.y) / 2 + faceH * 0.3;
      for (const [cheek, dir] of [[cheekL, -1], [cheekR, 1]] as const) {
        const x = cheek.x + dir * faceW * 0.03;
        ctx.globalAlpha = 0.95;
        if (entry.optionId === "ear-hoops") {
          ctx.lineWidth = Math.max(2, eyeSpan * 0.03);
          ctx.beginPath();
          ctx.arc(x, y + eyeSpan * 0.1, eyeSpan * 0.12, 0, 2 * Math.PI);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, eyeSpan * 0.055, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
