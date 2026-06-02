import { describe, expect, it } from "vitest";
import { makeTempRoot, runCli } from "./helpers.js";

describe("doctor local", () => {
  it("doctor --root passes on generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["doctor", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Result: PASS with 1 warning");
  });

  it("doctor --root --strict exits nonzero when warnings are present", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["doctor", "--root", root, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("HTTP reachability and content-type headers were not checked");
  });
});
