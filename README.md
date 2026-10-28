<p align="center">
  <a href="https://okdp.io">
    <img src="https://okdp.io/logos/okdp-inverted.png" alt="OKDP: Open Kubernetes Data Platform" height="180" />
  </a>
</p>

[![ci](https://github.com/OKDP/okdp-control-plane-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/OKDP/okdp-control-plane-ui/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/OKDP/okdp-control-plane-ui)](https://github.com/OKDP/okdp-control-plane-ui/releases/latest)
[![License Apache2](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](http://www.apache.org/licenses/LICENSE-2.0)

# OKDP Console

The OKDP Console is the web interface of the [OKDP](https://okdp.io) (Open
Kubernetes Data Platform): it manages OKDP projects and their data-platform
services — Spark applications, JupyterHub, Airflow, Trino, Superset, Polaris,
secret stores — by talking to the OKDP control-plane API.

Built with React 19, Vite, TypeScript (strict), PrimeReact and Tailwind CSS v4.

## What does this project provide?

### Why this project?

The OKDP control-plane API ([okdp-control-plane-server](https://github.com/OKDP/okdp-control-plane-server))
exposes project and service management over HTTP and Server-Sent Events, but it
has no human-facing interface — every operation would otherwise require raw API
calls or `kubectl`. This repository delivers the web console that drives that
API.

Within OKDP, operators and data engineers manage *projects* (Kubernetes
namespaces labelled `okdp.io/project`) and a catalog of data services (Spark,
JupyterHub, Airflow, Trino, Superset, Polaris, secret stores). The Console is
the single pane of glass that ties OIDC authentication, project selection and
per-service deploy / edit / observe flows together, so users don't have to
juggle separate upstream UIs and `kubectl`.

### Delivered artifacts

- **Single-page application** — a React 19 + Vite + TypeScript SPA (PrimeReact +
  Tailwind CSS v4), authenticating with OIDC and consuming the control-plane API
  over REST + SSE.
- **Production Docker image** — a multi-stage build that compiles the static
  bundle and serves it with nginx on port `4200` (SPA fallback, immutable
  caching of hashed assets), built from the included [`Dockerfile`](Dockerfile).

## Architecture

The Console is a browser SPA that talks to the OKDP control-plane API: it
fetches initial state over REST and keeps live lists (projects, services, Spark
apps) up to date by merging watch-style SSE events. Authentication uses the OIDC
authorization-code flow with silent renew; roles come from the OIDC `groups`
claim.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design — provider tree,
routing, auth, the REST + SSE pattern, dynamic schema forms, styling and the
build/deploy story.

## Requirements

- **Node.js** 22+ and **npm**
- A running **OKDP control plane** reachable at `http://localhost:8093` (the
  development API target — see [okdp-control-plane-server](https://github.com/OKDP/okdp-control-plane-server))
- Access to the development **OIDC identity provider** (the dev build
  authenticates against an OIDC provider such as
  `https://keycloak.example.com/realms/master`)

### Tested with

The following versions have been validated by the maintainers. Other versions
within the supported range may work but are untested.

| Tool | Version tested |
|------|----------------|
| Node.js | `22` (the `node:22-alpine` build image) |
| npm | the version bundled with Node 22 |
| nginx (runtime image) | `1.27-alpine` |

## Quick start

Run it directly on your machine, or in the devcontainer (only Docker needed). Both
talk to **okdp-sandbox** (see its README for cluster, DNS and CA setup).

**Directly:**

```bash
npm ci
npm start
```

**Devcontainer:** open the repo and "Reopen in Container" (or run `devcontainer up`).
The image ships Node, installs dependencies on create, and publishes port 4200.

```bash
npm start
```

The dev server serves no `/config.js`, so the OIDC settings come from a
git-ignored `.env.local` at the repository root:

```
VITE_OIDC_AUTHORITY=https://keycloak.example.com/realms/okdp
VITE_OIDC_CLIENT_ID=okdp-ui
```

Without an authority the console says so on a configuration screen instead of
signing you in to somebody else's issuer.

Open `http://localhost:4200/`. The dev server reloads on source changes and
redirects to the OIDC provider for login.

**Expected result:**

```
VITE v7  ready in NNN ms

➜  Local:   http://localhost:4200/
```

> **The port matters.** The OIDC redirect URIs registered with the identity
> provider point at `localhost:4200` — running on another port breaks login.
> The port is pinned in `vite.config.ts`; don't change it.

## Configuration

`src/config/environment.ts` switches on `import.meta.env.PROD`:

| | Development | Production |
|---|---|---|
| API base URL | `http://localhost:8093` | `/api` (same-origin, behind an ingress) |
| OIDC authority | `VITE_OIDC_AUTHORITY` from `.env.local` | `oidc.authority` from the chart, through `/config.js` |
| OIDC client | `VITE_OIDC_CLIENT_ID`, default `okdp-ui` | `oidc.clientId` from the chart, default `okdp-ui` |

The OIDC settings are read at startup rather than baked into the bundle, so one
image runs against any cluster: the container entrypoint writes `/config.js`
from the chart values, and `index.html` loads it before the bundle. Without an
authority the console shows a configuration screen instead of signing users in
somewhere else.

Authentication uses the OIDC authorization-code flow (`oidc-client-ts`) with
silent renew, and tokens live in `sessionStorage`. Roles are read from the claim
named by `identity.rolesClaim` (default `groups`, dotted paths supported), and
the administration pages are granted by `identity.adminRole` (default
`platform_admin`).

> **Production note:** the image expects a fronting ingress to route `/api` to
> the control plane, since its nginx serves only the static bundle. See
> [Known limitations](ARCHITECTURE.md#known-limitations--open-decisions).

## Docker

The production image builds the static bundle and serves it with nginx on
port `4200` (SPA fallback included, hashed assets cached immutably,
`index.html` served with `no-cache`):

```bash
docker build -t okdp-console .
docker run --rm -p 4200:4200 okdp-console
```

**Expected result:** the Console is served at `http://localhost:4200/`. Note
that, as above, the image serves only the static bundle — a fronting ingress
must route `/api` to the control plane.

## Deploy with the Helm chart

The published chart is the normal path:

<!-- x-release-please-start-version -->
```bash
helm install okdp-control-plane-ui oci://quay.io/okdp/charts/okdp-control-plane-ui --version 0.9.1
```
<!-- x-release-please-end -->


The examples below install from `chart/` in this checkout, which is what a
contributor does while changing the chart itself.

<!-- x-release-please-start-version -->
```bash
helm install okdp-control-plane-ui ./chart -n okdp-system \
  --set image.tag=0.9.1 \
  --set ingress.host=okdp-ui.example.com \
  --set backend.service=okdp-control-plane-server \
  --set oidc.authority=https://keycloak.example.com/realms/master
```
<!-- x-release-please-end -->

`oidc.authority` has no default: the console cannot reach any provider without
it. `ingress.host` must match the client's redirect URIs in the realm.

The OIDC client itself and CORS are provided by the platform (okdp-sandbox), not
the chart.

## OKDP Integration

This component is part of the [OKDP Data Platform](https://okdp.io) — a
cloud-native, open-source data platform for Kubernetes.

The Console is the web front end of the OKDP control plane. It authenticates
through the platform's OIDC provider, talks to the control-plane API
([okdp-control-plane-server](https://github.com/OKDP/okdp-control-plane-server))
over REST + SSE, and manages OKDP projects and their data services. It does not
deploy on its own — it requires a reachable control-plane API and OIDC provider,
both available in the [okdp-sandbox](https://github.com/OKDP/okdp-sandbox).

## Troubleshooting

### Login fails or loops back to the provider

**Symptom:** after authenticating, the app returns to the login page or errors
on the OIDC callback.
**Cause:** the dev server is running on a port other than `4200`. The OIDC
redirect URIs are registered for `localhost:4200`.
**Fix:** stop any process holding port `4200`, then run `npm start` (the port is
pinned in `vite.config.ts`).

### Immediately logged out / repeated 401s

**Symptom:** the app loads but logs you out, or API calls return `401`/`403`.
**Cause:** the control-plane API is not reachable at the configured base URL; the
HTTP layer forces a logout on `401`/`403`.
**Fix:** start the control plane on `http://localhost:8093` (see
[okdp-control-plane-server](https://github.com/OKDP/okdp-control-plane-server)).

## Contributing / Development

### Scripts

| Command | What it does |
|---------|--------------|
| `npm start` / `npm run dev` | Vite dev server on port 4200 |
| `npm run build` | type-check (`tsc -b`) + production bundle → `dist/` |
| `npm run size-check` | build, then fail if a bundle exceeds its size budget |
| `npm run preview` | serve the production bundle locally |
| `npm test` | run the unit tests once (Vitest) |
| `npm run test:watch` | run the tests in watch mode |
| `npm run test:coverage` | tests with coverage report |
| `npm run lint` | ESLint over `src` (with `--fix`) |
| `npm run format` | Prettier over `src` |

Run a single test file or test name:

```bash
npx vitest run src/core/auth/auth-context.test.tsx
npx vitest run -t "force local logout"
```

**Expected result:** `vitest` reports the matched tests passing, e.g.
`Test Files  1 passed (1)`.

## Example: Secret Store (Vault)

1. Open your project → **Secrets** → **Secret Stores** → **Add secret store**.
2. Fill the form with simple values like below. The Vault URL must work **from inside the cluster** (where ESO runs).

| Field | Simple example |
|-------|----------------|
| Store name | `my-store` |
| Server URL | `http://vault-main.vault-system.svc.cluster.local:8200` |
| Secret path | `secret` |
| KV version | `v2` |
| Token | `root` *(sandbox / dev only; never in production)* |
| Default store | optional checkbox |

### Project structure

```
src/
  core/        # cross-cutting infra: auth, http/sse clients, contexts, theme
  features/    # one folder per functional area (admin, project-console, …)
  shared/      # reusable components, hooks and utils
  config/      # environment switch
```

Conventions in brief (details in [ARCHITECTURE.md](ARCHITECTURE.md)):

- strict TypeScript, no `any`; use the app `logger`, not `console`
- design tokens (`--db-*` variables / Tailwind utilities) over raw hex/px
- live lists follow the *initial REST fetch + SSE merge* pattern
- all web-storage keys are centralized in `src/core/storage-keys.ts`
- tests are co-located `*.test.ts(x)` (Vitest + Testing Library)

### Tests

```bash
npm test
```

Unit tests run with Vitest + Testing Library in `jsdom`. External SDKs such as
`oidc-client-ts` are mocked with `vi.hoisted` + `vi.mock` (see
`src/core/auth/auth-context.test.tsx` for the pattern).

## Contributing & License

Contributions are welcome! Please read the [contribution guidelines](https://github.com/OKDP/.github/blob/main/CONTRIBUTING.md).

This project is licensed under the [Apache License 2.0](LICENSE).

---

**Built 🚀 for the OKDP Community**
<a href="https://okdp.io">
  <img src="https://okdp.io/logos/okdp-notext.svg" height="20px" style="margin: 0 2px;" />
</a>
