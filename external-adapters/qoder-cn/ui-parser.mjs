export function parseStdoutLine(line, ts) {
  let event; try { event = JSON.parse(line); } catch { return [{ kind: "stdout", ts, text: line }]; }
  if (event.type === "assistant" && Array.isArray(event.message?.content)) return event.message.content.filter(item => item.type === "text" && typeof item.text === "string").map(item => ({ kind: "assistant", ts, text: item.text }));
  if (event.type === "result" && typeof event.result === "string") return [{ kind: "assistant", ts, text: event.result, channel: "final" }];
  return [{ kind: "stdout", ts, text: line }];
}
