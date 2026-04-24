import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

const UI_ROOT = resolve(import.meta.dirname, "..");

function fileExists(relativePath: string): boolean {
  return existsSync(resolve(UI_ROOT, relativePath));
}

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(UI_ROOT, relativePath), "utf-8"));
}

describe("UI scaffold", () => {
  it("package.json exists and has correct name", () => {
    const pkg = readJson("package.json");
    expect(pkg.name).toBe("anthroclaw-ui");
  });

  it("next.config.ts exists", () => {
    expect(fileExists("next.config.ts")).toBe(true);
  });

  it("layout.tsx exists", () => {
    expect(fileExists("app/layout.tsx")).toBe(true);
  });

  it("all placeholder pages exist", () => {
    const pages = [
      "app/(auth)/login/page.tsx",
      "app/(dashboard)/page.tsx",
      "app/(dashboard)/layout.tsx",
      "app/(dashboard)/fleet/page.tsx",
    ];
    for (const page of pages) {
      expect(fileExists(page), `missing: ${page}`).toBe(true);
    }
  });

  it("cn() utility merges classes correctly", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", false && "hidden")).toBe("text-red-500");
    expect(cn("bg-white", undefined, "text-black")).toBe("bg-white text-black");
  });

  it("components.json has correct config", () => {
    const config = readJson("components.json");
    expect(config.rsc).toBe(true);
    expect(config.tsx).toBe(true);
  });

  it("tsconfig.json has correct path aliases", () => {
    const tsconfig = readJson("tsconfig.json");
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    const paths = opts.paths as Record<string, string[]>;
    expect(paths["@/*"]).toEqual(["./*"]);
    expect(paths["@backend/*"]).toEqual(["../src/*"]);
  });

  it("globals.css exists", () => {
    expect(fileExists("app/globals.css")).toBe(true);
  });

  it("postcss.config.mjs exists", () => {
    expect(fileExists("postcss.config.mjs")).toBe(true);
  });
});
