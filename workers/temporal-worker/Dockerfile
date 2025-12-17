# Autonomous Enterprise Temporal Worker Dockerfile
# Includes Claude Code, Gemini CLI, and Codex CLI tools
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create worker user
RUN useradd -m -s /bin/bash worker

# Install CLI tools globally

# Install Claude Code CLI (using npm)
RUN npm install -g @anthropics/claude-code

# Install Gemini CLI (using npm)
RUN npm install -g @anthropic/gemini-cli || echo "Gemini CLI not available via npm"

# Install Codex CLI (using npm)
RUN npm install -g @openai/codex || echo "Codex CLI not available via npm"

# Alternative: Install via pipx if npm packages don't exist
RUN pip3 install --break-system-packages pipx && \
    pipx ensurepath

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install Node.js dependencies
RUN npm ci

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build || true

# Create directories for CLI configs and workspaces
RUN mkdir -p /home/worker/.claude \
    /home/worker/.gemini \
    /home/worker/.codex \
    /workspaces

# Change ownership
RUN chown -R worker:worker /app /home/worker /workspaces

# Switch to worker user
USER worker

# Set environment variables
ENV NODE_ENV=production
ENV TEMPORAL_TASK_QUEUE=genesis-queue

# Run the worker
CMD ["node", "dist/worker.js"]
