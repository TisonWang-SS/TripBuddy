import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceIssueList } from "@/app/components/EvidenceIssueList";
import { RunPriceCheckButton } from "@/app/components/RunPriceCheckButton";
import { promoteObservationToBooking } from "@/lib/actions";
import { formatBookingBaseline } from "@/lib/bookingPrice";
import { prisma } from "@/lib/db";
import type { CostBreakdown } from "@/lib/decision";
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
import { LabelBadge } from "@/ui";

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
    <div className="grid">
      <div className="pageHeader">
        <div><p className="eyebrow">{booking.hotelGroup}</p><h1>{booking.hotelName}</h1><p>{booking.city} · {formatCalendarDate(booking.checkIn)} to {formatCalendarDate(booking.checkOut)} · {booking.guests} guest{booking.guests === 1 ? "" : "s"} · {booking.isSuite ? "Suite" : "Standard room"}</p></div>
        <RunPriceCheckButton bookingId={booking.id} />
      </div>

      <section className="grid three">
        <Metric label="Current baseline" value={formatBookingBaseline(booking)} />
        <Metric label="Latest direct" value={formatObservationPrice(latestDirect, booking.currency)} />
        <Metric label="Latest OTA" value={formatObservationPrice(latestOta, booking.currency)} />
      </section>

      <nav className="subnav" aria-label="Booking tools">
        <Link href={`/bookings/${booking.id}/edit`}>Edit booking</Link>
        <Link href={`/bookings/${booking.id}/observations/new`}>Manual entry</Link>
        <Link href={`/bookings/${booking.id}/watch-plan`}>Watch plan</Link>
        <Link href={`/bookings/${booking.id}/logs`}>Logs</Link>
      </nav>

      {latestRun ? <section className="card flat"><div className="pageHeader"><div><p className="eyebrow">Latest price check</p><strong>{latestRun.summary ?? latestRun.errorMessage ?? "Waiting for Browser Companion evidence."}</strong></div><div><LabelBadge dot value={runStatusLabel(latestRun.status)} /><p className="muted">{formatLocalInstant(latestRun.startedAt)}</p></div></div></section> : null}

      {latestRecommendation ? (
        <section className="card">
          <div className="pageHeader"><div><p className="eyebrow">Recommendation</p><h2><LabelBadge value={verdictLabel(latestRecommendation.verdict)} /></h2></div><div><p className="muted">Estimated savings</p><h2>{formatMoney(latestRecommendation.estimatedSavings, latestRecommendation.currency)}</h2></div></div>
          <p>{latestRecommendation.explanation}</p>
          <p className="muted">Evidence: {evidenceQualityLabel(latestRecommendation.qualityLevel).label} · Risk: {riskLevelLabel(latestRecommendation.riskLevel).label} · {latestRecommendation.decisionProvider} v{latestRecommendation.decisionVersion}</p>
          <EvidenceIssueList className="section" blockers={stringList(latestRecommendation.blockersJson)} warnings={stringList(latestRecommendation.warningsJson)} />
          <RecommendationCostBreakdown
            currency={latestRecommendation.currency}
            value={latestRecommendation.costBreakdownJson}
          />
          {candidateObservation ? <form action={promoteObservationToBooking} className="section"><input type="hidden" name="bookingId" value={booking.id} /><input type="hidden" name="observationId" value={candidateObservation.id} /><button type="submit">Use candidate as current</button></form> : null}
        </section>
      ) : <section className="empty"><h2>No recommendation yet</h2><p>Run a price check or add a final manual observation.</p></section>}

      <section className="card">
        <div className="pageHeader"><div><p className="eyebrow">Recent prices</p><h2>Observations</h2></div><Link className="button secondary" href={`/bookings/${booking.id}/logs`}>View all</Link></div>
        {booking.observations.length === 0 ? <div className="empty"><h3>No observations</h3><p>Only final cash evidence, explicit points rates, and manual observations appear here.</p></div> : (
          <table className="table"><thead><tr><th>Observed</th><th>Source</th><th>Price</th><th>Room</th><th>Evidence</th></tr></thead><tbody>
            {booking.observations.map((observation) => (
              <tr key={observation.id}>
                <td>{formatLocalInstant(observation.observedAt)}</td>
                <td>{observation.sourceName}<br /><span className="muted">{sourceTypeLabel(observation.sourceType).label} · {collectionMethodLabel(observation.collectionMethod).label}</span></td>
                <td>{formatObservationPrice(observation, booking.currency)}{observation.cashCurrency && observation.cashCurrency !== booking.currency ? <><br /><span className="muted">Observed in {observation.cashCurrency}</span></> : null}</td>
                <td>{formatRoom(observation.roomTypeRaw)}<br /><span className="muted">{observation.ratePlanName ?? "Rate plan not captured"}</span></td>
                <td><LabelBadge value={evidenceQualityLabel(observation.evidence?.qualityLevel)} /><br /><span className="muted">{roomMatchLabel(observation.evidence?.roomMatch).label} room · {cancellationMatchLabel(observation.evidence?.cancellationMatch).label} policy</span></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card flat metric"><span className="muted">{label}</span><strong>{value}</strong></div>;
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
  const rows: Array<[string, keyof CostBreakdown]> = [
    ["Cash price", "cashPrice"],
    ["Redeemed points value", "redemptionPointsValue"],
    ["Earned points value", "earnedPointsValue"],
    ["Promotion value", "promotionValue"],
    ["Credit-card value", "creditCardValue"],
    ["Elite progress value", "eliteProgressValue"],
    ["Included benefits value", "benefitValue"],
    ["Effective cost", "effectiveCost"]
  ];
  return (
    <details className="section">
      <summary>Cost breakdown</summary>
      <table className="table">
        <thead><tr><th>Component</th><th>Current booking</th><th>Candidate</th></tr></thead>
        <tbody>{rows.map(([label, field]) => (
          <tr key={field}>
            <td>{label}</td>
            <td>{formatMoney(breakdown.baseline[field], currency)}</td>
            <td>{formatMoney(breakdown.candidate[field], currency)}</td>
          </tr>
        ))}</tbody>
      </table>
    </details>
  );
}
