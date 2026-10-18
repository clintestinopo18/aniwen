import fs from "node:fs/promises";
const picks = [
  ["frieren", "Frieren", "ANIME"],
  ["solo-leveling", "Solo Leveling", "ANIME"],
  ["jujutsu-kaisen", "Jujutsu Kaisen", "ANIME"],
  ["demon-slayer", "Kimetsu no Yaiba", "ANIME"],
  ["chainsaw-man", "Chainsaw Man", "ANIME"],
  ["spy-family", "SPY x FAMILY", "ANIME"],
  ["attack-on-titan", "Shingeki no Kyojin", "ANIME"],
  ["vinland-saga", "Vinland Saga", "ANIME"],
  ["berserk", "Berserk", "MANGA"],
  ["one-piece", "ONE PIECE", "MANGA"],
  ["vagabond", "Vagabond", "MANGA"],
  ["blue-lock", "Blue Lock", "MANGA"],
  ["dandadan", "Dandadan", "MANGA"],
  ["sakamoto-days", "SAKAMOTO DAYS", "MANGA"],
  ["solo-leveling-manhwa", "Solo Leveling", "MANGA"],
  ["omniscient-reader", "Omniscient Reader", "MANGA"],
  ["tower-of-god", "Tower of God", "MANGA"],
  ["the-horizon", "The Horizon", "MANGA"],
  ["the-boxer", "The Boxer", "MANGA"],
  ["eleceed", "Eleceed", "MANGA"],
];
const query =
  "{" +
  picks
    .map(
      ([slug, name, type], i) =>
        `m${i}:Media(search:${JSON.stringify(name)},type:${type},isAdult:false){id title{english romaji} coverImage{extraLarge} bannerImage episodes chapters status startDate{year} genres countryOfOrigin}`,
    )
    .join("\n") +
  "}";
const r = await fetch("https://graphql.anilist.co", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
  signal: AbortSignal.timeout(30000),
});
if (!r.ok) throw new Error("Artwork metadata: " + r.status);
const data = await r.json();
if (data.errors) throw new Error(JSON.stringify(data.errors));
await fs.mkdir("dist/assets", { recursive: true });
const records = [];
for (let i = 0; i < picks.length; i++) {
  const [slug] = picks[i],
    m = data.data["m" + i];
  const image = await fetch(m.coverImage.extraLarge, {
    signal: AbortSignal.timeout(20000),
  });
  if (!image.ok) throw new Error("Cover failed: " + slug);
  await fs.writeFile(
    `dist/assets/${slug}.jpg`,
    Buffer.from(await image.arrayBuffer()),
  );
  if (i === 0 && m.bannerImage) {
    const b = await fetch(m.bannerImage);
    await fs.writeFile(
      "dist/assets/hero.jpg",
      Buffer.from(await b.arrayBuffer()),
    );
  }
  records.push({ slug, ...m });
  console.log(slug + ": " + (m.title.english || m.title.romaji));
}
await fs.writeFile("dist/artwork.json", JSON.stringify(records, null, 2));
console.log("Saved " + records.length + " covers and hero artwork.");
