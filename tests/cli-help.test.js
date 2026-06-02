import { describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

describe("CLI help and version", () => {
  it("sitectx --help exits 0 and shows commands", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("discover");
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

  it("standard version flags print the raw package version", () => {
    for (const flag of ["--version", "-V"]) {
      const result = runCli([flag]);

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("0.1.0");
    }
  });
});
