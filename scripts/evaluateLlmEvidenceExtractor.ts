import { evaluateTextEvidenceExtractor, evaluateTextEvidenceExtractorAsync } from "../src/lib/providers/extractionEvaluation";
import { hyattEvidenceFixtures } from "../src/lib/providers/hyattEvidence.fixtures";
import {
  normalizeBrowserEvidencePayload,
  parseHyattEvidenceFromText,
  type BrowserEvidenceCandidateInput
} from "../src/lib/providers/hyattEvidence";
import {
  createConfiguredLlmEvidenceExtractor,
  validateLlmEvidenceCandidates
} from "../src/lib/providers/llmEvidence";
import baseline from "../docs/evals/hyatt-evidence-deterministic-baseline.json";

const requestedFixtureId = process.argv
  .find((argument) => argument.startsWith("--fixture="))
  ?.slice("--fixture=".length);
const fixtures = requestedFixtureId
  ? hyattEvidenceFixtures.filter((fixture) => fixture.id === requestedFixtureId)
  : hyattEvidenceFixtures;
if (requestedFixtureId && fixtures.length === 0) {
  throw new Error(`Unknown extraction fixture: ${requestedFixtureId}`);
}

const extractor = createConfiguredLlmEvidenceExtractor();
const deterministic = evaluateTextEvidenceExtractor(fixtures, parseHyattEvidenceFromText);
const validationIssues: Array<{
  fixtureId: string;
  issues: string[];
  proposals: Array<Pick<BrowserEvidenceCandidateInput, "ratePlanName"> & { evidenceText: string }>;
}> = [];
const model = await evaluateTextEvidenceExtractorAsync<BrowserEvidenceCandidateInput>(
  fixtures,
  async (pageText, sourceUrl) => {
    const nights = readNights(sourceUrl, pageText);
    const proposals = await extractor.extract({ hotelGroup: "Hyatt", nights, pageText, sourceUrl });
    const validated = validateLlmEvidenceCandidates(proposals, { nights, pageText, sourceUrl });
    if (validated.issues.length > 0) {
      validationIssues.push({
        fixtureId: fixtures.find((fixture) => fixture.pageText === pageText && fixture.sourceUrl === sourceUrl)?.id ?? sourceUrl,
        issues: validated.issues,
        proposals: proposals.map((proposal) => ({
          evidenceText: proposal.evidenceText,
          ratePlanName: proposal.ratePlanName
        }))
      });
    }
    return normalizeBrowserEvidencePayload({
      candidates: validated.accepted.map(({ proposal }) => ({
        ...(proposal.averageNightlyRate && !proposal.cashTotal
          ? { basePrice: proposal.averageNightlyRate.amount }
          : {}),
        breakfastIncluded: proposal.breakfastIncluded,
        cancellationPolicyRaw: proposal.cancellationPolicyRaw,
        currency: proposal.cashTotal?.currency ?? proposal.averageNightlyRate?.currency ?? proposal.cashCopay?.currency ?? "",
        fees: proposal.cashFees?.amount ?? null,
        feesIncluded: proposal.feesIncluded,
        inventoryType: proposal.inventoryType,
        pointsPrice: proposal.points,
        ratePlanName: proposal.ratePlanName,
        rawRateName: proposal.rawRateName,
        roomTypeRaw: proposal.roomTypeRaw,
        taxes: proposal.cashTaxes?.amount ?? null,
        taxesIncluded: proposal.taxesIncluded,
        totalPrice: proposal.cashTotal?.amount ?? (
          proposal.averageNightlyRate ? proposal.averageNightlyRate.amount * nights : null
        )
      })),
      pageText,
      sourceUrl
    }).candidates.map(({ basePrice, ...candidate }) => (
      basePrice === null ? candidate : { ...candidate, basePrice }
    ));
  }
);

console.log(JSON.stringify({ deterministic, model, validationIssues }, null, 2));
if (!requestedFixtureId && (
  deterministic.score !== baseline.score ||
  deterministic.assertions.total !== baseline.assertions.total ||
  deterministic.fixtures.total !== baseline.fixtures.total
)) {
  throw new Error("The deterministic extractor or fixture set changed; review and update the stored baseline first.");
}
if (requestedFixtureId ? model.failures.length > 0 : model.score < baseline.score) {
  process.exitCode = 1;
}

function readNights(sourceUrl: string, pageText: string) {
  try {
    const url = new URL(sourceUrl);
    const checkIn = url.searchParams.get("checkinDate");
    const checkOut = url.searchParams.get("checkoutDate");
    if (checkIn && checkOut) {
      return Math.max(1, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));
    }
  } catch {
    // Fall through to the visible night count.
  }
  const visible = pageText.match(/\b([1-9][0-9]?)\s*Night/i);
  return visible ? Number(visible[1]) : 1;
}
