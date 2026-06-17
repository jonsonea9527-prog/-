import crypto from "node:crypto";

export function makeSlug(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const truncatedSlug = slug.slice(0, 64).replace(/-+$/g, "");
  if (truncatedSlug.length > 0) {
    return truncatedSlug;
  }

  return `project-${crypto.createHash("sha256").update(input).digest("hex").slice(0, 6)}`;
}
