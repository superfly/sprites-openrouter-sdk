import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const projectRoot = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "sprites-openrouter-package-"));

try {
  const packOutput = execFileSync(
    npm,
    [
      "pack",
      "--json",
      "--silent",
      "--pack-destination",
      temporaryRoot,
      "--cache",
      join(temporaryRoot, "npm-cache"),
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const [packResult] = JSON.parse(packOutput);
  assert.equal(packResult?.name, "@fly/sprites-openrouter");
  assert.ok(packResult?.filename, "npm pack did not produce a tarball");

  await writeFile(
    join(temporaryRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      join(temporaryRoot, packResult.filename),
    ],
    { cwd: temporaryRoot, stdio: "inherit" },
  );

  await writeFile(
    join(temporaryRoot, "smoke.mjs"),
    `
      import assert from "node:assert/strict";
      import {
        DEFAULT_LIMITS,
        SpriteWorkspaceNotFoundError,
        createSpriteTools,
        createSpriteWorkspace,
      } from "@fly/sprites-openrouter";

      assert.equal(typeof DEFAULT_LIMITS, "object");
      assert.equal(typeof SpriteWorkspaceNotFoundError, "function");
      assert.equal(typeof createSpriteTools, "function");
      assert.equal(typeof createSpriteWorkspace, "function");
    `,
  );
  execFileSync(process.execPath, [join(temporaryRoot, "smoke.mjs")], {
    cwd: temporaryRoot,
    stdio: "inherit",
  });

  console.log("Packaged consumer smoke test passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
