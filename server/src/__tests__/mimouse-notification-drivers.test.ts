import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildNotificationRequest, classifyNotificationResponse, dingtalkSignature, feishuSignature, sendNotification, type NotificationSnapshot } from "../services/mimouse-notifications/drivers.js";
const base = { title: "Review required", text: "Task needs review", detailUrl: "https://app.example/issues/one" };
describe("notification vendor protocols", () => {
  it("uses distinct signing inputs and timestamp units", () => {
    expect(feishuSignature("secret", 1700000000)).toBe(createHmac("sha256", "1700000000\nsecret").update("").digest("base64"));
    expect(dingtalkSignature("secret", 1700000000000)).toBe(createHmac("sha256", "secret").update("1700000000000\nsecret").digest("base64"));
    const request = buildNotificationRequest({ ...base, kind: "dingtalk_webhook_legacy" }, { url: "https://oapi.dingtalk.com/robot/send?access_token=test", signingSecret: "secret" }, 1700000000000);
    expect(request.url.searchParams.get("sign")).toBe(dingtalkSignature("secret", 1700000000000));
    expect(JSON.parse(request.body).at.isAtAll).toBe(false);
  });
  it("does not sign WeCom with another vendor algorithm", () => {
    const request = buildNotificationRequest({ ...base, kind: "wecom_webhook" }, { url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture" });
    expect(request.url.searchParams.has("sign")).toBe(false); expect(JSON.parse(request.body).msgtype).toBe("markdown");
  });
  it.each(["https://evil.example/robot/send", "http://oapi.dingtalk.com/robot/send", "https://oapi.dingtalk.com:444/robot/send", "https://user:pass@oapi.dingtalk.com/robot/send"])("rejects unsafe destination %s", url => expect(() => buildNotificationRequest({ ...base, kind: "dingtalk_webhook_legacy" }, { url })).toThrow());
  it("keeps Lark and Feishu domains separate", () => {
    expect(() => buildNotificationRequest({ ...base, kind: "feishu_webhook", brand: "lark" }, { url: "https://open.feishu.cn/open-apis/bot/v2/hook/test" })).toThrow();
  });
  it("checks bytes rather than character count", () => {
    expect(() => buildNotificationRequest({ ...base, kind: "feishu_webhook", text: "中文".repeat(4000) }, { url: "https://open.feishu.cn/open-apis/bot/v2/hook/test" })).toThrow("message_too_large");
  });
  it("requires current Feishu code and not legacy StatusCode", () => {
    expect(classifyNotificationResponse("feishu_webhook", 200, { StatusCode: 0 }).state).toBe("indeterminate");
    expect(classifyNotificationResponse("feishu_webhook", 200, { code: 0 }).state).toBe("accepted");
  });
  it("requires vendor success even with HTTP 200", () => {
    expect(classifyNotificationResponse("wecom_webhook", 200, { errcode: 93000 }).state).toBe("rejected");
    expect(classifyNotificationResponse("dingtalk_app", 200, { processQueryKey: "receipt" }).state).toBe("accepted");
    expect(classifyNotificationResponse("dingtalk_app", 200, { errcode: 0 }).state).toBe("rejected");
  });
  it("renders actual official-account template fields", () => {
    const request = buildNotificationRequest({ ...base, kind: "wechat_official_account", target: "openid", templateId: "template", templateData: { thing1: { value: "审批" } } }, { accessToken: "fixture" });
    expect(JSON.parse(request.body).data.thing1.value).toBe("审批");
    expect(classifyNotificationResponse("wechat_official_account", 200, { errcode: 0 }).state).toBe("indeterminate");
  });
  it("never retries an unconfirmed transport outcome automatically", async () => {
    const transport = vi.fn().mockRejectedValue(Error("secret-url-must-not-leak"));
    const result = await sendNotification({ ...base, kind: "wecom_webhook" }, { url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret" }, transport);
    expect(result).toEqual({ state: "indeterminate", code: "transport_unconfirmed" }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("keeps 5xx uncertain but records explicit rate limits", () => {
    expect(classifyNotificationResponse("wecom_webhook", 503, {}).state).toBe("indeterminate");
    expect(classifyNotificationResponse("wecom_webhook", 429, {}, "12").retryAfterMs).toBe(12000);
  });
  it("validates accepted mock protocol without claiming a real delivery", async () => {
    expect((await sendNotification({ ...base, kind: "wecom_webhook" }, { url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture" }, vi.fn().mockResolvedValue(Response.json({ errcode: 0 })))).state).toBe("accepted");
  });
});
