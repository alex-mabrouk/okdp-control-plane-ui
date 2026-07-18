import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyRuntimeOidc } from './config/environment';
import { fetchCapabilities } from './core/capabilities/use-capabilities';
// The PrimeReact theme is imported by styles.css: it must load after the
// @layer order declared there, or preflight strips its component styles.
import './styles.css';

/** The platform publishes the OIDC client to use (Context identity.oidc via
 *  /api/capabilities): resolve it before mounting so AuthProvider creates the
 *  UserManager against the right IdP. fetchCapabilities never rejects — an
 *  unreachable/legacy server falls back to the build-time configuration. */
async function bootstrap() {
  const capabilities = await fetchCapabilities();
  applyRuntimeOidc(capabilities.identity.oidc);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
