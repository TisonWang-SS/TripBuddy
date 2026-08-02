import { listSearchableHotelGroups } from "@/lib/providers/registry";
import { getProfileSearchCurrency } from "@/lib/profilePreferences";
import { HotelSearchClient } from "./HotelSearchClient";

export const dynamic = "force-dynamic";

export default async function HotelSearchPage() {
  const currency = await getProfileSearchCurrency();
  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Hotel search</p>
          <h1>Official city prices</h1>
          <p>Search supported hotel-group websites without attaching results to an existing booking.</p>
        </div>
      </div>
      <HotelSearchClient currency={currency} hotelGroups={listSearchableHotelGroups()} />
    </div>
  );
}
