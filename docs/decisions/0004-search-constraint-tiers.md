# ADR 0004: A search constraint belongs to one of three tiers, and the product assigns it

## Status

Accepted.

## Context

A traveller asking in natural language states more than a search form can hold. *2 间 2 晚,每间每晚预算 1000,要有健身房,离车站近,最好高楼层* contains six constraints. Today one of them is honoured, one is silently misfiled, and four vanish.

The misfiling is the instructive part. `HotelSearchQuery` carries a single occupancy field, `adults`, so a model asked to fill that form put the room count there: *2 间* arrived as `adults: 2`. Two rooms is not two adults, and nothing downstream can tell. This is not a model failure — the model put a real constraint in the only slot that existed.

Meanwhile `buildHyattCitySearchUrl` already sends `kids`, `rooms`, and `rate` to Hyatt, all three pinned to constants. The provider accepts dimensions the product does not model.

Review §1.6 established that a stored field nothing computes with is a product defect, and deleted several. The same defect exists on the input side and has no name yet: **a constraint the traveller states and nothing searches with**. Both are the product taking something from the user and ignoring it.

Expanding the parameter list does not settle this on its own, because the list can never be complete. *离车站近* is verifiable and *高楼层* is not, and both will keep arriving. What has to be decided is not which parameters exist but what happens to the one that does not.

## Decision

### Three tiers

Every constraint extracted from a request is assigned to exactly one tier.

**Tier 1 — provider search parameters.** What the provider's own search form accepts: destination, dates, adults, children, rooms, rate type. These go into the search URL.

The anchor is deliberate. The parameter space is not invented from what a traveller might say, which is unbounded, but read off what the provider can actually be asked, which is finite and inspectable. It also states its own completion condition: a dimension the provider accepts and the product pins to a constant is a gap; a dimension the provider does not accept is not.

**Tier 1.5 — the budget.** Price is neither a search parameter nor an optional detail. Hyatt's search URL has no price filter, so a budget can only be a filter applied to returned results — but unlike anything in tier 2, the data it filters on is always present. What varies is its *evidence grade*: a starting `Avg/Night` is tax-exclusive, a verified stay total is not.

This is why the budget needs machinery nothing else needs — citation grounding, a stated basis, a product-owned tolerance, and the three-state comparison in `hotelSearchComparison.ts`. It earns that machinery by being the one filter whose subject always exists.

**Tier 2 — verifiable hotel attributes.** Amenities, address, stated distance to a landmark. Provable from the provider's own detail pages, therefore admissible as evidence on the same terms as a price.

**Tier 2 is deliberately empty at this decision.** Nothing is implemented in it. What matters now is that the tier exists and that tier 3 works, because expanding tier 2 later must be reclassification — moving a constraint from tier 3 to tier 2 — and not new plumbing.

**Tier 3 — everything else.** Connecting rooms, a high floor, a quiet corridor. These are negotiated with the hotel directly, at booking or at check-in, and they are outside what a search expresses in the same way that booking is outside what this product does. The answer is a product-owned sentence telling the traveller to raise it with the hotel.

With tier 2 empty, tier 3 also receives constraints that will one day move up. The copy must therefore describe a current limit rather than an impossibility, so that promoting a constraint later changes the classification and not the wording.

### The product assigns the tier; the model does not

The model extracts constraints from the request. A closed, product-owned table maps each to a tier, and **anything not in the table falls to tier 3**.

This matters most while tier 2 is empty, which is exactly when a model is most tempted to help — seeing *有健身房*, judging it filterable, and returning a filter that nothing can evaluate. That is the failure shape of review §3.22 and §3.25: a proposal that looks well-formed and is answerable by nothing.

Model proposes, product classifies. The same line ADR 0002 draws for capabilities.

### Tier 2, when it is built, needs four states and not three

The budget's three states — within, over, needs-upgrade — work because the price always exists at some grade, so an upgrade path always exists too. Amenities are different: detail pages differ per hotel, and a page may simply not say.

So tier 2 requires:

```
has / lacks / not_stated / not_checked
```

`not_stated` (we looked; the page is silent) must never collapse into `lacks` (we looked; it is absent). Recording this now because the collapse is the natural mistake, and it is the same mistake in a new field as the one §3.25 caught — treating unchecked as negative, which is how a starting price came to stand in for a verified total.

Only a proven negative may hide a hotel. Everything else stays visible.

### Verification rides on the visit that already happens

The tax-inclusive total already walks a per-hotel detail path. When tier 2 is built, whatever that visit can prove is captured in the same visit. There must not be a second per-hotel pass: the first one is already the expensive step, it is foreground, the traveller is watching, and it has been observed to time out.

### A stated distance is evidence; a computed one is not

If a Hyatt page says *0.3 miles from Shibuya Station*, that is provider-stated text and admissible like any other. What "near" means is a product-owned threshold, in the same class as the budget's tolerance.

Deriving a distance from coordinates is refused. It requires a geolocation source with no provenance story in a product whose entire argument is that every number traces to a page someone can open. If distance filtering is ever wanted, it filters on what the page states or it does not exist.

## Consequences

- `rooms` and `kids` become real query fields rather than constants in the URL builder; `2 间` stops landing in `adults`.
- A closed constraint table and a tier 3 path ship before tier 2 has any content, because tier 3 working is what makes tier 2 additive.
- Children may need ages rather than a count — hotels price by child age and programs define the boundary differently. That is a modelling question this ADR does not settle, only names.
- `HotelSearchProvider.normalizeSearchQuery` is where a provider declares which tier 1 dimensions it supports. A dimension another provider accepts and this one does not is an error, never a silent drop.
- Tier 3 copy is product-owned, like the never-acts refusal. The model signals that a constraint is unsupported; it does not describe the product.
