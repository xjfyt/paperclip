import { comparePrivatePromptTestsSchema } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { privatePromptComparisonService } from "../services/mimouse-private-prompt-tests/comparison-service.js";
import { preparePrivatePromptTestSchema, executePrivatePromptTestSchema, cancelPrivatePromptTestSchema } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { privatePromptTestService } from "../services/mimouse-private-prompt-tests/service.js";
import { privatePromptTestsEnabled } from "../services/mimouse-private-prompt-tests/profile.js";
import { heartbeatService } from "../services/heartbeat.js";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createPromptRevisionSchema, selectPromptRevisionSchema } from "@paperclipai/shared/mimouse-prompt-registry";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { forbidden, HttpError, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { promptRegistryService } from "../services/mimouse-prompt-registry/service.js";
const uuid = z.string().uuid(), page = z.object({ beforeId: uuid.optional() }).strict();
export function mimousePromptRegistryRoutes(db: Db) {
  const router = Router(), service = promptRegistryService(db), root = "/companies/:companyId/prompt-registry";
  const privateTests = privatePromptTestService(db, (agentId, opts) => heartbeatService(db).wakeup(agentId, opts));
  function human(req: Request) {
    const companyId = uuid.parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.source !== "session" || !req.actor.userId) throw forbidden("prompt_signed_in_human_required");
    const member = req.actor.memberships?.find(value => value.companyId === companyId);
    if (!member || member.status !== "active" || !["owner", "admin"].includes(String(member.membershipRole))) throw forbidden("prompt_active_company_administrator_required");
    return { companyId, userId: req.actor.userId };
  }
  async function safe<T>(action: () => Promise<T>) {
    try { return await action(); } catch (error) {
      if (error instanceof HttpError) throw error;
      // Drizzle errors may embed bound SQL prompt contents. Never forward them.
      throw unprocessable("prompt_registry_operation_failed");
    }
  }
  router.use(root, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  function privateHuman(req: Request) {
    const actor = human(req);
    if (!req.actor.sessionId) throw forbidden("private_prompt_session_required");
    return { ...actor, sessionId: req.actor.sessionId };
  }
  router.get(`${root}/test-capabilities`, async (req, res) => {
    const actor = privateHuman(req);
    // Listing an empty UUID scope performs the same current DB authorization.
    await safe(() => privateTests.list(actor, "00000000-0000-4000-8000-000000000000"));
    res.json({ enabled: privatePromptTestsEnabled(), profile: "claude_cli_bare_api_key_v1",
      privateResults: true, toolsEnabled: false, completeContextCaptured: false });
  });
  // POST carries explicit IDs; the service enforces READ ONLY transactions.
  router.post(`${root}/:promptId/comparison`, validate(comparePrivatePromptTestsSchema), async (req, res) => {
    const actor = privateHuman(req), promptId = uuid.parse(req.params.promptId);
    res.json(await safe(() => privatePromptComparisonService(db).compare(actor, promptId, req.body)));
  });
  router.post(`${root}/:promptId/tests`, validate(preparePrivatePromptTestSchema), async (req, res) => {
    const actor = privateHuman(req), promptId = uuid.parse(req.params.promptId);
    const result = await safe(() => privateTests.prepare(actor, promptId, req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  router.post(`${root}/:promptId/tests/:testId/execute`, validate(executePrivatePromptTestSchema), async (req, res) => {
    const actor = privateHuman(req), promptId = uuid.parse(req.params.promptId), testId = uuid.parse(req.params.testId);
    res.json(await safe(() => privateTests.execute(actor, promptId, testId, req.body)));
  });
  router.post(`${root}/:promptId/tests/:testId/cancel`, validate(cancelPrivatePromptTestSchema), async (req, res) => {
    const actor = privateHuman(req), promptId = uuid.parse(req.params.promptId), testId = uuid.parse(req.params.testId);
    res.json(await safe(() => privateTests.cancel(actor, promptId, testId, req.body)));
  });
  router.get(`${root}/:promptId/tests`, async (req, res) => {
    const actor = privateHuman(req), promptId = uuid.parse(req.params.promptId);
    res.json(await safe(() => privateTests.list(actor, promptId, page.parse(req.query).beforeId)));
  });
  router.get(`${root}/:promptId/tests/:testId`, async (req, res) => {
    const actor = privateHuman(req), promptId = uuid.parse(req.params.promptId), testId = uuid.parse(req.params.testId);
    res.json(await safe(() => privateTests.detail(actor, promptId, testId)));
  });
  router.get(root, async (req, res) => { const { companyId, userId } = human(req);
    res.json(await safe(() => service.list(companyId, userId, page.parse(req.query).beforeId))); });
  router.post(`${root}/revisions`, validate(createPromptRevisionSchema), async (req, res) => {
    const { companyId, userId } = human(req), result = await safe(() => service.create(companyId, userId, req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  for (const kind of ["revisions", "receipts"] as const) router.get(`${root}/:promptId/${kind}`, async (req, res) => {
    const { companyId, userId } = human(req), promptId = uuid.parse(req.params.promptId), beforeId = page.parse(req.query).beforeId;
    res.json(await safe(() => service.history(companyId, userId, promptId, kind, beforeId)));
  });
  router.get(`${root}/:promptId/revisions/:revisionId`, async (req, res) => {
    const { companyId, userId } = human(req), promptId = uuid.parse(req.params.promptId), revisionId = uuid.parse(req.params.revisionId);
    res.json(await safe(() => service.content(companyId, userId, promptId, revisionId)));
  });
  router.post(`${root}/:promptId/selections`, validate(selectPromptRevisionSchema), async (req, res) => {
    const { companyId, userId } = human(req), promptId = uuid.parse(req.params.promptId);
    const result = await safe(() => service.select(companyId, userId, promptId, req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  return router;
}
