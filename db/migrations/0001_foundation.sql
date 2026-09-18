-- P01 only creates a private application boundary. No child data or public grants.
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
-- Role separation, per-family constraints and RLS policies are added in P03.
-- Never use a schema owner/service_role as APP_DATABASE_URL.
