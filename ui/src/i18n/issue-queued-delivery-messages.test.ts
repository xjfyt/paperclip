import { expect, it } from "vitest";
import { validateLocaleMessages } from "./locale-validation";
import { issueQueuedDeliveryMessages } from "./issue-queued-delivery-test-resources";
it.each(Object.entries(issueQueuedDeliveryMessages))("validates classic queue feedback for %s", (_locale, messages) => {
  expect(validateLocaleMessages(messages, issueQueuedDeliveryMessages.en)).toEqual([]);
});
