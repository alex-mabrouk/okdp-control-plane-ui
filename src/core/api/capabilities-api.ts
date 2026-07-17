import { environment } from '../../config/environment';
import { http } from './http';

/** Mirror of the server's GET /api/capabilities response: the optional
 *  features the platform is configured with, so the UI can adapt. */
export interface Capabilities {
  identity: {
    /** "external" (BYO OIDC, default) or "kubauth". */
    provider: string;
    /** True when the kubauth user/group management API is available. */
    userManagement: boolean;
  };
  oidcProvisioning: {
    /** "none" (default), "kubauth" or "keycloak". */
    provider: string;
  };
}

export const capabilitiesApi = {
  get(): Promise<Capabilities> {
    return http.get<Capabilities>(`${environment.apiBaseUrl}/api/capabilities`);
  },
};
