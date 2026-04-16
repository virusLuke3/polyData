# 001 - Architecture Boundaries

Status: pending  
Priority: P1

## Goal

Separate product code from command scripts without breaking current runtime entrypoints.

## Motivation

The current `scripts/` directory contains API code, DB helpers, pipeline workers, runtime providers, and operational scripts. This made sense early on, but it now hides important ownership boundaries.

## Target Direction

Introduce these long-term boundaries:

- `api/` for Flask app construction, routes, services, clients, and API config.
- `core/` for DB access, Polymarket domain logic, serialization, and shared clients.
- `pipelines/` for market, trade, oracle, LOB, and analytics workers.
- `scripts/` for thin CLI wrappers and operational commands.

## Verification

- Existing `python scripts/api_server.py` still works.
- Existing sync commands still work through compatibility wrappers.
- Frontend build still passes.
- Public docs describe the new boundaries.

## Non-Goals

- Do not move everything in one commit.
- Do not change database schemas as part of directory cleanup.
