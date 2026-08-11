import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceIssueList } from "@/app/components/EvidenceIssueList";
import { RunLlmExtractionButton } from "@/app/components/RunLlmExtractionButton";
import { deleteObservation, promoteObservationToBooking } from "@/lib/actions";
import { parseSanitizedBrowserSnapshots } from "@/lib/browserTaskCodecs";
import { prisma } from "@/lib/db";
import { parseObservationEvidenceSnapshot } from "@/lib/evidenceCodecs";
import { formatLocalInstant, formatMoney } from "@/lib/format";
import { stringList } from "@/lib/json";
import {
  cancellationMatchLabel,
  collectionMethodLabel,
  evidenceQualityLabel,
  extractionSourceLabel,
  humanize,
  inclusionLabel,
  riskLevelLabel,
  roomMatchLabel,
  runStatusLabel,
  sourceTypeLabel,
  verdictLabel
} from "@/lib/labels";
import { isLlmEvidenceExtractionConfigured } from "@/lib/providers/llmEvidence";
import { Button, buttonClassName, Card, EmptyState, LabelStamp, PageHeader, Stamp, Table } from "@/ui";
import styles from "./page.module.css";

export default async function BookingLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.hotelBooking.findUnique({
    where: { id },
    include: {
      observations: { include: { evidence: true }, orderBy: { observedAt: "desc" } },
      priceCheckRuns: {
        include: { browserTask: true, extractionRuns: { orderBy: { createdAt: "desc" } } },
        orderBy: { startedAt: "desc" }
      },
      recommendations: { orderBy: { generatedAt: "desc" } }
    }
  });
  if (!booking) {
    notFound();
  }
  const llmConfigured = isLlmEvidenceExtractionConfigured();

  return (
    <div className="deskStack">
      <PageHeader
        actions={
          <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href={`/bookings/${id}`}>
            Back
          </Link>
        }
        description="Price-check runs, observation evidence, and recommendation history."
        eyebrow="Logs"
        title={booking.hotelName}
      />

      <Card
        actions={
          <Link className={buttonClassName({ size: "sm", variant: "secondary" })} href={`/bookings/${id}/observations/new`}>
            Manual entry
          </Link>
        }
        eyebrow="History"
        title="Price observations"
      >
        {booking.observations.length === 0 ? (
          <EmptyState description="Observation-ready direct and manual rates will appear here." title="No observations" />
        ) : (
          <div className={styles.entries}>
            {booking.observations.map((observation) => {
              const snapshot = parseObservationEvidenceSnapshot(observation.evidence?.snapshotJson);
              return (
                <article className={styles.entry} key={observation.id}>
                  <div className={styles.entryBody}>
                    <p className={styles.entryHead}>{formatObservationPrice(observation, booking.currency)}</p>
                    <p className={styles.line}>
                      {observation.sourceName} · {sourceTypeLabel(observation.sourceType).label} ·{" "}
                      {collectionMethodLabel(observation.collectionMethod).label}
                    </p>
                    <p className={styles.meta}>
                      Extractor: {observation.extractorName} v{observation.extractorVersion} ·{" "}
                      {extractionSourceLabel(observation.extractionSource).label}
                    </p>
                    <p className={styles.line}>
                      Room: {observation.roomTypeRaw ?? "Not captured"} · Policy:{" "}
                      {observation.cancellationPolicyRaw ?? "Not captured"}
                    </p>
                    <p className={styles.meta}>
                      {roomMatchLabel(observation.evidence?.roomMatch).label} room ·{" "}
                      {cancellationMatchLabel(observation.evidence?.cancellationMatch).label} cancellation · Taxes:{" "}
                      {inclusionLabel(observation.evidence?.taxesIncluded).label} · Fees:{" "}
                      {inclusionLabel(observation.evidence?.feesIncluded).label}
                    </p>
                    <EvidenceIssueList
                      blockers={stringList(observation.evidence?.blockersJson)}
                      warnings={stringList(observation.evidence?.warningsJson)}
                    />
                    {snapshot.textSample ? (
                      <details className={styles.disclosure}>
                        <summary>Sanitized evidence sample</summary>
                        <p className={styles.sample}>{snapshot.textSample}</p>
                      </details>
                    ) : null}
                  </div>

                  <div className={styles.entrySide}>
                    <LabelStamp value={evidenceQualityLabel(observation.evidence?.qualityLevel)} />
                    <p className={styles.when}>{formatLocalInstant(observation.observedAt)}</p>
                    <div className={styles.sideActions}>
                      <Link
                        className={buttonClassName({ size: "sm", variant: "secondary" })}
                        href={`/bookings/${id}/observations/${observation.id}/edit`}
                      >
                        Review
                      </Link>
                      <form action={promoteObservationToBooking}>
                        <input name="bookingId" type="hidden" value={id} />
                        <input name="observationId" type="hidden" value={observation.id} />
                        <Button size="sm" type="submit">
                          Use as current
                        </Button>
                      </form>
                      <form action={deleteObservation}>
                        <input name="bookingId" type="hidden" value={id} />
                        <input name="observationId" type="hidden" value={observation.id} />
                        <Button size="sm" type="submit" variant="danger">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Card eyebrow="Price check runs" title="Browser task activity">
        {booking.priceCheckRuns.length === 0 ? (
          <EmptyState description="Run a check from the booking page." title="No price checks" />
        ) : (
          <div className={styles.entries}>
            {booking.priceCheckRuns.map((run) => {
              const snapshots = parseSanitizedBrowserSnapshots(run.browserTask.snapshotsJson);
              return (
                <article className={styles.entry} key={run.id}>
                  <div className={styles.entryBody}>
                    <p className={styles.entryHead}>{run.providerName}</p>
                    <p className={styles.line}>{run.summary ?? run.errorMessage ?? "Waiting for evidence."}</p>
                    <EvidenceIssueList
                      blockers={[]}
                      warnings={[
                        run.candidatesTruncated
                          ? "Candidate evidence exceeded the audit limit; only the first 24 distinct candidates were retained."
                          : null,
                        run.browserTask.snapshotsTruncated
                          ? "Browser history exceeded the audit limit; only the 12 most recent sanitized snapshots were retained."
                          : null
                      ].filter((item) => item !== null)}
                    />
                    {run.sourceUrl ? (
                      <a className={styles.sourceLink} href={run.sourceUrl} rel="noreferrer" target="_blank">
                        Open source
                      </a>
                    ) : null}

                    {snapshots.length > 0 ? (
                      <details className={styles.disclosure}>
                        <summary>
                          {snapshots.length} sanitized browser snapshot{snapshots.length === 1 ? "" : "s"}
                        </summary>
                        <div className={styles.nested}>
                          {snapshots.map((snapshot) => (
                            <div className={styles.snapshot} key={`${snapshot.capturedAt}-${snapshot.sourceUrl}`}>
                              <div className={styles.snapshotBody}>
                                <span className={styles.snapshotTitle}>{snapshot.pageTitle || snapshot.phase}</span>
                                <p className={styles.sample}>
                                  {snapshot.textSample.slice(0, 1200)}
                                  {snapshot.textSample.length > 1200 || snapshot.truncated ? "…" : ""}
                                </p>
                              </div>
                              <Stamp>{humanize(snapshot.phase)}</Stamp>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {run.extractionRuns.length > 0 ? (
                      <details className={styles.disclosure}>
                        <summary>
                          {run.extractionRuns.length} LLM extraction run{run.extractionRuns.length === 1 ? "" : "s"}
                        </summary>
                        <div className={styles.nested}>
                          {run.extractionRuns.map((extraction) => {
                            const issues = stringList(extraction.issuesJson);
                            return (
                              <div className={styles.snapshot} key={extraction.id}>
                                <div className={styles.snapshotBody}>
                                  <span className={styles.snapshotTitle}>
                                    {extraction.extractorName} v{extraction.extractorVersion}
                                  </span>
                                  <p className={styles.meta}>
                                    {extraction.modelName} · {extraction.snapshotCount} snapshot
                                    {extraction.snapshotCount === 1 ? "" : "s"} · {formatLocalInstant(extraction.createdAt)}
                                  </p>
                                  {issues.length > 0 ? (
                                    <ul className={styles.issues}>
                                      {issues.map((issue) => (
                                        <li key={issue}>{issue}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                                <LabelStamp value={runStatusLabel(extraction.status)} />
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    ) : null}
                  </div>

                  <div className={styles.entrySide}>
                    <LabelStamp value={runStatusLabel(run.status)} />
                    <p className={styles.when}>{formatLocalInstant(run.startedAt)}</p>
                    <p className={styles.when}>Task {runStatusLabel(run.browserTask.status).label.toLowerCase()}</p>
                    {snapshots.length > 0 && run.status !== "running" ? (
                      <RunLlmExtractionButton configured={llmConfigured} runId={run.id} />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Card eyebrow="Decision history" title="Past recommendations">
        {booking.recommendations.length === 0 ? (
          <EmptyState description="A decision is saved after an observation exists." title="No decisions" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Generated</th>
                <th scope="col">Verdict</th>
                <th scope="col">Savings</th>
                <th scope="col">Evidence</th>
                <th scope="col">Explanation</th>
              </tr>
            </thead>
            <tbody>
              {booking.recommendations.map((item) => (
                <tr key={item.id}>
                  <td>{formatLocalInstant(item.generatedAt)}</td>
                  <td>
                    <LabelStamp value={verdictLabel(item.verdict)} />
                  </td>
                  <td>{formatMoney(item.estimatedSavings, item.currency)}</td>
                  <td>
                    {evidenceQualityLabel(item.qualityLevel).label} · {riskLevelLabel(item.riskLevel).label} risk
                  </td>
                  <td className={styles.explanation}>{item.explanation}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function formatObservationPrice(observation: { cashCurrency: string | null; cashTotal: number | null; inventoryType: string; points: number | null }, fallbackCurrency: string) {
  if (observation.inventoryType === "award" && observation.points) return `${observation.points.toLocaleString("en-US")} points`;
  return observation.cashTotal === null ? "Cash total not captured" : formatMoney(observation.cashTotal, observation.cashCurrency ?? fallbackCurrency);
}
