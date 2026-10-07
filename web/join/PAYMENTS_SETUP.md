# Payments setup

Regular agreed installation price: **249 THB per server**. The owner authorized a temporary live test price of **5 THB** (`INSTALL_PRICE_SATANG=500`) on 2026-10-07. Do not restore the regular price automatically. Receiving PromptPay and TrueMoney numbers have been configured privately in Vercel Production. Neon has been connected to Vercel. SlipOK credentials and the receiver display name have also been configured. The three payment tables were initialized and verified against Neon on 2026-10-07 (Vercel setup job `dpl_7Brn2174Fw5Jq1i89RXhvm6Jbfgd`). Production is enabled at the temporary test price.

After MCSV confirms Minecraft Bedrock + Endstone and installation permissions, the installer can display a payment page instead of the port selector. Verified payment unlocks port selection, installation, automatic restart and Join. This is a one-time entitlement for the signed-in Discord user and the MCSV server ID; reinstalling that server with the same account does not charge again. Other servers need their own payment. No credits or monthly renewal are implemented.

## Required configuration

Set these privately in Vercel, never in browser JavaScript or GitHub:

| Variable | Value |
| --- | --- |
| `PAYMENTS_ENABLED` | `true` only after migration and a real payment test; absent/false keeps the existing free installer |
| `PAYMENT_DATABASE_URL` | Optional override for the private PostgreSQL connection string; otherwise the Neon integration’s `DATABASE_URL` is used, preferably pooled with verified TLS |
| `INSTALL_PRICE_SATANG` | Required agreed price, integer in satang (100 THB = 10000); no default price |
| `PROMPTPAY_ID` | Receiving PromptPay phone, ID or wallet identifier |
| `PAYMENT_RECEIVER_NAME` | Name users must check in their banking app before transferring |
| `SLIPOK_BRANCH_ID` | SlipOK branch that has this receiving account linked in LINE LIFF |
| `SLIPOK_API_KEY` | Private SlipOK API key |
| `TRUEMONEY_PHONE` | Receiving TrueMoney wallet phone, linked and OTP-verified in this SlipOK branch |
| `TRUEMONEY_ENABLED` | `true` to offer TrueMoney transfer + slip upload; it shares the configured SlipOK branch/key |

Both channels require SlipOK branch/key and receiver name. TrueMoney additionally requires its receiving phone and explicit enable flag. At least one channel and the database and price are required. If payments are enabled but configuration/database fails, installation is blocked. Do not send secrets in public chat. Store credentials in Vercel Environment Variables.

Apply `lib/payment-schema.sql` once with a database migration role before enabling. The website runtime role needs SELECT/INSERT/UPDATE on these three tables; do not expose the database to browsers. Keep backups. Vercel already blocks `/lib/**` from public download. Neon is already connected and the three payment tables are initialized.

## Payment verification

- PromptPay QR is generated locally with the server-owned order amount. Images are limited to 2 MB; PNG/JPEG/WEBP only. API body is under 3 MB (base64), below Vercel's body limit. Uploaded pictures are forwarded to SlipOK, not stored by this website.
- SlipOK uses multipart `files`, `log=true`, and `amount`. `log=true` checks the branch's registered recipient and duplicate slips. Only explicit success and the exact amount unlock installation. The slip must be from after order creation (one minute clock tolerance), and cannot be from the future. Bank + transaction reference is unique in our database, including across different image uploads. Branch recipient configuration must match the generated QR before enabling.
- TrueMoney now uses a direct wallet transfer followed by image upload to SlipOK with the same `log=true`, exact amount, timestamp and transaction-reference checks. The owner confirmed that the receiving wallet has been linked and verified in SlipOK. The checkout displays the receiving phone and name; it does not redeem envelopes or call the gift website. Both methods share image hashes and provider transaction references, so switching the radio button cannot reuse a slip to buy another server. The envelope SDK and its dependency have been removed.
- Orders expire after 30 minutes. Payments and grants remain in PostgreSQL after logout or redeployment. API checks Discord login, server membership and same-origin POST; each order belongs to the authenticated Discord user. Installation checks the durable entitlement before any installation writes, and rechecks the server with MCSV.
- SQL row locks, proof hashes and unique transaction references prevent concurrent/replayed grants. Maximum 5 attempts per user in 10 minutes. Bangkok bank delay errors can retry the same picture after 10 minutes. Returning to server verification reuses the active order, including orders under review.

## Ambiguous payments and support

A request may accept money and then time out before returning. Orders/attempts are committed as `verifying` **before** calling a provider. Timeout, malformed success, database failure after acceptance or duplicate transaction conflicts leave `review` (or `verifying` if the function dies). These states never auto-grant or create a fresh payable order for that user/server. Users see the order ID and are told not to pay again. Logs contain only error category and correlation ID, not keys, images, bank details.

There is no automated reconciliation, refund API or admin review page yet. For a review/verifying order, the operator must verify actual receipt from the receiving account/provider dashboard and order ownership before resolving it. Confirmed payment must be recorded together with a unique provider reference and entitlement in one SQL transaction, matching `paymentStore.finish`; do not manually mark an order paid without creating its grant. If payment was definitely not accepted, record that evidence before reopening the order. Never reopen an uncertain payment without checking its actual receipt.

For the first live rollout: choose price and receiver, provision PostgreSQL, migrate, configure SlipOK recipient, test each enabled channel with a real small payment, check grant/reinstall/replay behavior, then enable production. Production is enabled at 5 THB; the owner confirmed the PromptPay payment works. The assistant has not transferred money.

## Development checks

```sh
cd web/join
npm ci
cd ../..
node tests/test_web_payments.mjs
node tests/test_web_payment_ui.mjs
node tests/test_web_install.mjs
```

Payment tests use embedded PostgreSQL (PGlite), the real SQL schema and mocked providers. They do not transfer real money or consume SlipOK quota. Real network and device/browser testing remains required before collecting money.

## Live test rollout, 2026-10-07

Production checkout is enabled at the owner-authorized 5 THB test price. Database connection and all three tables passed checks. SlipOK quota API authenticated successfully (100 quota at the check). The configured SlipOK branch may be either a numeric ID or its exact SlipOK API URL; the code extracts the ID from that fixed host/path. Internal setup documents are omitted from deployments and their URLs return 404.

The owner confirmed that PromptPay works normally on 2026-10-07. The assistant has not performed a real transfer.

TrueMoney envelope calls previously returned HTTP 403. On 2026-10-07 the owner requested TrueMoney transfer/slip verification and confirmed the wallet was added to SlipOK. Production now offers both channels via SlipOK; the old gift endpoint is unused. `/api/payments/availability` reports configuration readiness and the test price, without contacting TrueMoney or exposing secrets. TrueMoney still requires a real transfer/slip test by the owner; configuration readiness is not proof of a successful payment.
