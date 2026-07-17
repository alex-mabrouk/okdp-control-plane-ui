import { useEffect, useState } from 'react';
import { capabilitiesApi, type Capabilities } from '../api/capabilities-api';

/** Legacy fallback: servers without GET /api/capabilities always expose the
 *  identity API, so an unreachable endpoint means "behave like before". */
const legacyCapabilities: Capabilities = {
  identity: { provider: 'kubauth', userManagement: true },
  oidcProvisioning: { provider: 'none' },
};

// Fetched once per tab and shared by every consumer: capabilities only change
// when an operator edits the platform Context, a reload is fine to pick it up.
let cached: Capabilities | undefined;
let inflight: Promise<Capabilities> | undefined;

function fetchCapabilities(): Promise<Capabilities> {
  inflight ??= capabilitiesApi
    .get()
    .catch(() => legacyCapabilities)
    .then((caps) => {
      cached = caps;
      return caps;
    });
  return inflight;
}

/** Platform capabilities, undefined while the first fetch is in flight.
 *  Consumers should hide optional features until capabilities are known. */
export function useCapabilities(): Capabilities | undefined {
  const [capabilities, setCapabilities] = useState<Capabilities | undefined>(cached);

  useEffect(() => {
    if (capabilities) return;
    let alive = true;
    void fetchCapabilities().then((caps) => {
      if (alive) setCapabilities(caps);
    });
    return () => {
      alive = false;
    };
  }, [capabilities]);

  return capabilities;
}

/** True when the platform manages users/groups (identity.provider: kubauth);
 *  undefined while loading — treat as hidden. */
export function useUserManagementEnabled(): boolean | undefined {
  return useCapabilities()?.identity.userManagement;
}
