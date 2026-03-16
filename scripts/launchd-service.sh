#!/bin/bash
# launchd-service.sh — Install, uninstall, or check status of the Koncierge launchd service
#
# Usage:
#   ./scripts/launchd-service.sh install     # Install and start the service
#   ./scripts/launchd-service.sh uninstall   # Stop and remove the service
#   ./scripts/launchd-service.sh status      # Check if the service is running
#   ./scripts/launchd-service.sh logs        # Tail the service logs

set -euo pipefail

LABEL="dev.kapable.koncierge"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
BUN_PATH="$(which bun)"

# Resolve .env path
ENV_FILE="$PROJECT_DIR/.env"

cmd_install() {
  echo "Installing Koncierge launchd service..."

  # Verify .env exists
  if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill in values."
    exit 1
  fi

  # Source .env to get values for the plist
  set -a
  source "$ENV_FILE"
  set +a

  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY not set in $ENV_FILE"
    exit 1
  fi

  if [ -z "${KONCIERGE_SECRET:-}" ] || [ "$KONCIERGE_SECRET" = "change-me" ]; then
    echo "ERROR: KONCIERGE_SECRET not set or still default in $ENV_FILE"
    exit 1
  fi

  mkdir -p "$LOG_DIR"
  mkdir -p "$(dirname "$PLIST_PATH")"

  # Unload if already loaded
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

  cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${BUN_PATH}</string>
    <string>run</string>
    <string>src/server.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>ANTHROPIC_API_KEY</key>
    <string>${ANTHROPIC_API_KEY}</string>
    <key>KONCIERGE_SECRET</key>
    <string>${KONCIERGE_SECRET}</string>
    <key>PORT</key>
    <string>${PORT:-3101}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/koncierge.stdout.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/koncierge.stderr.log</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
PLIST

  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  echo "Service installed and started."
  echo "  Logs: $LOG_DIR/koncierge.{stdout,stderr}.log"
  echo "  Health: curl http://localhost:${PORT:-3101}/health"
}

cmd_uninstall() {
  echo "Uninstalling Koncierge launchd service..."
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "Service removed."
}

cmd_status() {
  if launchctl print "gui/$(id -u)/${LABEL}" &>/dev/null; then
    echo "Service is LOADED"
    # Try health check
    if curl -sf "http://localhost:${PORT:-3101}/health" >/dev/null 2>&1; then
      echo "Health check: OK"
      curl -sf "http://localhost:${PORT:-3101}/health" | python3 -m json.tool 2>/dev/null || true
    else
      echo "Health check: FAILED (server may be starting)"
    fi
  else
    echo "Service is NOT loaded"
  fi
}

cmd_logs() {
  if [ -d "$LOG_DIR" ]; then
    tail -f "$LOG_DIR"/koncierge.*.log
  else
    echo "No log directory found at $LOG_DIR"
    exit 1
  fi
}

case "${1:-help}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  *)
    echo "Usage: $0 {install|uninstall|status|logs}"
    exit 1
    ;;
esac
