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

    # HLS renditions from the media service (media-cdn container).
    location /media/ {
        proxy_pass http://127.0.0.1:4106/;
    }

    # OAuth client metadata for Debug iOS builds signing in here
    # (apps/ios/Sources/OpenReel/Auth/AppAuthConfiguration.swift). The PDS
    # fetches it by its URL, the client_id. Exact match, so it wins over the
    # PDS's /oauth/ routes below. The redirect scheme is this host reversed,
    # as the atproto OAuth profile requires for native clients.
    location = /oauth/ios-client-metadata.json {
        default_type application/json;
        add_header Cache-Control "public, max-age=300";
        return 200 '{"client_id":"https://openreel.zackmurry.com/oauth/ios-client-metadata.json","client_name":"OpenReel for iOS (dev server)","client_uri":"https://openreel.zackmurry.com","application_type":"native","redirect_uris":["com.zackmurry.openreel:/oauth/callback"],"scope":"atproto transition:generic","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none","dpop_bound_access_tokens":true}';
    }

    # PDS: XRPC, OAuth, /.well-known, and the subscribeRepos WebSocket.
    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $openreel_connection_upgrade;
        proxy_read_timeout 1h;
    }
}
