import { environment } from '../../config/environment';
import { http } from './http';

/** OIDC client the platform publishes for the console (Context identity.oidc);
 *  absent when the deployment relies on the UI's build-time configuration. */
export interface IdentityOidcConfig {
  authority: string;
  clientId: string;
  scope?: string;
}

/** Mirror of the server's GET /api/capabilities response: the optional
 *  features the platform is configured with, so the UI can adapt. */
export interface Capabilities {
  identity: {
    /** "external" (BYO OIDC, default) or "kubauth". */
    provider: string;
    /** True when the kubauth user/group management API is available. */
    userManagement: boolean;
    oidc?: IdentityOidcConfig;
  };
  oidcProvisioning: {
    /** "none" (default), "kubauth" or "keycloak". */
    provider: string;
  };
}

export const capabilitiesApi = {
  get(): Promise<Capabilities> {
    // Bounded: this call gates the app bootstrap (OIDC init waits for it), a
    // dead server must degrade to the build-time config, not hang the UI.
    return http.get<Capabilities>(`${environment.apiBaseUrl}/api/capabilities`, {
      signal: AbortSignal.timeout(5000),
    });
  },
};
