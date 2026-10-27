// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderListItem, FolderListResult } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/folderControlsUi/en.json";
import zh from "@/i18n/contributions/folderControlsUi/zh-CN.json";
import es from "@/i18n/contributions/folderControlsUi/es.json";
import ja from "@/i18n/contributions/folderControlsUi/ja.json";
import {
  AllUnfiledBanner, BulkBar, DeleteFolderDialog, FolderChip, FolderFormDialog,
  FolderRail, MobileFolderSheet, MoveToMenu,
} from "./FolderControls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!globalThis.PointerEvent) globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
const locales = [["en", en], ["zh-CN", zh], ["es", es], ["ja", ja]] as const;
const folder: FolderListItem = {
  id: "folder-original", companyId: "company-original", kind: "routine", parentId: null,
  name: "客户 Folder Ω", slug: "raw-slug", systemKey: null, path: "raw-slug", depth: 1,
  color: "indigo", position: 0, itemCount: 3,
  createdAt: new Date("2026-10-27T00:00:00Z"), updatedAt: new Date("2026-10-27T00:00:00Z"),
};
const result: FolderListResult = { kind: "routine", allCount: 4, unfiledCount: 1, folders: [folder] };
const noun = "调用者 noun Ω";
const allLabel = "调用者 all Ω";
const interpolate = (text: string, values: Record<string, string | number>) => text.replace(/{{(\w+)}}/g, (_, key: string) => String(values[key]));
const button = (label: string) => Array.from(document.querySelectorAll("button")).find(el => el.textContent === label)!;
const menuItem = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el => el.textContent === label)!;
const nextStrings = (locale: string) => locale === "en" ? ja : en;
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function switchLanguage(locale: string) { await language(locale === "en" ? "ja" : "en"); }
function inputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await language("en"); localStorage.clear(); });

describe.each(locales)("shared folder controls in %s", (locale, strings) => {
  it("loads real resources, translates rail/ARIA/chip and preserves rename drafts and raw scope", async () => {
    await language(locale);
    for (const [key, text] of Object.entries(strings)) expect(i18n.getResource(locale, "translation", `folderControlsUi.${key}`)).toBe(text);
    const onSelect = vi.fn(), onCreate = vi.fn(), onRename = vi.fn(), onEdit = vi.fn(), onDelete = vi.fn();
    await act(async () => root.render(<>
      <FolderRail result={result} selection="unfiled" itemLabelPlural={noun} allLabel={allLabel}
        onSelect={onSelect} onCreate={onCreate} onRename={onRename} onEdit={onEdit} onDelete={onDelete} />
      <FolderChip result={result} selection="unfiled" allLabel={allLabel} onClick={vi.fn()} />
    </>));
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe(interpolate(strings.itemFolders, { items: noun }));
    expect(host.textContent).toContain(strings.system);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain(strings.unfiled);
    expect(host.querySelector('button[title]')?.getAttribute("title")).toBe(strings.newFolder);
    expect(host.querySelector('button[aria-label]')?.getAttribute("aria-label")).toBe(interpolate(strings.folderActions, { name: folder.name }));
    const row = Array.from(host.querySelectorAll("button")).find(el => el.textContent === folder.name)!;
    await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = host.querySelector("input")!;
    await act(async () => inputValue(input, "  用户 draft Ω  "));
    await switchLanguage(locale);
    expect(input.value).toBe("  用户 draft Ω  ");
    expect(host.textContent).toContain(nextStrings(locale).unfiled);
    for (const callback of [onSelect, onCreate, onRename, onEdit, onDelete]) expect(callback).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onRename).toHaveBeenCalledExactlyOnceWith(folder, "用户 draft Ω");
    expect(folder.name).toBe("客户 Folder Ω");
    expect(folder.companyId).toBe("company-original");
  });

  it("keeps inline rename drafts during IME confirmation until an ordinary Enter", async () => {
    await language(locale);
    const onRename = vi.fn();
    await act(async () => root.render(<FolderRail result={result} selection={folder.id} itemLabelPlural={noun} allLabel={allLabel}
      onSelect={vi.fn()} onCreate={vi.fn()} onRename={onRename} onEdit={vi.fn()} onDelete={vi.fn()} />));
    const row = Array.from(host.querySelectorAll("button")).find(el => el.textContent === folder.name)!;
    await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = host.querySelector("input")!;
    await act(async () => inputValue(input, "  確定前 draft Ω  "));
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...composition })));
      expect(onRename).not.toHaveBeenCalled();
      expect(host.querySelector("input")?.value).toBe("  確定前 draft Ω  ");
    }
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onRename).toHaveBeenCalledExactlyOnceWith(folder, "確定前 draft Ω");
  });

  it("does not submit the folder form while confirming an IME candidate", async () => {
    await language(locale);
    const onSubmit = vi.fn();
    await act(async () => root.render(<FolderFormDialog open kind="routine" folder={null} onSubmit={onSubmit} onOpenChange={vi.fn()} />));
    const input = document.querySelector<HTMLInputElement>("#folder-name")!;
    await act(async () => inputValue(input, "  入力中 draft Ω  "));
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...composition })));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(input.value).toBe("  入力中 draft Ω  ");
    }
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "入力中 draft Ω", color: "indigo" });
  });

  it("blocks repeated Enter while saving and allows one ordinary Enter after pending ends", async () => {
    await language(locale);
    const onSubmit = vi.fn();
    const render = (pending: boolean) => root.render(<FolderFormDialog open kind="routine" folder={folder} pending={pending} onSubmit={onSubmit} onOpenChange={vi.fn()} />);
    await act(async () => render(true));
    const input = document.querySelector<HTMLInputElement>("#folder-name")!;
    for (let repeat = 0; repeat < 3; repeat++) {
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: repeat > 0, bubbles: true })));
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(button(strings.saving).disabled).toBe(true);
    await switchLanguage(locale);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe(folder.name);
    await act(async () => render(false));
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: folder.name, color: folder.color });
  });

  it("translates form controls without resetting draft/color or submitting during a language change", async () => {
    await language(locale);
    const onSubmit = vi.fn(), onOpenChange = vi.fn();
    const render = (pending = false, editFolder: FolderListItem | null = null) => root.render(
      <FolderFormDialog open kind={editFolder ? "skill" : "routine"} folder={editFolder}
        pending={pending} onOpenChange={onOpenChange} onSubmit={onSubmit} />,
    );
    await act(async () => render());
    expect(button(strings.createFolder).disabled).toBe(true);
    expect(document.body.textContent).toContain(strings.routineDescription);
    const input = document.querySelector<HTMLInputElement>("#folder-name")!;
    await act(async () => inputValue(input, "  自定义 draft Ω  "));
    const color = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]")).find(el => el.getAttribute("aria-label") === interpolate(strings.useColor, { color: strings.color_amber }))!;
    await act(async () => color.click());
    await act(async () => render(true));
    expect(button(strings.saving).disabled).toBe(true);
    expect(button(strings.cancel).disabled).toBe(true);
    await switchLanguage(locale);
    expect(document.querySelector<HTMLInputElement>("#folder-name")?.value).toBe("  自定义 draft Ω  ");
    expect(button(nextStrings(locale).saving).disabled).toBe(true);
    await act(async () => button(nextStrings(locale).saving).click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => render());
    await act(async () => button(nextStrings(locale).createFolder).click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "自定义 draft Ω", color: "amber" });
    const otherFolder = { ...folder, id: "other-folder", companyId: "other-company", name: "其他 scope Ω", color: "cyan" };
    await act(async () => render(false, otherFolder));
    expect(document.querySelector<HTMLInputElement>("#folder-name")?.value).toBe(otherFolder.name);
    expect(document.body.textContent).toContain(nextStrings(locale).skillDescription);
    await act(async () => button(nextStrings(locale).cancel).click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps deletion explicitly confirmed and disabled while pending or without a target", async () => {
    await language(locale);
    const onConfirm = vi.fn(), onOpenChange = vi.fn();
    const render = (pending: boolean, target: FolderListItem | null = folder) => root.render(
      <DeleteFolderDialog open folder={target} itemLabelPlural={noun} pending={pending} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    );
    await act(async () => render(true));
    expect(document.body.textContent).toContain(interpolate(strings.deleteDescription, { count: 3, items: noun }));
    expect(button(strings.deleting).disabled).toBe(true);
    expect(button(strings.cancel).disabled).toBe(true);
    await switchLanguage(locale);
    expect(document.body.textContent).toContain(interpolate(nextStrings(locale).deleteDescription, { count: 3, items: noun }));
    await act(async () => button(nextStrings(locale).deleting).click());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => render(false, null));
    expect(button(nextStrings(locale).deleteFolder).disabled).toBe(true);
    await act(async () => button(nextStrings(locale).deleteFolder).click());
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => render(false));
    await act(async () => button(nextStrings(locale).deleteFolder).click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => button(nextStrings(locale).cancel).click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("preserves mobile hierarchy and IDs while translating only system labels", async () => {
    await language(locale);
    const onSelect = vi.fn(), onCreate = vi.fn(), onOpenChange = vi.fn();
    const skillResult: FolderListResult = { ...result, kind: "skill", folders: [
      { ...folder, kind: "skill" },
      { ...folder, kind: "skill", id: "child-raw", parentId: folder.id, depth: 2, name: "Child custom Ω" },
      ...["my", "projects", "bundled"].map(key => ({ ...folder, kind: "skill" as const, id: `reserved-${key}`, name: key, systemKey: key })),
    ] };
    await act(async () => root.render(<MobileFolderSheet open result={skillResult} selection={folder.id}
      itemLabelPlural={noun} allLabel={allLabel} onSelect={onSelect} onCreate={onCreate} onOpenChange={onOpenChange} />));
    for (const label of [strings.mySkills, strings.organization, strings.projects, strings.bundled, strings.unfiled]) expect(document.body.textContent).toContain(label);
    expect(document.body.textContent).toContain(interpolate(strings.itemFolders, { items: noun }));
    expect(document.querySelector('[data-folder-id="folder-original"] > .pl-3 [data-folder-id="child-raw"]')).not.toBeNull();
    await switchLanguage(locale);
    for (const callback of [onSelect, onCreate, onOpenChange]) expect(callback).not.toHaveBeenCalled();
    const child = document.querySelector<HTMLButtonElement>('[data-folder-id="child-raw"] > button')!;
    expect(child.textContent).toContain("Child custom Ω");
    await act(async () => child.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("child-raw");
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps banner dismissal scoped to its original storage key across language changes", async () => {
    await language(locale);
    const onCreateFolder = vi.fn();
    const storageKey = "folder-nudge:company-original";
    const render = (key: string) => root.render(<AllUnfiledBanner key={key} storageKey={key} itemLabelPlural={noun} onCreateFolder={onCreateFolder} />);
    await act(async () => render(storageKey));
    expect(host.textContent).toContain(interpolate(strings.organizeHint, { items: noun }));
    await switchLanguage(locale);
    expect(onCreateFolder).not.toHaveBeenCalled();
    expect(host.textContent).toContain(interpolate(nextStrings(locale).organizeHint, { items: noun }));
    await act(async () => button(nextStrings(locale).createFirstFolder).click());
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    expect(localStorage.getItem(storageKey)).toBe("1");
    expect(host.textContent).toBe("");
    await act(async () => render("folder-nudge:other-company"));
    expect(host.textContent).toContain(nextStrings(locale).createFirstFolder);
    expect(localStorage.getItem("folder-nudge:other-company")).toBeNull();
    await act(async () => render(storageKey));
    expect(host.textContent).toBe("");
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });

  it("retains move-menu search and raw destination IDs without moves on language changes", async () => {
    await language(locale);
    const onMove = vi.fn(), onCreateAndMove = vi.fn();
    await act(async () => root.render(<DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild><button type="button">Actions</button></DropdownMenuTrigger>
      <DropdownMenuContent><MoveToMenu folders={result.folders} currentFolderId={folder.id} onMove={onMove} onCreateAndMove={onCreateAndMove} /></DropdownMenuContent>
    </DropdownMenu>));
    const trigger = menuItem(strings.moveTo);
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(input.placeholder).toBe(strings.searchFolders);
    await act(async () => inputValue(input, "does-not-match Ω"));
    expect(document.body.textContent).toContain(strings.noMatches);
    await switchLanguage(locale);
    expect(input.value).toBe("does-not-match Ω");
    expect(input.placeholder).toBe(nextStrings(locale).searchFolders);
    expect(document.body.textContent).toContain(nextStrings(locale).noMatches);
    expect(onMove).not.toHaveBeenCalled();
    expect(onCreateAndMove).not.toHaveBeenCalled();
    await act(async () => inputValue(input, "客户"));
    const destination = menuItem(folder.name);
    expect(destination).toBeDefined();
    await act(async () => destination.click());
    expect(onMove).toHaveBeenCalledExactlyOnceWith(folder.id);
    expect(onCreateAndMove).not.toHaveBeenCalled();
  });

  it("translates bulk counts and preserves clear/done semantics", async () => {
    await language(locale);
    const onMove = vi.fn(), onCreateAndMove = vi.fn(), onClear = vi.fn(), onDone = vi.fn();
    const render = (count: number) => root.render(<BulkBar selectedCount={count} folders={result.folders} onMove={onMove} onCreateAndMove={onCreateAndMove} onClear={onClear} onDone={onDone} />);
    await act(async () => render(1));
    expect(host.textContent).toContain(strings.selected_one.replace("{{count}}", "1"));
    await act(async () => render(3));
    expect(host.textContent).toContain(strings.selected_other.replace("{{count}}", "3"));
    await switchLanguage(locale);
    for (const callback of [onMove, onCreateAndMove, onClear, onDone]) expect(callback).not.toHaveBeenCalled();
    await act(async () => button(nextStrings(locale).deselectAll).click());
    await act(async () => button(nextStrings(locale).done).click());
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => render(0));
    expect(host.textContent).toBe("");
    expect(onMove).not.toHaveBeenCalled();
    expect(onCreateAndMove).not.toHaveBeenCalled();
  });
});
