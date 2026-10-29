// @vitest-environment jsdom
import { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { $getRoot, $isTextNode, getNearestEditorFromDOMNode, HISTORY_PUSH_TAG, UNDO_COMMAND, REDO_COMMAND } from "lexical";
import { MarkdownEditor, type MarkdownEditorRef } from "./MarkdownEditor";

// Keep the actual MDXEditor realm/Lexical lifecycle; mocking the translation prop
// would incorrectly make an initialization-only prop appear reactive.
vi.mock("../context/EditorAutocompleteContext", () => ({ useEditorAutocomplete: () => ({ slashCommands: [] }) }));
afterEach(async () => { await i18n.changeLanguage("en"); vi.restoreAllMocks(); });
it("updates the live rich-editor label without remounting or replacing its content and selection", async () => {
  await i18n.changeLanguage("en");
  // jsdom lacks Range geometry; Lexical needs it when committing a selection.
  const geometry = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const editorRef = createRef<MarkdownEditorRef>();
  const onChange = vi.fn();
  function Editor({ label }: { label?: string }) {
    const [value, setValue] = useState("Draft 原文 1234");
    return <MarkdownEditor ref={editorRef} ariaLabel={label} value={value} onChange={next => { setValue(next); onChange(next); }} />;
  }
  try {
    await act(async () => { root.render(<Editor />); await new Promise(resolve => setTimeout(resolve, 30)); });
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editable).not.toBeNull();
    const initialLabel = editable.getAttribute("aria-label");
    const lexical = getNearestEditorFromDOMNode(editable);
    await act(async () => lexical.update(() => {
      const text = $getRoot().getFirstDescendant();
      if ($isTextNode(text)) text.setTextContent("Draft 原文 1234 edited");
      $getRoot().selectEnd();
    }, { tag: HISTORY_PUSH_TAG }));
    expect(editable.textContent).toBe("Draft 原文 1234 edited");
    await act(async () => editorRef.current!.focus());
    const selection = window.getSelection()!;
    const anchorNode = selection.anchorNode;
    const anchorOffset = selection.anchorOffset;
    const content = editable.innerHTML;
    onChange.mockClear();
    await act(async () => { await i18n.changeLanguage("ja"); });
    expect(container.querySelector('[contenteditable="true"]')).toBe(editable);
    expect(editable.getAttribute("aria-label")).toBe(i18n.t("taskPanel.editableMarkdown"));
    expect(editable.getAttribute("aria-label")).not.toBe(initialLabel);
    expect(editable.innerHTML).toBe(content);
    expect(selection.anchorNode).toBe(anchorNode); expect(selection.anchorOffset).toBe(anchorOffset);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.render(<Editor label="Custom document name" />));
    expect(editable.getAttribute("aria-label")).toBe("Custom document name");
    expect(container.querySelector('[contenteditable="true"]')).toBe(editable);
    await act(async () => { lexical.dispatchCommand(UNDO_COMMAND, undefined); });
    expect(editable.textContent).toBe("Draft 原文 1234");
    await act(async () => { lexical.dispatchCommand(REDO_COMMAND, undefined); });
    expect(editable.textContent).toBe("Draft 原文 1234 edited");
  } finally {
    await act(async () => root.unmount()); container.remove();
    if (geometry) Object.defineProperty(Range.prototype, "getBoundingClientRect", geometry);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
});
