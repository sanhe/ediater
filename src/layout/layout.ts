/**
 * Pure recursive split-tree algebra for the docking layout.
 *
 * Every dock region is a **group**: a tab strip holding one or more panels with
 * an active one (PhpStorm/VS Code tool-window model). Splits arrange groups
 * (and nested splits) horizontally/vertically with proportional sizes.
 *
 * All functions are pure — they take a tree and return a new tree — which makes
 * the layout trivially unit-testable and serializable into the session. New
 * group/split ids are supplied by an injected `idgen` for determinism.
 */

export type Direction = "row" | "column";

/** Where a dragged tab is dropped relative to a target group. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";
export type SplitEdge = "left" | "right" | "top" | "bottom";

export interface GroupNode {
  kind: "group";
  id: string;
  /** Panel ids shown as tabs, in order. */
  panelIds: string[];
  activePanelId: string;
}

export interface SplitNode {
  kind: "split";
  id: string;
  direction: Direction;
  children: LayoutNode[];
  /** Proportional sizes, one per child, summing to ~1. */
  sizes: number[];
}

export type LayoutNode = GroupNode | SplitNode;

/** Minimum fraction a pane may shrink to during a resize drag. */
export const MIN_LEAF_FRACTION = 0.08;

export function group(
  id: string,
  panelIds: string[],
  activePanelId?: string,
): GroupNode {
  return {
    kind: "group",
    id,
    panelIds,
    activePanelId: activePanelId ?? panelIds[0],
  };
}

function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

function normalizeSizes(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0) return evenSizes(sizes.length);
  return sizes.map((s) => s / total);
}

/**
 * Normalize to sum 1 while keeping every pane at or above MIN_LEAF_FRACTION via
 * water-filling: raise sub-minimum panes to the floor, shave the excess from
 * panes above the floor in proportion to their surplus.
 */
function clampedSizes(sizes: number[]): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  if (n * MIN_LEAF_FRACTION >= 1) return evenSizes(n);

  let s = normalizeSizes(sizes);
  for (let iter = 0; iter < 32; iter++) {
    const deficit = s.reduce(
      (acc, v) => acc + (v < MIN_LEAF_FRACTION ? MIN_LEAF_FRACTION - v : 0),
      0,
    );
    if (deficit <= 1e-9) break;
    const raised = s.map((v) => (v < MIN_LEAF_FRACTION ? MIN_LEAF_FRACTION : v));
    const excess = raised.map((v) => Math.max(0, v - MIN_LEAF_FRACTION));
    const totalExcess = excess.reduce((a, b) => a + b, 0);
    if (totalExcess <= 1e-9) return evenSizes(n);
    s = raised.map((v, i) => v - (excess[i] / totalExcess) * deficit);
  }
  return s;
}

// --- queries ---

export function collectPanelIds(node: LayoutNode): string[] {
  if (node.kind === "group") return [...node.panelIds];
  return node.children.flatMap(collectPanelIds);
}

export function findGroupOfPanel(
  node: LayoutNode,
  panelId: string,
): GroupNode | null {
  if (node.kind === "group") {
    return node.panelIds.includes(panelId) ? node : null;
  }
  for (const child of node.children) {
    const found = findGroupOfPanel(child, panelId);
    if (found) return found;
  }
  return null;
}

export function findGroupById(
  node: LayoutNode,
  groupId: string,
): GroupNode | null {
  if (node.kind === "group") return node.id === groupId ? node : null;
  for (const child of node.children) {
    const found = findGroupById(child, groupId);
    if (found) return found;
  }
  return null;
}

export function findSplitById(
  node: LayoutNode,
  splitId: string,
): SplitNode | null {
  if (node.kind === "group") return null;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const found = findSplitById(child, splitId);
    if (found) return found;
  }
  return null;
}

export function firstGroupId(node: LayoutNode): string {
  return node.kind === "group" ? node.id : firstGroupId(node.children[0]);
}

// --- mutations (pure) ---

function mapGroups(
  node: LayoutNode,
  fn: (g: GroupNode) => GroupNode,
): LayoutNode {
  if (node.kind === "group") return fn(node);
  return { ...node, children: node.children.map((c) => mapGroups(c, fn)) };
}

export function setActivePanel(
  node: LayoutNode,
  groupId: string,
  panelId: string,
): LayoutNode {
  return mapGroups(node, (g) =>
    g.id === groupId && g.panelIds.includes(panelId)
      ? { ...g, activePanelId: panelId }
      : g,
  );
}

export function addPanelToGroup(
  node: LayoutNode,
  groupId: string,
  panelId: string,
  opts: { index?: number; activate?: boolean } = {},
): LayoutNode {
  const activate = opts.activate ?? true;
  return mapGroups(node, (g) => {
    if (g.id !== groupId) return g;
    if (g.panelIds.includes(panelId)) {
      return { ...g, activePanelId: activate ? panelId : g.activePanelId };
    }
    const panelIds = [...g.panelIds];
    const idx = Math.min(opts.index ?? panelIds.length, panelIds.length);
    panelIds.splice(idx, 0, panelId);
    return { ...g, panelIds, activePanelId: activate ? panelId : g.activePanelId };
  });
}

/**
 * Remove a panel from whichever group holds it. Empty groups are dropped and
 * single-child splits collapsed. Returns null if the tree becomes empty.
 */
export function removePanel(
  node: LayoutNode,
  panelId: string,
): LayoutNode | null {
  if (node.kind === "group") {
    if (!node.panelIds.includes(panelId)) return node;
    const panelIds = node.panelIds.filter((p) => p !== panelId);
    if (panelIds.length === 0) return null;
    let activePanelId = node.activePanelId;
    if (activePanelId === panelId) {
      const oldIdx = node.panelIds.indexOf(panelId);
      activePanelId = panelIds[oldIdx] ?? panelIds[oldIdx - 1] ?? panelIds[0];
    }
    return { ...node, panelIds, activePanelId };
  }

  const keptChildren: LayoutNode[] = [];
  const keptSizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = removePanel(child, panelId);
    if (next) {
      keptChildren.push(next);
      keptSizes.push(node.sizes[i] ?? 1 / node.children.length);
    }
  });
  if (keptChildren.length === 0) return null;
  if (keptChildren.length === 1) return keptChildren[0];
  return { ...node, children: keptChildren, sizes: normalizeSizes(keptSizes) };
}

/** Move a panel into an existing group as a tab (also reorders within a group). */
export function movePanelToGroup(
  node: LayoutNode,
  panelId: string,
  targetGroupId: string,
  index?: number,
): LayoutNode {
  const target = findGroupById(node, targetGroupId);
  if (!target) return node;

  const source = findGroupOfPanel(node, panelId);
  if (source && source.id === targetGroupId) {
    // Reorder within the same group.
    return mapGroups(node, (g) => {
      if (g.id !== targetGroupId) return g;
      const without = g.panelIds.filter((p) => p !== panelId);
      const idx = Math.min(index ?? without.length, without.length);
      without.splice(idx, 0, panelId);
      return { ...g, panelIds: without, activePanelId: panelId };
    });
  }

  const removed = removePanel(node, panelId);
  if (!removed) return node;
  return addPanelToGroup(removed, targetGroupId, panelId, { index, activate: true });
}

function insertGroupAdjacent(
  node: LayoutNode,
  targetGroupId: string,
  edge: SplitEdge,
  newGroup: GroupNode,
  idgen: () => string,
): LayoutNode {
  if (node.kind === "group") {
    if (node.id !== targetGroupId) return node;
    const direction: Direction =
      edge === "left" || edge === "right" ? "row" : "column";
    const before = edge === "left" || edge === "top";
    const children = before ? [newGroup, node] : [node, newGroup];
    return { kind: "split", id: idgen(), direction, children, sizes: [0.5, 0.5] };
  }
  return {
    ...node,
    children: node.children.map((c) =>
      insertGroupAdjacent(c, targetGroupId, edge, newGroup, idgen),
    ),
  };
}

/** Split: drop a panel onto an edge of a group, creating a new adjacent group. */
export function splitPanelToGroup(
  node: LayoutNode,
  panelId: string,
  targetGroupId: string,
  edge: SplitEdge,
  idgen: () => string,
): LayoutNode {
  const target = findGroupById(node, targetGroupId);
  if (!target) return node;

  const source = findGroupOfPanel(node, panelId);
  // Splitting a single-panel group against itself is a no-op.
  if (source && source.id === targetGroupId && source.panelIds.length === 1) {
    return node;
  }

  const removed = removePanel(node, panelId);
  if (!removed) return node;
  if (!findGroupById(removed, targetGroupId)) return removed;

  const newGroup = group(idgen(), [panelId], panelId);
  return insertGroupAdjacent(removed, targetGroupId, edge, newGroup, idgen);
}

/** Replace the sizes of the split identified by `splitId` (clamped + normalized). */
export function updateSplitSizes(
  node: LayoutNode,
  splitId: string,
  sizes: number[],
): LayoutNode {
  if (node.kind === "group") return node;
  if (node.id === splitId && sizes.length === node.children.length) {
    return { ...node, sizes: clampedSizes(sizes) };
  }
  return {
    ...node,
    children: node.children.map((c) => updateSplitSizes(c, splitId, sizes)),
  };
}

/**
 * Which zone of a `w`×`h` rectangle the point (`x`,`y`) is in: a central region
 * (tabify) sized by `centerFrac`, otherwise the nearest edge (split).
 */
export function closestZone(
  x: number,
  y: number,
  w: number,
  h: number,
  centerFrac = 0.5,
): DropZone {
  const mx = (w * (1 - centerFrac)) / 2;
  const my = (h * (1 - centerFrac)) / 2;
  if (x >= mx && x <= w - mx && y >= my && y <= h - my) return "center";

  const distances: Record<SplitEdge, number> = {
    left: x,
    right: w - x,
    top: y,
    bottom: h - y,
  };
  let best: SplitEdge = "left";
  let bestDist = Infinity;
  (Object.keys(distances) as SplitEdge[]).forEach((edge) => {
    if (distances[edge] < bestDist) {
      bestDist = distances[edge];
      best = edge;
    }
  });
  return best;
}
