FROM quay.io/keycloak/keycloak:26.7.0 AS builder

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.7.0
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY --chown=keycloak:keycloak social-publisher-realm.json /opt/keycloak/data/import/social-publisher-realm.json
COPY --chown=keycloak:keycloak --chmod=755 bootstrap-owner.sh /opt/keycloak/bin/bootstrap-owner.sh
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
