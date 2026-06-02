FROM node:18-alpine AS build

WORKDIR /app

# Build-time configuration (Vite bakes env vars into the bundle)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Copy package files first for better layer caching
COPY package*.json ./

# Use clean install for reproducible builds; falls back to install if no lockfile
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source code
COPY . .

# Build the application
RUN npm run build


# ── Production stage ─────────────────────────────────────────────────
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Default nginx CMD already runs as `nginx -g "daemon off;"`
