// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/commonUi/en.json";
import zh from "@/i18n/contributions/commonUi/zh-CN.json";
import es from "@/i18n/contributions/commonUi/es.json";
import ja from "@/i18n/contributions/commonUi/ja.json";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const locales = [["en", en.close], ["zh-CN", zh.close], ["es", es.close], ["ja", ja.close]] as const;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await language("en"); });
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function switchLanguage(locale: string) { await language(locale === "en" ? "ja" : "en"); }
const nextLabel = (locale: string) => locale === "en" ? ja.close : en.close;
const closeButtons = (label: string) => Array.from(document.querySelectorAll("button")).filter(el => el.textContent === label);
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe.each(locales)("dialog and sheet Close in %s", (locale, closeLabel) => {
  it("updates dialog icon/footer labels without resetting a draft or dismissing automatically", async () => {
    await language(locale);
    const onOpenChange = vi.fn();
    await act(async () => root.render(<Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Customer title Ω</DialogTitle><DialogDescription>Customer description Ω</DialogDescription>
        <input aria-label="Customer draft" defaultValue="Original Ω" />
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>));
    expect(closeButtons(closeLabel)).toHaveLength(2);
    expect(document.querySelector(".sr-only")?.textContent).toBe(closeLabel);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Customer draft"]')!;
    await act(async () => type(input, "Typed draft Ω"));
    await switchLanguage(locale);
    expect(closeButtons(nextLabel(locale))).toHaveLength(2);
    expect(document.querySelector(".sr-only")?.textContent).toBe(nextLabel(locale));
    expect(input.value).toBe("Typed draft Ω");
    expect(document.body.textContent).toContain("Customer title Ω");
    expect(onOpenChange).not.toHaveBeenCalled();
    const footerClose = document.querySelector<HTMLButtonElement>('[data-slot="dialog-footer"] button')!;
    await act(async () => footerClose.click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    onOpenChange.mockClear();
    await act(async () => document.querySelector<HTMLButtonElement>('button[data-slot="dialog-close"]')!.click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("updates the sheet accessible close label and keeps showCloseButton and dismissal unchanged", async () => {
    await language(locale);
    const onOpenChange = vi.fn();
    const render = (showCloseButton: boolean) => root.render(<Sheet open onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={showCloseButton} side="bottom">
        <SheetTitle>Customer sheet Ω</SheetTitle><SheetDescription>Customer description Ω</SheetDescription>
        <input aria-label="Sheet draft" defaultValue="Original Ω" />
      </SheetContent>
    </Sheet>);
    await act(async () => render(true));
    expect(closeButtons(closeLabel)).toHaveLength(1);
    expect(document.querySelector(".sr-only")?.textContent).toBe(closeLabel);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Sheet draft"]')!;
    await act(async () => type(input, "Typed sheet Ω"));
    await switchLanguage(locale);
    expect(closeButtons(nextLabel(locale))).toHaveLength(1);
    expect(input.value).toBe("Typed sheet Ω");
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => render(false));
    expect(closeButtons(nextLabel(locale))).toHaveLength(0);
    expect(input.value).toBe("Typed sheet Ω");
    await act(async () => render(true));
    await act(async () => closeButtons(nextLabel(locale))[0]!.click());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("preserves caller-controlled pending, hidden close and Escape guards across language changes", async () => {
    await language(locale);
    const onOpenChange = vi.fn(), onSave = vi.fn();
    const render = (pending: boolean) => root.render(<Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!pending} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}>
        <DialogTitle>Customer pending Ω</DialogTitle><DialogDescription>Customer description Ω</DialogDescription>
        <button type="button" disabled={pending} onClick={onSave}>Customer save Ω</button>
      </DialogContent>
    </Dialog>);
    await act(async () => render(true));
    expect(closeButtons(closeLabel)).toHaveLength(0);
    const save = document.querySelector<HTMLButtonElement>('button:not([data-slot="dialog-close"])')!;
    expect(save.disabled).toBe(true);
    await switchLanguage(locale);
    await act(async () => {
      save.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(closeButtons(nextLabel(locale))).toHaveLength(0);
    await act(async () => render(false));
    expect(save.disabled).toBe(false);
    expect(closeButtons(nextLabel(locale))).toHaveLength(1);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });
});
