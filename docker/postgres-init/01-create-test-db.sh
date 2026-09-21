#!/bin/sh
# Runs once, only when the postgres container initializes an empty data directory (per the
# official postgres image's docker-entrypoint-initdb.d convention). Creates a second, separate
# database for integration/security tests alongside the development database, owned by its own
# distinct, non-superuser role — so tests never run against development data, and a test
# database credential (even if leaked or misconfigured) has no access to the development
# database at all, rather than merely being discouraged from using it.
set -e

TEST_DB="${POSTGRES_TEST_DB:-fulfillos_test}"
TEST_USER="${POSTGRES_TEST_USER:-fulfillos_test}"
TEST_PASSWORD="${POSTGRES_TEST_PASSWORD:-fulfillos_test}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE "${TEST_USER}" WITH LOGIN PASSWORD '${TEST_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    CREATE DATABASE "${TEST_DB}" OWNER "${TEST_USER}";
    REVOKE ALL ON DATABASE "${POSTGRES_DB}" FROM "${TEST_USER}";
    REVOKE CONNECT ON DATABASE "${POSTGRES_DB}" FROM PUBLIC;
    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${POSTGRES_USER}";
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$TEST_DB" <<-EOSQL
    GRANT ALL ON SCHEMA public TO "${TEST_USER}";
    ALTER SCHEMA public OWNER TO "${TEST_USER}";
EOSQL
