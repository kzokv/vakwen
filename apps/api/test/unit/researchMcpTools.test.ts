import { afterEach, describe, expect, it } from "vitest";
import { listMcpToolDefinitions, setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import {
  researchPriceSeriesToolOutputSchema,
  researchToolErrorOutputSchema,
} from "../../src/services/research/contracts.js";

describe("Taiwan research MCP tool contracts", () => {
  afterEach(() => setResearchRolloutOverrideForTest(null));

  it("research MCP rollout: enable acquisition and MCP exposure → list manifest and identity first with concrete schemas", () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, mcpExposureEnabled: true });

    const tools = listMcpToolDefinitions();
    expect(tools.slice(0, 3).map((tool) => tool.name)).toEqual([
      "get_research_manifest",
      "get_research_identity",
      "get_price_series",
    ]);
    for (const toolName of ["get_research_manifest", "get_research_identity", "get_price_series"] as const) {
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
      expect(tool.outputSchema.safeParse({ result: structuredError }).success).toBe(true);
      expect(tool.outputSchema.safeParse(structuredError).success).toBe(false);
      expect(tool.outputSchema.safeParse({}).success).toBe(false);
      expect(tool.outputSchema.safeParse({ result: {} }).success).toBe(false);
      expect(tool.outputSchema.safeParse({
        result: {
          ...structuredError,
          contractVersion: "research-invalid/1.0.0",
        },
      }).success).toBe(false);
      for (const sharedCode of [
        "mcp_rate_limited",
        "mcp_tool_group_disabled",
        "mcp_tool_disabled",
      ]) {
        expect(tool.outputSchema.safeParse({
          result: {
            code: sharedCode,
            message: "Shared MCP policy denied the tool call",
            statusCode: sharedCode === "mcp_rate_limited" ? 429 : 403,
          },
        }).success).toBe(true);
      }
    }
    const priceSeriesTool = tools.find((tool) => tool.name === "get_price_series")!;
    expect(priceSeriesTool.outputSchema).toBe(researchPriceSeriesToolOutputSchema);
  });
});
