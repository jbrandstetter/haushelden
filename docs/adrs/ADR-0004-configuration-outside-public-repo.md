---
status: proposed
date: 2026-10-11
decision-makers: Johannes
tier: quick
governs: [SPEC-0001, SPEC-0007]
---

# ADR-0004: Deployment Addresses and Secrets Live in the Private Homelab Repository

## Context and Problem Statement

This repository is public (it hosts the prototype on GitHub Pages). The production app needs hostnames, internal IPs,
the backup target, the reverse-proxy site, the iCloud calendar account, the assistant token and the local LLM endpoint.
Writing any of these into specs, code or examples here would publish the homelab's layout and credentials. Where do
deployment-specific values live?

## Decision

All deployment-specific values are configuration, owned by the private homelab infrastructure repository (Ansible
inventory, host variables and vault) and injected into the container as environment variables or a config file at
deploy time. This repository contains only the application, its specs and its ADRs; it names configuration keys
(for example `HH_PUBLIC_URL`, `HH_BACKUP_TARGET`, `HH_CALDAV_URL`), never their values. The app's own API paths are
part of the application and stay in the specs.

## Alternative

Do not separate them: specs and examples name the real hostname, backup host and endpoints. Easier to read, but it
leaks the homelab's topology to the public repository and its history, where removal is unreliable.

## Consequences

* Good, because the repository can stay public without revealing infrastructure or secrets
* Good, because the same code can run on a laptop with a local `.env` and on pve1 with production values
* Bad, because a reader of this repository cannot see the real deployment; they must look in the private repository
* Bad, because every new setting needs a named key in SPEC-0007 and a value in the private inventory

## More Information

The configuration keys are listed in SPEC-0007 (Deployment and Operations). Related: ADR-0002 (the public hostname is
one of these values).
