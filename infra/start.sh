#!/bin/bash
# Autonomous Enterprise - Local Infrastructure Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Autonomous Enterprise - Local Infra  ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}No .env file found. Creating from .env.example...${NC}"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${YELLOW}Please edit .env with your API keys before running production workloads.${NC}"
    else
        echo -e "${RED}No .env.example found!${NC}"
        exit 1
    fi
fi

# Check for CLI OAuth tokens
check_cli_auth() {
    local cli_name=$1
    local config_dir=$2

    if [ -d "$HOME/$config_dir" ]; then
        echo -e "${GREEN}✓ $cli_name config found${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠ $cli_name config not found at ~/$config_dir${NC}"
        echo -e "  Run '$cli_name' once to authenticate via OAuth"
        return 1
    fi
}

echo "Checking CLI authentication..."
echo ""
check_cli_auth "Claude Code" ".claude" || true
check_cli_auth "Gemini CLI" ".gemini" || true
check_cli_auth "Codex CLI" ".codex" || true
echo ""

# Create Temporal dynamic config
mkdir -p temporal
if [ ! -f temporal/dynamicconfig.yaml ]; then
    cat > temporal/dynamicconfig.yaml << 'EOF'
# Temporal Dynamic Configuration
# See: https://docs.temporal.io/references/dynamic-configuration

# Allow long-running workflows
limit.maxIDLength:
  - value: 1000
    constraints: {}

# Increase history size for complex workflows
history.maximumPageSize:
  - value: 250
    constraints: {}

# Enable activity local dispatch for better performance
frontend.enableActivityLocalDispatch:
  - value: true
    constraints: {}
EOF
    echo -e "${GREEN}Created Temporal dynamic config${NC}"
fi

# Parse arguments
SERVICES=""
DETACH="-d"
BUILD=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --fg|--foreground)
            DETACH=""
            shift
            ;;
        --build)
            BUILD="--build"
            shift
            ;;
        --infra)
            SERVICES="postgres redis temporal temporal-ui phoenix"
            shift
            ;;
        --all)
            SERVICES=""
            shift
            ;;
        *)
            SERVICES="$SERVICES $1"
            shift
            ;;
    esac
done

echo ""
echo "Starting services..."
echo ""

# Start Docker Compose
if [ -n "$SERVICES" ]; then
    docker compose up $DETACH $BUILD $SERVICES
else
    docker compose up $DETACH $BUILD
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Services Started Successfully!        ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Access points:"
echo "  - API Server:     http://localhost:8000"
echo "  - API Docs:       http://localhost:8000/docs"
echo "  - Temporal UI:    http://localhost:8080"
echo "  - Phoenix:        http://localhost:6006"
echo ""
echo "Commands:"
echo "  - View logs:      docker compose logs -f"
echo "  - Stop all:       docker compose down"
echo "  - Stop + clean:   docker compose down -v"
echo ""
