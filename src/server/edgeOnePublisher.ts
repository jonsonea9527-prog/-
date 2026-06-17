import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildProcessEnv, runCommand } from "./processRunner";

export interface EdgeOneDeployResult {
  previewUrl: string;
  expiresAt: string | null;
}

type McpContentResult = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

export function parseEdgeOneDeployResult(result: McpContentResult): EdgeOneDeployResult {
  const text = result.content?.find((item) => item.type === "text" && item.text)?.text;
  if (!text) {
    throw new Error("EdgeOne 没有返回部署结果。");
  }

  const parsed = JSON.parse(text) as {
    url?: string;
    expiredTime?: number;
  };

  if (!parsed.url) {
    throw new Error(text);
  }

  return {
    previewUrl: parsed.url,
    expiresAt: parsed.expiredTime ? new Date(parsed.expiredTime * 1000).toISOString() : null
  };
}

async function buildProject(projectPath: string) {
  const result = await runCommand("npm", ["run", "build"], projectPath);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "npm run build failed");
  }
}

export async function publishEdgeOnePreview(input: {
  projectPath: string;
  apiToken?: string;
  projectName?: string;
}): Promise<EdgeOneDeployResult> {
  const apiToken = input.apiToken?.trim() || process.env.EDGEONE_PAGES_API_TOKEN?.trim();
  if (!apiToken) {
    throw new Error("请先填写 EdgeOne Pages API Token。");
  }

  await buildProject(input.projectPath);

  const client = new Client({
    name: "local-live-share-edgeone",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["edgeone-pages-mcp-fullstack@latest", "--region", "china"],
    cwd: input.projectPath,
    env: {
      ...buildProcessEnv(),
      EDGEONE_PAGES_API_TOKEN: apiToken,
      EDGEONE_PAGES_PROJECT_NAME: input.projectName?.trim() || path.basename(input.projectPath)
    }
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "deploy_folder",
      arguments: {
        builtFolderPath: path.join(input.projectPath, "dist"),
        workspacePath: input.projectPath,
        projectType: "static"
      }
    }, undefined, {
      timeout: 600000
    }) as McpContentResult;

    if (result.isError) {
      const text = result.content?.find((item) => item.type === "text" && item.text)?.text;
      throw new Error(text || "EdgeOne 部署失败。");
    }

    return parseEdgeOneDeployResult(result);
  } finally {
    await client.close();
  }
}
