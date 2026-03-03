# Deployment Guide

## Prerequisites

Before deploying, ensure the following tools are installed:

- Docker 24.0 or later
- kubectl 1.28 or later
- Helm 3.14 or later

You must also have cluster-admin access to the target Kubernetes cluster.

## Building the Image

Build the container image using the project Dockerfile:

```bash
docker build -t myapp:latest .
```

For production builds, always pin the base image digest and enable BuildKit:

```bash
DOCKER_BUILDKIT=1 docker build \
  --build-arg BASE_IMAGE=node:20-alpine@sha256:abc123 \
  -t registry.example.com/myapp:v2.4.1 .
```

## Deploying to Staging

Push the image to your container registry, then deploy with Helm:

```bash
helm upgrade --install myapp ./charts/myapp \
  --namespace staging \
  --set image.tag=v2.4.1 \
  --set replicas=2
```

Health checks are configured to probe `/healthz` every 15 seconds.

## Rolling Updates

The deployment uses a rolling update strategy with `maxSurge: 1` and `maxUnavailable: 0`.
This ensures zero downtime during updates by keeping all existing pods available
until the new revision passes readiness probes.

## Rollback Procedure

If the new version fails health checks, roll back immediately:

```bash
helm rollback myapp 0 --namespace staging
```

Review the rollback checklist before restoring a previous version:

1. Verify database migrations are backward-compatible.
2. Confirm no breaking API contract changes were published.
3. Notify dependent services of the version change.
4. Update the incident log with rollback details.

## Monitoring

After deployment, verify the following metrics in Grafana:

- Request latency p99 < 200ms
- Error rate < 0.1%
- Pod restart count = 0 within 10 minutes

Alerts fire automatically if thresholds are breached for more than 5 minutes.
