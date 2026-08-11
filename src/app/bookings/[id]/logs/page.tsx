import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceIssueList } from "@/app/components/EvidenceIssueList";
import { RunLlmExtractionButton } from "@/app/components/RunLlmExtractionButton";
import { deleteObservation, promoteObservationToBooking } from "@/lib/actions";
import { parseSanitizedBrowserSnapshots } from "@/lib/browserTaskCodecs";
import { prisma } from "@/lib/db";
import { formatLocalInstant, formatMoney } from "@/lib/format";
import { parseJson, stringList } from "@/lib/json";
import { isLlmEvidenceExtractionConfigured } from "@/lib/providers/llmEvidence";

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
    <div className="grid">
      <div className="pageHeader"><div><p className="eyebrow">Logs</p><h1>{booking.hotelName}</h1><p>Price-check runs, observation evidence, and recommendation history.</p></div><Link className="button secondary" href={`/bookings/${id}`}>Back</Link></div>

      <section className="card">
        <div className="pageHeader"><div><p className="eyebrow">History</p><h2>Price observations</h2></div><Link className="button secondary" href={`/bookings/${id}/observations/new`}>Manual entry</Link></div>
        {booking.observations.length === 0 ? <div className="empty"><h3>No observations</h3><p>Observation-ready direct and manual rates will appear here.</p></div> : (
          <div className="list">{booking.observations.map((observation) => {
            const blockers = stringList(observation.evidence?.blockersJson);
            const warnings = stringList(observation.evidence?.warningsJson);
            const snapshot = parseJson<{ textSample?: string }>(observation.evidence?.snapshotJson, {});
            return <article className="listItem evidenceItem" key={observation.id}>
              <div>
                <h3>{formatObservationPrice(observation, booking.currency)}</h3>
                <p>{observation.sourceName} · {observation.sourceType} · {observation.collectionMethod}</p>
                <p className="muted">Extractor: {observation.extractorName} v{observation.extractorVersion} · {observation.extractionSource}</p>
                <p>Room: {observation.roomTypeRaw ?? "Not captured"} · Policy: {observation.cancellationPolicyRaw ?? "Not captured"}</p>
                <p className="muted">{observation.evidence?.roomMatch ?? "unknown"} room · {observation.evidence?.cancellationMatch ?? "unknown"} cancellation · taxes {observation.evidence?.taxesIncluded ?? "unknown"} · fees {observation.evidence?.feesIncluded ?? "unknown"}</p>
                <EvidenceIssueList blockers={blockers} warnings={warnings} />
                {snapshot.textSample ? <details><summary>Sanitized evidence sample</summary><p className="muted">{snapshot.textSample}</p></details> : null}
              </div>
              <div><span className={`badge ${observation.evidence?.qualityLevel ?? "needs_review"}`}>{observation.evidence?.qualityLevel ?? "needs_review"}</span><p>{formatLocalInstant(observation.observedAt)}</p><div className="buttonRow"><Link className="button secondary" href={`/bookings/${id}/observations/${observation.id}/edit`}>Review</Link><form action={promoteObservationToBooking}><input type="hidden" name="bookingId" value={id} /><input type="hidden" name="observationId" value={observation.id} /><button type="submit">Use as current</button></form><form action={deleteObservation}><input type="hidden" name="bookingId" value={id} /><input type="hidden" name="observationId" value={observation.id} /><button className="danger" type="submit">Delete</button></form></div></div>
            </article>;
          })}</div>
        )}
      </section>

      <section className="card"><p className="eyebrow">Price check runs</p><h2>Browser task activity</h2><div className="divider" />
        {booking.priceCheckRuns.length === 0 ? <div className="empty"><h3>No price checks</h3><p>Run a check from the booking page.</p></div> : <div className="list">{booking.priceCheckRuns.map((run) => {
          const snapshots = parseSanitizedBrowserSnapshots(run.browserTask.snapshotsJson);
          return <article className="listItem evidenceItem" key={run.id}>
            <div>
              <h3>{run.providerName}</h3>
              <p>{run.summary ?? run.errorMessage ?? "Waiting for evidence."}</p>
              {run.candidatesTruncated ? <p className="notice warning">Candidate evidence exceeded the audit limit; only the first 24 distinct candidates were retained.</p> : null}
              {run.browserTask.snapshotsTruncated ? <p className="notice warning">Browser history exceeded the audit limit; only the 12 most recent sanitized snapshots were retained.</p> : null}
              {run.sourceUrl ? <a className="muted" href={run.sourceUrl} rel="noreferrer" target="_blank">Open source</a> : null}
              {snapshots.length > 0 ? <details><summary>{snapshots.length} sanitized browser snapshot{snapshots.length === 1 ? "" : "s"}</summary><div className="list">{snapshots.map((snapshot) => <div className="listItem" key={`${snapshot.capturedAt}-${snapshot.sourceUrl}`}><div><strong>{snapshot.pageTitle || snapshot.phase}</strong><p className="muted">{snapshot.textSample.slice(0, 1200)}{snapshot.textSample.length > 1200 || snapshot.truncated ? "…" : ""}</p></div><span className="badge">{snapshot.phase}</span></div>)}</div></details> : null}
              {run.extractionRuns.length > 0 ? <details><summary>{run.extractionRuns.length} LLM extraction run{run.extractionRuns.length === 1 ? "" : "s"}</summary><div className="list">{run.extractionRuns.map((extraction) => {
                const issues = stringList(extraction.issuesJson);
                return <div className="listItem" key={extraction.id}><div><strong>{extraction.extractorName} v{extraction.extractorVersion}</strong><p className="muted">{extraction.modelName} · {extraction.snapshotCount} snapshot{extraction.snapshotCount === 1 ? "" : "s"} · {formatLocalInstant(extraction.createdAt)}</p>{issues.length > 0 ? <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}</div><span className={`badge ${extraction.status}`}>{extraction.status}</span></div>;
              })}</div></details> : null}
            </div>
            <div><span className={`badge ${run.status}`}>{run.status}</span><p>{formatLocalInstant(run.startedAt)}</p><small className="muted">Task {run.browserTask.status}</small>{snapshots.length > 0 && run.status !== "running" ? <RunLlmExtractionButton configured={llmConfigured} runId={run.id} /> : null}</div>
          </article>;
        })}</div>}
      </section>

      <section className="card"><p className="eyebrow">Decision history</p><h2>Past recommendations</h2><div className="divider" />
        {booking.recommendations.length === 0 ? <div className="empty"><h3>No decisions</h3><p>A decision is saved after an observation exists.</p></div> : <table className="table"><thead><tr><th>Generated</th><th>Verdict</th><th>Savings</th><th>Evidence</th><th>Explanation</th></tr></thead><tbody>{booking.recommendations.map((item) => <tr key={item.id}><td>{formatLocalInstant(item.generatedAt)}</td><td><span className={`badge ${item.verdict}`}>{item.verdict}</span></td><td>{formatMoney(item.estimatedSavings, item.currency)}</td><td>{item.qualityLevel} · {item.riskLevel} risk</td><td>{item.explanation}</td></tr>)}</tbody></table>}
      </section>
    </div>
  );
}

function formatObservationPrice(observation: { cashCurrency: string | null; cashTotal: number | null; inventoryType: string; points: number | null }, fallbackCurrency: string) {
  if (observation.inventoryType === "award" && observation.points) return `${observation.points.toLocaleString("en-US")} points`;
  return observation.cashTotal === null ? "Cash total not captured" : formatMoney(observation.cashTotal, observation.cashCurrency ?? fallbackCurrency);
}
