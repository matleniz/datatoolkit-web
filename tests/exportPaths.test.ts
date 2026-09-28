import { describe, expect, it } from "vitest";
import {
  isAbsolutePath,
  joinManifestPath,
  outDirFromProcessedPath,
  resolveExportOutDir,
} from "../src/bench/export/exportPaths";

describe("exportPaths", () => {
  it("detects absolute paths (posix and windows)", () => {
    expect(isAbsolutePath("/tmp/export")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\out")).toBe(true);
    expect(isAbsolutePath("D:/data/out")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("./export")).toBe(false);
    expect(isAbsolutePath("export")).toBe(false);
  });

  it("derives out_dir from a processed/ output path", () => {
    expect(
      outDirFromProcessedPath("/tmp/run/processed/train.parquet"),
    ).toBe("/tmp/run");
    expect(
      outDirFromProcessedPath("C:\\out\\processed\\test.parquet"),
    ).toBe("C:\\out");
    expect(outDirFromProcessedPath("/tmp/run/manifest.json")).toBeNull();
    expect(outDirFromProcessedPath("processed/train.parquet")).toBeNull();
  });

  it("prefers absolute requested out_dir", () => {
    expect(
      resolveExportOutDir("/abs/out", [
        "/other/processed/train.parquet",
      ]),
    ).toBe("/abs/out");
  });

  it("derives absolute out_dir from outputs when requested was relative", () => {
    expect(
      resolveExportOutDir("./export", [
        "/home/user/export/processed/train.parquet",
        "/home/user/export/processed/test.parquet",
      ]),
    ).toBe("/home/user/export");
  });

  it("falls back to requested when no processed/ path exists", () => {
    expect(resolveExportOutDir("./export", [])).toBe("./export");
    expect(
      resolveExportOutDir("rel/out/", ["/tmp/something.parquet"]),
    ).toBe("rel/out");
  });

  it("joins manifest.json under out_dir", () => {
    expect(joinManifestPath("/tmp/run")).toBe("/tmp/run/manifest.json");
    expect(joinManifestPath("/tmp/run/")).toBe("/tmp/run/manifest.json");
    expect(joinManifestPath("C:\\out")).toBe("C:\\out\\manifest.json");
  });
});
