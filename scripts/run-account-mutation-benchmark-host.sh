#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./test-integration-ci-lib.sh
source "${SCRIPT_DIR}/test-integration-ci-lib.sh"

INTEGRATION_CI_MODE="benchmark"
cd "$REPO_ROOT"
require_docker_cli
require_node_cli
require_docker_daemon
require_docker_credentials_helper
detect_compose_bin
trap cleanup EXIT

log_ci "Starting isolated Postgres/Redis benchmark stack..."
CI_DB_PORT="$CI_DB_PORT" CI_REDIS_PORT="$CI_REDIS_PORT" compose up -d
wait_for_postgres
wait_for_redis
TEST_HOST="$(resolve_host_mode_target)"
wait_for_host_ports "$TEST_HOST"

VAKWEN_MANAGED_CI_STACK=1 \
POSTGRES_PERSISTENCE_SKIP_REDIS_INIT=1 \
POSTGRES_TEST_DB_URL="postgres://app:app@${TEST_HOST}:${CI_DB_PORT}/${CI_DB_NAME}?connect_timeout=${CI_DB_CONNECT_TIMEOUT_SECONDS}" \
POSTGRES_TEST_REDIS_URL="redis://${TEST_HOST}:${CI_REDIS_PORT}" \
npx tsx apps/api/test/benchmarks/accountMutationPostgres.ts
