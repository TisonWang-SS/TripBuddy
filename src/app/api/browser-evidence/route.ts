import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { normalizeBrowserEvidencePayload, parseHyattEvidenceFromText, type BrowserEvidencePayload } from "@/lib/browserEvidence";
import { prisma } from "@/lib/db";
import { createRecommendationForBooking } from "@/lib/recommendations";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function POST(request: Request) {
  let payload: BrowserEvidencePayload;
  try {
    payload = (await request.json()) as BrowserEvidencePayload;
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }

  const enrichedPayload =
    (!payload.candidates || payload.candidates.length === 0) && payload.pageText && payload.sourceUrl?.includes("hyatt.com")
      ? {
          ...payload,
          candidates: parseHyattEvidenceFromText(payload.pageText, payload.sourceUrl)
        }
      : payload;
  const normalized = normalizeBrowserEvidencePayload(enrichedPayload);
  if (!normalized.bookingId) {
    return json({ error: "bookingId is required." }, 400);
  }

  const booking = await prisma.hotelBooking.findUnique({
    where: { id: normalized.bookingId },
    include: { watchPlan: true }
  });

  if (!booking) {
    return json({ error: "Booking was not found." }, 404);
  }

  const watchPlan =
    booking.watchPlan ??
    (await prisma.watchPlan.create({
      data: {
        bookingId: booking.id,
        enabled: true,
        cashEnabled: true,
        awardEnabled: true,
        directEnabled: true,
        otaReferenceEnabled: false,
        browserMode: "chrome_profile"
      }
    }));

  const run = await prisma.priceCheckRun.create({
    data: {
      bookingId: booking.id,
      watchPlanId: watchPlan.id,
      status: normalized.candidates.length > 0 ? "succeeded" : "partial",
      trigger: "browser_import",
      inventoryTypesJson: JSON.stringify(["cash", "award"]),
      collectorName: "browser-extension",
      sourceUrl: normalized.sourceUrl,
      summary:
        normalized.candidates.length > 0
          ? `Browser extension imported ${normalized.candidates.length} candidate rate${normalized.candidates.length === 1 ? "" : "s"}.`
          : "Browser extension imported the page, but no rate candidates were parsed.",
      errorMessage:
        normalized.candidates.length > 0
          ? null
          : `No candidate rates parsed. Page text sample: ${normalized.pageText.slice(0, 500)}`,
      finishedAt: new Date()
    }
  });

  for (const candidate of normalized.candidates) {
    await prisma.priceObservation.create({
      data: {
        bookingId: booking.id,
        priceCheckRunId: run.id,
        observedAt: normalized.capturedAt,
        sourceName: normalized.hotelGroup === "Hyatt" ? "Hyatt official site" : `${normalized.hotelGroup} official site`,
        sourceType: "direct",
        collectedBy: "browser_extension",
        collectorName: "browser-extension",
        inventoryType: candidate.inventoryType,
        price: candidate.price,
        basePrice: candidate.basePrice,
        taxAmount: candidate.taxes,
        feeAmount: candidate.fees,
        totalPrice: candidate.price,
        pointsPrice: candidate.pointsPrice,
        cashCopay: null,
        currency: candidate.currency,
        rawRateName: candidate.rawRateName,
        ratePlanName: candidate.ratePlanName,
        roomTypeRaw: candidate.roomTypeRaw,
        roomMatch: inferRoomMatch(booking.roomType, candidate.roomTypeRaw),
        cancellationPolicyRaw: candidate.cancellationPolicyRaw,
        cancellationMatch: "unknown",
        breakfastIncluded: candidate.breakfastIncluded,
        taxesIncluded: candidate.taxesIncluded,
        loyaltyEligible: true,
        sourceUrl: normalized.sourceUrl,
        confidence: 0.8,
        notes: createEvidenceNote(normalized.pageTitle, normalized.pageText)
      }
    });
  }

  await prisma.watchPlan.update({
    where: { id: watchPlan.id },
    data: { lastCheckedAt: new Date() }
  });

  if (normalized.candidates.length > 0) {
    await createRecommendationForBooking(booking.id);
  }

  revalidatePath("/");
  revalidatePath(`/bookings/${booking.id}`);

  return json({
    bookingId: booking.id,
    candidatesImported: normalized.candidates.length,
    runId: run.id,
    status: run.status
  });
}

function createEvidenceNote(pageTitle: string | null, pageText: string) {
  const title = pageTitle ? `Browser page: ${pageTitle}` : "Browser page evidence";
  return `${title}\nText sample: ${pageText.slice(0, 900)}`;
}

function inferRoomMatch(currentRoomType: string, observedRoomType: string) {
  const current = normalizeComparableRoom(currentRoomType);
  const observed = normalizeComparableRoom(observedRoomType);
  if (!current || !observed || /not captured|unknown/.test(observed)) {
    return "unknown";
  }
  if (current === observed || current.includes(observed) || observed.includes(current)) {
    return "exact";
  }
  if (shareRoomBedType(current, observed)) {
    return "similar";
  }
  return "unknown";
}

function normalizeComparableRoom(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:room|rooms|standard|view|details|hyatt|place|select|book)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shareRoomBedType(current: string, observed: string) {
  for (const token of ["king", "queen", "twin", "double", "suite"]) {
    if (current.includes(token) && observed.includes(token)) {
      return true;
    }
  }
  return false;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: corsHeaders,
    status
  });
}
