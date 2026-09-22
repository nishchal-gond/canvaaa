FROM node:20-bookworm-slim

# Install system dependencies: Python3, pip, ffmpeg, poppler
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python virtualenv
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies from backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies from backend
COPY backend/package*.json ./
RUN npm install --omit=dev

# Copy backend application code
COPY backend/ .

# Ensure upload directories exist
RUN mkdir -p uploads/docs uploads/videos uploads/slides uploads/thumbnails

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

CMD ["node", "src/server.js"]
