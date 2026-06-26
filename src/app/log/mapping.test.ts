import { describe, expect, it } from "vitest";
import {
  commandPayload,
  countLines,
  fsChangedPayload,
  makeFileRef,
  sessionEvent,
} from "./mapping";
import type { SessionData } from "../session/sessionData";
import type { PanelState } from "../../layout/panel";

const scope = "full" as const;
const ctx = {};

function state(panels: Record<string, PanelState> = {}): SessionData {
  return {
    version: 3,
    ui: { theme: "dark", activeGroupId: null },
    layout: null,
    panels,
  };
}

describe("countLines", () => {
  it("counts newlines + 1", () => {
    expect(countLines("")).toBe(1);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(3);
  });
});

describe("makeFileRef", () => {
  it("redacts the path and derives the extension", () => {
    expect(makeFileRef("/a/b.ts", "basename", {})).toEqual({
      path: "b.ts",
      ext: ".ts",
    });
    expect(makeFileRef("/a/b", "basename", {})).toEqual({ path: "b" });
  });
});

describe("sessionEvent", () => {
  it("maps hydrate from the incoming session", () => {
    const e = sessionEvent(
      { type: "hydrate", session: state({ p: { id: "p", kind: "terminal" } }) },
      state(),
      scope,
      ctx,
    );
    expect(e.action).toBe("session.hydrate");
    expect(e.payload).toEqual({
      kind: "hydrate",
      restored: false,
      panelCount: 1,
    });
  });

  it("maps setTheme", () => {
    const e = sessionEvent({ type: "setTheme", theme: "light" }, state(), scope, ctx);
    expect(e.action).toBe("theme.set");
    expect(e.payload).toEqual({ kind: "theme", to: "light" });
  });

  it("flags reused folders/files from previous state", () => {
    const prev = state({
      e1: { id: "e1", kind: "explorer", root: "/p" },
      f1: { id: "f1", kind: "editor", path: "/p/a.ts" },
    });
    expect(
      sessionEvent({ type: "openFolderTab", root: "/p" }, prev, scope, ctx).payload,
    ).toMatchObject({ kind: "folder", root: "/p", reused: true });
    expect(
      sessionEvent({ type: "openFolderTab", root: "/q" }, prev, scope, ctx).payload,
    ).toMatchObject({ reused: false });
    expect(
      sessionEvent({ type: "openFileTab", path: "/p/a.ts" }, prev, scope, ctx)
        .payload,
    ).toMatchObject({ kind: "file", reused: true });
    expect(
      sessionEvent({ type: "openFileTab", path: "/p/b.ts" }, prev, scope, ctx)
        .payload,
    ).toMatchObject({ reused: false });
  });

  it("resolves closed panel kind and file from previous state", () => {
    const prev = state({ f1: { id: "f1", kind: "editor", path: "/p/a.ts" } });
    const e = sessionEvent({ type: "closePanel", panelId: "f1" }, prev, scope, ctx);
    expect(e.action).toBe("panel.close");
    expect(e.payload).toMatchObject({
      kind: "panel",
      panelId: "f1",
      panelKind: "editor",
      file: { path: "/p/a.ts", ext: ".ts" },
    });
  });

  it("collapses active-tab and active-group churn by key", () => {
    const tab = sessionEvent(
      { type: "setActiveTab", groupId: "g1", panelId: "p1" },
      state(),
      scope,
      ctx,
    );
    expect(tab.action).toBe("tab.activate");
    expect(tab.collapseKey).toBe("tab.activate:g1");

    const grp = sessionEvent(
      { type: "setActiveGroup", groupId: "g2" },
      state(),
      scope,
      ctx,
    );
    expect(grp.collapseKey).toBe("group.activate:g2");
  });

  it("maps move/split tab", () => {
    expect(
      sessionEvent(
        { type: "moveTab", panelId: "p1", targetGroupId: "g2", index: 1 },
        state(),
        scope,
        ctx,
      ).payload,
    ).toEqual({ kind: "tabMove", panelId: "p1", targetGroup: "g2", index: 1 });
    expect(
      sessionEvent(
        { type: "splitTab", panelId: "p1", targetGroupId: "g2", edge: "right" },
        state(),
        scope,
        ctx,
      ).payload,
    ).toEqual({
      kind: "tabSplit",
      panelId: "p1",
      targetGroup: "g2",
      edge: "right",
    });
  });

  it("maps resizeSplit to pane count and a collapse key, omitting sizes", () => {
    const e = sessionEvent(
      { type: "resizeSplit", splitId: "s1", sizes: [0.3, 0.7] },
      state(),
      scope,
      ctx,
    );
    expect(e.payload).toEqual({ kind: "splitResize", splitId: "s1", paneCount: 2 });
    expect(e.collapseKey).toBe("split.resize:s1");
  });

  it("maps togglePanelKind opened state from previous presence", () => {
    expect(
      sessionEvent({ type: "togglePanelKind", kind: "terminal" }, state(), scope, ctx)
        .payload,
    ).toEqual({ kind: "panelToggle", panelKind: "terminal", opened: true });
    const withTerminal = state({ t: { id: "t", kind: "terminal" } });
    expect(
      sessionEvent(
        { type: "togglePanelKind", kind: "terminal" },
        withTerminal,
        scope,
        ctx,
      ).payload,
    ).toEqual({ kind: "panelToggle", panelKind: "terminal", opened: false });
  });
});

describe("commandPayload", () => {
  it("builds a command payload, preferring an explicit keybinding", () => {
    expect(commandPayload({ id: "file.save", title: "Save File" }, "palette")).toEqual(
      { kind: "command", commandId: "file.save", title: "Save File", via: "palette" },
    );
    expect(
      commandPayload(
        { id: "x", title: "X", keybinding: "Mod+s" },
        "keybinding",
      ),
    ).toMatchObject({ via: "keybinding", keybinding: "Mod+s" });
  });
});

describe("fsChangedPayload", () => {
  it("counts all and samples the first N, redacted", () => {
    expect(
      fsChangedPayload(["/a/x", "/a/y", "/a/z"], 2, "basename", {}),
    ).toEqual({ kind: "fsChanged", count: 3, sample: ["x", "y"] });
  });
});
