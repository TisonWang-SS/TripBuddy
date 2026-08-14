import { parseCalendarDate } from "@/lib/dateSemantics";

export type ExtractedSearchQuery = {
  checkIn?: string;
  checkOut?: string;
  city?: string;
  cityAsAsked?: string;
  nights?: number;
  priceMode?: "cash" | "points";
};

export type SearchQueryOptions = {
  /** The local calendar day used to resolve a month/day without a year. */
  referenceDate?: Date;
};

/*
 * This is intentionally a small, deterministic fallback rather than a second
 * natural-language model. It covers the date and city shapes people most often
 * use at the command bar, while the model remains free to understand a wider
 * vocabulary. Its important job is to make the same safe rewrites offline that
 * the model is instructed to make online.
 */
const CITY_ALIASES: readonly { aliases: readonly string[]; provider: string }[] = [
  { aliases: ["东京", "東京", "tokyo"], provider: "Tokyo" },
  { aliases: ["京都", "kyoto"], provider: "Kyoto" },
  { aliases: ["大阪", "おおさか", "osaka"], provider: "Osaka" },
  { aliases: ["札幌", "sapporo"], provider: "Sapporo" },
  { aliases: ["福冈", "福岡", "fukuoka"], provider: "Fukuoka" },
  { aliases: ["冲绳", "沖縄", "okinawa"], provider: "Okinawa" },
  { aliases: ["纽约市", "纽约", "new york city", "new york", "nyc"], provider: "New York" },
  { aliases: ["洛杉矶", "los angeles", "la"], provider: "Los Angeles" },
  { aliases: ["旧金山", "san francisco", "sf"], provider: "San Francisco" },
  { aliases: ["伦敦", "london"], provider: "London" },
  { aliases: ["巴黎", "paris"], provider: "Paris" },
  { aliases: ["新加坡", "singapore"], provider: "Singapore" },
  { aliases: ["吉隆坡", "kuala lumpur", "kl"], provider: "Kuala Lumpur" },
  { aliases: ["首尔", "首爾", "seoul"], provider: "Seoul" },
  { aliases: ["曼谷", "bangkok"], provider: "Bangkok" },
  { aliases: ["台北", "臺北", "taipei"], provider: "Taipei" },
  { aliases: ["香港", "hong kong"], provider: "Hong Kong" },
  { aliases: ["北京", "beijing"], provider: "Beijing" },
  { aliases: ["上海", "shanghai"], provider: "Shanghai" }
];

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
};

/** Extracts only dates whose year is present in the user wording. */
export function extractSearchQuery(text: string, options: SearchQueryOptions = {}): ExtractedSearchQuery {
  const dates = extractDates(text);
  const resolvedDates = dates.length > 0 ? dates : inferUpcomingDates(text, options.referenceDate ?? new Date());
  const city = extractCity(text);
  const nights = extractNights(text);
  const checkIn = resolvedDates[0];
  /* A single date is a complete one-night price query; only an explicit stay length overrides it. */
  const checkOut = resolvedDates[1] ?? (checkIn ? addCalendarDays(checkIn, nights ?? 1) : undefined);

  return {
    checkIn,
    checkOut,
    ...(city ? { city: city.provider, cityAsAsked: city.asAsked } : {}),
    nights,
    ...(/积分|点数|points?|award|奖励兑换|兑换积分/iu.test(text) ? { priceMode: "points" as const } : {})
  };
}

/**
 * Resolves month/day wording to the next occurrence relative to the local
 * calendar day. This is query normalization, not a model guess: the same
 * reference day and the same input always produce the same date.
 */
export function inferUpcomingDates(text: string, referenceDate = new Date()): string[] {
  const partials = [
    ...[...text.matchAll(/(\d{1,2})月\s*(\d{1,2})日?/g)].map((match) => ({ day: match[2], month: match[1], position: match.index! })),
    ...[...text.matchAll(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi
    )].map((match) => ({ day: match[2], month: String(englishMonth(match[1])), position: match.index! }))
  ].sort((left, right) => left.position - right.position);
  if (partials.length === 0) {
    return [];
  }

  const reference = localCalendarDate(referenceDate);
  let previous: string | undefined;
  return partials
    .map(({ day, month }) => {
      let year = reference.year;
      let value = normalizeDate(String(year), month, day);
      if (!value) {
        return undefined;
      }
      if (value < reference.value || (previous !== undefined && value < previous)) {
        year += 1;
        value = normalizeDate(String(year), month, day);
      }
      previous = value;
      return value;
    })
    .filter((value): value is string => value !== undefined);
}

/** Returns normalized dates found in complete date expressions, in request order. */
export function extractDates(text: string): string[] {
  const complete: { end: number; start: number; value: string }[] = [];

  for (const match of text.matchAll(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const value = normalizeDate(match[1], match[2], match[3]);
    if (value) {
      complete.push({ end: match.index! + match[0].length, start: match.index!, value });
    }
  }
  for (const match of text.matchAll(/((?:19|20)\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日?/g)) {
    const value = normalizeDate(match[1], match[2], match[3]);
    if (value) {
      complete.push({ end: match.index! + match[0].length, start: match.index!, value });
    }
  }
  for (const match of text.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+((?:19|20)\d{2})\b/gi
  )) {
    const month = englishMonth(match[1]);
    const value = month ? normalizeDate(match[3], String(month), match[2]) : undefined;
    if (value) {
      complete.push({ end: match.index! + match[0].length, start: match.index!, value });
    }
  }

  const years = [...text.matchAll(/\b((?:19|20)\d{2})年?\b/g)].map((match) => match[1]);
  const partials = [...text.matchAll(/(\d{1,2})月\s*(\d{1,2})日?/g)];
  const year = years.at(-1);

  /* A range often writes the year only once: 2026年9月1日到9月3日. */
  if (year) {
    for (const match of partials) {
      const start = match.index!;
      const coveredByComplete = complete.some((date) => start >= date.start && start < date.end);
      if (coveredByComplete) {
        continue;
      }
      const value = normalizeDate(year, match[1], match[2]);
      if (value) {
        complete.push({ end: start + match[0].length, start, value });
      }
    }
  }

  /*
   * A common multi-turn shape is:
   *   user: 9月1日东京的酒店
   *   user: 2026年，住1晚
   * The year and month/day are both user-supplied, just in different turns.
   * Combining them here is safe; inventing the missing year would not be.
   */
  return complete.sort((left, right) => left.start - right.start).map(({ value }) => value);
}

export function addCalendarDays(value: string, days: number) {
  const date = parseCalendarDate(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function extractCity(text: string) {
  const lower = text.toLowerCase();
  for (const entry of CITY_ALIASES) {
    const alias = entry.aliases.slice().sort((left, right) => right.length - left.length).map((candidate) => {
      const pattern = /^[a-z ]+$/i.test(candidate) && candidate.length <= 3
        ? new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i")
        : new RegExp(escapeRegExp(candidate), "i");
      const match = pattern.exec(lower);
      return match ? { candidate, start: match.index } : null;
    }).find((match) => match !== null);
    if (alias) {
      return { asAsked: text.slice(alias.start, alias.start + alias.candidate.length), provider: entry.provider };
    }
  }
  return undefined;
}

function extractNights(text: string) {
  const chinese = text.match(/住\s*(\d+|[一二两三四五六七八九十])\s*晚/);
  if (chinese) {
    return Number(chinese[1]) || CHINESE_NUMBERS[chinese[1]];
  }
  const english = text.match(/(?:stay|for)\s+(\d+)\s+nights?/i) ?? text.match(/(\d+)\s+nights?/i);
  return english ? Number(english[1]) : undefined;
}

function normalizeDate(year: string, month: string, day: string) {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number.isNaN(parseCalendarDate(value).getTime()) ? undefined : value;
}

function englishMonth(value: string) {
  const month = value.slice(0, 3).toLowerCase();
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month) + 1;
}

function localCalendarDate(value: Date) {
  const year = value.getFullYear();
  const month = value.getMonth() + 1;
  const day = value.getDate();
  return { value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, year };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
