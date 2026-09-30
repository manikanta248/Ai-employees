# 0003. Payments: Razorpay Route plus counter payments

Status: accepted (decision made; implementation in Phase 4)

## Decision

Online payments use Razorpay Route: each restaurant is a linked account and is settled directly, so Hazir never holds restaurant money. Cash and card at the counter are recorded by staff. A manual UPI (restaurant's own UPI ID) path is an optional fallback for restaurants awaiting KYC. All of these sit behind one `PaymentProvider` interface and one payment state model.

Online orders are confirmed only from a verified, signed webhook, stored raw and processed idempotently, with a daily reconciliation job.

## Open items (to confirm with Razorpay before Phase 4)

Route eligibility for a platform like Hazir, linked-account KYC for small cafes, extra Route fees, settlement timing, refund and dispute handling.
