# TSG: HTTPRoute Not Accepted by Cilium Gateway

## Symptom

- HTTPRoute exists in cluster but has **no `.status`** field
- ArgoCD shows HTTPRoute as OutOfSync
- Requests to the gateway IP return `404 Not Found` for the route's hostname
- DNS record never created by external-dns (depends on HTTPRoute status)

## Root Cause

The Cilium operator's Gateway API controller failed to initialize on startup due to TLS handshake timeouts when checking for required GatewayAPI CRDs. When this happens, the operator **silently stops watching HTTPRoutes** — existing routes keep working (cached in envoy) but new routes are never reconciled.

### Error signature in Cilium operator logs

```
level=error msg="Required GatewayAPI resources are not found, please refer to docs for installation instructions"
  module=operator.operator-controlplane.leader-lifecycle.gateway-api
  error="Get \"https://localhost:7445/apis/apiextensions.k8s.io/v1/customresourcedefinitions/gatewayclasses.gateway.networking.k8s.io\":
  net/http: TLS handshake timeout..."
level=info msg=Invoked duration=30.012135689s function="gateway-api.initGatewayAPIController (pkg/gateway-api/cell.go:210)"
```

## Diagnosis Steps

1. **Check if the HTTPRoute has status:**
   ```bash
   kubectl get httproute <name> -n <ns> -o jsonpath='{.status}'
   ```
   Empty output = Cilium isn't watching.

2. **Compare attached routes vs total routes:**
   ```bash
   # Gateway says N routes attached
   kubectl get gateway cilium-gateway -n kube-system -o jsonpath='{.status.listeners[*].attachedRoutes}'

   # But there are more HTTPRoutes in the cluster
   kubectl get httproute -A --no-headers | wc -l
   ```
   If the counts don't match, Cilium missed some routes.

3. **Check Cilium operator logs for gateway-api init failure:**
   ```bash
   kubectl logs -n kube-system -l app.kubernetes.io/name=cilium-operator | grep -i "gateway-api\|initGateway"
   ```
   Look for `TLS handshake timeout` or `Required GatewayAPI resources are not found`.

## Resolution

Restart the Cilium operator to force re-initialization of the gateway-api controller:

```bash
kubectl rollout restart deployment cilium-operator -n kube-system
```

Verify recovery:
```bash
# Wait ~30s then check logs for successful reconciliation
kubectl logs -n kube-system -l app.kubernetes.io/name=cilium-operator --since=1m | grep "Successfully reconciled Gateway"

# Confirm HTTPRoute now has status
kubectl get httproute <name> -n <ns> -o jsonpath='{.status.parents[0].conditions[0].reason}'
# Expected: "Accepted"
```

## Prevention & Detection

### Monitoring (add to your Prometheus/Grafana stack)

**Alert: HTTPRoute missing status after 5 minutes**

```yaml
# PrometheusRule
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: gateway-api-alerts
  namespace: monitoring
spec:
  groups:
    - name: gateway-api
      rules:
        - alert: HTTPRouteNotAccepted
          expr: |
            (time() - kube_httproute_created) > 300
            AND ON(httproute, namespace)
            kube_httproute_status_parent_info == 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "HTTPRoute {{ $labels.namespace }}/{{ $labels.httproute }} not accepted after 5 minutes"
            runbook_url: "https://github.com/camcast3/walkthrough-app/blob/main/docs/tsg-httproute-not-accepted.md"
```

> **Note:** If kube-state-metrics doesn't expose HTTPRoute metrics in your version, use the script-based approach below instead.

### Health check script (run as CronJob)

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: gateway-api-healthcheck
  namespace: monitoring
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: gateway-healthcheck
          containers:
            - name: check
              image: bitnami/kubectl:latest
              command:
                - /bin/sh
                - -c
                - |
                  ROUTES=$(kubectl get httproute -A -o json | jq '[.items[] | select(.status.parents == null or (.status.parents | length) == 0)] | length')
                  if [ "$ROUTES" -gt "0" ]; then
                    echo "ALERT: $ROUTES HTTPRoute(s) have no accepted status"
                    exit 1
                  fi
                  echo "OK: All HTTPRoutes accepted"
          restartPolicy: Never
```

### Cilium operator startup probe

Add a startup check to the Cilium Helm values to ensure gateway-api initializes:

```yaml
# In cilium Helm values
operator:
  extraArgs:
    - --gateway-api-controller-status-address=:9878
  startupProbe:
    httpGet:
      path: /healthz
      port: 9878
    failureThreshold: 30
    periodSeconds: 10
```

### Manual spot-check

After any Cilium operator restart or node reboot, run:

```bash
# Quick health check — all HTTPRoutes should have "Accepted" status
kubectl get httproute -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,ACCEPTED:.status.parents[0].conditions[0].reason'
```

Expected output — every route shows `Accepted`:
```
NAMESPACE      NAME                 ACCEPTED
argocd         argocd-server        Accepted
kube-system    hubble-ui            Accepted
monitoring     grafana              Accepted
walkthroughs   walkthrough-server   Accepted
```

## Timeline (2026-04-30 incident)

| Time | Event |
|------|-------|
| ~10:48 UTC | Cilium operator restarted, gateway-api init failed (TLS timeout) |
| 06:51 UTC+0 (next day) | walkthrough-app deployed, HTTPRoute created |
| 06:51 | HTTPRoute has no status — Cilium not watching |
| 07:06 | Cilium operator restarted manually, gateway-api init succeeds |
| 07:06 | HTTPRoute accepted, traffic flowing |
