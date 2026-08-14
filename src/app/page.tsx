import { Chat } from "@/app/components/Chat";
import { PageHeader } from "@/ui";

/*
 * The conversation is the product's front door (ADR 0005). Everything the agent
 * can do is reachable by saying it, and everything it produces renders here —
 * the pages under /desk, /bookings, and /hotel-search are where a result is
 * looked at again later, not where work starts.
 */
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="deskStack">
      <PageHeader
        description="Ask about a stay and I will collect the evidence, compare it, and say what I would do. Hyatt opens in a visible tab, only when you press for it."
        eyebrow="TripBuddy"
        title="What are we looking at?"
      />
      <Chat />
    </div>
  );
}
