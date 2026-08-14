"use client";

import Link from "next/link";
import { HotelSearchResults } from "@/app/hotel-search/HotelSearchResults";
import type { AdvicePick, Surface, SurfaceNode } from "@/lib/agent/surface";
import { formatCalendarDate, formatLocalInstant, formatMoney } from "@/lib/format";
import {
  evidenceQualityLabel,
  riskLevelLabel,
  runStatusLabel,
  sourceTypeLabel,
  verdictLabel
} from "@/lib/labels";
import { buttonClassName, Card, Figure, Figures, LabelStamp, Notice, Table } from "@/ui";
import styles from "./SurfaceRenderer.module.css";

/**
 * Renders a surface with this application's own components.
 *
 * The switch below is the security boundary. A node names a component; it never
 * carries markup, a template, or a module path, and a name outside the
 * catalogue renders nothing rather than being resolved. There is no
 * dangerouslySetInnerHTML and no dynamic import here, and there must not be:
 * the whole point of a declarative payload is that rendering it cannot execute
 * anything the client did not already ship.
 */
/**
 * `variant` says where this surface is being rendered.
 *
 * In a conversation the assistant's words are already a message bubble, so the
 * nodes that carry the same prose — a Message, an Advice narrative — would print
 * it twice. The surface stays self-contained for every other caller; only the
 * duplication is suppressed.
 */
export type SurfaceVariant = "standalone" | "conversation";

export function SurfaceRenderer({
  onConfirm,
  surface,
  variant = "standalone"
}: {
  onConfirm?: (action: { args: unknown; capability: string }) => void;
  surface: Surface;
  variant?: SurfaceVariant;
}) {
  return (
    <div className={styles.surface}>
      {surface.nodes.map((node) => (
        <SurfaceNodeView key={node.key} node={node} onConfirm={onConfirm} variant={variant} />
      ))}
    </div>
  );
}

function SurfaceNodeView({
  node,
  onConfirm,
  variant
}: {
  node: SurfaceNode;
  onConfirm?: (action: { args: unknown; capability: string }) => void;
  variant: SurfaceVariant;
}) {
  switch (node.component) {
    case "Message":
      return variant === "conversation" ? null : <Notice tone={node.props.tone}>{node.props.text}</Notice>;

    case "Advice": {
      const { narrative, picks } = node.props;
      if (picks.length === 0) {
        return variant === "conversation" ? null : <p className={styles.explanation}>{narrative}</p>;
      }
      return (
        <Card eyebrow="Recommendation" title={picks.length === 1 ? "The one I'd take" : "What I'd compare"}>
          {variant === "conversation" ? null : <p className={styles.explanation}>{narrative}</p>}
          <div className={styles.list}>
            {picks.map((pick) => (
              <div className={styles.row} key={`${pick.label}-${pick.reason}`}>
                <div>
                  {pick.href ? (
                    <Link className={styles.name} href={pick.href}>
                      {pick.label}
                    </Link>
                  ) : (
                    <span className={styles.name}>{pick.label}</span>
                  )}
                  <p className={styles.where}>{pick.reason}</p>
                  {pick.note ? <p className={styles.caveat}>{pick.note}</p> : null}
                </div>
                <div className={styles.end}>
                  <span className={styles.amount}>{priceOf(pick)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      );
    }

    case "ConfirmAction":
      return (
        <Card eyebrow="Needs your go-ahead" title="Open a Hyatt tab">
          <p className={styles.explanation}>{node.props.detail}</p>
          <button
            className={buttonClassName({ size: "sm" })}
            onClick={() => onConfirm?.({ args: node.props.args, capability: node.props.capability })}
            type="button"
          >
            {node.props.label}
          </button>
        </Card>
      );

    case "BookingList":
      return (
        <Card eyebrow="Stays" title={node.props.title}>
          <div className={styles.list}>
            {node.props.bookings.map((booking) => (
              <div className={styles.row} key={booking.bookingId}>
                <div>
                  <Link className={styles.name} href={`/bookings/${booking.bookingId}`}>
                    {booking.hotelName}
                  </Link>
                  <p className={styles.where}>
                    {booking.city} · {formatCalendarDate(booking.checkIn)} to {formatCalendarDate(booking.checkOut)} ·{" "}
                    {booking.nights} {booking.nights === 1 ? "night" : "nights"}
                  </p>
                </div>
                <div className={styles.end}>
                  <LabelStamp value={verdictLabel(booking.verdict)} />
                  {booking.baselineCashTotal === null ? null : (
                    <span className={styles.amount}>{formatMoney(booking.baselineCashTotal, booking.currency)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      );

    case "DueQueue":
      return (
        <Card eyebrow="Foreground queue" title="Checks due">
          <div className={styles.list}>
            {node.props.due.map((due) => (
              <div className={styles.row} key={due.bookingId}>
                <div>
                  <Link className={styles.name} href={`/bookings/${due.bookingId}`}>
                    {due.hotelName}
                  </Link>
                  <p className={styles.where}>
                    {due.consecutiveFailures > 0
                      ? `${due.consecutiveFailures} failed attempt(s)`
                      : `${due.urgency === "urgent" ? "Urgent" : "Normal"} cadence · every ${due.cadenceHours} hours`}
                    {" · due since "}
                    {formatLocalInstant(due.nextCheckAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      );

    case "RecommendationPanel": {
      const { recommendation } = node.props;
      return (
        <Card actions={<LabelStamp value={verdictLabel(recommendation.verdict)} />} eyebrow="Verdict" title="Recommendation">
          <p className={styles.explanation}>{recommendation.explanation}</p>
          <Figures>
            <Figure label="Estimated savings" value={formatMoney(recommendation.estimatedSavings, recommendation.currency)} />
            <Figure label="Evidence" value={evidenceQualityLabel(recommendation.qualityLevel).label} />
            <Figure label="Risk" value={riskLevelLabel(recommendation.riskLevel).label} />
          </Figures>
        </Card>
      );
    }

    case "EvidenceIssues":
      if (node.props.blockers.length === 0 && node.props.warnings.length === 0) {
        return null;
      }
      return (
        <div className={styles.issues}>
          {node.props.blockers.map((blocker) => (
            <Notice key={blocker} tone="critical">
              {blocker}
            </Notice>
          ))}
          {node.props.warnings.map((warning) => (
            <Notice key={warning} tone="caution">
              {warning}
            </Notice>
          ))}
        </div>
      );

    case "BaselineAction":
      return (
        <Link className={buttonClassName()} href={`/bookings/${node.props.bookingId}`}>
          {node.props.label}
        </Link>
      );

    case "PriceHistory":
      return (
        <Card eyebrow="History" title="Observations">
          <Table>
            <thead>
              <tr>
                <th>Observed</th>
                <th>Source</th>
                <th>Price</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {node.props.observations.map((observation) => (
                <tr key={observation.observationId}>
                  <td>{formatLocalInstant(observation.observedAt)}</td>
                  <td>
                    {observation.sourceName}
                    <br />
                    {sourceTypeLabel(observation.sourceType).label}
                  </td>
                  <td>
                    {observation.cashTotal === null
                      ? observation.points === null
                        ? "Not captured"
                        : `${observation.points.toLocaleString("en-US")} points`
                      : formatMoney(observation.cashTotal, observation.cashCurrency ?? "USD")}
                  </td>
                  <td>
                    <LabelStamp value={evidenceQualityLabel(observation.qualityLevel)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      );

    case "TaskLaunch":
      return (
        <Card eyebrow="Browser Companion" title="Check started">
          <p className={styles.explanation}>
            A Hyatt tab was opened. Its progress and result appear on the page that owns it.
          </p>
          <Link className={buttonClassName({ variant: "secondary" })} href={node.props.resultRoute}>
            Open that page
          </Link>
        </Card>
      );

    case "HotelSearchResults":
      return <HotelSearchResults session={node.props.session} />;

    case "Facts":
      return (
        <Card eyebrow="Configuration" title={node.props.title}>
          <Figures>
            {node.props.items.map((item) => (
              <Figure key={item.label} label={item.label} value={item.value} />
            ))}
          </Figures>
        </Card>
      );

    default:
      /*
       * A node this client does not know about — an older client meeting a newer
       * server. Rendering nothing is the correct answer; guessing is not.
       */
      return null;
  }
}

/**
 * The figure beside a recommendation, formatted from stored data.
 *
 * Reads the basis rather than assuming one: a nightly starting rate and a
 * tax-inclusive stay total are different claims, and a card that prints both as
 * a bare number is how someone compares two prices that were never comparable.
 */
function priceOf(pick: AdvicePick) {
  if (pick.amount === null) {
    return "No price captured";
  }
  if (pick.amountBasis === "points_per_night") {
    return `${pick.amount.toLocaleString("en-US")} pts/night`;
  }
  const money = formatMoney(pick.amount, pick.currency ?? "USD");
  if (pick.amountBasis === "per_night") {
    return `${money}/night`;
  }
  return money;
}

/** Exported for the run-status strip that sits above a surface. */
export function RunStatus({ status }: { status: string }) {
  return <LabelStamp value={runStatusLabel(status)} />;
}
