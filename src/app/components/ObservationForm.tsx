import { addObservation, updateObservation } from "@/lib/actions";
import { CANCELLATION_MATCHES, CHANNELS, ROOM_MATCHES } from "@/lib/constants";
import { Button, CheckField, Field, FieldGrid, Form, FormActions } from "@/ui";

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
    <Form action={observation ? updateObservation : addObservation}>
      <input name="bookingId" type="hidden" value={booking.id} />
      {observation ? <input name="observationId" type="hidden" value={observation.id} /> : null}

      <FieldGrid>
        <Field htmlFor="sourceName" label="Source name">
          <input defaultValue={observation?.sourceName ?? ""} id="sourceName" name="sourceName" placeholder="Hyatt official site" required />
        </Field>
        <Field htmlFor="sourceType" label="Source type">
          <select defaultValue={observation?.sourceType ?? "direct"} id="sourceType" name="sourceType">
            {CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}
          </select>
        </Field>
        <Field htmlFor="inventoryType" label="Inventory type">
          <select defaultValue={observation?.inventoryType ?? "cash"} id="inventoryType" name="inventoryType">
            <option value="cash">Cash</option>
            <option value="award">Points / award</option>
          </select>
        </Field>
        <Field htmlFor="cashCurrency" label="Cash or copay currency">
          <input defaultValue={observation?.cashCurrency ?? observation?.cashCopayCurrency ?? booking.currency} id="cashCurrency" name="cashCurrency" />
        </Field>
        <Field htmlFor="cashBase" label="Cash base">
          <input defaultValue={observation?.cashBase ?? ""} id="cashBase" min="0" name="cashBase" step="0.01" type="number" />
        </Field>
        <Field htmlFor="cashTaxes" label="Cash taxes">
          <input defaultValue={observation?.cashTaxes ?? ""} id="cashTaxes" min="0" name="cashTaxes" step="0.01" type="number" />
        </Field>
        <Field htmlFor="cashFees" label="Cash fees">
          <input defaultValue={observation?.cashFees ?? ""} id="cashFees" min="0" name="cashFees" step="0.01" type="number" />
        </Field>
        <Field htmlFor="cashTotal" label="Final cash total">
          <input defaultValue={observation?.cashTotal ?? ""} id="cashTotal" min="0" name="cashTotal" step="0.01" type="number" />
        </Field>
        <Field htmlFor="points" label="Points total">
          <input defaultValue={observation?.points ?? ""} id="points" min="0" name="points" step="1" type="number" />
        </Field>
        <Field htmlFor="cashCopay" label="Award cash copay">
          <input defaultValue={observation?.cashCopay ?? ""} id="cashCopay" min="0" name="cashCopay" step="0.01" type="number" />
        </Field>
        <Field htmlFor="roomTypeRaw" label="Observed room type">
          <input defaultValue={observation?.roomTypeRaw ?? ""} id="roomTypeRaw" name="roomTypeRaw" required />
        </Field>
        <Field hint="Automatic unless you overrule it." htmlFor="roomMatch" label="Room assessment">
          <select defaultValue={observation?.evidence?.roomAssessmentSource === "user" ? observation.evidence.roomMatch : "auto"} id="roomMatch" name="roomMatch">
            <option value="auto">Automatic assessment</option>
            {ROOM_MATCHES.map((match) => <option key={match}>{match}</option>)}
          </select>
        </Field>
        <Field hint="Automatic unless you overrule it." htmlFor="cancellationMatch" label="Cancellation assessment">
          <select defaultValue={observation?.evidence?.cancellationAssessmentSource === "user" ? observation.evidence.cancellationMatch : "auto"} id="cancellationMatch" name="cancellationMatch">
            <option value="auto">Automatic assessment</option>
            {CANCELLATION_MATCHES.map((match) => <option key={match}>{match}</option>)}
          </select>
        </Field>
        <Field htmlFor="taxesIncluded" label="Taxes included">
          <select defaultValue={observation?.evidence?.taxesIncluded ?? "unknown"} id="taxesIncluded" name="taxesIncluded">
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field htmlFor="feesIncluded" label="Fees included">
          <select defaultValue={observation?.evidence?.feesIncluded ?? "unknown"} id="feesIncluded" name="feesIncluded">
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field htmlFor="loyaltyEligible" label="Loyalty eligibility">
          <select defaultValue={observation?.evidence?.loyaltyEligibility === "eligible" ? "yes" : observation?.evidence?.loyaltyEligibility === "not_eligible" ? "no" : "unknown"} id="loyaltyEligible" name="loyaltyEligible">
            <option value="unknown">Unknown</option>
            <option value="yes">Eligible</option>
            <option value="no">Not eligible</option>
          </select>
        </Field>
        <Field htmlFor="sourceUrl" label="Source URL">
          <input defaultValue={observation?.sourceUrl ?? ""} id="sourceUrl" name="sourceUrl" placeholder="https://..." type="url" />
        </Field>
      </FieldGrid>

      <Field htmlFor="cancellationPolicyRaw" label="Cancellation policy">
        <textarea defaultValue={observation?.cancellationPolicyRaw ?? ""} id="cancellationPolicyRaw" name="cancellationPolicyRaw" />
      </Field>

      <FieldGrid>
        <CheckField defaultChecked={observation?.isSuite ?? false} id="isSuite" label="Observed room is a suite" name="isSuite" />
        <CheckField defaultChecked={observation?.breakfastIncluded ?? false} id="breakfastIncluded" label="Breakfast is included" name="breakfastIncluded" />
      </FieldGrid>

      <Field htmlFor="notes" label="Notes">
        <textarea defaultValue={observation?.notes ?? ""} id="notes" name="notes" />
      </Field>

      <FormActions>
        <Button type="submit">{observation ? "Save observation" : "Add observation"}</Button>
      </FormActions>
    </Form>
  );
}
