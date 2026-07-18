// Environment configuration. Vite statically replaces import.meta.env.PROD,
// so the unused branch is dropped from production bundles.

interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scope: string;
  responseType: string;
  silentRenew: boolean;
  logLevel: string;
}

interface Environment {
  production: boolean;
  apiBaseUrl: string;
  oidc: OidcConfig;
  githubUrl: string;
}

const development: Environment = {
  production: false,

  // API Configuration
  apiBaseUrl: 'http://localhost:8093',

  oidc: {
    // Keycloak is the sandbox IdP (kubauth retired); the okdp-ui client is
    // seeded by the sandbox Keycloak configuration.
    authority: 'https://keycloak.okdp.sandbox/realms/master',
    clientId: 'okdp-ui',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    scope: 'openid profile email groups offline_access',
    responseType: 'code',
    silentRenew: true,
    logLevel: 'Debug',
  },

  // External Links
  githubUrl: 'https://github.com/okdp',
};

const production: Environment = {
  ...development,

  production: true,

  // API Configuration - relative URLs for same-origin deployment
  apiBaseUrl: '',

  oidc: {
    ...development.oidc,
    logLevel: 'None',
  },
};

export const environment: Environment = import.meta.env.PROD ? production : development;

/** Overrides the build-time OIDC client with the one the platform publishes
 *  (GET /api/capabilities, Context identity.oidc), so a single UI build works
 *  against any IdP. Called by the bootstrap in main.tsx before the OIDC
 *  client is created; no-op when the platform publishes nothing. */
export function applyRuntimeOidc(oidc?: { authority: string; clientId: string; scope?: string }) {
  if (!oidc?.authority || !oidc.clientId) return;
  environment.oidc.authority = oidc.authority;
  environment.oidc.clientId = oidc.clientId;
  if (oidc.scope) environment.oidc.scope = oidc.scope;
}
