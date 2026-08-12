"use client";

import Link from "next/link";
import { HotelSearchResults } from "@/app/hotel-search/HotelSearchResults";
import type { Surface, SurfaceNode } from "@/lib/agent/surface";
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
export function SurfaceRenderer({ surface }: { surface: Surface }) {
  return (
    <div className={styles.surface}>
      {surface.nodes.map((node) => (
        <SurfaceNodeView key={node.key} node={node} />
      ))}
    </div>
  );
}

function SurfaceNodeView({ node }: { node: SurfaceNode }) {
  switch (node.component) {
    case "Message":
      return <Notice tone={node.props.tone}>{node.props.text}</Notice>;

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

/** Exported for the run-status strip that sits above a surface. */
export function RunStatus({ status }: { status: string }) {
  return <LabelStamp value={runStatusLabel(status)} />;
}
