import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  BUILTIN_THEMES_BY_ID,
  combineThemes,
  createCustomTheme,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  parseThemeImport,
  resolveTheme,
  sanitizeCustomThemes,
  sanitizeTheme,
  slugify,
  SYSTEM_THEME,
  THEME_COLOR_FIELDS,
  type Theme,
} from "./themes";

const sampleColors = () => ({ ...BUILTIN_THEMES_BY_ID[DEFAULT_DARK_THEME_ID].colors });

describe("built-in registry", () => {
  it("indexes every built-in theme by id", () => {
    for (const theme of BUILTIN_THEMES) {
      expect(BUILTIN_THEMES_BY_ID[theme.id]).toBe(theme);
    }
  });

  it("defines every colour field on every built-in theme", () => {
    for (const theme of BUILTIN_THEMES) {
      for (const field of THEME_COLOR_FIELDS) {
        expect(typeof theme.colors[field.key]).toBe("string");
      }
    }
  });

  it("ships default dark and light themes of the right kind", () => {
    expect(BUILTIN_THEMES_BY_ID[DEFAULT_DARK_THEME_ID]?.kind).toBe("dark");
    expect(BUILTIN_THEMES_BY_ID[DEFAULT_LIGHT_THEME_ID]?.kind).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("maps system to dark/light by the OS preference", () => {
    expect(resolveTheme(SYSTEM_THEME, true).id).toBe(DEFAULT_DARK_THEME_ID);
    expect(resolveTheme(SYSTEM_THEME, false).id).toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it("returns the requested theme for a concrete id", () => {
    expect(resolveTheme("midnight", false).id).toBe("midnight");
  });

  it("falls back to the default dark theme for an unknown id", () => {
    expect(resolveTheme("removed", false).id).toBe(DEFAULT_DARK_THEME_ID);
  });

  it("resolves custom themes when present in the list", () => {
    const custom = createCustomTheme({
      label: "My Theme",
      kind: "dark",
      colors: sampleColors(),
    });
    const all = combineThemes([custom]);
    expect(resolveTheme(custom.id, false, all).id).toBe(custom.id);
  });
});

describe("combineThemes", () => {
  it("appends custom themes after built-ins", () => {
    const custom = createCustomTheme({
      label: "Extra",
      kind: "light",
      colors: sampleColors(),
    });
    const all = combineThemes([custom]);
    expect(all).toHaveLength(BUILTIN_THEMES.length + 1);
    expect(all.at(-1)?.id).toBe(custom.id);
  });

  it("never lets a custom theme shadow a built-in id", () => {
    const shadow: Theme = {
      id: "dark",
      label: "Fake Dark",
      kind: "dark",
      colors: sampleColors(),
    };
    const all = combineThemes([shadow]);
    expect(all.filter((t) => t.id === "dark")).toHaveLength(1);
    expect(BUILTIN_THEMES_BY_ID.dark.label).toBe(all.find((t) => t.id === "dark")?.label);
  });
});

describe("createCustomTheme", () => {
  it("derives a unique slug id and avoids built-in/system collisions", () => {
    const t = createCustomTheme({
      label: "Solarized Light",
      kind: "light",
      colors: sampleColors(),
    });
    // "solarized-light" is a built-in id, so it must be suffixed.
    expect(t.id).not.toBe("solarized-light");
    expect(t.id.startsWith("solarized-light")).toBe(true);
  });

  it("preserves the id when editing in place", () => {
    const t = createCustomTheme({
      id: "my-theme",
      label: "Renamed",
      kind: "dark",
      colors: sampleColors(),
    });
    expect(t.id).toBe("my-theme");
  });
});

describe("sanitizeTheme", () => {
  it("rejects values without a valid kind or label", () => {
    expect(sanitizeTheme({ label: "x" })).toBeNull();
    expect(sanitizeTheme({ kind: "dark" })).toBeNull();
    expect(sanitizeTheme("nope")).toBeNull();
  });

  it("fills missing colours from the base theme of the kind", () => {
    const theme = sanitizeTheme({
      label: "Sparse",
      kind: "light",
      colors: { accent: "#ff0000" },
    });
    expect(theme).not.toBeNull();
    expect(theme!.colors.accent).toBe("#ff0000");
    // Untouched fields inherit the light base.
    expect(theme!.colors.bg).toBe(BUILTIN_THEMES_BY_ID[DEFAULT_LIGHT_THEME_ID].colors.bg);
  });
});

describe("parseThemeImport", () => {
  const good = { label: "Pack Theme", kind: "dark", colors: {} };

  it("accepts a single object, a bare array, and a { themes } pack", () => {
    expect(parseThemeImport(good)).toHaveLength(1);
    expect(parseThemeImport([good, good])).toHaveLength(2);
    expect(parseThemeImport({ themes: [good, good, good] })).toHaveLength(3);
  });

  it("skips invalid entries and de-duplicates ids", () => {
    const themes = parseThemeImport([good, { junk: true }, good]);
    expect(themes).toHaveLength(2);
    expect(themes[0].id).not.toBe(themes[1].id);
  });
});

describe("sanitizeCustomThemes", () => {
  it("returns [] for non-arrays and drops corrupt entries", () => {
    expect(sanitizeCustomThemes(null)).toEqual([]);
    expect(sanitizeCustomThemes("x")).toEqual([]);
    expect(
      sanitizeCustomThemes([{ label: "ok", kind: "dark", colors: {} }, 42]),
    ).toHaveLength(1);
  });
});

describe("slugify", () => {
  it("kebab-cases and strips junk", () => {
    expect(slugify("  My Cool Theme!! ")).toBe("my-cool-theme");
  });

  it("falls back to 'theme' for empty input", () => {
    expect(slugify("@@@")).toBe("theme");
  });
});
