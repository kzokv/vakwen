import { afterEach, describe, expect, it } from "vitest";
import { listMcpToolDefinitions, setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

describe("Taiwan research MCP tool contracts", () => {
  afterEach(() => setResearchRolloutOverrideForTest(null));

  it("research MCP rollout: enable acquisition and MCP exposure → list manifest and identity first with concrete schemas", () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, mcpExposureEnabled: true });

    const tools = listMcpToolDefinitions();
    expect(tools.slice(0, 2).map((tool) => tool.name)).toEqual([
      "get_research_manifest",
      "get_research_identity",
    ]);
    for (const toolName of ["get_research_manifest", "get_research_identity"] as const) {
      const tool = tools.find((item) => item.name === toolName)!;
      expect(tool.scope).toBe("research:read");
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool.outputSchema.safeParse({}).success).toBe(false);
    }
  });
});
