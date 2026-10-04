#!/bin/sh
# Agent bridge (datatoolkit-issues#148): hand DTK_UI_TOKEN to Studio as
# <meta name="dtk-ui-token"> in index.html at container start, so the token
# never lands in an image layer. Unset or empty: no meta, the bridge stays off.
# Run by the nginx image's /docker-entrypoint.sh before nginx starts.
set -eu

index=${DTK_INDEX_HTML:-/usr/share/nginx/html/index.html}
token=${DTK_UI_TOKEN:-}

# The token goes into an HTML attribute and a sed replacement: allow only
# URL-safe characters (hex, base64, token_urlsafe output all pass).
case "$token" in
    *[!A-Za-z0-9._~+/=-]*)
        echo "$0: DTK_UI_TOKEN has characters outside A-Z a-z 0-9 . _ ~ + / = -; refusing to serve it" >&2
        exit 1
        ;;
esac

if [ -z "$token" ] && ! grep -q 'dtk-ui-token' "$index"; then
    echo "$0: no DTK_UI_TOKEN, agent bridge off"
    exit 0
fi

# Never keep a stale meta: the container may restart with another token, or none.
strip='s#<meta name="dtk-ui-token"[^>]*>##g'
if [ -n "$token" ]; then
    sed -e "$strip" -e "s#</head>#<meta name=\"dtk-ui-token\" content=\"$token\" /></head>#" "$index" > "$index.tmp"
    echo "$0: dtk-ui-token meta injected, agent bridge on"
else
    sed -e "$strip" "$index" > "$index.tmp"
    echo "$0: no DTK_UI_TOKEN, stale dtk-ui-token meta removed, agent bridge off"
fi
cat "$index.tmp" > "$index"
rm -f "$index.tmp"
