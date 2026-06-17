import type { RuntimeStatus } from "../shared/types";

export interface LocalProjectRecord {
  id: string;
  name: string;
  projectPath: string;
  preferredPort: number | null;
  runtimeStatus: RuntimeStatus;
  localUrl: string | null;
  publicUrl: string | null;
  lastError: string | null;
  repositoryUrl: string | null;
  cloudPreviewUrl: string | null;
  lastPublishedAt: string | null;
  cloudLastError: string | null;
  edgeOnePreviewUrl: string | null;
  edgeOneExpiresAt: string | null;
  stepIndex: number;
  stepTotal: number;
  stepLabel: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
