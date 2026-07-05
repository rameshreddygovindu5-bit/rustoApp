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

# Resolve output directory and normalise the entry file to index.html.
# The portal builds emit index-customer.html / index-pms.html (their vite
# entry points). The nginx base image ships its own stock index.html (the
# "Welcome to nginx" page), so we must OVERWRITE it (cp -f), not just place
# the portal file alongside — otherwise nginx serves the welcome page.
#
# PMS is served under /pms (base: '/pms/'), so its files live in a pms/
# subdir and reference /pms/assets/... — this keeps its assets from
# colliding with the customer portal's /assets/ at the outer nginx.
RUN if [ "$PORTAL" = "pms" ]; then \
      mkdir -p dist-final/pms; \
      cp -r dist-pms/* dist-final/pms/; \
      [ -f dist-final/pms/index-pms.html ] && cp -f dist-final/pms/index-pms.html dist-final/pms/index.html || true; \
    elif [ "$PORTAL" = "customer" ]; then \
      cp -r dist-customer dist-final; \
      [ -f dist-final/index-customer.html ] && cp -f dist-final/index-customer.html dist-final/index.html || true; \
    else \
      cp -r dist dist-final; \
    fi

# ── Production stage ─────────────────────────────────────────────────
FROM nginx:1.25-alpine

# Copy built assets
COPY --from=build /app/dist-final /usr/share/nginx/html

# Copy nginx configuration — PMS serves under /pms/ so it needs its own
# config; the customer/combined portals use the default static config.
ARG PORTAL=combined
COPY nginx.conf     /tmp/nginx-default.conf
COPY nginx-pms.conf /tmp/nginx-pms.conf
RUN if [ "$PORTAL" = "pms" ]; then \
      cp /tmp/nginx-pms.conf /etc/nginx/conf.d/default.conf; \
    else \
      cp /tmp/nginx-default.conf /etc/nginx/conf.d/default.conf; \
    fi

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost/ || exit 1
