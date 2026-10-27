import { expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueTreeExecutionMessages } from "./issue-tree-execution-test-resources";
it.each(Object.entries(issueTreeExecutionMessages))("validates local tree execution feedback for %s", (_locale, messages) => {
  expect(validateLocaleMessages(messages, issueTreeExecutionMessages.en)).toEqual([]);
});
