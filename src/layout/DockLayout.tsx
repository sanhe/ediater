import {
  Fragment,
  Suspense,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  closestZone,
  MIN_LEAF_FRACTION,
  type DropZone,
  type GroupNode,
  type LayoutNode,
  type SplitEdge,
  type SplitNode,
} from "./layout";
import { panelTitle, type PanelState } from "./panel";
import { panelRegistry } from "./panelRegistry";
import "../styles/layout.css";

interface DockLayoutProps {
  node: LayoutNode;
  panels: Record<string, PanelState>;
  activeGroupId: string | null;
  isPanelModified?: (panel: PanelState) => boolean;
  onResize: (splitId: string, sizes: number[]) => void;
  onMoveTab: (panelId: string, targetGroupId: string, index?: number) => void;
  onSplitTab: (panelId: string, targetGroupId: string, edge: SplitEdge) => void;
  onSelectTab: (groupId: string, panelId: string) => void;
  onCloseTab: (panelId: string) => void;
  onFocusGroup: (groupId: string) => void;
}

type DropTarget =
  | { kind: "tab"; groupId: string; index: number; rect: DOMRect }
  | { kind: "zone"; groupId: string; zone: DropZone; rect: DOMRect };

interface DragState {
  panelId: string;
  target: DropTarget | null;
}

function computeDropTarget(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  const groupEl = el?.closest<HTMLElement>("[data-group-id]");
  if (!groupEl) return null;
  const groupId = groupEl.getAttribute("data-group-id");
  if (!groupId) return null;

  const tabbarEl = el?.closest<HTMLElement>("[data-tabbar]");
  if (tabbarEl && tabbarEl.getAttribute("data-tabbar") === groupId) {
    const tabs = Array.from(
      tabbarEl.querySelectorAll<HTMLElement>("[data-tab-index]"),
    );
    let index = tabs.length;
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        index = i;
        break;
      }
    }
    return { kind: "tab", groupId, index, rect: tabbarEl.getBoundingClientRect() };
  }

  const rect = groupEl.getBoundingClientRect();
  const zone = closestZone(x - rect.left, y - rect.top, rect.width, rect.height);
  return { kind: "zone", groupId, zone, rect };
}

/**
 * Renders a docking layout where every group is a tab strip of panels. Tabs can
 * be dragged between groups (tabify) or onto a group edge (split); split seams
 * resize. All structural changes run the pure algebra in layout.ts.
 */
export function DockLayout(props: DockLayoutProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const startTabDrag = (
    groupId: string,
    panelId: string,
    e: ReactPointerEvent,
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) {
          return;
        }
        dragging = true;
        document.body.classList.add("layout-dragging");
      }
      const target = computeDropTarget(ev.clientX, ev.clientY);
      const next: DragState = { panelId, target };
      dragRef.current = next;
      setDrag(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("layout-dragging");

      if (!dragging) {
        props.onSelectTab(groupId, panelId);
      } else {
        const t = dragRef.current?.target;
        if (t?.kind === "tab") {
          props.onMoveTab(panelId, t.groupId, t.index);
        } else if (t?.kind === "zone") {
          if (t.zone === "center") props.onMoveTab(panelId, t.groupId);
          else props.onSplitTab(panelId, t.groupId, t.zone);
        }
      }
      dragRef.current = null;
      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="layout-root">
      <RenderNode node={props.node} props={props} startTabDrag={startTabDrag} />
      {drag?.target && <DropIndicator target={drag.target} />}
    </div>
  );
}

interface RenderProps {
  node: LayoutNode;
  props: DockLayoutProps;
  startTabDrag: (groupId: string, panelId: string, e: ReactPointerEvent) => void;
}

function RenderNode({ node, props, startTabDrag }: RenderProps) {
  if (node.kind === "group") {
    return <GroupView group={node} props={props} startTabDrag={startTabDrag} />;
  }
  return <SplitView split={node} props={props} startTabDrag={startTabDrag} />;
}

function GroupView({
  group,
  props,
  startTabDrag,
}: {
  group: GroupNode;
  props: DockLayoutProps;
  startTabDrag: (groupId: string, panelId: string, e: ReactPointerEvent) => void;
}) {
  const { panels, activeGroupId, isPanelModified } = props;
  const activeId = group.panelIds.includes(group.activePanelId)
    ? group.activePanelId
    : group.panelIds[0];
  const activePanel = panels[activeId];
  const Body = activePanel ? panelRegistry[activePanel.kind] : null;

  return (
    <div
      className={`dock-group${group.id === activeGroupId ? " active" : ""}`}
      data-group-id={group.id}
      onPointerDown={() => props.onFocusGroup(group.id)}
    >
      <div className="dock-tabbar" data-tabbar={group.id}>
        {group.panelIds.map((pid, i) => {
          const panel = panels[pid];
          if (!panel) return null;
          const modified =
            panel.kind === "editor" && isPanelModified?.(panel) ? true : false;
          return (
            <div
              key={pid}
              data-tab-index={i}
              className={`dock-tab${pid === activeId ? " active" : ""}`}
              title={panelTitle(panel)}
              onPointerDown={(e) => startTabDrag(group.id, pid, e)}
            >
              <span className="dock-tab-label">{panelTitle(panel)}</span>
              {modified && <span className="dock-tab-dirty">●</span>}
              <button
                className="dock-tab-close"
                aria-label="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onCloseTab(pid);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="dock-group-body" data-groupbody={group.id}>
        {activePanel && Body ? (
          <Suspense
            fallback={<div className="panel-loading muted">Loading…</div>}
          >
            <Body panel={activePanel} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

function SplitView({
  split,
  props,
  startTabDrag,
}: {
  split: SplitNode;
  props: DockLayoutProps;
  startTabDrag: (groupId: string, panelId: string, e: ReactPointerEvent) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize =
    (leftIndex: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const isRow = split.direction === "row";
      const rect = container.getBoundingClientRect();
      const total = isRow ? rect.width : rect.height;
      if (total <= 0) return;
      const startPos = isRow ? e.clientX : e.clientY;
      const startSizes = [...split.sizes];
      const i = leftIndex;
      const j = leftIndex + 1;
      document.body.classList.add("layout-resizing");

      const onMove = (ev: PointerEvent) => {
        const pos = isRow ? ev.clientX : ev.clientY;
        let delta = (pos - startPos) / total;
        const maxDelta = startSizes[j] - MIN_LEAF_FRACTION;
        const minDelta = -(startSizes[i] - MIN_LEAF_FRACTION);
        delta = Math.max(minDelta, Math.min(maxDelta, delta));
        const next = [...startSizes];
        next[i] = startSizes[i] + delta;
        next[j] = startSizes[j] - delta;
        props.onResize(split.id, next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("layout-resizing");
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

  return (
    <div ref={containerRef} className={`layout-split ${split.direction}`}>
      {split.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <div
              className="layout-resize-handle"
              onPointerDown={startResize(i - 1)}
            />
          )}
          <div className="layout-slot" style={{ flex: `${split.sizes[i]} 1 0` }}>
            <RenderNode node={child} props={props} startTabDrag={startTabDrag} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function DropIndicator({ target }: { target: DropTarget }) {
  const style: CSSProperties = { position: "fixed" };

  if (target.kind === "tab") {
    const r = target.rect;
    Object.assign(style, {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    });
    return <div className="drop-indicator drop-indicator-tab" style={style} />;
  }

  const { rect, zone } = target;
  const half = 0.5;
  switch (zone) {
    case "center":
      Object.assign(style, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
      break;
    case "left":
      Object.assign(style, {
        left: rect.left,
        top: rect.top,
        width: rect.width * half,
        height: rect.height,
      });
      break;
    case "right":
      Object.assign(style, {
        left: rect.left + rect.width * half,
        top: rect.top,
        width: rect.width * half,
        height: rect.height,
      });
      break;
    case "top":
      Object.assign(style, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height * half,
      });
      break;
    case "bottom":
      Object.assign(style, {
        left: rect.left,
        top: rect.top + rect.height * half,
        width: rect.width,
        height: rect.height * half,
      });
      break;
  }
  return <div className="drop-indicator" style={style} />;
}
