import { describe, expect, it } from "vitest";
import {
  baseName,
  extOf,
  redactErrorMessage,
  redactPath,
  toErrorMessage,
} from "./redact";

describe("baseName", () => {
  it("returns the final path segment", () => {
    expect(baseName("/a/b/c.ts")).toBe("c.ts");
    expect(baseName("/a/b/")).toBe("b");
    expect(baseName("c.ts")).toBe("c.ts");
    expect(baseName("C:\\x\\y.txt")).toBe("y.txt");
  });
});

describe("extOf", () => {
  it("returns a lowercase extension or undefined", () => {
    expect(extOf("/a/b/c.TS")).toBe(".ts");
    expect(extOf("/a/b/c")).toBeUndefined();
    expect(extOf("/a/.gitignore")).toBeUndefined();
    expect(extOf("/a/b.tar.gz")).toBe(".gz");
    expect(extOf("/a/b.")).toBeUndefined();
  });
});

describe("redactPath", () => {
  const home = "/Users/sam";

  it("full mode collapses the home dir to ~", () => {
    expect(redactPath("/Users/sam/p/x.ts", "full", { home })).toBe("~/p/x.ts");
    expect(redactPath("/Users/sam", "full", { home })).toBe("~");
    expect(redactPath("/other/x.ts", "full", { home })).toBe("/other/x.ts");
    expect(redactPath("/Users/sam/p/x.ts", "full", {})).toBe("/Users/sam/p/x.ts");
  });

  it("basename mode keeps only the filename", () => {
    expect(redactPath("/Users/sam/p/x.ts", "basename", { home })).toBe("x.ts");
  });

  it("relative mode maps under the nearest root, else falls back to full", () => {
    const roots = ["/Users/sam/proj"];
    expect(
      redactPath("/Users/sam/proj/src/x.ts", "relative", { roots, home }),
    ).toBe("src/x.ts");
    // Exactly the root resolves to its basename.
    expect(redactPath("/Users/sam/proj", "relative", { roots, home })).toBe(
      "proj",
    );
    // Outside any root: fall back to full (home-collapsed).
    expect(
      redactPath("/Users/sam/other/x.ts", "relative", { roots, home }),
    ).toBe("~/other/x.ts");
  });

  it("prefers the longest matching root", () => {
    const roots = ["/a", "/a/b"];
    expect(redactPath("/a/b/c.ts", "relative", { roots })).toBe("c.ts");
  });
});

describe("redactErrorMessage", () => {
  it("reduces embedded absolute paths to a basename", () => {
    const out = redactErrorMessage(
      "failed to write /Users/sam/secret/deep/file.ts: nope",
      500,
    );
    expect(out).toContain("…/file.ts");
    expect(out).not.toContain("/Users/sam/secret");
  });

  it("reduces embedded Windows backslash paths too", () => {
    const out = redactErrorMessage(
      "failed to write C:\\Users\\alice\\secret\\config.json: denied",
      500,
    );
    expect(out).toContain("…/config.json");
    expect(out).not.toContain("alice");
    expect(out).not.toContain("secret");
  });

  it("truncates to maxLen", () => {
    expect(redactErrorMessage("x".repeat(100), 10)).toBe("xxxxxxxxxx…");
  });
});

describe("toErrorMessage", () => {
  it("coerces Error, string, and other values", () => {
    expect(toErrorMessage(new Error("boom"), 500)).toBe("boom");
    expect(toErrorMessage("plain", 500)).toBe("plain");
    expect(toErrorMessage({ a: 1 }, 500)).toBe('{"a":1}');
  });
});
