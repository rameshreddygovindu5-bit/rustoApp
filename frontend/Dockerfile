# ════════════════════════════════════════════════════════════════════
# Frontend Dockerfile — supports both PMS and Customer portal builds
#
# Build args:
#   PORTAL   = pms | customer | combined (default: combined)
#   VITE_API_URL = /api  (default)
#
# Examples:
#   PMS portal:      docker build --build-arg PORTAL=pms -t rusto-pms .
#   Customer portal: docker build --build-arg PORTAL=customer -t rusto-customer .
#   Combined:        docker build -t rusto-combined .
# ════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS build

WORKDIR /app

# Build arguments
ARG PORTAL=combined
ARG VITE_API_URL=/api
ARG VITE_API_BASE=

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_BASE=$VITE_API_BASE

# Cache dependencies separately
COPY package*.json ./
RUN npm ci --prefer-offline

# Copy all source
COPY . .

# Choose the correct build target based on PORTAL arg
RUN if [ "$PORTAL" = "pms" ]; then \
      echo "Building PMS portal..." && npm run build:pms; \
    elif [ "$PORTAL" = "customer" ]; then \
      echo "Building Customer portal..." && npm run build:customer; \
    else \
      echo "Building combined portal..." && npm run build; \
    fi

# Resolve output directory
RUN if [ "$PORTAL" = "pms" ]; then \
      cp -r dist-pms dist-final; \
    elif [ "$PORTAL" = "customer" ]; then \
      cp -r dist-customer dist-final; \
    else \
      cp -r dist dist-final; \
    fi

# ── Production stage ─────────────────────────────────────────────────
FROM nginx:1.25-alpine

# Copy built assets
COPY --from=build /app/dist-final /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost/ || exit 1
