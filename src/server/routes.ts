import { Router } from "express";
import type { AppDatabase } from "./db";
import { pickFolder as defaultPickFolder } from "./folderPicker";
import { ensureProjectDependencies as defaultEnsureProjectDependencies } from "./dependencyManager";
import type { LiveShareSupervisor } from "./liveShareSupervisor";
import { inspectLocalProject } from "./projectInspector";
import { checkLocalTunnelAvailability as defaultCheckLocalTunnelAvailability } from "./systemChecks";
import { checkUrlHealth as defaultCheckUrlHealth } from "./urlHealth";
import { checkRuntimeAvailability as defaultCheckRuntimeAvailability } from "./runtimeChecks";
import { publishCloudProject as defaultPublishCloudProject } from "./cloudPublisher";
import { publishEdgeOnePreview as defaultPublishEdgeOnePreview } from "./edgeOnePublisher";

export interface RouteDependencies {
  db: AppDatabase;
  supervisor: LiveShareSupervisor;
  pickFolder?: typeof defaultPickFolder;
  checkLocalTunnelAvailability?: typeof defaultCheckLocalTunnelAvailability;
  checkRuntimeAvailability?: typeof defaultCheckRuntimeAvailability;
  ensureProjectDependencies?: typeof defaultEnsureProjectDependencies;
  publishCloudProject?: typeof defaultPublishCloudProject;
  publishEdgeOnePreview?: typeof defaultPublishEdgeOnePreview;
  checkUrlHealth?: typeof defaultCheckUrlHealth;
}

export function createRoutes(deps: RouteDependencies) {
  const router = Router();
  const pickFolder = deps.pickFolder ?? defaultPickFolder;
  const checkLocalTunnelAvailability = deps.checkLocalTunnelAvailability ?? defaultCheckLocalTunnelAvailability;
  const checkRuntimeAvailability = deps.checkRuntimeAvailability ?? defaultCheckRuntimeAvailability;
  const ensureProjectDependencies = deps.ensureProjectDependencies ?? defaultEnsureProjectDependencies;
  const publishCloudProject = deps.publishCloudProject ?? defaultPublishCloudProject;
  const publishEdgeOnePreview = deps.publishEdgeOnePreview ?? defaultPublishEdgeOnePreview;
  const checkUrlHealth = deps.checkUrlHealth ?? defaultCheckUrlHealth;

  router.get("/api/system/status", async (_req, res) => {
    const [tunnel, runtime] = await Promise.all([
      checkLocalTunnelAvailability(),
      checkRuntimeAvailability()
    ]);
    res.json({
      folderPickerAvailable: process.platform === "win32",
      runtime,
      tunnel,
      localtunnel: tunnel
    });
  });

  router.post("/api/system/pick-folder", async (_req, res) => {
    const projectPath = await pickFolder();
    res.json({ projectPath });
  });

  router.get("/api/local-projects", (_req, res) => {
    res.json({ projects: deps.db.listLocalProjects() });
  });

  router.post("/api/local-projects", async (req, res) => {
    const projectPath = typeof req.body?.projectPath === "string"
      ? req.body.projectPath.trim()
      : "";

    if (!projectPath) {
      res.status(400).json({ error: "project path is required" });
      return;
    }

    const existingProject = deps.db.getLocalProjectByPath(projectPath);
    if (existingProject) {
      res.status(409).json({ error: "project already exists" });
      return;
    }

    const inspection = await inspectLocalProject(projectPath);
    if (!inspection.ok) {
      res.status(400).json({ error: inspection.error });
      return;
    }

    const project = deps.db.createLocalProject({
      name: inspection.name,
      projectPath: inspection.projectPath,
      preferredPort: null,
      createdBy: "local"
    });

    res.status(201).json({ project });
  });

  router.post("/api/local-projects/:projectId/start", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    void deps.supervisor.start(project.id).catch(() => undefined);
    res.status(202).json({ ok: true });
  });

  router.post("/api/local-projects/:projectId/install-dependencies", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    try {
      await ensureProjectDependencies(project.projectPath);
      res.status(202).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/api/local-projects/:projectId/cloud", (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    const repositoryUrl = typeof req.body?.repositoryUrl === "string" && req.body.repositoryUrl.trim()
      ? req.body.repositoryUrl.trim()
      : null;
    const cloudPreviewUrl = typeof req.body?.cloudPreviewUrl === "string" && req.body.cloudPreviewUrl.trim()
      ? req.body.cloudPreviewUrl.trim()
      : null;

    deps.db.updateLocalProjectCloud(project.id, {
      repositoryUrl,
      cloudPreviewUrl,
      lastPublishedAt: project.lastPublishedAt,
      cloudLastError: null
    });

    res.json({ project: deps.db.getLocalProject(project.id) });
  });

  router.post("/api/local-projects/:projectId/cloud/publish", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    const commitMessage = typeof req.body?.commitMessage === "string" && req.body.commitMessage.trim()
      ? req.body.commitMessage.trim()
      : "Update preview";

    try {
      const result = await publishCloudProject({
        projectPath: project.projectPath,
        repositoryUrl: project.repositoryUrl,
        commitMessage
      });
      deps.db.updateLocalProjectCloud(project.id, {
        repositoryUrl: result.repositoryUrl,
        cloudPreviewUrl: project.cloudPreviewUrl,
        lastPublishedAt: result.lastPublishedAt,
        cloudLastError: null
      });
      res.json({ project: deps.db.getLocalProject(project.id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.db.updateLocalProjectCloud(project.id, {
        repositoryUrl: project.repositoryUrl,
        cloudPreviewUrl: project.cloudPreviewUrl,
        lastPublishedAt: project.lastPublishedAt,
        cloudLastError: message
      });
      res.status(500).json({ error: message, project: deps.db.getLocalProject(project.id) });
    }
  });

  router.post("/api/local-projects/:projectId/cloud/edgeone", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    const apiToken = typeof req.body?.apiToken === "string" ? req.body.apiToken.trim() : "";
    const projectName = typeof req.body?.projectName === "string" && req.body.projectName.trim()
      ? req.body.projectName.trim()
      : project.name;

    try {
      const result = await publishEdgeOnePreview({
        projectPath: project.projectPath,
        apiToken,
        projectName
      });
      deps.db.updateLocalProjectCloud(project.id, {
        repositoryUrl: project.repositoryUrl,
        cloudPreviewUrl: project.cloudPreviewUrl,
        lastPublishedAt: new Date().toISOString(),
        cloudLastError: null,
        edgeOnePreviewUrl: result.previewUrl,
        edgeOneExpiresAt: result.expiresAt
      });
      res.json({ project: deps.db.getLocalProject(project.id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.db.updateLocalProjectCloud(project.id, {
        repositoryUrl: project.repositoryUrl,
        cloudPreviewUrl: project.cloudPreviewUrl,
        lastPublishedAt: project.lastPublishedAt,
        cloudLastError: message
      });
      res.status(500).json({ error: message, project: deps.db.getLocalProject(project.id) });
    }
  });

  router.post("/api/local-projects/:projectId/check-public", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    if (!project.publicUrl) {
      res.status(400).json({ error: "public URL has not been generated" });
      return;
    }

    const result = await checkUrlHealth(project.publicUrl, {
      timeoutMs: 30000,
      attemptTimeoutMs: 5000,
      retryDelayMs: 1000
    });
    deps.db.updateLocalProjectRuntime(project.id, {
      runtimeStatus: project.runtimeStatus,
      localUrl: project.localUrl,
      publicUrl: project.publicUrl,
      lastError: result.ok ? null : result.message,
      stepIndex: project.stepIndex,
      stepTotal: project.stepTotal,
      stepLabel: project.stepLabel
    });
    res.json(result);
  });

  router.post("/api/local-projects/:projectId/stop", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    await deps.supervisor.stop(project.id);
    res.status(202).json({ ok: true });
  });

  router.post("/api/local-projects/:projectId/restart", async (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    void deps.supervisor.restart(project.id).catch(() => undefined);
    res.status(202).json({ ok: true });
  });

  router.delete("/api/local-projects/:projectId", (req, res) => {
    const project = deps.db.getLocalProject(req.params.projectId);
    if (!project) {
      res.sendStatus(404);
      return;
    }

    deps.db.deleteLocalProject(project.id);
    res.sendStatus(204);
  });

  return router;
}
