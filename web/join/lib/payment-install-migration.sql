BEGIN;
-- Historical grants belonged to the previous permanent entitlement model.
-- Keep their payment audit, but do not use them for a new absent installation.
ALTER TABLE sleepy_install_entitlements ADD COLUMN IF NOT EXISTS installed_at timestamptz DEFAULT now();
ALTER TABLE sleepy_install_entitlements ALTER COLUMN installed_at DROP DEFAULT;
COMMIT;
