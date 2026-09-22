-- OPTIONAL administrator provisioning, not run automatically by the app.
-- Connect ONLY to olist_olap_abd; create a separate LOGIN or Entra principal,
-- then grant it membership in olist_agent_reader. Never grant the agent ownership.
-- This grants no INSERT/UPDATE/DELETE/CREATE rights and does not populate OLAP.
BEGIN;
DO $$
BEGIN
    IF current_database() <> 'olist_olap_abd' THEN
        RAISE EXCEPTION 'This script must run in olist_olap_abd';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'olist_agent_reader') THEN
        CREATE ROLE olist_agent_reader NOLOGIN;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE olist_olap_abd TO olist_agent_reader;
GRANT USAGE ON SCHEMA public TO olist_agent_reader;
GRANT SELECT ON TABLE
    public.fact_order_item,
    public.dim_date,
    public.dim_category,
    public.dim_customer,
    public.dim_seller,
    public.dim_product,
    public.dim_geography
TO olist_agent_reader;
COMMIT;

-- Administrator follow-up (replace principal name; never put its secret in this file):
-- GRANT olist_agent_reader TO your_agent_login;
-- ALTER ROLE your_agent_login SET default_transaction_read_only = on;
-- Ensure the login has no other memberships, ownership, or PUBLIC write privileges.
