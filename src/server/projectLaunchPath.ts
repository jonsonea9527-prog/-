const projectDrivePool = ["P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

function quoteCommandSegment(value: string): string {
  if (!/[ \t"&()^<>|]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function resolveProjectCommand(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm" || command === "npx") {
    return `${command}.cmd`;
  }

  return command;
}

export function chooseProjectDrive(usedDrives: string[]): string {
  const normalized = new Set(usedDrives.map((drive) => drive.toUpperCase()));
  const available = projectDrivePool.find((drive) => !normalized.has(drive));
  if (!available) {
    throw new Error("no free project drive letters available");
  }

  return available;
}

export function buildWindowsProjectCommandLine(
  projectPath: string,
  driveLetter: string,
  command: string,
  args: string[]
): string {
  const resolvedCommand = resolveProjectCommand(command);
  const quotedProjectPath = quoteCommandSegment(projectPath);
  const commandLine = [resolvedCommand, ...args.map(quoteCommandSegment)].join(" ");

  return [
    `"C:\\Windows\\System32\\subst.exe" ${driveLetter}: ${quotedProjectPath}`,
    `cd /d ${driveLetter}:\\`,
    commandLine
  ].join(" && ");
}

export function buildWindowsDriveCleanupCommandLine(driveLetter: string): string {
  return `"C:\\Windows\\System32\\subst.exe" ${driveLetter}: /d`;
}

export async function prepareProjectLaunchPath(_projectId: string, projectPath: string): Promise<string> {
  return projectPath;
}
