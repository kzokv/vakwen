import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { RealReauthorizationFlow } from "./helpers/realReauthorizationFlow";

let flow: RealReauthorizationFlow | undefined;

test.afterEach(async () => { await flow?.restore(); flow = undefined; });

test("local real OAuth: browser create A+B → cancel replacement → replace only A → independent MCP refresh", async ({ page, request, e2eUserId, testUser: _testUser }) => {
  const current = new RealReauthorizationFlow(page, request, e2eUserId);
  flow = current;

  await test.step("Configure local MCP policy", () => current.configure());

  const a = await test.step("Browser creates A", () => current.authorize("Local A"));

  const aSession = await current.read(a);

  const b = await test.step("Browser creates B", () => current.authorize("Local B"));

  await current.read(a, aSession);
  await current.read(b);
  await current.cancelReplacement("Local A");
  await current.read(a, aSession);
  const aRefreshed = (await current.refresh(a))!;
  const bRefreshed = (await current.refresh(b))!;
  const c = await current.authorize("Local C", "Local A");
  await current.read(c);
  await current.read(bRefreshed);
  await current.refresh(aRefreshed, false);
  await current.refresh(c);
  await current.assertHistory();
});
