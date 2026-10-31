/**
 * Decodes the small set of HTML entities commonly found in official EKKE pages.
 * The extracted text is plain text for search indexing, not HTML to render.
 */
export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/**
 * Extracts a page title and readable text while dropping non-content markup.
 */
export function parsePage(url: string, html: string): { title: string; text: string } {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(url).pathname)
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = decodeHtml(html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
  return { title, text };
}

/** Extracts sitemap locations and decodes XML-escaped URL characters. */
export function extractLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeHtml(match[1].trim()));
}
