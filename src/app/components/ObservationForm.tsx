import { addObservation, updateObservation } from "@/lib/actions";
import { CANCELLATION_MATCHES, CHANNELS, ROOM_MATCHES } from "@/lib/constants";

type ObservationFormValue = {
  breakfastIncluded: boolean | null;
  cancellationPolicyRaw: string | null;
  cashBase: number | null;
  cashCopay: number | null;
  cashCopayCurrency: string | null;
  cashCurrency: string | null;
  cashFees: number | null;
  cashTaxes: number | null;
  cashTotal: number | null;
  evidence: {
    cancellationAssessmentSource: string;
    cancellationMatch: string;
    feesIncluded: string;
    loyaltyEligibility: string;
    roomAssessmentSource: string;
    roomMatch: string;
    taxesIncluded: string;
  } | null;
  id: string;
  inventoryType: string;
  isSuite: boolean | null;
  loyaltyEligible: boolean | null;
  notes: string | null;
  points: number | null;
  roomTypeRaw: string | null;
  sourceName: string;
  sourceType: string;
  sourceUrl: string | null;
};

export function ObservationForm({
  booking,
  observation
}: {
  booking: { currency: string; id: string };
  observation?: ObservationFormValue;
}) {
  return (
    <form action={observation ? updateObservation : addObservation} className="card form">
      <input type="hidden" name="bookingId" value={booking.id} />
      {observation ? <input type="hidden" name="observationId" value={observation.id} /> : null}
      <div className="grid two">
        <div className="field"><label htmlFor="sourceName">Source name</label><input id="sourceName" name="sourceName" defaultValue={observation?.sourceName ?? ""} placeholder="Hyatt official site" required /></div>
        <div className="field"><label htmlFor="sourceType">Source type</label><select id="sourceType" name="sourceType" defaultValue={observation?.sourceType ?? "direct"}>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></div>
        <div className="field"><label htmlFor="inventoryType">Inventory type</label><select id="inventoryType" name="inventoryType" defaultValue={observation?.inventoryType ?? "cash"}><option value="cash">Cash</option><option value="award">Points / award</option></select></div>
        <div className="field"><label htmlFor="cashCurrency">Cash or copay currency</label><input id="cashCurrency" name="cashCurrency" defaultValue={observation?.cashCurrency ?? observation?.cashCopayCurrency ?? booking.currency} /></div>
        <div className="field"><label htmlFor="cashBase">Cash base</label><input id="cashBase" name="cashBase" type="number" min="0" step="0.01" defaultValue={observation?.cashBase ?? ""} /></div>
        <div className="field"><label htmlFor="cashTaxes">Cash taxes</label><input id="cashTaxes" name="cashTaxes" type="number" min="0" step="0.01" defaultValue={observation?.cashTaxes ?? ""} /></div>
        <div className="field"><label htmlFor="cashFees">Cash fees</label><input id="cashFees" name="cashFees" type="number" min="0" step="0.01" defaultValue={observation?.cashFees ?? ""} /></div>
        <div className="field"><label htmlFor="cashTotal">Final cash total</label><input id="cashTotal" name="cashTotal" type="number" min="0" step="0.01" defaultValue={observation?.cashTotal ?? ""} /></div>
        <div className="field"><label htmlFor="points">Points total</label><input id="points" name="points" type="number" min="0" step="1" defaultValue={observation?.points ?? ""} /></div>
        <div className="field"><label htmlFor="cashCopay">Award cash copay</label><input id="cashCopay" name="cashCopay" type="number" min="0" step="0.01" defaultValue={observation?.cashCopay ?? ""} /></div>
        <div className="field"><label htmlFor="roomTypeRaw">Observed room type</label><input id="roomTypeRaw" name="roomTypeRaw" defaultValue={observation?.roomTypeRaw ?? ""} required /></div>
        <div className="field"><label htmlFor="roomMatch">Room assessment</label><select id="roomMatch" name="roomMatch" defaultValue={observation?.evidence?.roomAssessmentSource === "user" ? observation.evidence.roomMatch : "auto"}><option value="auto">Automatic assessment</option>{ROOM_MATCHES.map((match) => <option key={match}>{match}</option>)}</select></div>
        <div className="field"><label htmlFor="cancellationMatch">Cancellation assessment</label><select id="cancellationMatch" name="cancellationMatch" defaultValue={observation?.evidence?.cancellationAssessmentSource === "user" ? observation.evidence.cancellationMatch : "auto"}><option value="auto">Automatic assessment</option>{CANCELLATION_MATCHES.map((match) => <option key={match}>{match}</option>)}</select></div>
        <div className="field"><label htmlFor="taxesIncluded">Taxes included</label><select id="taxesIncluded" name="taxesIncluded" defaultValue={observation?.evidence?.taxesIncluded ?? "unknown"}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></div>
        <div className="field"><label htmlFor="feesIncluded">Fees included</label><select id="feesIncluded" name="feesIncluded" defaultValue={observation?.evidence?.feesIncluded ?? "unknown"}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></div>
        <div className="field"><label htmlFor="loyaltyEligible">Loyalty eligibility</label><select id="loyaltyEligible" name="loyaltyEligible" defaultValue={observation?.evidence?.loyaltyEligibility === "eligible" ? "yes" : observation?.evidence?.loyaltyEligibility === "not_eligible" ? "no" : "unknown"}><option value="unknown">Unknown</option><option value="yes">Eligible</option><option value="no">Not eligible</option></select></div>
        <div className="field"><label htmlFor="sourceUrl">Source URL</label><input id="sourceUrl" name="sourceUrl" type="url" defaultValue={observation?.sourceUrl ?? ""} placeholder="https://..." /></div>
      </div>
      <div className="field"><label htmlFor="cancellationPolicyRaw">Cancellation policy</label><textarea id="cancellationPolicyRaw" name="cancellationPolicyRaw" defaultValue={observation?.cancellationPolicyRaw ?? ""} /></div>
      <div className="check"><input id="isSuite" name="isSuite" type="checkbox" defaultChecked={observation?.isSuite ?? false} /><label htmlFor="isSuite">Observed room is a suite</label></div>
      <div className="check"><input id="breakfastIncluded" name="breakfastIncluded" type="checkbox" defaultChecked={observation?.breakfastIncluded ?? false} /><label htmlFor="breakfastIncluded">Breakfast is included</label></div>
      <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" defaultValue={observation?.notes ?? ""} /></div>
      <button type="submit">{observation ? "Save observation" : "Add observation"}</button>
    </form>
  );
}
