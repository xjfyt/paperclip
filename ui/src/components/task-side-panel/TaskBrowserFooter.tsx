import { Trans } from "react-i18next";
import { useTranslation } from "@/i18n";
import {
  Clock3,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import {
  BROWSER_USE_IDLE_MS,
  BROWSER_USE_VIEWPORT_PRESETS,
  type BrowserUseViewportPreset,
  type BrowserUseControl,
  type TaskBrowser,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Session controls stay below the viewport; the countdown appears only near expiry. */
export function TaskBrowserFooter({
  browser,
  now,
  disabled = false,
  onControl,
  onReconnect,
  viewport = "fit",
  controlledElsewhere = false,
  resizing = false,
  resizeAvailable = true,
  onResize,
}: {
  browser: TaskBrowser;
  now: number;
  disabled?: boolean;
  onControl: (action: BrowserUseControl) => void;
  onReconnect: () => void;
  viewport?: BrowserUseViewportPreset;
  controlledElsewhere?: boolean;
  resizing?: boolean;
  resizeAvailable?: boolean;
  onResize: (preset: BrowserUseViewportPreset) => void;
}) {
  const { t } = useTranslation();
  const live = browser.status === "running" || browser.status === "idle";
  const expiry = browser.expiresAt ? Date.parse(browser.expiresAt) : Infinity;
  const idleDeadline = browser.idleDeadline
    ? Date.parse(browser.idleDeadline)
    : Infinity;
  const deadline = Math.min(idleDeadline, expiry);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const closingSoon = browser.status === "idle" && seconds <= 5 * 60;
  const canExtend =
    browser.status === "idle" && expiry > idleDeadline && deadline > now;
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const sizePreset = BROWSER_USE_VIEWPORT_PRESETS.find((preset) => preset.id === viewport);
  const sizeLabel =
    viewport === "fit"
      ? t("taskRecoveryControlsUi.browser.fit")
      : sizePreset
        ? t(`taskRecoveryControlsUi.browser.presets.${sizePreset.id}`)
        : t("taskRecoveryControlsUi.browser.default");
  if (!live) return null;

  return (
    <footer
      aria-label={t("taskRecoveryControlsUi.browser.session")}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground"
    >
      {closingSoon && (
        <span
          role="timer"
          aria-live="off"
          className="flex items-center gap-1 whitespace-nowrap"
        >
          <Clock3 className="size-3" aria-hidden="true" />
          {seconds > 0 ? (
            <Trans
              t={t}
              i18nKey="taskRecoveryControlsUi.browser.closesIn"
              values={{ countdown }}
              components={[<span key="countdown" className="font-mono tabular-nums" />]}
            />
          ) : (
            t("taskRecoveryControlsUi.browser.closing")
          )}
        </span>
      )}
      {controlledElsewhere && viewport === "fit" && (
        <span>{t("taskRecoveryControlsUi.browser.controlledElsewhere")}</span>
      )}
      {resizing ? (
        <span role="status" className="flex items-center gap-1">
          <LoaderCircle
            className="size-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t("taskRecoveryControlsUi.browser.resizing")}
        </span>
      ) : (
        browser.status === "running" && <span>{t("taskRecoveryControlsUi.browser.browsing")}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {closingSoon && canExtend && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => onControl("keep_open")}
              >
                {t("taskRecoveryControlsUi.browser.keepBrowsing")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("taskRecoveryControlsUi.browser.keepBrowsingDescription", { minutes: BROWSER_USE_IDLE_MS / 60000 })}
            </TooltipContent>
          </Tooltip>
        )}
        {browser.status === "running" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => onControl("cancel")}
              >
                <Square aria-hidden="true" /> {t("taskRecoveryControlsUi.browser.stopBrowsing")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("taskRecoveryControlsUi.browser.stopDescription")}
            </TooltipContent>
          </Tooltip>
        )}
        {live && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("taskRecoveryControlsUi.browser.options")}
                disabled={disabled}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-64">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={resizing || !resizeAvailable}>
                  <Monitor aria-hidden="true" />
                  <span>{t("taskRecoveryControlsUi.browser.size")}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {sizeLabel}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64">
                  <DropdownMenuLabel>{t("taskRecoveryControlsUi.browser.size")}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={viewport}
                    // Radix also emits this when the selected value is chosen again.
                    // Keep one path so explicit reapply/takeover does not dispatch twice.
                    onValueChange={(value) =>
                      onResize(value as BrowserUseViewportPreset)
                    }
                  >
                    <DropdownMenuRadioItem
                      value="fit"
                    >
                      {t("taskRecoveryControlsUi.browser.fit")}
                    </DropdownMenuRadioItem>
                    {controlledElsewhere && (
                      <DropdownMenuItem onSelect={() => onResize("fit")}>
                        {t("taskRecoveryControlsUi.browser.fitHere")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioItem
                      value="default"
                    >
                      {t("taskRecoveryControlsUi.browser.browserDefault")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {BROWSER_USE_VIEWPORT_PRESETS.map((preset) => (
                      <DropdownMenuRadioItem
                        key={preset.id}
                        value={preset.id}
                      >
                        <span>{t(`taskRecoveryControlsUi.browser.presets.${preset.id}`)}</span>
                        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                          {preset.width} × {preset.height}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onReconnect} className="items-start">
                <RefreshCw className="mt-0.5" aria-hidden="true" />
                <span className="flex flex-col gap-1">
                  <span>{t("taskRecoveryControlsUi.browser.reconnect")}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("taskRecoveryControlsUi.browser.reconnectDescription")}
                  </span>
                </span>
              </DropdownMenuItem>
              {canExtend && (
                <DropdownMenuItem
                  onSelect={() => onControl("keep_open")}
                  className="items-start"
                >
                  <Clock3 className="mt-0.5" aria-hidden="true" />
                  <span className="flex flex-col gap-1">
                    <span>{t("taskRecoveryControlsUi.browser.keepOpen")}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("taskRecoveryControlsUi.browser.keepOpenDescription", { minutes: BROWSER_USE_IDLE_MS / 60000 })}
                    </span>
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onControl("end")}
                className="items-start"
              >
                <X className="mt-0.5" aria-hidden="true" />
                <span className="flex flex-col gap-1">
                  <span>{t("taskRecoveryControlsUi.browser.close")}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("taskRecoveryControlsUi.browser.closeDescription")}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </footer>
  );
}
