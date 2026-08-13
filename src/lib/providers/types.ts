import type { LoginState } from "@prisma/client";
import type { BrowserAgentAction, BrowserAgentControlSnapshot } from "@/lib/providers/hyattBrowser";

export type InventoryTypeValue = "cash" | "award";

export type BookingPriceInput = {
  bookingId: string;
  bookingUrl: string | null;
  cancellationDeadline: Date | null;
  checkIn: Date;
  checkOut: Date;
  city: string;
  currency: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
  inventoryTypes: readonly InventoryTypeValue[];
  roomType: string;
};

export type BrowserPageSnapshot = {
  capturedAt: string;
  controls: BrowserAgentControlSnapshot[];
  pageText: string;
  pageTitle: string;
  sourceUrl: string;
};

export type SanitizedBrowserSnapshot = {
  capturedAt: string;
  pageTitle: string;
  phase: "inventory" | "detail" | "other";
  sourceUrl: string;
  textSample: string;
  truncated: boolean;
};

export type AccountPageSnapshot = {
  links: Array<{ href: string; text: string }>;
  text: string;
  title: string;
  url: string;
};

export type ExtractedAccountBooking = {
  awardLabel: string | null;
  bookingUrl: string | null;
  cancellationDeadline: Date | null;
  cashTotal: number;
  checkIn: Date;
  checkOut: Date;
  city: string;
  confirmationNumber: string | null;
  currency: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
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

export type ParsedObservationDraft = {
  breakfastIncluded: boolean | null;
  cancellationPolicyRaw: string | null;
  cashBase: number | null;
  cashCopay: number | null;
  cashCurrency: string | null;
  cashFees: number | null;
  cashTaxes: number | null;
  cashTotal: number | null;
  feesIncluded: boolean | null;
  inventoryType: InventoryTypeValue;
  loyaltyEligible: boolean | null;
  points: number | null;
  ratePlanName: string | null;
  rawRateName: string | null;
  roomTypeRaw: string | null;
  sourceUrl: string;
  taxesIncluded: boolean | null;
};

export type ParsedBookingEvidence = {
  candidatesTruncated: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  inventory: ParsedObservationDraft[];
  loginState: LoginState;
  observations: ParsedObservationDraft[];
  sourceUrl: string;
  status: "succeeded" | "partial" | "failed";
  summary: string;
};

export type HotelSearchQuery = {
  adults: number;
  /** User-stated amount plus product-owned interpretation; null means no budget filter. */
  budget: HotelSearchBudget | null;
  checkIn: string;
  checkOut: string;
  /** Provider-facing Latin-letter destination. */
  city: string;
  /** The destination wording the user supplied, retained for display. */
  cityAsAsked: string;
  currency: string;
  hotelGroup: string;
};

export type HotelSearchBudget = {
  /** Numeric amount copied from the user's request or entered in the form; never model-derived. */
  amount: number;
  /** Whether `amount` applies per night or to the whole stay. */
  basis: "per_night" | "stay_total";
  /** True when the request omitted a basis and the product defaulted it to per night. */
  basisAssumed: boolean;
  /** A hard ceiling or an approximate target with the product-owned tolerance. */
  flexibility: "maximum" | "approximate";
};

export type HotelSearchResult = {
  availabilityLabel: string;
  avgNightlyRate: number;
  currency: string;
  hotelName: string;
  locationLabel: string | null;
  priceBasis: string;
  sourceUrl: string;
};

export interface BookingPriceProvider {
  hotelGroup: string;
  name: string;
  buildLaunchUrl(input: BookingPriceInput): string;
  inferLoginState(pageText: string): LoginState;
  parseSnapshot(snapshot: BrowserPageSnapshot, input: BookingPriceInput): ParsedBookingEvidence;
  planAction(snapshot: BrowserPageSnapshot, input: BookingPriceInput): BrowserAgentAction;
}

export interface HotelSearchProvider {
  hotelGroup: string;
  name: string;
  buildSearchUrl(query: HotelSearchQuery): string;
  normalizeSearchQuery(input: Partial<HotelSearchQuery>): { errors: string[]; query: HotelSearchQuery };
  parseSearchSnapshot(snapshot: BrowserPageSnapshot): HotelSearchResult[];
}

export interface AccountBookingImporter {
  hotelGroup: string;
  name: string;
  buildLaunchUrl(taskId: string, endpoint: string): string;
  isReservationDetailUrl(value: string): boolean;
  parseSnapshots(snapshots: AccountPageSnapshot[]): AccountBookingExtraction;
}

export type HotelProvider = {
  accountImporter?: AccountBookingImporter;
  bookingPrice?: BookingPriceProvider;
  hotelGroup: string;
  hotelSearch?: HotelSearchProvider;
};
