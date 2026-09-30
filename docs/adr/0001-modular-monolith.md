# 0001. Modular monolith on Next.js and Postgres

Status: accepted (Phase 1)

## Context

One person builds and runs this. Microservices would add network failure modes and operational cost without adding capacity at our scale (design target: 5,000 restaurants, about 150 order writes per second at peak).

## Decision

One deployable web/API app (Next.js, TypeScript strict) and one Postgres database. Business logic that must be exactly right (money, order state, pricing) lives in framework-free packages (`packages/domain`) with heavy tests. Modules communicate through typed interfaces so one can be extracted later if load demands it.

## Consequences

Simple deploys and debugging. The database is the scaling bottleneck, so we plan for pooling, read replicas and partitioning of `orders` (Phase 7) before splitting services.
