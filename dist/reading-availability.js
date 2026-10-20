// Chapter listings are evidence of availability, not a promise of complete series coverage.
export function chapterAvailability(data) {
  if (!Array.isArray(data?.chapters)) return { state: "unknown" };
  const chapters = data.chapters;
  if (!chapters.length) return { state: data.chapterPagination?.hasNextPage ? "unknown" : "none" };
  const numbers = [...new Set(chapters.map(c => c.chapterNumber).filter(n => n != null))];
  return { state: "hosted", loaded: chapters.length, first: numbers[0] ?? null, more: data.chapterPagination?.hasNextPage === true };
}
export function availabilityLabel(value, external = false) {
  if (value?.state === "hosted") return "English chapters listed";
  if (value?.state === "none") return external ? "Publisher link available" : "No hosted English chapters";
  if (value?.state === "unknown") return "Availability unconfirmed";
  return "Checking chapters…";
}
// Bound source traffic, stop scheduling after navigation, and never call errors "no chapters".
export async function checkAvailability(items, load, update, {
  isCurrent = () => true,
  wait = () => new Promise(resolve => setTimeout(resolve, 500)),
} = {}) {
  let index = 0;
  async function worker() {
    while (isCurrent() && index < items.length) {
      const item = items[index++];
      let result;
      try { result = chapterAvailability(await load(item)); }
      catch { result = { state: "unknown" }; }
      if (!isCurrent()) return;
      update(item, result);
      if (index < items.length) await wait();
    }
  }
  await Promise.all([worker(), worker()]);
}
