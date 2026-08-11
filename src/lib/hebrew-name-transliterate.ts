/**
 * Transliteration from Hebrew to Arabic for courier PDF names/places.
 */
import { containsArabic } from "@/lib/arabic-text";

const HEBREW_RE = /[\u0590-\u05FF]/;

const HEBREW_TO_ARABIC_LETTER: Record<string, string> = {
  "\u05D0": "\u0627",
  "\u05D1": "\u0628",
  "\u05D2": "\u062C",
  "\u05D3": "\u062F",
  "\u05D4": "\u0647",
  "\u05D5": "\u0648",
  "\u05D6": "\u0632",
  "\u05D7": "\u062D",
  "\u05D8": "\u0637",
  "\u05D9": "\u064A",
  "\u05DB": "\u0643",
  "\u05DA": "\u0643",
  "\u05DC": "\u0644",
  "\u05DE": "\u0645",
  "\u05DD": "\u0645",
  "\u05E0": "\u0646",
  "\u05E1": "\u0633",
  "\u05E2": "\u0639",
  "\u05E4": "\u0641",
  "\u05E3": "\u0641",
  "\u05E6": "\u0635",
  "\u05E5": "\u0635",
  "\u05E7": "\u0642",
  "\u05E8": "\u0631",
  "\u05E9": "\u0634",
  "\u05EA": "\u062A",
  "\u05DF": "\u0646",
};

const HEBREW_NAME_TOKEN: Record<string, string> = {
  "\u05D0\u05D1\u05D5": "\u0623\u0628\u0648",
  "\u05D1\u05DF": "\u0628\u0646",
  "\u05D0\u05DC": "\u0627\u0644",
  "\u05DE\u05D5\u05D7\u05DE\u05D3": "\u0645\u062D\u0645\u062F",
  "\u05D0\u05D7\u05DE\u05D3": "\u0623\u062D\u0645\u062F",
  "\u05E2\u05DC\u05D9": "\u0639\u0644\u064A",
  "\u05D7\u05E1\u05DF": "\u062D\u0633\u0646",
  "\u05D7\u05D5\u05E1\u05D9\u05DF": "\u062D\u0633\u064A\u0646",
  "\u05D7\u05D8\u05D9\u05D1": "\u062E\u0637\u064A\u0628",
  "\u05DB\u05D4\u05DF": "\u0643\u0648\u0647\u064A\u0646",
  "\u05D3\u05D5\u05D3": "\u062F\u0627\u0641\u064A\u062F",
  "\u05D3\u05D9\u05D5\u05D5\u05D3": "\u062F\u0627\u0641\u064A\u062F",
  "\u05D9\u05D5\u05E1\u05E3": "\u064A\u0648\u0633\u0641",
  "\u05E1\u05DC\u05D9\u05DE\u05D0\u05DF": "\u0633\u0644\u064A\u0645\u0627\u0646",
  "\u05E1\u05DC\u05D9\u05DE\u05DF": "\u0633\u0644\u064A\u0645\u0627\u0646",
};

const HEBREW_LOCALITY_TOKEN: Record<string, string> = {
  "\u05E0\u05E6\u05E8\u05EA": "\u0627\u0644\u0646\u0627\u0635\u0631\u0629",
  "\u05DB\u05E4\u05E8 \u05DB\u05E0\u05D0": "\u0643\u0641\u0631 \u0643\u0646\u0627",
  "\u05E9\u05E4\u05E8\u05E2\u05DD": "\u0634\u0641\u0627\u0639\u0645\u0631\u0648",
  "\u05E2\u05DB\u05D5": "\u0639\u0643\u0627",
  "\u05D7\u05D9\u05E4\u05D4": "\u062D\u064A\u0641\u0627",
  "\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD": "\u0627\u0644\u0642\u062F\u0633",
};

export type HebrewTransliterationContext = "customer" | "locality";

export function containsHebrew(text: string | null | undefined): boolean {
  return Boolean(text && HEBREW_RE.test(text));
}

function stripNikud(text: string): string {
  return text.replace(/[\u0591-\u05C7]/g, "");
}

function normalizeHebrewToken(token: string): string {
  return stripNikud(token).trim();
}

function transliterateHebrewLetters(text: string): string | null {
  let out = "";
  for (const ch of stripNikud(text)) {
    const mapped = HEBREW_TO_ARABIC_LETTER[ch];
    if (!mapped && ch !== " " && ch !== "-" && ch !== "'") return null;
    if (mapped) out += mapped;
  }
  return out.trim() || null;
}

function transliterateHebrewToken(token: string, context: HebrewTransliterationContext): string | null {
  const normalized = normalizeHebrewToken(token);
  if (!normalized) return null;

  const dict =
    context === "locality"
      ? { ...HEBREW_NAME_TOKEN, ...HEBREW_LOCALITY_TOKEN }
      : HEBREW_NAME_TOKEN;

  if (dict[normalized]) return dict[normalized];
  return transliterateHebrewLetters(normalized);
}

export function tokenizeHebrewName(name: string): string[] {
  return stripNikud(name)
    .replace(/[()[\]{}]/g, " ")
    .replace(/[_./\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export type HebrewTransliterationResult = {
  suggested: string | null;
  mappedCount: number;
  tokenCount: number;
  complete: boolean;
};

export function transliterateHebrewToArabic(
  hebrewOrMixed: string | null | undefined,
  context: HebrewTransliterationContext = "customer",
): HebrewTransliterationResult {
  const raw = (hebrewOrMixed ?? "").trim();
  if (!raw) return { suggested: null, mappedCount: 0, tokenCount: 0, complete: false };
  if (containsArabic(raw)) {
    return { suggested: raw, mappedCount: 1, tokenCount: 1, complete: true };
  }

  const tokens = tokenizeHebrewName(raw);
  if (tokens.length === 0) {
    return { suggested: null, mappedCount: 0, tokenCount: 0, complete: false };
  }

  const parts: string[] = [];
  let mapped = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const n = normalizeHebrewToken(token);

    if (n === "\u05D0\u05DC" && i + 1 < tokens.length) {
      const next = transliterateHebrewToken(tokens[i + 1]!, context);
      if (next) {
        parts.push(next.startsWith("\u0627\u0644") ? next : `\u0627\u0644${next}`);
        mapped += 2;
        i++;
        continue;
      }
    }

    if (n === "\u05D0\u05D1\u05D5" && i + 1 < tokens.length) {
      const next = transliterateHebrewToken(tokens[i + 1]!, context);
      if (next) {
        parts.push(`\u0623\u0628\u0648 ${next}`);
        mapped += 2;
        i++;
        continue;
      }
    }

    const ar = transliterateHebrewToken(token, context);
    if (ar) {
      parts.push(ar);
      mapped++;
    }
  }

  if (mapped === 0) {
    return { suggested: null, mappedCount: 0, tokenCount: tokens.length, complete: false };
  }

  const suggested = parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    suggested: suggested || null,
    mappedCount: mapped,
    tokenCount: tokens.length,
    complete: mapped === tokens.length,
  };
}
