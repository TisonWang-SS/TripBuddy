import { listSearchableHotelGroups } from "@/lib/providers/registry";
import { getProfileSearchCurrency } from "@/lib/profilePreferences";
import { PageHeader } from "@/ui";
import { HotelSearchClient } from "./HotelSearchClient";

export const dynamic = "force-dynamic";

export default async function HotelSearchPage() {
  const currency = await getProfileSearchCurrency();
  return (
    <div className="deskStack">
      <PageHeader
        description="Search supported hotel-group websites without attaching results to an existing booking."
        eyebrow="Hotel search"
        title="Official city prices"
      />
      <HotelSearchClient currency={currency} hotelGroups={listSearchableHotelGroups()} />
    </div>
  );
}
