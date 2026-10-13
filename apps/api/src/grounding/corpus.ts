/**
 * Deterministic text matching used to check LLM output against the user's
 * own words. Everything here is pure and cheap, so it runs on every draft and
 * every section update — it is the backstop that does not depend on the model
 * following instructions.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'is', 'was',
  'were', 'be', 'been', 'are', 'it', 'its', 'this', 'that', 'these', 'those', 'into', 'over', 'via', 'per',
]);

const NUMBER_WORDS: Record<string, string> = {
  '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight',
  '9': 'nine', '10': 'ten', '11': 'eleven', '12': 'twelve', '15': 'fifteen', '20': 'twenty',
};

/** Words that may be capitalised mid-sentence without being a "fact". */
const ALWAYS_ALLOWED = new Set([
  'i', 'cv', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november',
  'december', 'present', 'current',
]);

/** Lowercase, strip diacritics and punctuation (keeping + and # for C++/C#). */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

const digitsOnly = (s: string) => s.replace(/\D/g, '');

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

// Digits inside phone numbers, emails and URLs must not "support" metrics:
// a phone ending in 45 is not evidence for "improved latency by 45%".
const PHONE_RE = /(?:\+|\b00)\d[\d\s().-]{6,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{2,4}(?:[\s.-]\d{2})?\b/g;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_RE = /\b(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?/gi;

export class Corpus {
  private readonly norm: string;
  private readonly lower: string;
  private readonly tokens: Set<string>;
  private readonly allDigits: string;
  private readonly numbers: Set<string>;

  constructor(text: string) {
    this.norm = ` ${normalize(text)} `;
    this.lower = text.toLowerCase();
    this.tokens = new Set(tokenize(text));
    this.allDigits = digitsOnly(text);
    this.numbers = new Set<string>();
    const numericText = text.replace(PHONE_RE, ' ').replace(EMAIL_RE, ' ').replace(URL_RE, ' ');
    for (const m of numericText.matchAll(NUMBER_RE)) {
      this.numbers.add(digitsOnly(m[0]));
      for (const part of m[0].split(/[.,]/)) this.numbers.add(part);
    }
  }

  /** Whole-word phrase match after normalisation. Empty input is trivially supported. */
  containsPhrase(fragment: string): boolean {
    const n = normalize(fragment);
    return !n || this.norm.includes(` ${n} `);
  }

  containsRaw(fragment: string): boolean {
    return this.lower.includes(fragment.toLowerCase());
  }

  containsDigitSequence(digits: string): boolean {
    return digits.length > 0 && this.allDigits.includes(digits);
  }

  hasToken(token: string): boolean {
    return this.tokens.has(token);
  }

  /** Token match tolerant to simple English plurals ("API" ~ "APIs", "service" ~ "services"). */
  hasTokenLoose(token: string): boolean {
    if (this.tokens.has(token)) return true;
    if (/\d/.test(token)) return false;
    const variants = [`${token}s`, `${token}es`, token.replace(/es$/, ''), token.replace(/s$/, '')];
    return variants.some((v) => v.length > 1 && this.tokens.has(v));
  }

  /** Share of meaningful tokens of `fragment` that occur anywhere in the corpus. */
  tokenCoverage(fragment: string): number {
    const toks = tokenize(fragment).filter((t) => !STOPWORDS.has(t));
    if (toks.length === 0) return 1;
    return toks.filter((t) => this.hasTokenLoose(t)).length / toks.length;
  }

  hasNumber(raw: string): boolean {
    const d = digitsOnly(raw);
    if (!d) return true;
    if (this.numbers.has(d)) return true;
    const word = NUMBER_WORDS[String(Number(d))];
    return word !== undefined && this.tokens.has(word);
  }
}

/**
 * "Hard" terms are the parts of a sentence most likely to be fabricated and
 * most damaging when they are: numbers, and proper nouns / product names
 * (capitalised mid-sentence, CamelCase, ALLCAPS, or containing digits/+/#).
 * Common words can be rephrased freely; these cannot.
 */
export function extractHardTerms(text: string): { numbers: string[]; terms: string[] } {
  const numbers = [...text.matchAll(NUMBER_RE)].map((m) => m[0]);
  const terms: string[] = [];
  const wordRe = /[\p{L}\p{N}][\p{L}\p{N}+#.\-/']*/gu;
  for (const m of text.matchAll(wordRe)) {
    const word = m[0].replace(/[.\-/']+$/u, '');
    if (!word || /^\d+(?:[.,]\d+)*$/.test(word)) continue;
    const before = text.slice(0, m.index).trimEnd();
    const sentenceStart = before === '' || /[.!?:;•\-–—(\n]$/.test(before);
    const hasInnerUpper = /^.+\p{Lu}/u.test(word);
    const hasSymbolOrDigit = /[\d+#]/.test(word);
    const capitalised = /^\p{Lu}/u.test(word);
    if (hasInnerUpper || hasSymbolOrDigit || (capitalised && !sentenceStart)) {
      if (!ALWAYS_ALLOWED.has(word.toLowerCase())) terms.push(word);
    }
  }
  return { numbers, terms };
}

/** Returns the hard terms in `text` that the corpus (or the allow-list) does not contain. */
export function findUnsupportedTerms(text: string, corpus: Corpus, allow: Set<string> = new Set()): string[] {
  const { numbers, terms } = extractHardTerms(text);
  const missing: string[] = [];
  for (const n of numbers) if (!corpus.hasNumber(n)) missing.push(n);
  for (const t of terms) {
    const toks = tokenize(t);
    if (toks.every((tok) => allow.has(tok))) continue;
    if (!corpus.containsPhrase(t) && !toks.every((tok) => corpus.hasTokenLoose(tok))) missing.push(t);
  }
  return [...new Set(missing)];
}

/** A quote is valid evidence if it appears in the source (tolerating minor punctuation/case drift). */
export function isValidEvidence(quote: string, corpus: Corpus): boolean {
  const toks = tokenize(quote);
  if (toks.length === 0) return false;
  if (corpus.containsPhrase(quote)) return true;
  return toks.length >= 3 && corpus.tokenCoverage(quote) >= 0.85;
}

export function digitsOf(s: string): string {
  return digitsOnly(s);
}
