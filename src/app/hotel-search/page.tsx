import Link from "next/link";
import { getHotelSearchSession } from "@/lib/hotelSearchSessions";
import { buttonClassName, EmptyState, PageHeader } from "@/ui";
import { HotelSearchResults } from "./HotelSearchResults";

/*
 * A search is started by asking for one, not by filling this in.
 *
 * This page used to carry a nine-field form and a per-hotel button for the
 * tax-inclusive upgrade — a reader had to know that an Avg/Night excludes taxes
 * before they knew to press it. Both are the agent's job now (`search_hotels`
 * and `get_tax_inclusive_total`), so what is left is the durable view of one
 * session: somewhere a conversation card can link to, and somewhere a search can
 * be reopened later without re-running it.
 */
export const dynamic = "force-dynamic";

export default async function HotelSearchPage({
  searchParams
}: {
  searchParams: Promise<{ sessionId?: string | string[] }>;
}) {
  const params = await searchParams;
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const session = sessionId ? await getHotelSearchSession(sessionId) : null;

  return (
    <div className="deskStack">
      <PageHeader
        description="One saved city search, with everything captured for it. Searches are started in the conversation."
        eyebrow="Hotel search"
        title={session ? session.query.cityAsAsked : "Official city prices"}
      />
      {session ? (
        <HotelSearchResults session={session} />
      ) : (
        <EmptyState
          action={
            <Link className={buttonClassName()} href="/">
              Ask for a search
            </Link>
          }
          description={
            sessionId
              ? "Search sessions are kept for a day. Ask for the city and dates again and I will collect fresh prices."
              : "Tell me a city and your dates in the conversation, and the results will appear there and here."
          }
          title={sessionId ? "That search has expired" : "No search open"}
        />
      )}
    </div>
  );
}
