import { createAssistantFactory } from "@vakwen/test-framework/config";
import { CapitalReductionsApiArrange } from "./CapitalReductionsApiArrange.js";
import { CapitalReductionsApiActions } from "./CapitalReductionsApiActions.js";
import { CapitalReductionsApiAssert } from "./CapitalReductionsApiAssert.js";
export const capitalReductionsApiAssistantFactory = createAssistantFactory({ Arrange: CapitalReductionsApiArrange, Actions: CapitalReductionsApiActions, Assert: CapitalReductionsApiAssert });
export type TCapitalReductionsApiAssistant = ReturnType<typeof capitalReductionsApiAssistantFactory>;
