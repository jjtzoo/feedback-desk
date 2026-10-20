#!/usr/bin/env bash
# Deploy Feedback to staging or production on Cloud Run (spec v3 D25, D28 to D33;
# company deployment manual §4 to §11, §45 to §47). See docs/deployment.md first.
#
#   ./deploy.sh staging                 build, push, deploy staging from the `staging` branch
#   ./deploy.sh production              same for production from `main`, via a no-traffic candidate
#   ./deploy.sh staging --config-only   no rebuild: re-apply configuration with the current images
#
# Needs: git, docker, gcloud (signed in), and deploy/<env>.env filled in. Prints no secrets.
set -euo pipefail

ENV_NAME="${1:-}"
CONFIG_ONLY="false"
[[ "${2:-}" == "--config-only" ]] && CONFIG_ONLY="true"
if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "production" ]]; then
  echo "Usage: ./deploy.sh staging|production [--config-only]" >&2
  exit 2
fi

cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1090
source "deploy/${ENV_NAME}.env"
set +a

fail() { echo "STOP: $*" >&2; exit 1; }
grep -q "REPLACE" "deploy/${ENV_NAME}.env" && fail "deploy/${ENV_NAME}.env still has REPLACE values."

# --- pre-deployment checks (manual §47) ------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "$DEPLOY_BRANCH" ]] || fail "$ENV_NAME deploys from '$DEPLOY_BRANCH', you are on '$BRANCH'."
[[ -z "$(git status --porcelain)" ]] || fail "Uncommitted changes. Commit (after review) before deploying."
SHA="$(git rev-parse --short HEAD)"
TAG="${ENV_NAME}-${SHA}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
export API_IMAGE="${REGISTRY}/feedback-api:${TAG}"
export WEB_IMAGE="${REGISTRY}/feedback-web:${TAG}"
gcloud projects describe "$PROJECT_ID" --format="value(projectId)" >/dev/null || fail "Can't reach project $PROJECT_ID."

if [[ "$CONFIG_ONLY" == "true" ]]; then
  API_IMAGE="$(gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(spec.template.spec.containers[0].image)')"
  WEB_IMAGE="$(gcloud run services describe "$WEB_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(spec.template.spec.containers[0].image)')"
  export API_IMAGE WEB_IMAGE
fi

cat <<EOF
About to deploy Feedback
  environment     $ENV_NAME
  branch / commit $BRANCH / $SHA
  project         $PROJECT_ID
  region          $REGION
  services        $API_SERVICE, $WEB_SERVICE; job $WORKER_JOB
  images          $API_IMAGE
                  $WEB_IMAGE
  database        $CLOUDSQL_INSTANCE (secret feedback-${ENV_NAME}-database-url)
  bucket          $GCS_BUCKET
  rebuild         $([[ "$CONFIG_ONLY" == "true" ]] && echo "no (configuration only)" || echo yes)
EOF
read -r -p "Type '$ENV_NAME' to continue: " ANSWER
[[ "$ANSWER" == "$ENV_NAME" ]] || fail "Cancelled."

# --- build and push --------------------------------------------------------------------
if [[ "$CONFIG_ONLY" != "true" ]]; then
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  docker build -t "$API_IMAGE" --label "project=feedback" --label "environment=$ENV_NAME" --label "git-sha=$SHA" backend
  docker build -t "$WEB_IMAGE" --label "project=feedback" --label "environment=$ENV_NAME" --label "git-sha=$SHA" web
  docker push "$API_IMAGE"
  docker push "$WEB_IMAGE"
fi

# --- render the YAML for review --------------------------------------------------------
OUT="deploy/rendered/${ENV_NAME}"
mkdir -p "$OUT"
PYTHON="$(command -v python3 || command -v python)"
render() {  # render <template> <output>: fill ${VAR} from the environment
  "$PYTHON" - "$1" "$2" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
missing = sorted({m for m in re.findall(r"\$\{([A-Z_]+)\}", text) if m not in os.environ})
if missing:
    sys.exit(f"Missing values: {', '.join(missing)}")
open(dst, "w", encoding="utf-8").write(re.sub(r"\$\{([A-Z_]+)\}", lambda m: os.environ[m.group(1)], text))
PY
}

current_revision() {
  gcloud run services describe "$1" --project "$PROJECT_ID" --region "$REGION" \
    --format='value(status.traffic[0].revisionName)' 2>/dev/null || true
}

traffic_block() {  # production keeps traffic on the current revision; the new one is a candidate
  local current="$1"
  if [[ "$ENV_NAME" == "production" && -n "$current" ]]; then
    printf '  traffic:\n    - revisionName: %s\n      percent: 100\n    - latestRevision: true\n      percent: 0\n      tag: candidate\n' "$current"
  else
    printf '  traffic:\n    - latestRevision: true\n      percent: 100\n'
  fi
}

API_CURRENT="$(current_revision "$API_SERVICE")"
WEB_CURRENT="$(current_revision "$WEB_SERVICE")"

export TRAFFIC_BLOCK
TRAFFIC_BLOCK="$(traffic_block "$API_CURRENT")"
render deploy/api.service.yaml "$OUT/api.service.yaml"
render deploy/worker.job.yaml "$OUT/worker.job.yaml"

# --- deploy the API and the worker job -------------------------------------------------
gcloud run services replace "$OUT/api.service.yaml" --project "$PROJECT_ID" --region "$REGION"
gcloud run jobs replace "$OUT/worker.job.yaml" --project "$PROJECT_ID" --region "$REGION"

API_URL="$(gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
export API_URL
TRAFFIC_BLOCK="$(traffic_block "$WEB_CURRENT")"
render deploy/web.service.yaml "$OUT/web.service.yaml"
gcloud run services replace "$OUT/web.service.yaml" --project "$PROJECT_ID" --region "$REGION"

# --- scheduler: start the worker job every minute ----------------------------------------
JOB_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${WORKER_JOB}:run"
if gcloud scheduler jobs describe "$SCHEDULER_JOB" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  ACTION=update
else
  ACTION=create
fi
gcloud scheduler jobs "$ACTION" http "$SCHEDULER_JOB" --project "$PROJECT_ID" --location "$REGION" \
  --schedule "* * * * *" --time-zone "Australia/Sydney" --uri "$JOB_URI" --http-method POST \
  --oauth-service-account-email "$SCHEDULER_SA"

# --- verification (manual §45) -----------------------------------------------------------
check_health() {  # check_health <url>
  local body
  body="$(curl -fsS --max-time 30 "$1/api/health")" || fail "Health check failed at $1."
  echo "$body" | grep -q '"database":"ok"' || fail "Database not ok at $1: $body"
  echo "Health ok at $1"
}
candidate_url() {  # the tagged no-traffic revision's own URL
  gcloud run services describe "$1" --project "$PROJECT_ID" --region "$REGION" \
    --format='value(status.traffic[].url)' | tr ';' '\n' | grep candidate || true
}
if [[ "$ENV_NAME" == "production" && -n "$API_CURRENT" ]]; then
  API_CANDIDATE="$(candidate_url "$API_SERVICE")"
  WEB_CANDIDATE="$(candidate_url "$WEB_SERVICE")"
  [[ -n "$API_CANDIDATE" ]] && check_health "$API_CANDIDATE"
  [[ -n "$WEB_CANDIDATE" ]] && curl -fsS --max-time 30 -o /dev/null "$WEB_CANDIDATE/" && echo "Web candidate loads at $WEB_CANDIDATE"
  echo "Note: until traffic moves, the web candidate still talks to the live API."
  echo "Check the API candidate's health above, then the web candidate in a browser."
  read -r -p "Move 100% of production traffic to the new revisions? Type 'yes': " GO
  [[ "$GO" == "yes" ]] || { echo "Traffic left on $API_CURRENT / $WEB_CURRENT."; exit 0; }
  gcloud run services update-traffic "$API_SERVICE" --to-latest --project "$PROJECT_ID" --region "$REGION"
  gcloud run services update-traffic "$WEB_SERVICE" --to-latest --project "$PROJECT_ID" --region "$REGION"
  echo "Rollback if needed:"
  echo "  gcloud run services update-traffic $API_SERVICE --to-revisions $API_CURRENT=100 --project $PROJECT_ID --region $REGION"
  echo "  gcloud run services update-traffic $WEB_SERVICE --to-revisions $WEB_CURRENT=100 --project $PROJECT_ID --region $REGION"
fi
WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
check_health "$WEB_URL"
echo "Deployed $TAG. Finish the post-deployment verification in docs/deployment.md."
