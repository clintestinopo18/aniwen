export const MEGAPLAY_ORIGIN = "https://megaplay.buzz";
export function positiveId(value, max = 10000000) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max)
    throw Object.assign(new Error("Invalid anime or episode number."), { status: 400 });
  return Number(value);
}
export function embedUrl(id, episode, language = "sub") {
  if (!["sub", "dub"].includes(language)) throw Object.assign(new Error("Choose sub or dub."), { status: 400 });
  return `${MEGAPLAY_ORIGIN}/stream/ani/${positiveId(id)}/${positiveId(episode, 5000)}/${language}`;
}
// Only trust the exact origin AND the current iframe window, never sibling frames.
export function playerEvent(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== MEGAPLAY_ORIGIN) return null;
  let data = event.data;
  if (typeof data === "string") {
    if (data.length > 10000) return null;
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  if (data.event === "complete") return { type: "complete" };
  if (data.event === "error") return { type: "error" };
  if (data.event !== "time" && data.type !== "watching-log") return null;
  const time = Number(data.time ?? data.currentTime), duration = Number(data.duration);
  if (!Number.isFinite(time) || !Number.isFinite(duration) || time < 0 || duration <= 0 || time > duration + 5) return null;
  return { type: "progress", time: Math.min(time, duration), duration };
}
