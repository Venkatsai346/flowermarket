# Order lifecycle and return governance

## One order, three independent lifecycles

An order must never use one status field to answer three different questions.

| Axis | Question | Examples |
|---|---|---|
| Fulfillment | Where are the goods? | confirmed, picking, packed, out for delivery, delivered, cancelled |
| After-sales | What is happening to a delivered item? | return approved, collected, QC passed, refund initiated, refunded |
| Payment | What happened to the money? | pending, paid, partially refunded, refunded |

A returned order is still historically **Delivered** on the fulfillment axis. Its customer headline is **Returned & refunded**, and the storefront displays all three facts together. This preserves proof of delivery, shipment tracking, inventory history and financial auditability without confusing customers.

The API exposes this composition as `order.lifecycle`:

- `fulfillment.status` — shipment-derived physical state;
- `afterSales.status`, `requestCount`, `activeCount` — return/claim state;
- `payment.status`, `refundedAmount` — money state;
- `customerStatus` — the current customer-facing headline.

## Who decides whether a product can be returned?

Central Catalog Ops (super admin) owns `ProductMaster.returnPolicy`. Open **Catalog → Product masters → Create/Edit master → Identity → Returns & quality claims**.

Three explicit modes are supported:

1. **Returnable with pickup & QC** — sets a parcel-delivery-based pickup window and whether physical QC is required.
2. **Quality claim only** — no pickup return; permits a short quality-issue claim window, appropriate for milk, eggs, cut flowers, groceries and other perishables.
3. **Final sale** — no pickup return and no instant quality claim. Use only where law and marketplace policy permit it.

The super admin also controls the window and a customer-facing explanation. The policy appears on the product detail page before purchase and in the return flow.

## Historical integrity

At add-to-cart time the resolved policy is copied to `CartItem.returnPolicySnapshot`. At checkout it is copied to `OrderItem.returnPolicySnapshot`. Return eligibility always evaluates this immutable order-line snapshot—not the current ProductMaster—so changing a catalog policy tomorrow cannot reduce or expand rights on yesterday's purchase.

Products created before explicit policies remain compatible:

- ordinary products default to a 7-day pickup/QC return;
- perishables other than bouquets/plants default to a 24-hour quality claim only;
- legacy `isReturnable` snapshots remain authoritative for old orders.

## Split-delivery rules

- Delivery and eligibility are evaluated per shipment.
- A delivered parcel can be returned while another parcel is in transit.
- One return request belongs to one shipment.
- Every selected line must permit the selected claim type and still be inside its own snapshotted window.
- Quantity checks subtract previous returns and cancellations.
- Final-sale lines remain visible with an explanation but cannot be selected.

## State ownership rules

- Shipment execution derives aggregate fulfillment status.
- Return requests own after-sales status.
- Refund transactions own payment/refund status.
- No return operation may overwrite shipment history.
- No shipment reconciliation may erase return/refund history.
- The storefront composes the three axes; it does not guess from one overloaded field.
