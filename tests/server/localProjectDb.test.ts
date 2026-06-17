import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db";

describe("local project database", () => {
  it("creates and lists local projects with idle runtime state", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "live-share-db-"));
    const db = createDatabase(path.join(root, "app.sqlite"));

    const project = db.createLocalProject({
      name: "Attendance PC",
      projectPath: "C:\\demo\\attendance-pc",
      preferredPort: null,
      createdBy: "local"
    });

    expect(project).toMatchObject({
      name: "Attendance PC",
      projectPath: "C:\\demo\\attendance-pc",
      preferredPort: null,
      runtimeStatus: "idle",
      localUrl: null,
      publicUrl: null,
      lastError: null,
      stepIndex: 0,
      stepTotal: 0,
      stepLabel: null
    });

    expect(db.listLocalProjects()).toEqual([project]);
  });
});
