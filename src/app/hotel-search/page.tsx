import { listSearchableHotelGroups } from "@/lib/providers/registry";
import { getProfileSearchCurrency } from "@/lib/profilePreferences";
import { getHotelSearchSession } from "@/lib/hotelSearchSessions";
import { PageHeader } from "@/ui";
import { HotelSearchClient } from "./HotelSearchClient";

export const dynamic = "force-dynamic";

export default async function HotelSearchPage({
  searchParams
}: {
  searchParams: Promise<{ sessionId?: string | string[]; taskId?: string | string[] }>;
}) {
  const params = await searchParams;
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const taskId = Array.isArray(params.taskId) ? params.taskId[0] : params.taskId;
  const initialSession = sessionId ? await getHotelSearchSession(sessionId) : null;
  const currency = await getProfileSearchCurrency();
  return (
    <div className="deskStack">
      <PageHeader
        description="Search supported hotel-group websites without attaching results to an existing booking."
        eyebrow="Hotel search"
        title="Official city prices"
      />
      <HotelSearchClient
        currency={currency}
        hotelGroups={listSearchableHotelGroups()}
        initialSession={initialSession}
        taskId={taskId ?? null}
      />
    </div>
  );
}
