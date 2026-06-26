import { describe, expect, it } from "vitest";
import {
  addPanelToGroup,
  closestZone,
  collectPanelIds,
  findGroupById,
  findGroupOfPanel,
  group,
  type LayoutNode,
  type SplitNode,
  MIN_LEAF_FRACTION,
  movePanelToGroup,
  removePanel,
  setActivePanel,
  splitPanelToGroup,
  updateSplitSizes,
} from "./layout";

function counter() {
  let n = 0;
  return () => `n${++n}`;
}

const singleGroup = (): LayoutNode => group("g1", ["a"], "a");

/** Two side-by-side groups, each with one panel. */
function twoGroups(): SplitNode {
  return {
    kind: "split",
    id: "root",
    direction: "row",
    children: [group("gA", ["a"], "a"), group("gB", ["b"], "b")],
    sizes: [0.5, 0.5],
  };
}

describe("addPanelToGroup", () => {
  it("appends a tab and activates it", () => {
    const tree = addPanelToGroup(singleGroup(), "g1", "b");
    const g = findGroupById(tree, "g1")!;
    expect(g.panelIds).toEqual(["a", "b"]);
    expect(g.activePanelId).toBe("b");
  });

  it("inserts at an index without activating when asked", () => {
    const tree = addPanelToGroup(singleGroup(), "g1", "b", {
      index: 0,
      activate: false,
    });
    const g = findGroupById(tree, "g1")!;
    expect(g.panelIds).toEqual(["b", "a"]);
    expect(g.activePanelId).toBe("a");
  });
});

describe("removePanel", () => {
  it("drops the panel but keeps the group while it has tabs", () => {
    const start = addPanelToGroup(singleGroup(), "g1", "b");
    const tree = removePanel(start, "a")!;
    const g = findGroupById(tree, "g1")!;
    expect(g.panelIds).toEqual(["b"]);
    expect(g.activePanelId).toBe("b");
  });

  it("collapses an emptied group's split back to the sibling", () => {
    const tree = removePanel(twoGroups(), "a")!;
    expect(tree.kind).toBe("group");
    expect(collectPanelIds(tree)).toEqual(["b"]);
  });

  it("returns null when the last panel is removed", () => {
    expect(removePanel(singleGroup(), "a")).toBeNull();
  });
});

describe("movePanelToGroup", () => {
  it("moves a panel into another group as a tab", () => {
    const tree = movePanelToGroup(twoGroups(), "a", "gB");
    // gA emptied + collapsed; gB now holds both.
    const g = findGroupById(tree, "gB")!;
    expect(g.panelIds).toEqual(["b", "a"]);
    expect(g.activePanelId).toBe("a");
    expect(findGroupById(tree, "gA")).toBeNull();
  });

  it("reorders within the same group", () => {
    const start = addPanelToGroup(singleGroup(), "g1", "b"); // [a, b]
    const tree = movePanelToGroup(start, "b", "g1", 0);
    expect(findGroupById(tree, "g1")!.panelIds).toEqual(["b", "a"]);
  });
});

describe("splitPanelToGroup", () => {
  it("splits a panel out to a new adjacent group", () => {
    const start = addPanelToGroup(singleGroup(), "g1", "b"); // group g1 [a,b]
    const tree = splitPanelToGroup(start, "b", "g1", "right", counter());
    expect(tree.kind).toBe("split");
    expect(collectPanelIds(tree)).toEqual(["a", "b"]);
    // two distinct groups now
    expect(findGroupOfPanel(tree, "a")!.id).not.toBe(
      findGroupOfPanel(tree, "b")!.id,
    );
  });

  it("is a no-op when splitting a lone panel against its own group", () => {
    const before = singleGroup();
    const after = splitPanelToGroup(before, "a", "g1", "right", counter());
    expect(after).toBe(before);
  });
});

describe("setActivePanel", () => {
  it("activates a tab in a group", () => {
    const start = addPanelToGroup(singleGroup(), "g1", "b"); // active b
    const tree = setActivePanel(start, "g1", "a");
    expect(findGroupById(tree, "g1")!.activePanelId).toBe("a");
  });
});

describe("updateSplitSizes", () => {
  it("sets and clamps sizes", () => {
    const updated = updateSplitSizes(twoGroups(), "root", [0.99, 0.01]) as SplitNode;
    expect(updated.sizes[0] + updated.sizes[1]).toBeCloseTo(1, 6);
    expect(updated.sizes[1]).toBeGreaterThanOrEqual(MIN_LEAF_FRACTION - 1e-9);
  });
});

describe("closestZone", () => {
  it("returns center within the central region", () => {
    expect(closestZone(50, 50, 100, 100)).toBe("center");
  });
  it("returns the nearest edge outside the center", () => {
    expect(closestZone(2, 50, 100, 100)).toBe("left");
    expect(closestZone(98, 50, 100, 100)).toBe("right");
    expect(closestZone(50, 2, 100, 100)).toBe("top");
    expect(closestZone(50, 98, 100, 100)).toBe("bottom");
  });
});
