import type { AccountPageSnapshot } from "@/lib/browserConnector";

export type ExtractedAccountBooking = {
  bookingUrl: string | null;
  cancellationDeadline: Date | null;
  checkIn: Date;
  checkOut: Date;
  city: string;
  confirmationNumber: string | null;
  currency: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
  originalPrice: number;
  awardLabel: string | null;
  pointsPrice: number | null;
  priceSource: "cash" | "points" | "free_night" | "unknown";
  roomType: string;
};

export type AccountBookingExtraction = {
  bookings: ExtractedAccountBooking[];
  loginState: "logged_in" | "login_required" | "unknown";
  loginUrl: string;
  sourceUrl: string;
  summary: string;
};

const HYATT_LOGIN_URL = "https://www.hyatt.com/profile/en-US/account-overview";
const HYATT_BRAND_PATTERN = /\b(?:Park Hyatt|Grand Hyatt|Hyatt Regency|Hyatt Centric|Hyatt Place|Hyatt House|Hyatt Studios|Hyatt Zilara|Hyatt Ziva|Hyatt Vivid|Hyatt Vacation Club|Hyatt|Andaz|Alila|Thompson|JdV|Dream|Destination by Hyatt|Caption by Hyatt|The Unbound Collection|The StandardX?|Miraval)\b/i;
const CURRENCY_PATTERN = "(?:USD|US\\$|\\$|CNY|RMB|CN¥|¥|￥|MYR|RM|JPY|SGD|S\\$|HKD|HK\\$|EUR|€|GBP|£|THB|฿|KRW|₩)";

export function parseHyattAccountBookingsFromSnapshots(snapshots: AccountPageSnapshot[]): AccountBookingExtraction {
  const sourceUrl = snapshots.at(-1)?.url ?? HYATT_LOGIN_URL;
  const combinedText = snapshots.map((snapshot) => snapshot.text).join("\n\n");

  if (snapshots.some((snapshot) => isHyattLoginRequired(snapshot.text, snapshot.url)) || isHyattLoginRequired(combinedText, sourceUrl)) {
    return {
      bookings: [],
      loginState: "login_required",
      loginUrl: HYATT_LOGIN_URL,
      sourceUrl,
      summary: "Hyatt account is not signed in. Sign in with the configured Chrome profile, then import again."
    };
  }

  const bookings = mergeBookingDetails(
    snapshots.flatMap((snapshot) => extractHyattBookingSegments(snapshot.text).map(parseHyattBookingSegment).filter(isBooking))
  );
  const stayListLoaded = snapshots.some((snapshot) => isHyattStayListPage(snapshot.text, snapshot.url));
  const hasReservationSignals = /Confirmation(?: Number)?|Check-?in|Check-?out|Reservation Details/i.test(combinedText);
  return {
    bookings,
    loginState: bookings.length > 0 || (stayListLoaded && !hasReservationSignals) ? "logged_in" : "unknown",
    loginUrl: HYATT_LOGIN_URL,
    sourceUrl,
    summary:
      bookings.length > 0
        ? `Hyatt account exposed ${bookings.length} upcoming booking${bookings.length === 1 ? "" : "s"}.`
        : stayListLoaded && !hasReservationSignals
          ? "Hyatt account is signed in, but no upcoming bookings are visible in My Stays."
        : "Hyatt account opened, but no upcoming bookings could be parsed from the visible page text."
  };
}

export function isHyattLoginRequired(text: string, url = HYATT_LOGIN_URL) {
  const compactText = text.replace(/\s+/g, " ");
  const loginUrlSignal = /\/(?:profile|login|signin|sign-in|auth)\b/i.test(url);
  const signInSignals =
    /Sign In|Sign in to|First time signing in|Activate your online account|Not a member\?|Password|Username|Email Address|Passkeys/i.test(
      compactText
    );
  const accountSignals = /Sign Out|Upcoming Stays|Upcoming Reservations|My Reservations|Confirmation(?: Number| #|#)|Points Balance/i.test(compactText);
  return loginUrlSignal && signInSignals && !accountSignals;
}

function isHyattStayListPage(text: string, url: string) {
  const compactText = text.replace(/\s+/g, " ");
  return /\/my-stays/i.test(url) && /\bUpcoming\b/i.test(compactText) && /\bPast\b/i.test(compactText) && /\bMissing a reservation\?/i.test(compactText);
}

function extractHyattBookingSegments(text: string) {
  const compactText = text.replace(/\s+/g, " ").trim();
  const dateCardSegments = extractHyattDateRangeStayCards(compactText);
  const confirmationMatches = Array.from(compactText.matchAll(/Confirmation(?: Number)?\s*:?\s*#?\s*([A-Z0-9-]{5,})/gi));
  if (dateCardSegments.length > 0) {
    return [...dateCardSegments, ...extractHyattConfirmationSegments(compactText, confirmationMatches)];
  }

  if (confirmationMatches.length === 0) {
    return splitPotentialStayCards(compactText);
  }

  return extractHyattConfirmationSegments(compactText, confirmationMatches);
}

function extractHyattConfirmationSegments(text: string, confirmationMatches: RegExpMatchArray[]) {
  return confirmationMatches.map((match, index) => {
    const start = Math.max(0, (match.index ?? 0) - 700);
    const nextIndex = confirmationMatches[index + 1]?.index ?? text.length;
    const end = Math.min(text.length, nextIndex + 900);
    return text.slice(start, end);
  });
}

function extractHyattDateRangeStayCards(text: string) {
  const stayListText = text.split(/\bWorld of Hyatt\b/i)[0] ?? text;
  const cardStartPattern =
    /(?:[A-Z][a-z]{2},\s*)?[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:,\s*\d{4})?\s*(?:-|to|–|—)\s*(?:[A-Z][a-z]{2},\s*)?[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:,\s*\d{4})?\s+(?=[A-Z])/gi;
  const matches = Array.from(stayListText.matchAll(cardStartPattern));
  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const nextStart = matches[index + 1]?.index ?? stayListText.length;
      return stayListText.slice(start, nextStart);
    })
    .filter((segment) => HYATT_BRAND_PATTERN.test(segment) && /Confirmation(?: Number| #|#)?/i.test(segment));
}

function splitPotentialStayCards(text: string) {
  const chunks = text.split(/(?=\b(?:Upcoming Stay|Upcoming Reservation|Reservation Details|Check-?in)\b)/i);
  return chunks.filter((chunk) => HYATT_BRAND_PATTERN.test(chunk) && /Check-?in|Confirmation|Reservation/i.test(chunk));
}

function parseHyattBookingSegment(segment: string): ExtractedAccountBooking | null {
  const confirmationNumber = segment.match(/Confirmation(?: Number)?\s*:?\s*#?\s*([A-Z0-9-]{5,})/i)?.[1] ?? null;
  const dates = extractStayDates(segment);
  if (!dates) {
    return null;
  }
  const hotelName = extractHotelName(segment, confirmationNumber);
  const total = extractTotal(segment);
  const pointsPrice = extractPointsPrice(segment);
  const awardLabel = extractFreeNightAward(segment);

  return {
    bookingUrl: null,
    cancellationDeadline: extractCancellationDeadline(segment),
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    city: extractCity(segment, hotelName),
    confirmationNumber,
    currency: total?.currency ?? "USD",
    guests: extractGuests(segment),
    hotelGroup: "Hyatt",
    hotelName,
    originalPrice: total?.amount ?? 0,
    awardLabel,
    pointsPrice,
    priceSource: total ? "cash" : pointsPrice ? "points" : awardLabel ? "free_night" : "unknown",
    roomType: extractRoomType(segment)
  };
}

function extractStayDates(text: string) {
  const checkIn = extractLabeledDate(text, /Check-?in(?: Date)?/i);
  const checkOut = extractLabeledDate(text, /Check-?out(?: Date)?/i);
  if (checkIn && checkOut && checkOut > checkIn) {
    return { checkIn, checkOut };
  }

  const dateSource = "(?:[A-Z][a-z]{2},\\s*)?[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4}";
  const rangePattern = new RegExp(`(${dateSource})\\s*(?:-|to|–|—)\\s*(${dateSource})`, "i");
  const range = text.match(rangePattern);
  if (range) {
    const start = parseDateLabel(range[1]);
    const end = parseDateLabel(range[2]);
    return start && end && end > start ? { checkIn: start, checkOut: end } : null;
  }

  const yearlessDateSource = "(?:[A-Z][a-z]{2},\\s*)?[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2}";
  const yearlessRangePattern = new RegExp(`(${yearlessDateSource})\\s*(?:-|to|–|—)\\s*(${yearlessDateSource})`, "i");
  const yearlessRange = text.match(yearlessRangePattern);
  if (!yearlessRange) {
    return null;
  }
  return parseYearlessDateRange(yearlessRange[1], yearlessRange[2]);
}

function extractLabeledDate(text: string, label: RegExp) {
  const source = label.source;
  const dateSource = "((?:[A-Z][a-z]{2},\\s*)?[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})";
  const pattern = new RegExp(`${source}\\s*:?\\s*${dateSource}`, "i");
  const match = text.match(pattern);
  return match ? parseDateLabel(match[1]) : null;
}

function parseDateLabel(value: string) {
  const normalized = value.replace(/^[A-Z][a-z]{2},\s*/, "").replace(/\./g, "").replace(/\s+/g, " ").trim();
  const parsed = new Date(`${normalized} 00:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseYearlessDateRange(startValue: string, endValue: string) {
  const year = new Date().getUTCFullYear();
  const start = parseDateLabel(`${startValue}, ${year}`);
  let end = parseDateLabel(`${endValue}, ${year}`);
  if (!start || !end) {
    return null;
  }
  if (end <= start) {
    end = parseDateLabel(`${endValue}, ${year + 1}`);
  }
  return end && end > start ? { checkIn: start, checkOut: end } : null;
}

function extractHotelName(segment: string, confirmationNumber: string | null) {
  const beforeConfirmation = confirmationNumber ? segment.slice(0, Math.max(0, segment.indexOf(confirmationNumber))) : segment;
  const brandMatch = beforeConfirmation.match(HYATT_BRAND_PATTERN);
  if (!brandMatch || brandMatch.index === undefined) {
    return confirmationNumber ? `Hyatt reservation ${confirmationNumber}` : "Hyatt reservation";
  }

  const hotelCandidate = beforeConfirmation
    .slice(brandMatch.index)
    .split(/\s+(?:Confirmation|Check-?in|Check-?out|Reservation Details)\b/i)[0];
  const cleaned = cleanHotelNameLabel(hotelCandidate);
  return cleaned || (confirmationNumber ? `Hyatt reservation ${confirmationNumber}` : "Hyatt reservation");
}

function cleanHotelNameLabel(value: string) {
  const cleaned = cleanRepeatedTrailingWords(cleanLabel(value));
  const locationSuffix = cleaned.match(/^(.+)\s+([A-Z][A-Za-z .'-]{2,40}),\s*(Japan|Malaysia|United States|China|Singapore|Thailand|Korea|United Kingdom)$/i);
  if (!locationSuffix) {
    return cleaned;
  }

  const [, hotelName, city] = locationSuffix;
  return hotelName.toLowerCase().endsWith(city.toLowerCase()) ? hotelName : cleaned;
}

function extractCity(segment: string, hotelName: string) {
  const cityMatch = segment.match(/\b(?:City|Location|Address)\s*:?\s*([A-Z][A-Za-z .'-]{2,40})(?:,|\s{2,}| Check-?in| Confirmation|$)/i);
  if (cityMatch) {
    return cleanLabel(cityMatch[1]);
  }

  const escapedHotelName = escapeRegExp(hotelName);
  const afterHotelPattern = new RegExp(`${escapedHotelName}\\s+([A-Z][A-Za-z .'-]{2,40}),\\s*[A-Z][A-Za-z .'-]{2,40}`, "i");
  const afterHotelMatch = segment.match(afterHotelPattern);
  if (afterHotelMatch) {
    return cleanLabel(afterHotelMatch[1]);
  }

  const postalCityMatch = segment.match(/\b([A-Z][A-Za-z .'-]{2,40}),\s*\d{4,6}\s+[A-Z][A-Za-z .'-]{2,40}(?:\s+Stay Details|$)/i);
  if (postalCityMatch) {
    return cleanAddressCity(postalCityMatch[1]);
  }

  return "City not captured";
}

function cleanAddressCity(value: string) {
  const cleaned = cleanLabel(value);
  if (/\bKuala Lumpur\b/i.test(cleaned)) {
    return "Kuala Lumpur";
  }
  return cleaned;
}

function cleanRepeatedTrailingWords(value: string) {
  const words = value.split(/\s+/);
  if (words.length >= 2 && words.at(-1)?.toLowerCase() === words.at(-2)?.toLowerCase()) {
    return words.slice(0, -1).join(" ");
  }

  const half = Math.floor(words.length / 2);
  const tail = words.slice(half).join(" ").toLowerCase();
  const beforeTail = words.slice(0, half).join(" ").toLowerCase();
  if (tail && beforeTail.endsWith(tail)) {
    return words.slice(0, half).join(" ");
  }

  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRoomType(segment: string) {
  const roomMatch = segment.match(
    /\b(?:Room|Room Type|Accommodation)\s*:?\s*([A-Za-z0-9 ,.'&/-]{3,80}?)(?=\s+(?:Rate|[1-9][0-9]?\s*(?:Adult|Adults|Guest|Guests)|Check-?in|Check-?out|Confirmation|Total|Grand Total)|$)/i
  );
  if (!roomMatch) {
    return "Room not captured";
  }

  const roomType = cleanLabel(roomMatch[1]);
  return /^s\s*&$/i.test(roomType) || /rates preferences/i.test(roomType) ? "Room not captured" : roomType;
}

function extractGuests(segment: string) {
  const match = segment.match(/\b([1-9][0-9]?)\s*(?:Adult|Adults|Guest|Guests)\b/i);
  const guests = match ? Number(match[1]) : 1;
  return Number.isInteger(guests) && guests > 0 ? guests : 1;
}

function extractTotal(segment: string) {
  const totalPattern = new RegExp(`(?:Grand Total|Stay Total|Total Cash|Total for Stay|Total Cost Per Room\\*?|Total)\\s*(${CURRENCY_PATTERN})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "i");
  const totalMatch = segment.match(totalPattern);
  if (totalMatch) {
    return { amount: parseAmount(totalMatch[2]), currency: normalizeCurrency(totalMatch[1]) };
  }

  const reversedPattern = new RegExp(`(${CURRENCY_PATTERN})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\s*(?:Grand Total|Stay Total|Total Cash|Total for Stay|Total Cost Per Room\\*?|Total)`, "i");
  const reversedMatch = segment.match(reversedPattern);
  return reversedMatch ? { amount: parseAmount(reversedMatch[2]), currency: normalizeCurrency(reversedMatch[1]) } : null;
}

function extractPointsPrice(segment: string) {
  const patterns = [
    /(?:Total Points|Points Total|Redeemed|Redemption|Points)\s*:?\s*([0-9][0-9,]{2,8})\s*(?:points|pts)?/i,
    /([0-9][0-9,]{2,8})\s*(?:points|pts)\b/i
  ];

  for (const pattern of patterns) {
    const match = segment.match(pattern);
    if (match) {
      return Math.round(parseAmount(match[1]));
    }
  }

  return null;
}

function extractFreeNightAward(segment: string) {
  const match = segment.match(/(?:Total Awards?\*{0,2}|Free Night Award Applied).*?\b([1-9][0-9]?)\s*Free Night(?:s)?\b/i);
  if (match) {
    const nights = Number(match[1]);
    return `${nights} Free Night${nights === 1 ? "" : "s"}`;
  }

  return /Free Night Award Applied|Free Night redeemed/i.test(segment) ? "Free Night Award" : null;
}

function extractCancellationDeadline(segment: string) {
  const policyMatch = segment.match(/(?:Cancel(?:lation)?(?: by| before| until)?|Free cancellation before)\s+([^.;]{6,80})/i);
  if (!policyMatch) {
    return null;
  }
  return parseDateLabel(policyMatch[1]) ?? null;
}

function parseAmount(value: string) {
  return Number(value.replace(/,/g, ""));
}

function normalizeCurrency(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "$" || normalized === "US$") {
    return "USD";
  }
  if (normalized === "RM") {
    return "MYR";
  }
  if (normalized === "RMB" || normalized === "CN¥" || normalized === "¥" || normalized === "￥") {
    return "CNY";
  }
  return normalized;
}

function cleanLabel(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s*[:|]\s*$/, "").trim();
}

function isBooking(value: ExtractedAccountBooking | null): value is ExtractedAccountBooking {
  return value !== null;
}

function mergeBookingDetails(bookings: ExtractedAccountBooking[]) {
  const byKey = new Map<string, ExtractedAccountBooking>();
  for (const booking of bookings) {
    const key = booking.confirmationNumber
      ? `confirmation:${booking.confirmationNumber}`
      : [booking.hotelName, booking.checkIn.toISOString(), booking.checkOut.toISOString()].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, booking);
      continue;
    }
    byKey.set(key, mergeBooking(existing, booking));
  }
  return Array.from(byKey.values());
}

function mergeBooking(existing: ExtractedAccountBooking, incoming: ExtractedAccountBooking) {
  return {
    ...existing,
    bookingUrl: existing.bookingUrl ?? incoming.bookingUrl,
    cancellationDeadline: existing.cancellationDeadline ?? incoming.cancellationDeadline,
    city: existing.city === "City not captured" ? incoming.city : existing.city,
    currency: incoming.originalPrice > 0 ? incoming.currency : existing.currency,
    guests: existing.guests === 1 ? incoming.guests : existing.guests,
    originalPrice: incoming.originalPrice > 0 ? incoming.originalPrice : existing.originalPrice,
    awardLabel: incoming.awardLabel ?? existing.awardLabel,
    pointsPrice: incoming.pointsPrice ?? existing.pointsPrice,
    priceSource: incoming.originalPrice > 0 ? "cash" : incoming.pointsPrice ? "points" : incoming.awardLabel ? "free_night" : existing.priceSource,
    roomType: existing.roomType === "Room not captured" ? incoming.roomType : existing.roomType
  };
}
