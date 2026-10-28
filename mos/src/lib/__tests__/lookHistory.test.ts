import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG } from "../tryon/catalog";
import { INTENSITY_STEP, initialLookState, lookReducer, type LookAction, type LookState } from "../tryon/lookHistory";

const run = (actions: LookAction[], from: LookState = initialLookState) => actions.reduce(lookReducer, from);

describe("lookReducer", () => {
  it("selects an option with the default intensity", () => {
    const state = run([{ type: "select", slot: "hair/color", optionId: "hair-auburn" }]);
    assert.deepEqual(state.present["hair/color"], { optionId: "hair-auburn", intensity: 50 });
  });

  it("collapses repeated intensity steps into one undo step", () => {
    const state = run([
      { type: "select", slot: "hair/color", optionId: "hair-auburn" },
      { type: "adjust", slot: "hair/color", delta: INTENSITY_STEP },
      { type: "adjust", slot: "hair/color", delta: INTENSITY_STEP },
      { type: "adjust", slot: "hair/color", delta: -INTENSITY_STEP },
    ]);
    assert.equal(state.present["hair/color"].intensity, 60);
    assert.equal(state.past.length, 2);
    const undone = lookReducer(state, { type: "undo" });
    assert.equal(undone.present["hair/color"].intensity, 50);
  });

  it("undo unwinds to the state before the last selection", () => {
    const state = run([
      { type: "select", slot: "hair/color", optionId: "hair-auburn" },
      { type: "select", slot: "fashion/outerwear", optionId: "jacket-formal" },
      { type: "select", slot: "accessories/eyewear", optionId: "glasses-gold" },
    ]);
    const undone = lookReducer(state, { type: "undo" });
    assert.ok(!("accessories/eyewear" in undone.present));
    assert.ok("fashion/outerwear" in undone.present);
  });

  it("clamps intensity to 0-100 and ignores no-op changes", () => {
    let state = run([{ type: "select", slot: "makeup/lips", optionId: "lip-ruby" }]);
    for (let i = 0; i < 10; i += 1) state = lookReducer(state, { type: "adjust", slot: "makeup/lips", delta: INTENSITY_STEP });
    assert.equal(state.present["makeup/lips"].intensity, 100);
    const same = lookReducer(state, { type: "adjust", slot: "makeup/lips", delta: INTENSITY_STEP });
    assert.equal(same, state);
    assert.equal(lookReducer(state, { type: "select", slot: "makeup/lips", optionId: "lip-ruby" }), state);
  });

  it("keeps intensity when swapping options in the same slot", () => {
    const state = run([
      { type: "select", slot: "hair/color", optionId: "hair-auburn" },
      { type: "adjust", slot: "hair/color", delta: 20 },
      { type: "select", slot: "hair/color", optionId: "hair-teal" },
    ]);
    assert.deepEqual(state.present["hair/color"], { optionId: "hair-teal", intensity: 70 });
  });

  it("undo on empty history does nothing, and reset is undoable", () => {
    assert.equal(lookReducer(initialLookState, { type: "undo" }), initialLookState);
    const state = run([{ type: "select", slot: "hair/color", optionId: "hair-auburn" }, { type: "reset" }]);
    assert.deepEqual(state.present, {});
    assert.ok("hair/color" in lookReducer(state, { type: "undo" }).present);
  });
});

describe("catalog", () => {
  it("has unique option ids", () => {
    const ids = CATALOG.flatMap((c) => c.groups.flatMap((g) => g.options.map((o) => o.id)));
    assert.equal(new Set(ids).size, ids.length);
  });
});
