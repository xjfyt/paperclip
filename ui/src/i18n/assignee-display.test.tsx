// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { changeLocale } from "./index";
import { useAssigneeDisplayLabels } from "./assignee-display";
import { assigneeValueFromSelection, currentUserAssigneeOption, formatAssigneeUserLabel, formatUserLabel, parseAssigneeValue } from "@/lib/assignees";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it("localizes only identity-derived UI fallbacks, preserving directory names and the shared protocol", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const users = [
    { principalId: "local-board", user: null },
    { principalId: "named-you", user: { id: "named-you", name: "You", email: null, image: null } },
    { principalId: "named-board", user: { id: "named-board", name: "Board", email: null, image: null } },
    { principalId: "email-user", user: { id: "email-user", name: " ", email: "raw@example.com", image: null } },
  ];
  let labels: ReturnType<typeof useAssigneeDisplayLabels>;
  function Probe({ currentUserId }: { currentUserId: string | null }) {
    labels = useAssigneeDisplayLabels(currentUserId, users);
    return null;
  }
  const cases = [
    ["en", "You", "Me", "Board"], ["zh-CN", "你", "我", "管理端"],
    ["es", "Tú", "Yo", "Administración"], ["ja", "あなた", "自分", "管理画面"],
  ] as const;
  try {
    await act(async () => root.render(<Probe currentUserId="self" />));
    for (const [locale, you, me, board] of cases) {
      await act(async () => { await changeLocale(locale); });
      expect(labels!.userLabel("self")).toBe(you);
      expect(labels!.currentUserOptionLabel).toBe(me);
      expect(labels!.userLabel("local-board")).toBe(board);
      expect(labels!.userLabel(null)).toBeNull();
      expect(labels!.userLabel("")).toBeNull();
      expect(labels!.userLabel("local-board-other")).toBe("local");
      expect(labels!.userLabel("self-other")).toBe("self-");
      expect(labels!.userLabel("named-you")).toBe("You");
      expect(labels!.userLabel("named-board")).toBe("Board");
      expect(labels!.userLabel("email-user")).toBe("raw@example.com");
      // Shared defaults/search text/encoding remain English and stable, even in non-English UI.
      expect(formatAssigneeUserLabel("self", "self")).toBe("You");
      expect(formatUserLabel("local-board")).toBe("Board");
      expect(currentUserAssigneeOption("local-board")).toEqual([
        { id: "user:local-board", label: "Me", searchText: "me board human local-board" },
      ]);
      expect(assigneeValueFromSelection({ assigneeUserId: "local-board" })).toBe("user:local-board");
      expect(parseAssigneeValue("user:local-board")).toEqual({ assigneeAgentId: null, assigneeUserId: "local-board" });
    }
    for (const id of ["named-you", "named-board", "email-user"]) {
      await act(async () => root.render(<Probe currentUserId={id} />));
      const name = id === "named-you" ? "You" : id === "named-board" ? "Board" : "raw@example.com";
      expect(labels!.userLabel(id)).toBe(name);
      expect(labels!.currentUserOptionLabel).toBe(name);
    }
    await act(async () => root.render(<Probe currentUserId="local-board" />));
    expect(labels!.userLabel("local-board")).toBe("あなた");
    expect(labels!.currentUserOptionLabel).toBe("管理画面");
    await act(async () => root.render(<Probe currentUserId={null} />));
    expect(labels!.userLabel("local-board")).toBe("管理画面");
    expect(labels!.currentUserOptionLabel).toBeNull();
  } finally {
    await act(async () => { root.unmount(); await changeLocale("en"); });
  }
});
