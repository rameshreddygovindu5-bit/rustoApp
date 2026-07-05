#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  enable-tls.sh — obtain a Let's Encrypt certificate and turn on HTTPS.
#  Run ONCE per box after DNS for your domain points at the box's IP.
#
#  Prerequisites:
#    • The app stack is already running (nginx on port 80 reachable).
#    • Your domain's A record points at this box's public IP.
#    • Ports 80 AND 443 are open in the security group (Terraform already
#      opens both).
#
#  Usage (on the EC2 box, in the app dir):
#    DOMAIN=lms.example.com EMAIL=you@example.com bash enable-tls.sh
#
#  It uses a one-shot certbot container against the webroot nginx already
#  serves (/.well-known/acme-challenge), writes the cert into the
#  lms_certs volume, drops in an HTTPS server block, and reloads nginx.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=lms.example.com}"
: "${EMAIL:?Set EMAIL, e.g. EMAIL=you@example.com}"
APP_DIR="${APP_DIR:-/opt/rusto}"
COMPOSE="docker-compose.deploy.yml"

cd "$APP_DIR"

echo "▶ Requesting certificate for ${DOMAIN} ..."
# certbot writes to /etc/letsencrypt (the lms_certs volume) and validates
# via the webroot that nginx serves at /var/www/certbot.
docker run --rm \
  -v lms_certs:/etc/letsencrypt \
  -v lms_certbot_web:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" --email "${EMAIL}" --agree-tos --no-eff-email --non-interactive

echo "▶ Writing HTTPS server block ..."
# Append an HTTPS server + redirect HTTP→HTTPS. server_name is set to the
# real domain now (the port-80 block keeps its ACME location for renewals).
cat > nginx/conf.d/https.conf <<EOF
server {
    listen 443 ssl;
    http2 on;
    server_name ${DOMAIN};
    client_max_body_size 25M;

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location /api/ {
        proxy_pass http://lms_backend;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering   off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
    location /uploads/ { proxy_pass http://lms_backend; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
    location = /health { proxy_pass http://lms_backend/api/health; access_log off; }
    location / {
        proxy_pass http://lms_frontend;
        proxy_set_header Host              \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

echo "▶ Adding HTTP→HTTPS redirect ..."
# Turn the port-80 server into a redirect (keeping the ACME location).
# We only redirect once a cert exists, to avoid locking ourselves out.
cat > nginx/conf.d/redirect.conf <<EOF
server {
    listen 80 default_server;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
EOF
# Disable the old catch-all :80 block so it doesn't conflict with the
# redirect block above (both listen on 80 default_server).
if [ -f nginx/conf.d/default.conf ]; then
  mv nginx/conf.d/default.conf nginx/conf.d/default.conf.disabled
fi

echo "▶ Reloading nginx ..."
docker compose -f "$COMPOSE" --env-file .env exec -T nginx nginx -s reload \
  || docker compose -f "$COMPOSE" --env-file .env restart nginx

echo
echo "✓ HTTPS enabled for https://${DOMAIN}"
echo "  Set up auto-renewal (cron/systemd) with:"
echo "    docker run --rm -v lms_certs:/etc/letsencrypt -v lms_certbot_web:/var/www/certbot certbot/certbot renew"
