FROM node:23.3.0-slim

# Install essential dependencies for the build process
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    g++ \
    git \
    make \
    python3 \
    unzip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*



# Install bun globally with npm
RUN npm install -g bun

# Add bun global bin to PATH for root and node users
ENV PATH="/root/.bun/bin:/home/node/.bun/bin:$PATH"

# Create a wrapper script for elizaos that uses the local installation
RUN echo '#!/bin/bash\nexec /app/node_modules/.bin/elizaos "$@"' > /usr/local/bin/elizaos && \
    chmod +x /usr/local/bin/elizaos

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy the rest of the application
COPY . .

# Build the application
RUN bun run build

# Change ownership of the app directory to node user
RUN chown -R node:node /app

# Create node user's bun directory
RUN mkdir -p /home/node/.bun && chown -R node:node /home/node/.bun

# Note: Keeping as root user for eigenx deployment compatibility


# Environment variables that should be provided at runtime
ARG POSTGRES_URL
ARG OPENAI_API_KEY
ARG DISCORD_APPLICATION_ID
ARG DISCORD_API_TOKEN
ARG TELEGRAM_BOT_TOKEN
ARG CLANKER_API_KEY
ARG CHANNEL_IDS
ARG BASE_RPC_URL
ARG OPENAI_BASE_URL
ARG OPENAI_SMALL_MODEL
ARG OPENAI_LARGE_MODEL
ARG OPENAI_EMBEDDING_URL
ARG OPENAI_EMBEDDING_API_KEY

# Convert ARGs to ENV variables for runtime access
ENV POSTGRES_URL=${POSTGRES_URL}
ENV OPENAI_API_KEY=${OPENAI_API_KEY}
ENV DISCORD_APPLICATION_ID=${DISCORD_APPLICATION_ID}
ENV DISCORD_API_TOKEN=${DISCORD_API_TOKEN}
ENV TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
ENV CLANKER_API_KEY=${CLANKER_API_KEY}
ENV CHANNEL_IDS=${CHANNEL_IDS}
ENV BASE_RPC_URL=${BASE_RPC_URL}
ENV OPENAI_BASE_URL=${OPENAI_BASE_URL}
ENV OPENAI_SMALL_MODEL=${OPENAI_SMALL_MODEL}
ENV OPENAI_LARGE_MODEL=${OPENAI_LARGE_MODEL}
ENV OPENAI_EMBEDDING_URL=${OPENAI_EMBEDDING_URL}
ENV OPENAI_EMBEDDING_API_KEY=${OPENAI_EMBEDDING_API_KEY}

# Expose port (adjust if needed based on your application)
EXPOSE 3000


# Start the application
CMD ["elizaos", "start"]
