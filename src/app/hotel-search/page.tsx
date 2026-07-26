import { HyattCitySearchClient } from "./HyattCitySearchClient";

export default function HotelSearchPage() {
  return (
    <div className="grid">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Hotel search</p>
          <h1>Hyatt city prices</h1>
          <p>Search Hyatt official availability by city without attaching the result to an existing booking.</p>
        </div>
      </div>
      <HyattCitySearchClient />
    </div>
  );
}
