#!/bin/sh
# Runs once, only when the postgres container initializes an empty data directory (per the
# official postgres image's docker-entrypoint-initdb.d convention). Creates a second,
# separate database for integration tests alongside the development database, so tests never
# run against development data.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE ${POSTGRES_TEST_DB:-fulfillos_test};
EOSQL
