import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/server/db";

function tempDbPath() {
  return join(mkdtempSync(join(tmpdir(), "preview-db-")), "app.sqlite");
}

describe("createDatabase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates indexes for local project listing queries", () => {
    const dbPath = tempDbPath();
    createDatabase(dbPath);

    const rawDb = new DatabaseSync(dbPath);
    const indexes = rawDb.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name IN ('idx_local_projects_created_at')
    `).all().map((row) => row.name);
    rawDb.close();

    expect(indexes).toEqual(["idx_local_projects_created_at"]);
  });

  it("creates, reads, updates and deletes local projects", () => {
    const db = createDatabase(tempDbPath());

    const project = db.createLocalProject({
      name: "Attendance PC",
      projectPath: "C:\\demo\\attendance-pc",
      preferredPort: 5174,
      createdBy: "local"
    });

    expect(db.getLocalProject(project.id)).toEqual(project);
    expect(db.getLocalProjectByPath("C:\\demo\\attendance-pc")).toEqual(project);
    expect(db.listLocalProjects()).toEqual([project]);

    vi.setSystemTime(new Date("2026-06-05T08:01:00.000Z"));
    db.updateLocalProjectRuntime(project.id, {
      runtimeStatus: "running",
      localUrl: "http://localhost:5174/",
      publicUrl: "https://demo.loca.lt",
      lastError: null,
      stepIndex: 5,
      stepTotal: 5,
      stepLabel: "启动完成"
    });

    expect(db.getLocalProject(project.id)).toMatchObject({
      runtimeStatus: "running",
      localUrl: "http://localhost:5174/",
      publicUrl: "https://demo.loca.lt",
      stepIndex: 5,
      stepTotal: 5,
      stepLabel: "启动完成",
      updatedAt: "2026-06-05T08:01:00.000Z"
    });

    db.updateLocalProjectCloud(project.id, {
      repositoryUrl: "https://github.com/example/attendance-pc",
      cloudPreviewUrl: "https://attendance-pc.vercel.app",
      lastPublishedAt: "2026-06-05T08:01:30.000Z",
      cloudLastError: null,
      edgeOnePreviewUrl: "https://attendance.edgeone.cool?eo_token=abc",
      edgeOneExpiresAt: "2026-06-05T11:01:30.000Z"
    });

    expect(db.getLocalProject(project.id)).toMatchObject({
      repositoryUrl: "https://github.com/example/attendance-pc",
      cloudPreviewUrl: "https://attendance-pc.vercel.app",
      lastPublishedAt: "2026-06-05T08:01:30.000Z",
      cloudLastError: null,
      edgeOnePreviewUrl: "https://attendance.edgeone.cool?eo_token=abc",
      edgeOneExpiresAt: "2026-06-05T11:01:30.000Z"
    });

    vi.setSystemTime(new Date("2026-06-05T08:02:00.000Z"));
    db.resetRuntimeState();
    expect(db.getLocalProject(project.id)).toMatchObject({
      runtimeStatus: "idle",
      localUrl: null,
      publicUrl: null,
      lastError: null,
      stepIndex: 0,
      stepTotal: 0,
      stepLabel: null,
      updatedAt: "2026-06-05T08:02:00.000Z"
    });

    db.deleteLocalProject(project.id);
    expect(db.getLocalProject(project.id)).toBeNull();
    expect(db.listLocalProjects()).toEqual([]);
  });
});
