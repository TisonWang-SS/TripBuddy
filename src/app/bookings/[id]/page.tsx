import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceIssueList } from "@/app/components/EvidenceIssueList";
import { RunPriceCheckButton } from "@/app/components/RunPriceCheckButton";
import { promoteObservationToBooking } from "@/lib/actions";
import { formatBookingBaseline } from "@/lib/bookingPrice";
import { prisma } from "@/lib/db";
import { formatCalendarDate, formatLocalInstant, formatMoney } from "@/lib/format";
import { stringList } from "@/lib/json";
import {
  cancellationMatchLabel,
  collectionMethodLabel,
  evidenceQualityLabel,
  riskLevelLabel,
  roomMatchLabel,
  runStatusLabel,
  sourceTypeLabel,
  verdictLabel
} from "@/lib/labels";
import { parseRecommendationCostBreakdown } from "@/lib/recommendationCodecs";
import { Button, buttonClassName, Card, EmptyState, Figure, Figures, LabelStamp, Table } from "@/ui";
import styles from "./page.module.css";

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: {
      observations: { include: { evidence: true }, orderBy: { observedAt: "desc" }, take: 8 },
      priceCheckRuns: { orderBy: { startedAt: "desc" }, take: 1 },
      recommendations: {
        where: { candidateObservationId: { not: null } },
        include: { candidateObservation: { include: { evidence: true } } },
        orderBy: { generatedAt: "desc" },
        take: 1
      },
      watchPlan: true
    }
  });
  if (!booking) {
    notFound();
  }
  const latestRecommendation = booking.recommendations[0];
  const candidateObservation = latestRecommendation?.candidateObservation ?? null;
  const latestDirect = booking.observations.find((item) => item.sourceType === "direct");
  const latestOta = booking.observations.find((item) => item.sourceType === "ota");
  const latestRun = booking.priceCheckRuns[0];

  return (
    <div className={styles.sheet}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <p className={styles.eyebrow}>
            {booking.hotelGroup} · No. {booking.id.slice(-4).toUpperCase()}
          </p>
          <h1>{booking.hotelName}</h1>
          <p className={styles.where}>
            {booking.city} · {formatCalendarDate(booking.checkIn)} to {formatCalendarDate(booking.checkOut)} ·{" "}
            {booking.guests} guest{booking.guests === 1 ? "" : "s"} · {booking.isSuite ? "Suite" : "Standard room"}
          </p>
        </div>
        <RunPriceCheckButton bookingId={booking.id} className={buttonClassName()} />
      </header>

      <Figures>
        <Figure label="Current baseline" value={formatBookingBaseline(booking)} />
        <Figure label="Latest direct" value={formatObservationPrice(latestDirect, booking.currency)} />
        <Figure label="Latest OTA" value={formatObservationPrice(latestOta, booking.currency)} />
      </Figures>

      <nav aria-label="Booking tools" className={styles.tools}>
        <Link href={`/bookings/${booking.id}/edit`}>Edit booking</Link>
        <Link href={`/bookings/${booking.id}/observations/new`}>Manual entry</Link>
        <Link href={`/bookings/${booking.id}/watch-plan`}>Watch plan</Link>
        <Link href={`/bookings/${booking.id}/logs`}>Logs</Link>
      </nav>

      {latestRun ? (
        <div className={styles.runLine}>
          <LabelStamp value={runStatusLabel(latestRun.status)} />
          <p className={styles.runSummary}>
            {latestRun.summary ?? latestRun.errorMessage ?? "Waiting for Browser Companion evidence."}
          </p>
          <p className={styles.runWhen}>{formatLocalInstant(latestRun.startedAt)}</p>
        </div>
      ) : null}

      {latestRecommendation ? (
        <section className={styles.verdict}>
          <div className={styles.verdictBody}>
            <LabelStamp value={verdictLabel(latestRecommendation.verdict)} />
            <p className={styles.explanation}>{latestRecommendation.explanation}</p>
            <p className={styles.provenance}>
              Evidence: {evidenceQualityLabel(latestRecommendation.qualityLevel).label} · Risk:{" "}
              {riskLevelLabel(latestRecommendation.riskLevel).label} · {latestRecommendation.decisionProvider} v
              {latestRecommendation.decisionVersion}
            </p>
            <EvidenceIssueList
              blockers={stringList(latestRecommendation.blockersJson)}
              warnings={stringList(latestRecommendation.warningsJson)}
            />
            <RecommendationCostBreakdown
              currency={latestRecommendation.currency}
              value={latestRecommendation.costBreakdownJson}
            />
          </div>
          <div className={styles.savings}>
            <span className={styles.figureLabel}>Estimated savings</span>
            <span
              className={
                latestRecommendation.estimatedSavings > 0
                  ? `${styles.savingsValue} ${styles.savingsValueReal}`
                  : styles.savingsValue
              }
            >
              {formatMoney(latestRecommendation.estimatedSavings, latestRecommendation.currency)}
            </span>
            {candidateObservation ? (
              <form action={promoteObservationToBooking} className={styles.promote}>
                <input name="bookingId" type="hidden" value={booking.id} />
                <input name="observationId" type="hidden" value={candidateObservation.id} />
                <Button size="sm" type="submit" variant="secondary">
                  Use candidate as current
                </Button>
              </form>
            ) : null}
          </div>
        </section>
      ) : (
        <EmptyState
          description="Run a price check or add a final manual observation."
          title="No recommendation yet"
        />
      )}

      <Card
        actions={
          <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href={`/bookings/${booking.id}/logs`}>
            View all
          </Link>
        }
        eyebrow="Recent prices"
        title="Observations"
      >
        {booking.observations.length === 0 ? (
          <EmptyState
            description="Only final cash evidence, explicit points rates, and manual observations appear here."
            title="No observations"
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Observed</th>
                <th scope="col">Source</th>
                <th scope="col">Price</th>
                <th scope="col">Room</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {booking.observations.map((observation) => (
                <tr key={observation.id}>
                  <td className={styles.money}>{formatLocalInstant(observation.observedAt)}</td>
                  <td>
                    {observation.sourceName}
                    <span className={styles.stacked}>
                      {sourceTypeLabel(observation.sourceType).label} ·{" "}
                      {collectionMethodLabel(observation.collectionMethod).label}
                    </span>
                  </td>
                  <td className={styles.money}>
                    {formatObservationPrice(observation, booking.currency)}
                    {observation.cashCurrency && observation.cashCurrency !== booking.currency ? (
                      <span className={styles.stacked}>Observed in {observation.cashCurrency}</span>
                    ) : null}
                  </td>
                  <td>
                    {formatRoom(observation.roomTypeRaw)}
                    <span className={styles.stacked}>{observation.ratePlanName ?? "Rate plan not captured"}</span>
                  </td>
                  <td>
                    <LabelStamp value={evidenceQualityLabel(observation.evidence?.qualityLevel)} />
                    <span className={styles.stacked}>
                      {roomMatchLabel(observation.evidence?.roomMatch).label} room ·{" "}
                      {cancellationMatchLabel(observation.evidence?.cancellationMatch).label} policy
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function formatObservationPrice(observation: { cashCopay: number | null; cashCopayCurrency: string | null; cashCurrency: string | null; cashTotal: number | null; inventoryType: string; points: number | null } | null | undefined, fallbackCurrency: string) {
  if (!observation) return "None";
  if (observation.inventoryType === "award") {
    const points = observation.points ? `${observation.points.toLocaleString("en-US")} points` : "Award";
    return observation.cashCopay === null
      ? points
      : `${points} + ${formatMoney(observation.cashCopay, observation.cashCopayCurrency ?? fallbackCurrency)}`;
  }
  return observation.cashTotal === null ? "Cash total not captured" : formatMoney(observation.cashTotal, observation.cashCurrency ?? fallbackCurrency);
}

function formatRoom(value: string | null) {
  return value && !/^(?:unknown|room not captured)$/i.test(value) ? value : "Not captured";
}

function RecommendationCostBreakdown({ currency, value }: { currency: string; value: string }) {
  const breakdown = parseRecommendationCostBreakdown(value);
  if (!breakdown) {
    return null;
  }
  const rows: Array<[string, number, number]> = [
    ["Cash price", breakdown.baseline.cashPrice, breakdown.candidate.cashPrice],
    ["Redeemed points value", breakdown.baseline.redemptionPointsValue, breakdown.candidate.redemptionPointsValue],
    ["Earned points value", breakdown.baseline.earnedPointsValue, breakdown.candidate.earnedPointsValue],
    ["Promotion value", breakdown.baseline.promotionValue, breakdown.candidate.promotionValue],
    ["Credit-card value", breakdown.baseline.creditCardValue, breakdown.candidate.creditCardValue]
  ];
  if (breakdown.baseline.eliteProgressValue !== undefined && breakdown.candidate.eliteProgressValue !== undefined) {
    rows.push([
      "Elite progress value (historical)",
      breakdown.baseline.eliteProgressValue,
      breakdown.candidate.eliteProgressValue
    ]);
  }
  if (breakdown.baseline.benefitValue !== undefined && breakdown.candidate.benefitValue !== undefined) {
    rows.push([
      "Included benefits value (historical)",
      breakdown.baseline.benefitValue,
      breakdown.candidate.benefitValue
    ]);
  }
  rows.push(["Effective cost", breakdown.baseline.effectiveCost, breakdown.candidate.effectiveCost]);
  return (
    <details className={styles.breakdown}>
      <summary>Cost breakdown</summary>
      <Table className={styles.breakdownTable}>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Current booking</th>
            <th scope="col">Candidate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, baselineValue, candidateValue]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className={styles.money}>{formatMoney(baselineValue, currency)}</td>
              <td className={styles.money}>{formatMoney(candidateValue, currency)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </details>
  );
}
