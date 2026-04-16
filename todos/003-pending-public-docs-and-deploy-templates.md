# 003 - Public Docs And Deploy Templates

Status: pending  
Priority: P2

## Goal

Build a clean public documentation and deployment template set that does not expose private notes.

## Motivation

The private `document/` directory contains important local notes and should stay ignored. Public docs should live separately and describe stable architecture, development, and deployment patterns.

## Target Direction

- Expand `docs/architecture.md` as boundaries mature.
- Add public API docs once response contracts are stable.
- Add Nginx and systemd templates under `deploy/`.
- Add a deployment safety checklist that references environment variables without hard-coded secrets.

## Verification

- `document/` remains ignored.
- `docs/`, `deploy/`, and `todos/` are tracked.
- Templates contain no credentials, local private IPs, or personal deployment details.

## Non-Goals

- Do not migrate private docs.
- Do not publish local credentials or machine-specific setup.
