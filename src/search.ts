export type Language = "auto" | "hu" | "en" | "both";

export type SearchItem = {
  title: string;
  url: string;
  text: string;
  source?: string;
  date?: string;
  kind?: string;
  score?: number;
  snippet?: string;
};

const termGroups = [
  ["tanulmányi időszak", "tanév rendje", "academic calendar", "academic year", "semester dates"],
  ["szorgalmi időszak", "oktatási időszak", "teaching period", "instruction period"],
  ["vizsgaidőszak", "vizsga", "exam period", "examination period", "exam"],
  ["tárgybővítés", "tárgyfelvétel", "kurzusfelvétel", "course add", "course registration", "course enrollment"],
  ["ösztöndíj", "ösztöndíjak", "scholarship", "scholarships", "grant"],
  ["tanulmányi osztály", "tanulmányi ügyek", "study office", "student administration", "student affairs"],
  ["határidő", "határidők", "deadline", "deadlines", "due date"],
  ["kurzus", "tantárgy", "tárgy", "course", "subject", "class"],
  ["szakdolgozat", "diplomamunka", "thesis", "dissertation"],
  ["adatbázisrendszerek", "adatbázis", "database systems", "database management systems"],
  ["komplex ai alkalmazások", "complex ai applications", "advanced ai applications"],
];

export function normalize(value: string): string {
  return value.toLocaleLowerCase("hu")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function expandQuery(query: string): string[] {
  const normalized = normalize(query);
  const expanded = new Set<string>([query]);
  for (const group of termGroups) {
    if (group.some((term) => normalized.includes(normalize(term)))) {
      for (const term of group) expanded.add(term);
    }
  }
  return [...expanded].map(normalize).filter(Boolean);
}

export function scoreText(queryTerms: string[], title: string, text: string): number {
  const normalizedTitle = normalize(title);
  const allText = `${normalizedTitle} ${normalize(text)}`;
  return queryTerms.reduce((score, term) =>
    score + (allText.includes(term) ? (normalizedTitle.includes(term) ? 5 : 2) : 0), 0);
}

export function makeSnippet(queryTerms: string[], text: string, maxLength = 360): string {
  const plain = text.replace(/\s+/g, " ").trim();
  const normalized = normalize(plain);
  let index = -1;
  for (const term of queryTerms) {
    const found = normalized.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0 || plain.length <= maxLength) return plain.slice(0, maxLength);
  const start = Math.max(0, index - 100);
  const end = Math.min(plain.length, start + maxLength);
  return `${start ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function responseText(results: SearchItem[], language: Language, notes: string[] = []): string {
  const lines: string[] = [];
  lines.push(language === "en" ? "Search results (source text is kept in its original language):" :
    language === "both" ? "Találatok / Search results (az eredeti forrásszöveg nyelvén / in the source language):" :
      "Találatok (az eredeti forrásszöveg nyelvén):");
  if (results.length === 0) {
    lines.push(language === "en" ? "No matching source was found. Try a shorter phrase or a Hungarian/English synonym." :
      language === "both" ? "Nincs találat. Próbálj rövidebb kifejezést vagy magyar/angol megfelelőjét. / No results. Try a shorter phrase or its Hungarian/English equivalent." :
        "Nincs találat. Próbálj rövidebb kifejezést vagy annak magyar/angol megfelelőjét.");
  }
  results.forEach((item, index) => {
    const source = item.source ? ` · ${escapeMarkdown(item.source)}` : "";
    const date = item.date ? ` · ${escapeMarkdown(item.date)}` : "";
    lines.push(`\n${index + 1}. **[${escapeMarkdown(item.title)}](${item.url})**${source}${date}`);
    if (item.snippet) lines.push(`   ${escapeMarkdown(item.snippet)}`);
  });
  if (notes.length) {
    lines.push(language === "en" ? "\nNotes:" : language === "both" ? "\nMegjegyzés / Notes:" : "\nMegjegyzés:");
    for (const note of notes) lines.push(`- ${note}`);
  }
  return lines.join("\n");
}

export function safeOfficialUrl(value: string, officialHosts: string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && officialHosts.some((host) =>
      url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}