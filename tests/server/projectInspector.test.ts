import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectLocalProject } from "../../src/server/projectInspector";

describe("projectInspector", () => {
  it("accepts a React + Vite project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vite-project-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      scripts: { dev: "vite --host" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^7.0.0" }
    }));

    const result = await inspectLocalProject(root);
    expect(result).toMatchObject({ ok: true, name: path.basename(root) });
  });

  it("rejects a directory without package.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plain-folder-"));
    const result = await inspectLocalProject(root);
    expect(result).toMatchObject({ ok: false, error: "missing package.json" });
  });
});
