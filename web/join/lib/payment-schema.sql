-- Apply once with the private migration role. Never serve this directory publicly.
BEGIN;
CREATE TABLE IF NOT EXISTS sleepy_payment_orders (
 id uuid PRIMARY KEY,user_id text NOT NULL,server_id text NOT NULL,
 amount_satang integer NOT NULL CHECK(amount_satang BETWEEN 100 AND 20000000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verifying','review','paid','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS sleepy_orders_user ON sleepy_payment_orders(user_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS sleepy_one_open_order ON sleepy_payment_orders(user_id,server_id) WHERE status IN ('pending','verifying','review');
CREATE TABLE IF NOT EXISTS sleepy_payment_attempts (
 proof_key text PRIMARY KEY,order_id uuid NOT NULL REFERENCES sleepy_payment_orders(id),
 method text NOT NULL CHECK(method IN ('promptpay','truemoney')),
 status text NOT NULL DEFAULT 'verifying' CHECK(status IN ('verifying','review','rejected','paid')),
 provider_reference text UNIQUE,amount_satang integer,error_code text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sleepy_install_entitlements (
 user_id text NOT NULL,server_id text NOT NULL,order_id uuid NOT NULL REFERENCES sleepy_payment_orders(id),
 created_at timestamptz NOT NULL DEFAULT now(),installed_at timestamptz,PRIMARY KEY(user_id,server_id)
);
COMMIT;
