# nginx site for the dev server, at /etc/nginx/sites-available/openreel.zackmurry.com
# (installed by hand, not by the deploy job; see ../README.md). Certbot adds the
# 443 block:
#   certbot --nginx -d openreel.zackmurry.com
#
# One hostname until openreel.social DNS exists, so the PDS owns the root (it
# must: its DID documents point at https://<host>/) and the other public
# services sit under path prefixes. Ports match ../compose.yaml.
# WebSocket upgrade only when the client asks for one. Prefixed because sites
# share the http context and nothing else on the server defines this map.
map $http_upgrade $openreel_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name openreel.zackmurry.com;

    # PDS blob uploads.
    client_max_body_size 100m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Private PLC directory, read-only from outside: clients resolve
    # /plc/did:plc:... here, and only the PDS (internally) may write.
    location /plc/ {
        limit_except GET HEAD { deny all; }
        proxy_pass http://127.0.0.1:4101/;
    }

    location /appview/ {
        proxy_pass http://127.0.0.1:4102/;
    }

    location /feedgen/ {
        proxy_pass http://127.0.0.1:4103/;
    }

    # PDS: XRPC, OAuth, /.well-known, and the subscribeRepos WebSocket.
    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $openreel_connection_upgrade;
        proxy_read_timeout 1h;
    }
}
