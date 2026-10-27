// @vitest-environment jsdom
import "@/i18n/task-protocol-runtime-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { QuestionFormProps } from "./QuestionForm";
import type { TaskChatRuntimeRequestItem } from "./task-chat-model";
import { TaskChatProtocolCard } from "./TaskChatProtocolCard";

const captured = vi.hoisted(() => ({ form: null as QuestionFormProps | null }));
vi.mock("./QuestionForm", () => ({
  QuestionForm: (props: QuestionFormProps) => { captured.form = props; return null; },
  QuestionResponseSummary: () => null,
}));

it.each([new Error("Original server error Ω"), { original: "Opaque rejection" }])("propagates the original rejection object only through the form callback", async cause => {
  const host = document.createElement("div"); const root = createRoot(host);
  const item: TaskChatRuntimeRequestItem = {
    id: "original-card", kind: "protocol", surface: "runtime_request", runId: "original-run", requestId: "original-request", turnId: null,
    requestKind: "runtime", requestType: "input", status: "pending", prompt: "Original prompt", choices: [], fields: [],
    questionSet: { schema: "paperclip.question_set.v1", questions: [{ id: "original", prompt: "Original question", answerMode: "text", required: true }] },
  };
  const onDecision = vi.fn().mockRejectedValue(cause);
  try {
    await act(async () => { root.render(<TaskChatProtocolCard item={item} presentation="takeover" onRuntimeRequestDecision={onDecision} />); });
    await act(async () => {
      await expect(captured.form!.onSubmit({ schema: "paperclip.question_response.v1", answers: { original: { text: "Original answer" } } })).rejects.toBe(cause);
    });
    expect(onDecision).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});
