BEGIN;
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
