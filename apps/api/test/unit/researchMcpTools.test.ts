import { afterEach, describe, expect, it } from "vitest";
import { listMcpToolDefinitions, setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { researchToolErrorOutputSchema } from "../../src/services/research/contracts.js";

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
      expect(tool.outputSchema.safeParse("not-structured-content").success).toBe(false);
      const structuredError = {
        code: "research_subject_not_found",
        message: "No canonical research identity matched the selector",
        statusCode: 404,
      };
      expect(researchToolErrorOutputSchema.parse(structuredError)).toEqual(structuredError);
      expect(tool.outputSchema.safeParse(structuredError).success).toBe(true);
    }
  });
});
