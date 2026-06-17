import cors from "cors";
import express from "express";
import type { AppDatabase } from "./db";
import { pickFolder as defaultPickFolder } from "./folderPicker";
import { ensureProjectDependencies as defaultEnsureProjectDependencies } from "./dependencyManager";
import type { LiveShareSupervisor } from "./liveShareSupervisor";
import { createRoutes } from "./routes";
import { checkLocalTunnelAvailability as defaultCheckLocalTunnelAvailability } from "./systemChecks";
import { checkUrlHealth as defaultCheckUrlHealth } from "./urlHealth";
import { checkRuntimeAvailability as defaultCheckRuntimeAvailability } from "./runtimeChecks";
import { publishCloudProject as defaultPublishCloudProject } from "./cloudPublisher";
import { publishEdgeOnePreview as defaultPublishEdgeOnePreview } from "./edgeOnePublisher";

export interface AppDependencies {
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

export function createApp(deps: AppDependencies) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(createRoutes(deps));

  return app;
}
