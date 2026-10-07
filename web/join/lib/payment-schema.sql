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

ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS server_name text;
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS user_name text;
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS purchase_number bigint;
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS installation_state text NOT NULL DEFAULT 'unknown';
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS addon_state text NOT NULL DEFAULT 'unknown';
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS plugin_state text NOT NULL DEFAULT 'unknown';
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS installation_attempt integer NOT NULL DEFAULT 0;
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS installation_updated_at timestamptz;
ALTER TABLE sleepy_payment_orders ADD COLUMN IF NOT EXISTS installation_error text;
CREATE SEQUENCE IF NOT EXISTS sleepy_purchase_sequence;
WITH numbered AS MATERIALIZED (SELECT id,nextval('sleepy_purchase_sequence') AS n FROM (SELECT id FROM sleepy_payment_orders WHERE status='paid' AND purchase_number IS NULL ORDER BY paid_at,created_at,id) ordered)
UPDATE sleepy_payment_orders o SET purchase_number=n.n FROM numbered n WHERE o.id=n.id;
CREATE UNIQUE INDEX IF NOT EXISTS sleepy_purchase_number ON sleepy_payment_orders(purchase_number);
UPDATE sleepy_payment_orders o SET payment_method=a.method FROM sleepy_payment_attempts a WHERE a.order_id=o.id AND a.status='paid' AND o.payment_method IS NULL;
CREATE TABLE IF NOT EXISTS sleepy_payment_notifications (
 id bigserial PRIMARY KEY,order_id uuid NOT NULL REFERENCES sleepy_payment_orders(id),attempt integer NOT NULL,event text NOT NULL,
 payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',tries integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),message_id text,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(order_id,attempt,event)
);
CREATE INDEX IF NOT EXISTS sleepy_notification_pending ON sleepy_payment_notifications(status,next_at);


COMMIT;
