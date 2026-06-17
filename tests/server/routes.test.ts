import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app";
import { createDatabase, type AppDatabase } from "../../src/server/db";
import type { LiveShareSupervisor } from "../../src/server/liveShareSupervisor";

interface TestContext {
  app: ReturnType<typeof createApp>;
  db: AppDatabase;
  supervisor: LiveShareSupervisor;
}

function createContext(
  options: {
    db?: AppDatabase;
    supervisor?: LiveShareSupervisor;
    pickFolder?: () => Promise<string | null>;
    checkLocalTunnelAvailability?: () => Promise<{ ok: boolean; message: string }>;
    checkRuntimeAvailability?: () => Promise<{
      node: { ok: boolean; version?: string; message: string };
      npm: { ok: boolean; version?: string; message: string };
    }>;
    ensureProjectDependencies?: (projectPath: string) => Promise<void>;
    publishCloudProject?: (input: {
      projectPath: string;
      repositoryUrl: string | null;
      commitMessage: string;
    }) => Promise<{ repositoryUrl: string | null; lastPublishedAt: string }>;
    publishEdgeOnePreview?: (input: {
      projectPath: string;
      apiToken?: string;
      projectName?: string;
    }) => Promise<{ previewUrl: string; expiresAt: string | null }>;
    checkUrlHealth?: (url: string) => Promise<{ ok: boolean; message: string }>;
  } = {}
): TestContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-share-routes-"));
  const db = options.db ?? createDatabase(path.join(root, "app.sqlite"));
  const supervisor = options.supervisor ?? {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };

  const app = createApp({
    db,
    supervisor,
    pickFolder: options.pickFolder,
    checkLocalTunnelAvailability: options.checkLocalTunnelAvailability,
    checkRuntimeAvailability: options.checkRuntimeAvailability,
    ensureProjectDependencies: options.ensureProjectDependencies,
    publishCloudProject: options.publishCloudProject,
    publishEdgeOnePreview: options.publishEdgeOnePreview,
    checkUrlHealth: options.checkUrlHealth
  });

  return { app, db, supervisor };
}

describe("server routes", () => {
  let context: TestContext;

  beforeEach(() => {
    context = createContext({
      pickFolder: async () => "C:\\picked-folder",
      checkLocalTunnelAvailability: async () => ({ ok: true, message: "public share component detected" }),
      checkRuntimeAvailability: async () => ({
        node: { ok: true, version: "v24.0.0", message: "Node.js v24.0.0" },
        npm: { ok: true, version: "10.0.0", message: "npm 10.0.0" }
      })
    });
  });

  it("reports system status and picks a folder", async () => {
    const statusResponse = await request(context.app)
      .get("/api/system/status")
      .expect(200);

    expect(statusResponse.body).toMatchObject({
      folderPickerAvailable: true,
      localtunnel: { ok: true, message: "public share component detected" },
      runtime: {
        node: { ok: true, version: "v24.0.0", message: "Node.js v24.0.0" },
        npm: { ok: true, version: "10.0.0", message: "npm 10.0.0" }
      }
    });

    const pickerResponse = await request(context.app)
      .post("/api/system/pick-folder")
      .expect(200);

    expect(pickerResponse.body.projectPath).toBe("C:\\picked-folder");
  });

  it("creates and lists local projects", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vite-project-"));
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "attendance-pc-preview",
      scripts: { dev: "vite --host" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^7.0.0" }
    }));

    const response = await request(context.app)
      .post("/api/local-projects")
      .send({ projectPath: projectRoot })
      .expect(201);

    expect(response.body.project).toMatchObject({
      name: "attendance-pc-preview",
      projectPath: projectRoot,
      runtimeStatus: "idle",
      stepIndex: 0,
      stepTotal: 0,
      stepLabel: null
    });

    const listResponse = await request(context.app)
      .get("/api/local-projects")
      .expect(200);

    expect(listResponse.body.projects).toHaveLength(1);
    expect(listResponse.body.projects[0].projectPath).toBe(projectRoot);
  });

  it("rejects invalid local project paths", async () => {
    const response = await request(context.app)
      .post("/api/local-projects")
      .send({ projectPath: "C:\\missing-project" })
      .expect(400);

    expect(response.body.error).toBe("path not found");
  });

  it("starts a local project runtime", async () => {
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    await request(context.app)
      .post(`/api/local-projects/${project.id}/start`)
      .expect(202);

    expect(context.supervisor.start).toHaveBeenCalledWith(project.id);
  });

  it("installs dependencies only when explicitly requested", async () => {
    const ensureProjectDependencies = vi.fn(async () => undefined);
    context = createContext({
      ensureProjectDependencies,
      pickFolder: async () => "C:\\picked-folder",
      checkLocalTunnelAvailability: async () => ({ ok: true, message: "public share component detected" })
    });
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    await request(context.app)
      .post(`/api/local-projects/${project.id}/install-dependencies`)
      .expect(202);

    expect(ensureProjectDependencies).toHaveBeenCalledWith("C:\\demo");
  });

  it("saves cloud settings and publishes to GitHub", async () => {
    const publishCloudProject = vi.fn(async () => ({
      repositoryUrl: "https://github.com/example/demo",
      lastPublishedAt: "2026-06-15T10:00:00.000Z"
    }));
    context = createContext({
      publishCloudProject,
      pickFolder: async () => "C:\\picked-folder",
      checkLocalTunnelAvailability: async () => ({ ok: true, message: "public share component detected" })
    });
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    await request(context.app)
      .put(`/api/local-projects/${project.id}/cloud`)
      .send({
        repositoryUrl: "https://github.com/example/demo",
        cloudPreviewUrl: "https://demo.vercel.app"
      })
      .expect(200);

    expect(context.db.getLocalProject(project.id)).toMatchObject({
      repositoryUrl: "https://github.com/example/demo",
      cloudPreviewUrl: "https://demo.vercel.app"
    });

    const publishResponse = await request(context.app)
      .post(`/api/local-projects/${project.id}/cloud/publish`)
      .send({ commitMessage: "Update preview" })
      .expect(200);

    expect(publishCloudProject).toHaveBeenCalledWith({
      projectPath: "C:\\demo",
      repositoryUrl: "https://github.com/example/demo",
      commitMessage: "Update preview"
    });
    expect(publishResponse.body.project).toMatchObject({
      repositoryUrl: "https://github.com/example/demo",
      cloudPreviewUrl: "https://demo.vercel.app",
      lastPublishedAt: "2026-06-15T10:00:00.000Z",
      cloudLastError: null
    });
  });

  it("publishes an EdgeOne temporary preview", async () => {
    const publishEdgeOnePreview = vi.fn(async () => ({
      previewUrl: "https://demo.edgeone.cool?eo_token=abc",
      expiresAt: "2026-06-15T13:00:00.000Z"
    }));
    context = createContext({
      publishEdgeOnePreview,
      pickFolder: async () => "C:\\picked-folder",
      checkLocalTunnelAvailability: async () => ({ ok: true, message: "public share component detected" })
    });
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    const response = await request(context.app)
      .post(`/api/local-projects/${project.id}/cloud/edgeone`)
      .send({ apiToken: "token-value", projectName: "attendance-preview" })
      .expect(200);

    expect(publishEdgeOnePreview).toHaveBeenCalledWith({
      projectPath: "C:\\demo",
      apiToken: "token-value",
      projectName: "attendance-preview"
    });
    expect(response.body.project).toMatchObject({
      edgeOnePreviewUrl: "https://demo.edgeone.cool?eo_token=abc",
      edgeOneExpiresAt: "2026-06-15T13:00:00.000Z",
      cloudLastError: null
    });
  });

  it("checks public URL health without restarting the project", async () => {
    const checkUrlHealth = vi.fn(async () => ({
      ok: false,
      message: "公网地址已生成，但本机校验超时。"
    }));
    context = createContext({
      checkUrlHealth,
      pickFolder: async () => "C:\\picked-folder",
      checkLocalTunnelAvailability: async () => ({ ok: true, message: "public share component detected" })
    });
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });
    context.db.updateLocalProjectRuntime(project.id, {
      runtimeStatus: "running",
      localUrl: "http://localhost:4173/",
      publicUrl: "https://demo.loca.lt",
      lastError: null,
      stepIndex: 4,
      stepTotal: 4,
      stepLabel: "Ready"
    });

    const response = await request(context.app)
      .post(`/api/local-projects/${project.id}/check-public`)
      .expect(200);

    expect(checkUrlHealth).toHaveBeenCalledWith("https://demo.loca.lt", expect.any(Object));
    expect(response.body).toEqual({
      ok: false,
      message: "公网地址已生成，但本机校验超时。"
    });
    expect(context.db.getLocalProject(project.id)?.runtimeStatus).toBe("running");
    expect(context.db.getLocalProject(project.id)?.lastError).toBe("公网地址已生成，但本机校验超时。");
  });

  it("stops and restarts a local project runtime", async () => {
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    await request(context.app)
      .post(`/api/local-projects/${project.id}/stop`)
      .expect(202);
    await request(context.app)
      .post(`/api/local-projects/${project.id}/restart`)
      .expect(202);

    expect(context.supervisor.stop).toHaveBeenCalledWith(project.id);
    expect(context.supervisor.restart).toHaveBeenCalledWith(project.id);
  });

  it("returns restart immediately even if background restart is still running", async () => {
    const restart = vi.fn(() => new Promise<void>(() => undefined));
    context = createContext({
      supervisor: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        restart,
        stopAll: vi.fn(async () => undefined)
      },
      pickFolder: async () => "C:\\picked-folder",
      checkLocalTunnelAvailability: async () => ({ ok: true, message: "public share component detected" })
    });

    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    await request(context.app)
      .post(`/api/local-projects/${project.id}/restart`)
      .expect(202);

    expect(restart).toHaveBeenCalledWith(project.id);
  });

  it("deletes a local project", async () => {
    const project = context.db.createLocalProject({
      name: "Demo",
      projectPath: "C:\\demo",
      preferredPort: null,
      createdBy: "local"
    });

    await request(context.app)
      .delete(`/api/local-projects/${project.id}`)
      .expect(204);

    expect(context.db.getLocalProject(project.id)).toBeNull();
  });
});
