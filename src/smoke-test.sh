#!/usr/bin/env bash
# Manual smoke test — requires ANTHROPIC_API_KEY to be set and server running
# Usage: ANTHROPIC_API_KEY=sk-ant-... bun run dev & sleep 2 && bash src/smoke-test.sh

PORT="${KONCIERGE_PORT:-3033}"
BASE="http://localhost:${PORT}"

echo "=== Health Check ==="
curl -s "$BASE/health" | jq .
echo ""

echo "=== Streaming Message (SSE) ==="
echo "Sending: 'What is the Data API?' with route_context '/dashboard'"
echo "---"
curl -N -s "$BASE/v1/koncierge/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token" \
  -d '{"message": "What is the Data API?", "route_context": "/dashboard"}' \
  --max-time 15
echo ""
echo "=== Done ==="
