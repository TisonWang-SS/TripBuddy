export type ExtractionCandidateExpectation<TCandidate extends object> = {
  absentFields?: readonly (keyof TCandidate)[];
  containsFields?: Partial<Record<keyof TCandidate, string>>;
  fields: Partial<TCandidate>;
};

export type ExtractionFixture<TCandidate extends object> = {
  candidateCount?: number;
  expectedCandidates: readonly ExtractionCandidateExpectation<TCandidate>[];
  id: string;
  pageText: string;
  sourceUrl: string;
};

export type ExtractionEvaluationReport = {
  assertions: { passed: number; total: number };
  failures: string[];
  fixtures: { passed: number; total: number };
  score: number;
};

export type TextEvidenceExtractor<TCandidate extends object> = (pageText: string, sourceUrl: string) => TCandidate[];

export function evaluateTextEvidenceExtractor<TCandidate extends object>(
  fixtures: readonly ExtractionFixture<TCandidate>[],
  extractor: TextEvidenceExtractor<TCandidate>
): ExtractionEvaluationReport {
  let passedAssertions = 0;
  let totalAssertions = 0;
  let passedFixtures = 0;
  const failures: string[] = [];

  for (const fixture of fixtures) {
    const fixtureFailureStart = failures.length;
    const candidates = extractor(fixture.pageText, fixture.sourceUrl);
    const usedCandidateIndexes = new Set<number>();

    if (fixture.candidateCount !== undefined) {
      totalAssertions += 1;
      if (candidates.length === fixture.candidateCount) {
        passedAssertions += 1;
      } else {
        failures.push(
          `${fixture.id}: expected ${fixture.candidateCount} candidate(s), received ${candidates.length}.`
        );
      }
    }

    fixture.expectedCandidates.forEach((expected, expectedIndex) => {
      const candidateIndex = selectBestCandidate(candidates, usedCandidateIndexes, expected);
      const candidate = candidateIndex === null ? null : candidates[candidateIndex];
      if (candidateIndex !== null) {
        usedCandidateIndexes.add(candidateIndex);
      }

      for (const [field, expectedValue] of Object.entries(expected.fields)) {
        totalAssertions += 1;
        const actualValue = candidate?.[field as keyof TCandidate];
        if (candidate && valuesEqual(actualValue, expectedValue)) {
          passedAssertions += 1;
        } else {
          failures.push(
            `${fixture.id} candidate ${expectedIndex + 1}: expected ${field}=${formatValue(expectedValue)}, received ${formatValue(actualValue)}.`
          );
        }
      }

      for (const field of expected.absentFields ?? []) {
        totalAssertions += 1;
        if (candidate && !(field in candidate)) {
          passedAssertions += 1;
        } else {
          failures.push(`${fixture.id} candidate ${expectedIndex + 1}: expected ${String(field)} to be absent.`);
        }
      }

      for (const [field, expectedText] of Object.entries(expected.containsFields ?? {})) {
        totalAssertions += 1;
        const actualValue = candidate?.[field as keyof TCandidate];
        if (candidate && typeof actualValue === "string" && actualValue.includes(String(expectedText))) {
          passedAssertions += 1;
        } else {
          failures.push(
            `${fixture.id} candidate ${expectedIndex + 1}: expected ${field} to contain ${formatValue(expectedText)}, received ${formatValue(actualValue)}.`
          );
        }
      }
    });

    if (fixture.candidateCount === undefined && fixture.expectedCandidates.length === 0) {
      throw new Error(`Extraction fixture ${fixture.id} does not define any assertions.`);
    }
    if (failures.length === fixtureFailureStart) {
      passedFixtures += 1;
    }
  }

  return {
    assertions: { passed: passedAssertions, total: totalAssertions },
    failures,
    fixtures: { passed: passedFixtures, total: fixtures.length },
    score: totalAssertions === 0 ? 1 : passedAssertions / totalAssertions
  };
}

function selectBestCandidate<TCandidate extends object>(
  candidates: readonly TCandidate[],
  usedCandidateIndexes: ReadonlySet<number>,
  expected: ExtractionCandidateExpectation<TCandidate>
) {
  let bestIndex: number | null = null;
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
    if (usedCandidateIndexes.has(index)) {
      return;
    }
    const score =
      Object.entries(expected.fields).filter(([field, value]) =>
        valuesEqual(candidate[field as keyof TCandidate], value)
      ).length +
      (expected.absentFields ?? []).filter((field) => !(field in candidate)).length;
    const containsScore = Object.entries(expected.containsFields ?? {}).filter(([field, text]) => {
      const value = candidate[field as keyof TCandidate];
      return typeof value === "string" && value.includes(String(text));
    }).length;
    if (score + containsScore > bestScore) {
      bestIndex = index;
      bestScore = score + containsScore;
    }
  });
  return bestIndex;
}

function valuesEqual(actual: unknown, expected: unknown) {
  return Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
}

function formatValue(value: unknown) {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}
