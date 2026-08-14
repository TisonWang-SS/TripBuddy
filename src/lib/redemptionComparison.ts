/*
 * Cash against points, inside one evidence capture.
 *
 * The question is whether paying with points returns more per point than the
 * traveler's recorded point value. It is answerable only when both numbers
 * were read from the same page visit: a cash total from today compared with an
 * award rate from last week is a comparison of two different inventories
 * wearing one conclusion. So a pair that does not share a capture is not
 * compared, and neither is one whose two sides describe different rooms.
 *
 * Every refusal here is named. A missing input produces no comparison, never
 * an estimated one (ADR 0003).
 */

import type { InclusionStatus, PointsBasis } from "@prisma/client";

export type RedemptionCashSide = {
  captureId: string | null;
  currency: string | null;
  feesIncluded: InclusionStatus;
  roomLabel: string | null;
  taxesIncluded: InclusionStatus;
  total: number | null;
};

export type RedemptionAwardSide = {
  captureId: string | null;
  /** Cash still payable on the award: the taxes and fees points do not cover. */
  copay: number | null;
  copayCurrency: string | null;
  points: number | null;
  pointsBasis: PointsBasis;
  roomLabel: string | null;
};

export type RedemptionPointValuation = {
  amount: number;
  currency: string;
};

export type RedemptionVerdict = "redeem" | "pay_cash" | "even" | "not_compared";

export type RedemptionComparison = {
  captureId: string | null;
  cashTotal: number | null;
  copay: number | null;
  currency: string | null;
  points: number | null;
  pointValue: number | null;
  reason: string | null;
  roomLabel: string | null;
  /** What one point returned on this stay, in currency units. Commonly "cpp". */
  valuePerPoint: number | null;
  verdict: RedemptionVerdict;
};

const NOT_COMPARED: RedemptionComparison = {
  captureId: null,
  cashTotal: null,
  copay: null,
  currency: null,
  points: null,
  pointValue: null,
  reason: null,
  roomLabel: null,
  valuePerPoint: null,
  verdict: "not_compared"
};

function notCompared(reason: string, partial: Partial<RedemptionComparison> = {}): RedemptionComparison {
  return { ...NOT_COMPARED, ...partial, reason, verdict: "not_compared" };
}

export function normalizeRoomLabel(value: string | null) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized && !/^(?:unknown|room not captured)$/.test(normalized) ? normalized : null;
}

export function compareRedemptionToCash(input: {
  award: RedemptionAwardSide;
  cash: RedemptionCashSide;
  pointValuation: RedemptionPointValuation | null;
}): RedemptionComparison {
  const { award, cash } = input;
  if (!cash.captureId || !award.captureId) {
    return notCompared("A cash rate and an award rate captured in one visit are required to compare them.");
  }
  if (cash.captureId !== award.captureId) {
    return notCompared("The cash rate and the award rate come from different captures, so they are not compared.");
  }
  const cashRoom = normalizeRoomLabel(cash.roomLabel);
  const awardRoom = normalizeRoomLabel(award.roomLabel);
  if (!cashRoom || !awardRoom || cashRoom !== awardRoom) {
    return notCompared("The cash rate and the award rate do not name the same room, so they are not compared.", {
      captureId: cash.captureId
    });
  }
  if (cash.total === null || cash.total <= 0 || !cash.currency) {
    return notCompared("The capture has no cash total to compare the award rate against.", { captureId: cash.captureId });
  }
  if (cash.taxesIncluded !== "yes" || cash.feesIncluded !== "yes") {
    return notCompared("The cash total does not show taxes and fees as included, so it is not compared with the award rate.", {
      captureId: cash.captureId
    });
  }
  if (award.points === null || award.points <= 0) {
    return notCompared("The award rate does not state how many points it costs.", { captureId: cash.captureId });
  }
  /*
   * The cash side is a stay total, proven by its taxes-and-fees evidence. The
   * points side must be the same span or the division is off by the number of
   * nights — and a nightly points figure looks exactly like a stay total in
   * the page text, so this cannot be inferred here.
   */
  if (award.pointsBasis !== "stay_total") {
    return notCompared(
      award.pointsBasis === "per_night"
        ? "The award rate is quoted per night while the cash total covers the stay, so they are not compared."
        : "The award rate does not show whether its points cover the stay or one night, so it is not compared.",
      { captureId: cash.captureId }
    );
  }
  const copay = award.copay ?? 0;
  if (copay > 0 && award.copayCurrency && award.copayCurrency !== cash.currency) {
    return notCompared("The award copay and the cash total are in different currencies, so they are not compared.", {
      captureId: cash.captureId
    });
  }

  /*
   * What the points bought: the cash the traveler avoids, less the cash the
   * award still charges. Dividing by the points required gives the return per
   * point in the same unit the recorded point value is stored in.
   */
  const valuePerPoint = (cash.total - copay) / award.points;
  const measured = {
    captureId: cash.captureId,
    cashTotal: cash.total,
    copay,
    currency: cash.currency,
    points: award.points,
    roomLabel: cash.roomLabel,
    valuePerPoint
  };

  if (!input.pointValuation) {
    return notCompared("No point value is recorded, so this return per point has nothing to be measured against.", measured);
  }
  if (input.pointValuation.currency !== cash.currency) {
    return notCompared(
      `The recorded point value is in ${input.pointValuation.currency} and this capture is in ${cash.currency}, so they are not compared.`,
      measured
    );
  }

  const pointValue = input.pointValuation.amount;
  return {
    ...measured,
    pointValue,
    reason: null,
    verdict: valuePerPoint > pointValue ? "redeem" : valuePerPoint < pointValue ? "pay_cash" : "even"
  };
}

export type RedemptionObservation = {
  captureId: string | null;
  cashCopay: number | null;
  cashCopayCurrency: string | null;
  cashCurrency: string | null;
  cashTotal: number | null;
  feesIncluded: InclusionStatus;
  inventoryType: "cash" | "award";
  observedAt: Date;
  points: number | null;
  pointsBasis: PointsBasis;
  roomLabel: string | null;
  taxesIncluded: InclusionStatus;
};

/*
 * Which pair to compare when a capture holds several rates: the newest capture
 * that has both sides for one room, and within it the cheapest cash rate —
 * the option the traveler would actually take, and so the hardest one for the
 * award to beat.
 */
export function selectRedemptionPair(observations: readonly RedemptionObservation[]) {
  const captures = [...new Set(observations.map((observation) => observation.captureId).filter((id): id is string => !!id))];
  const newestFirst = captures.sort((a, b) => captureTime(observations, b) - captureTime(observations, a));

  for (const captureId of newestFirst) {
    const inCapture = observations.filter((observation) => observation.captureId === captureId);
    const awards = inCapture.filter((observation) => observation.inventoryType === "award" && observation.points);
    const cashRates = inCapture
      .filter((observation) => observation.inventoryType === "cash" && observation.cashTotal !== null)
      .sort((a, b) => (a.cashTotal ?? 0) - (b.cashTotal ?? 0));
    for (const cash of cashRates) {
      const award = awards.find(
        (candidate) =>
          normalizeRoomLabel(candidate.roomLabel) !== null &&
          normalizeRoomLabel(candidate.roomLabel) === normalizeRoomLabel(cash.roomLabel)
      );
      if (award) {
        return { award, cash };
      }
    }
  }
  return null;
}

function captureTime(observations: readonly RedemptionObservation[], captureId: string) {
  return Math.max(
    ...observations
      .filter((observation) => observation.captureId === captureId)
      .map((observation) => observation.observedAt.getTime())
  );
}
