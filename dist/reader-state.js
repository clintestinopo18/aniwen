export function nextProgress(previous, unit, extra = {}) {
  return { ...(previous?.id === String(unit.id) ? previous : {}), id: String(unit.id), number: unit.number ?? unit.chapterNumber ?? "", ...extra };
}
export function pageIndex(value, total) {
  const n = Number(value);
  return Math.max(0, Math.min(Math.max(0, total - 1), Number.isFinite(n) ? Math.floor(n) : 0));
}
export function readerKey(event, mode) {
  if (mode !== "paged" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented) return 0;
  if (event.target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"]')) return 0;
  return event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
}
