import { describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

describe("CLI help and version", () => {
  it("sitectx --help exits 0 and shows commands", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("generate");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("inspect");
  });

  it("sitectx version prints the CLI version", () => {
    const result = runCli(["version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("SiteCTX CLI 0.1.0");
  });
});
