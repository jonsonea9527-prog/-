export type RuntimeStatus = "idle" | "starting" | "running" | "failed" | "stopping";

export interface LocalProjectSummary {
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
  createdAt: string;
  updatedAt: string;
}

export interface LocalProjectLogEntry {
  at: string;
  stream: "system" | "stdout" | "stderr";
  message: string;
}
