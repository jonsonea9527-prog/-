import { describe, expect, it } from "vitest";
import { parseEdgeOneDeployResult } from "../../src/server/edgeOnePublisher";

describe("edgeOnePublisher", () => {
  it("parses EdgeOne MCP deployment JSON from text content", () => {
    const result = parseEdgeOneDeployResult({
      content: [{
        type: "text",
        text: JSON.stringify({
          url: "https://attendance.edgeone.cool?eo_token=abc&eo_time=1781667767",
          expiredTime: 1781678568,
          projectId: "makers-demo",
          projectName: "attendance-preview"
        })
      }]
    });

    expect(result).toEqual({
      previewUrl: "https://attendance.edgeone.cool?eo_token=abc&eo_time=1781667767",
      expiresAt: new Date(1781678568 * 1000).toISOString()
    });
  });
});
