-- =============================================================================
-- Dar database roles: separate migrator / application / read-only accounts
-- =============================================================================
-- Why: the live app currently uses one role (dar_app) that also owns/DDLs the
-- schema. Splitting it means a compromised runtime connection cannot run DDL and a
-- reporting/diagnostic connection can never write. This is additive: the existing
-- dar_app connection string keeps working after the script runs.
--
-- Roles:
--   dar_migrator   owns the database + public schema and runs migrations (DDL).
--   dar_app        runtime API role: SELECT/INSERT/UPDATE/DELETE + sequences.
--   dar_read_only  reporting role: SELECT only, sessions forced read-only.
--
-- Apply with deploy/setup-host-db-roles.sh (reads the passwords from the untracked
-- deploy/.env, never prints them). Manual equivalent:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 \
--     -v db_name='<database>' \
--     -v migrator_password="$(openssl rand -hex 24)" \
--     -v app_password='<the current dar_app password>' \
--     -v read_only_password="$(openssl rand -hex 24)" \
--     -f deploy/sql/db-roles.sql
--
-- The script is idempotent: roles are created when missing and their passwords are
-- reset every run; grants are re-applied.
-- =============================================================================

\if :{?db_name}
\else
  \echo 'ERROR: pass -v db_name=<database>'
  \quit
\endif
\if :{?migrator_password}
\else
  \echo 'ERROR: pass -v migrator_password=<secret>'
  \quit
\endif
\if :{?app_password}
\else
  \echo 'ERROR: pass -v app_password=<secret>'
  \quit
\endif
\if :{?read_only_password}
\else
  \echo 'ERROR: pass -v read_only_password=<secret>'
  \quit
\endif

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ---- roles (idempotent create + password reset) ----
SELECT format('CREATE ROLE dar_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dar_migrator')
\gexec
SELECT format('ALTER ROLE dar_migrator WITH LOGIN PASSWORD %L', :'migrator_password')
\gexec

SELECT format('CREATE ROLE dar_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dar_app')
\gexec
SELECT format('ALTER ROLE dar_app WITH LOGIN PASSWORD %L', :'app_password')
\gexec

SELECT format('CREATE ROLE dar_read_only LOGIN PASSWORD %L', :'read_only_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dar_read_only')
\gexec
SELECT format('ALTER ROLE dar_read_only WITH LOGIN PASSWORD %L', :'read_only_password')
\gexec

-- Least privilege: no superuser/createdb/createrole for any of the three.
ALTER ROLE dar_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE dar_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE dar_read_only NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
-- Every dar_read_only session is read-only at the database level, even if the
-- client forgets to open a read-only transaction.
ALTER ROLE dar_read_only SET default_transaction_read_only = on;

-- ---- database-level access (PUBLIC loses everything first) ----
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO dar_migrator, dar_app, dar_read_only;

-- ---- schema access ----
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dar_app, dar_read_only;
GRANT CREATE ON SCHEMA public TO dar_migrator;

-- ---- existing objects ----
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dar_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dar_read_only;
-- Read-only reporting may look at sequence values but never advance them.
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dar_read_only;

-- ---- future objects ----
-- Default privileges are per-creating-role: grant for the new migrator (post
-- ownership transfer) and for the current owner (dar_app) so a partial rollout
-- cannot leave future tables unreadable by the runtime/reporting roles.
ALTER DEFAULT PRIVILEGES FOR ROLE dar_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dar_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dar_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO dar_read_only;
ALTER DEFAULT PRIVILEGES FOR ROLE dar_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dar_app IN SCHEMA public
  GRANT SELECT ON TABLES TO dar_read_only;

COMMIT;

\echo 'DB_ROLES_OK: dar_migrator (DDL), dar_app (DML), dar_read_only (SELECT-only)'
