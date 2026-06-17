import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { publishCloudProject } from "../../src/server/cloudPublisher";

const tempDirs: string[] = [];

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-live-share-cloud-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n", "utf8");
  return dir;
}

describe("cloudPublisher", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it("sets a local commit identity when the repository has none", async () => {
    const projectPath = createTempProject();
    const remotePath = fs.mkdtempSync(path.join(os.tmpdir(), "local-live-share-remote-"));
    tempDirs.push(remotePath);
    git(remotePath, ["init", "--bare"]);

    await publishCloudProject({
      projectPath,
      repositoryUrl: remotePath,
      commitMessage: "Update preview"
    });

    expect(git(projectPath, ["config", "--get", "user.name"]).trim()).toBe("Local Live Share");
    expect(git(projectPath, ["config", "--get", "user.email"]).trim()).toBe("local-live-share@example.local");
    expect(git(projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe("Update preview");
  });
});
