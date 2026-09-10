#!/usr/bin/env sh
set -eu

# The official image creates POSTGRES_DB (nexoclip) before running this file.
# This marker makes the initialization intent explicit without creating a
# second database; Spite remains on its dedicated Neon database.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c 'SELECT 1'
