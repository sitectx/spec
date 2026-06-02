import { describe, expect, it } from "vitest";
import { makeTempRoot, runCli } from "./helpers.js";

describe("inspect", () => {
  it("inspect --root summarizes generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(
      runCli([
        "init",
        "--root",
        root,
        "--site-url",
        "https://example.com",
        "--name",
        "Example Site"
      ]).status
    ).toBe(0);

    const result = runCli(["inspect", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Site name: Example Site");
    expect(result.stdout).toContain("Context URL: /sitectx.json");
    expect(result.stdout).toContain("Sections: 2");
    expect(result.stdout).toContain("Updates: 1");
  });

  it("inspect --json returns discovery fields", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["inspect", "--root", root, "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.specVersion).toBe("0.1");
    expect(parsed.contextUrl).toBe("/sitectx.json");
  });
});
