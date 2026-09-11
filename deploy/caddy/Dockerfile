FROM caddy:2.10-alpine

COPY --chown=1001:1001 deploy/caddy/Caddyfile /etc/caddy/Caddyfile

USER 1001:1001
EXPOSE 8080
