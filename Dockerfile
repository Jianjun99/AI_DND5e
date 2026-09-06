# AI D&D — game server in a container.
# Build:  docker build -t ai-dnd .
# Run:    docker run -p 3000:3000 -v ai-dnd-data:/app/data ai-dnd
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# App code
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY content ./content

# Persist characters, saves and settings here (mount a volume)
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/index.js"]
