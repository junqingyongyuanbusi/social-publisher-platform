#!/bin/bash
set -euo pipefail

: "${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD is required}"
: "${KEYCLOAK_OWNER_PASSWORD:?KEYCLOAK_OWNER_PASSWORD is required}"

KCADM=/opt/keycloak/bin/kcadm.sh
SERVER=http://keycloak:8080
REALM=social-publisher

"$KCADM" config credentials \
  --server "$SERVER" \
  --realm master \
  --user admin \
  --password "$KEYCLOAK_ADMIN_PASSWORD"

if ! "$KCADM" get users -r "$REALM" -q exact=true -q username=owner | grep -q '"username" : "owner"'; then
  "$KCADM" create users -r "$REALM" \
    -s username=owner \
    -s email=owner@localhost \
    -s emailVerified=true \
    -s enabled=true \
    -s firstName=Local \
    -s lastName=Owner
fi

"$KCADM" set-password -r "$REALM" \
  --username owner \
  --new-password "$KEYCLOAK_OWNER_PASSWORD" \
  --temporary
"$KCADM" add-roles -r "$REALM" --uusername owner --rolename owner
