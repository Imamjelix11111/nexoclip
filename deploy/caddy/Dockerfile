FROM caddy:2.10

ENV XDG_DATA_HOME=/tmp/caddy/data \
    XDG_CONFIG_HOME=/tmp/caddy/config

COPY --chown=1001:1001 deploy/caddy/Caddyfile /etc/caddy/Caddyfile

RUN setcap -r /usr/bin/caddy

USER 1001:1001
EXPOSE 8080
