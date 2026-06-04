import { describe, expect, it } from "vitest";
import { makeTempRoot, runCli } from "./helpers.js";

describe("doctor local", () => {
  it("doctor --root passes on generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["doctor", root]);

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

  it("doctor unsupported URL schemes fail cleanly", () => {
    const result = runCli(["doctor", "ftp://example.com"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Doctor only accepts http/https URLs or local paths");
    expect(result.stderr).not.toContain("Trace:");
  });
});
