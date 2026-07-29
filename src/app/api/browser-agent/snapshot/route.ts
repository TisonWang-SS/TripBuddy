import { NextResponse } from "next/server";
import { planBrowserAgentAction, type BrowserAgentSnapshot } from "@/lib/browserAgent";
import { prisma } from "@/lib/db";

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
  let snapshot: BrowserAgentSnapshot;
  try {
    snapshot = (await request.json()) as BrowserAgentSnapshot;
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }

  const bookingId = snapshot.bookingId?.trim();
  if (!bookingId) {
    return json({ error: "bookingId is required." }, 400);
  }

  const booking = await prisma.hotelBooking.findUnique({
    where: { id: bookingId },
    select: { hotelName: true, id: true }
  });
  if (!booking) {
    return json({ error: "Booking was not found." }, 404);
  }

  const action = planBrowserAgentAction({
    ...snapshot,
    targetHotelName: booking.hotelName
  });

  return json({
    ...action,
    bookingId: booking.id
  });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: corsHeaders,
    status
  });
}
