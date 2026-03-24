FROM node:20-alpine

# Install system dependencies for headless browser + VNC streaming
RUN apk add --no-cache \
    # Chromium
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ttf-opensans \
    libstdc++ \
    libgcc \
    # Virtual display
    xvfb \
    dbus \
    udev \
    # VNC server
    x11vnc \
    # Python for websockify
    python3 \
    py3-pip \
    py3-numpy \
    # noVNC dependencies
    bash \
    wget \
    git \
    # Process management
    supervisor

# Install websockify via pip
RUN pip3 install --break-system-packages websockify

# Install noVNC
RUN mkdir -p /usr/share/novnc && \
    wget -q https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz -O /tmp/novnc.tar.gz && \
    tar -xzf /tmp/novnc.tar.gz -C /tmp && \
    cp -r /tmp/noVNC-1.4.0/* /usr/share/novnc/ && \
    rm -rf /tmp/novnc.tar.gz /tmp/noVNC-1.4.0

# Set environment variables
ENV DISPLAY=:99
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV SESSIONS_PATH=/sessions
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci && npm prune --production

# Copy built app
COPY dist ./dist
COPY scripts ./scripts
COPY src/public ./dist/public

# Create sessions directory (will be overridden by EFS mount in ECS)
RUN mkdir -p /sessions

EXPOSE 3000
# noVNC WebSocket ports (6080-6129 for up to 50 concurrent sessions)
EXPOSE 6080-6129

CMD ["node", "dist/index.js"]
