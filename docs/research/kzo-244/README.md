# KZO-244 Evidence Bundle Layout

This directory is reserved for versioned KZO-244 fixture manifests, mutation recipes, contract examples, calculation vectors, and future Acceptance Manifests.

Expected subdirectories are created only when implementation planning assigns their owners:

- `fixtures/` — authentic base manifests and deterministic mutation recipes;
- `contracts/` — versioned valid and invalid tool/report examples;
- `calculations/` — full-precision deterministic calculation vectors;
- `manifests/` — immutable G1, G2, and G3 Acceptance Manifests.

Private portfolio fixtures must be synthetic. Restricted source artifacts remain in controlled storage; repository manifests contain hashes, source locations, rights/retention status, and reproducible retrieval instructions.

The governing specification is [../kzo-244-v1-acceptance.md](../kzo-244-v1-acceptance.md). The machine-readable case registry is [../kzo-244-acceptance-matrix.json](../kzo-244-acceptance-matrix.json).
