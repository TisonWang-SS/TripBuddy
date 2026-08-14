import type { LoginState, PointsBasis } from "@prisma/client";
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
  /**
   * Which modes this run has already walked to a price summary.
   *
   * Hyatt renders cash or points, never both, and the mode is fixed in the URL
   * a task launches with. Comparing the two therefore takes two walks inside
   * one run, and this is what stops the second walk from starting a third.
   */
  capturedModes?: readonly InventoryTypeValue[];
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
  /**
   * The controls the planner actually had to choose from.
   *
   * Without these a navigation failure is undiagnosable after the fact: the
   * text sample shows what the page said, but the planner matches on control
   * labels, hrefs and surrounding context, and "the page clearly had a button"
   * cannot distinguish a control that was never captured from one that was
   * captured and rejected. They carry no more than the text sample already
   * does — a label, a link, and the wording around it.
   */
  controls: Array<{ context: string; href: string | null; label: string; pressed: boolean | null }>;
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
  pointsBasis: PointsBasis;
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
  /** Cash is the legacy default; points asks Hyatt to show award rates. */
  priceMode?: HotelSearchPriceMode;
};

export type HotelSearchPriceMode = "cash" | "points";

export type HotelSearchBudget = {
  /** Numeric amount copied from the user's request or entered in the form; never model-derived. */
  amount: number;
  /** Whether `amount` applies per night or to the whole stay. */
  basis: "per_night" | "stay_total";
  /** True when the request omitted a basis and the product defaulted it to per night. */
  basisAssumed: boolean;
  /** A hard ceiling or an approximate target with the product-owned tolerance. */
  flexibility: "maximum" | "approximate";
  /**
   * The wording the amount was read from, verified verbatim against the request.
   * Null for a budget typed into the search form, which needs no citation.
   */
  quote: string | null;
};

export type HotelSearchResult = {
  availabilityLabel: string;
  avgNightlyRate: number | null;
  currency: string;
  hotelName: string;
  locationLabel: string | null;
  priceBasis: string;
  pointsPerNight: number | null;
  priceMode: HotelSearchPriceMode;
  sourceUrl: string;
};

export interface BookingPriceProvider {
  /**
   * The awards in a run's accumulated evidence that this booking can be
   * compared against.
   *
   * A run imports on its last snapshot, but awards are seen on earlier ones,
   * so the accumulated evidence has to be filtered by the same rule that
   * decides observations — otherwise every award ever glimpsed is stored,
   * which is how the points side ended up exempt from rules the cash side
   * has always had to meet.
   */
  selectComparableAwards(
    inventory: readonly ParsedObservationDraft[],
    input: BookingPriceInput
  ): ParsedObservationDraft[];
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
