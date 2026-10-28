# Motor Sovereignty

A hands-free virtual try-on studio. Gaze and intentional blinks replace every touch, and an **Adaptive Motor Control Layer** profiles each person in about five seconds, then reshapes the interface around them. The try-on rendering itself comes from the YouCam API; the contribution here is the input layer.

Built on a gaze-tracking core (MediaPipe) with a motor-adaptive control layer.

## How it works

1. **Calibrate** - five points, each confirmed by holding your gaze (a blink or Enter also works).
2. **Motor profile** (`src/lib/motor/profile.ts`, `src/components/studio/MotorProfiler.tsx`) - 2 s fixation plus four edge glances. Measures:
   - *gaze stability* (median RMS dispersion over 1 s windows) -> dwell time 400-1200 ms, target scale 1x-1.6x, tolerance label
   - *natural blink rate* while fixating -> enables or disables blink-to-select
   - *reach* (5th-95th percentile of gaze over the edge glances) -> a safe zone; the whole UI is laid out inside it
3. **Studio** (`src/components/studio/TryOnStudio.tsx`) - category tree (Makeup, Hair, Fashion, Accessories), dwell-ring selection, intensity +/- steps, A/B compare with gaze lock, and undo (`src/lib/tryon/lookHistory.ts`).

## Run it

```bash
npm install
# open http://localhost:3000, paste your keys on the start page (or put them in .env.local)
npm run dev                   # camera access needs localhost or https (npm run dev:https)
npm test
```

The start page (`/`) takes the YouCam, Groq and Gemini keys, stores them in this browser only, and can check them. Groq and Gemini are saved for later; the studio does not use them yet. The studio lives at `/studio`.

Without a key (Preview mode) the studio uses a **mock renderer** (rough fixed overlays, clearly labelled) so the gaze interface can be developed and demoed offline. No camera? Choose "Continue without a camera": the mouse stands in for gaze and Enter for a blink.

Presenter keys in the studio: `1` `2` `3` switch between steady / moderate / high-tremor profiles, `T` toggles the touch lock (real clicks are ignored while it is on).

## YouCam integration

`src/lib/server/youcam.ts` follows YouCam's public API reference: `POST /s2s/v2.0/file` (upload), then `POST /s2s/v2.0/task/<feature>` and polling `GET .../<task_id>` until `task_status` is `success`. The key travels from your browser to this app's `/api/tryon` route (header `x-youcam-key`), or comes from `YOUCAM_API_KEY` on the server.

| What you pick | How it is rendered |
|---|---|
| Hair colour | YouCam `hair-color` (solid colour, `color_intensity` from the intensity control) |
| Lips, eyes, blush | YouCam `makeup-vto` (one task for all effects) |
| Clothes | YouCam `cloth-v4` only when a reference outfit URL is configured (`YOUCAM_CLOTH_REF_*`); otherwise drawn locally |
| Eyewear, earrings | Drawn locally on the result from the face landmarks. YouCam has no eyewear API, and its earring API needs a reference image per product |

Field names follow YouCam's OpenAPI reference. They have not been exercised against a live call from this build environment, so check the first real responses.
