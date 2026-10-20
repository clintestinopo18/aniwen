// Original short editorial descriptions. Cover credits are retained in artwork.json.
const descriptions = {
  frieren:
    "The adventure ends. A new journey begins. Follow an elven mage as she discovers the fleeting, beautiful connections that make a lifetime worth living.",
  "solo-leveling":
    "The weakest hunter gets a second chance. A mysterious system turns survival into a relentless climb toward unimaginable power.",
  "jujutsu-kaisen":
    "One cursed object changes everything. Yuji Itadori enters a hidden world where human fears become monsters—and sorcerers fight back.",
  "demon-slayer":
    "A kindhearted boy takes up a blade to protect his sister and confront the demons that shattered his family.",
  "chainsaw-man":
    "A boy, his chainsaw devil, and a very dangerous new job. Denji’s simple dreams collide with a world of impossible bargains.",
  "spy-family":
    "A spy needs a family for his next mission. His new wife is an assassin. Their daughter reads minds. Nobody has the full picture.",
  "attack-on-titan":
    "Beyond the walls lies a terrifying world. Three childhood friends join a desperate fight that will overturn everything they believe.",
  "vinland-saga":
    "Amid the violence of the Viking age, a young warrior searches for purpose beyond revenge.",
  berserk:
    "A lone swordsman carries an impossible burden through a brutal world of ambition, betrayal, and fate.",
  "one-piece":
    "Set sail with Luffy and a wonderfully unlikely crew in search of the greatest treasure on the seas.",
  vagabond:
    "A restless young swordsman begins a long, uncompromising journey toward mastery—and understanding himself.",
  "blue-lock":
    "Japan’s most promising young forwards enter an uncompromising experiment to create the ultimate striker.",
  dandadan:
    "A believer in ghosts and a believer in aliens discover they are both right. Nothing about their lives stays ordinary.",
  "sakamoto-days":
    "A legendary hitman trades danger for family life and a corner store. His past, unfortunately, refuses to retire.",
  "solo-leveling-manhwa":
    "Enter the gates with Sung Jinwoo in the full-color story that follows one hunter’s rise from weakest to extraordinary.",
  "omniscient-reader":
    "A novel becomes reality. Its only reader suddenly knows what comes next—but knowing the story may not be enough to survive.",
  "tower-of-god":
    "A boy enters a mysterious tower to find the person who means everything to him. Every floor brings a new test.",
  "the-horizon":
    "Two children meet in a world undone by war. A quiet, devastating story about finding humanity when everything seems lost.",
  "the-boxer":
    "An extraordinary talent steps into the ring. Behind every opponent is a different answer to what it means to keep fighting.",
  eleceed:
    "A kindhearted speedster meets a powerful awakener hiding in the body of a cat. Their unlikely partnership changes both their worlds.",
};
export async function loadCatalog() {
  const response = await fetch("./artwork.json");
  if (!response.ok)
    throw new Error("The library could not load. Please refresh.");
  const items = await response.json();
  return items.map((m, i) => ({
    key: m.slug,
    id: m.slug,
    title: m.title.english || m.title.romaji,
    alternative: m.title.romaji,
    kind: i < 8 ? "anime" : m.countryOfOrigin === "KR" ? "manhwa" : "manga",
    image: `assets/${m.slug}.jpg`,
    genres: m.genres,
    year: m.startDate.year,
    description: descriptions[m.slug],
    total: m.episodes || m.chapters || null,
    status: m.status === "FINISHED" ? "Completed" : "Ongoing",
    editorial: true,
    sourceId: m.id,
  }));
}
export function titleOf(t) {
  return typeof t === "string"
    ? t
    : t?.english || t?.romaji || t?.native || "Untitled";
}
export function plainText(s) {
  const value =
    typeof s === "object" ? s?.en || Object.values(s || {})[0] || "" : s;
  return (
    new DOMParser().parseFromString(String(value || ""), "text/html").body
      .textContent || ""
  );
}
export function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value, location.href);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
export function normalize(item, kind, provider, base) {
  const id = String(item.id || "");
  const actualKind =
    kind !== "anime" && item.countryOfOrigin === "KR"
      ? "manhwa"
      : item.countryOfOrigin === "JP" && kind !== "anime"
        ? "manga"
        : kind;
  return {
    key: ["megaplay", "weebcentral", "mangapill", "comick", "mangadex"].includes(provider) ? `title-${actualKind}-${provider}-${encodeURIComponent(id)}` : `remote-${actualKind}-${provider}-${encodeURIComponent(base)}-${encodeURIComponent(id)}`,
    id,
    title: titleOf(item.title),
    alternative:
      item.altTitles
        ?.map((t) => (typeof t === "string" ? t : Object.values(t).join(" ")))
        .join(" ") || "",
    kind: actualKind,
    image: safeUrl(item.image || item.cover),
    genres: Array.isArray(item.genres) ? item.genres : [],
    year: item.releaseDate || item.year || "",
    description: plainText(item.description),
    total: item.totalEpisodes || item.totalChapters || null,
    status: item.status || "Unknown",
    provider,
    base,
    editorial: false,
  };
}
