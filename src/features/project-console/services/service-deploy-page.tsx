/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpError } from '../../../core/api/http';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dropdown } from 'primereact/dropdown';
import { Toast } from 'primereact/toast';
import { serviceApi, type PackageInput } from '../../../core/api/service-api';
import { ConnectionInputPicker } from '../connections/connection-input-picker';
import type { PlatformService } from '../../../core/models/service.model';
import { DynamicSchemaForm } from '../../../shared/components/dynamic-schema-form';
import EmptyState from '../../../shared/components/empty-state';
import { ProfileListEditor, type Profile } from '../../../shared/components/profile-list-editor';
import { useToastMessages } from '../../../shared/hooks/use-toast-messages';
import { k8sNameError } from '../../../shared/utils/k8s-names';
import { flattenReviewParams } from '../../../shared/utils/format-review-value';
import {
  apiErrorMessage,
  areaBasePath,
  hasProfileEditorWidget,
  parentLabel,
  useServiceSchema,
  versionOptionsFor,
} from './service-utils';

type StepKey = 'basics' | 'params' | 'profiles' | 'review';

interface WizardStep {
  key: StepKey;
  label: string;
}

const PROGRESS_STAGES = [
  { label: 'Validating parameters' },
  { label: 'Creating release' },
  { label: 'Scheduling pod' },
  { label: 'Waiting for readiness' },
];

export default function ServiceDeployPage() {
  const navigate = useNavigate();
  const { projectId, svcType } = useParams<{ projectId: string; svcType: string }>();
  const [searchParams] = useSearchParams();
  const { toast, showSuccess, showError, showWarn } = useToastMessages();
  const progressTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Post-deploy redirect timer — cleared on unmount so a navigation during
  // the success pause can't be yanked back to the instances list.
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [service, setService] = useState<PlatformService | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  // Track the dynamic schema form validity so Next on the Parameters step
  // is blocked when a CPU/memory quantity field is malformed.
  const [paramsValid, setParamsValid] = useState(true);
  const [deployProgress, setDeployProgress] = useState(0);
  const {
    schema: serviceSchema,
    setSchema: setServiceSchema,
    schemaLoading,
    loadSchema,
  } = useServiceSchema(
    showWarn,
    'Could not load configuration schema. You can still deploy with default parameters.',
  );
  const [profileImages, setProfileImages] = useState<
    Record<string, { label: string; image: string }[]>
  >({});
  const [versionOptions, setVersionOptions] = useState<{ label: string; value: string }[]>([]);
  const [currentStep, setCurrentStep] = useState(0);

  const [selectedTag, setSelectedTag] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // Connections the package declares it needs. Only inputs carrying a
  // parameter are offered. The others bind without a user choice.
  const [packageInputs, setPackageInputs] = useState<PackageInput[]>([]);
  /** An empty list of inputs and an unread one look the same, and deploying on
   *  the second means the release waits for a connection nobody was asked for.
   *  The wizard therefore refuses to advance until this reaches 'loaded'. */
  const [inputsState, setInputsState] = useState<'loading' | 'error' | 'loaded'>('loading');
  const [connectionChoices, setConnectionChoices] = useState<Record<string, string>>({});

  // Each fetch carries a token: switching version fast would otherwise let a
  // slow answer for the previous one land on top of the current inputs.
  const inputsRequestRef = useRef(0);

  const loadInputs = useCallback((serviceName: string, tag: string) => {
    const token = ++inputsRequestRef.current;
    setInputsState('loading');
    serviceApi
      .getServiceInputs(serviceName, tag)
      .then((inputs) => {
        if (token !== inputsRequestRef.current) return;
        setPackageInputs(inputs.filter((input) => !!input.parameter));
        setInputsState('loaded');
      })
      .catch((err: unknown) => {
        if (token !== inputsRequestRef.current) return;
        setPackageInputs([]);
        // A package that declares no input answers 404: that is an empty list,
        // not an unreadable one, and it must not hold the wizard back.
        setInputsState(err instanceof HttpError && err.status === 404 ? 'loaded' : 'error');
      });
  }, []);

  const profileEditor = hasProfileEditorWidget(serviceSchema);

  // The parameters claimed by connection inputs get a dedicated picker. Leaving
  // them in the schema form would render the same choice twice as a raw string.
  const visibleSchema = useMemo(() => {
    if (!serviceSchema?.properties || packageInputs.length === 0) {
      return serviceSchema;
    }
    const claimed = new Set(packageInputs.map((input) => input.parameter));
    const properties = Object.fromEntries(
      Object.entries(serviceSchema.properties).filter(([key]) => !claimed.has(key)),
    );
    return { ...serviceSchema, properties };
  }, [serviceSchema, packageInputs]);

  // Steps are computed from the loaded schema: the "Profiles" step is
  // only meaningful for services that declare a profile-editor widget
  // (currently just JupyterHub). Hiding it entirely for Spark History
  // Server / Trino / etc. gives a shorter, less confusing wizard.
  const steps = useMemo<WizardStep[]>(() => {
    const base: WizardStep[] = [
      { key: 'basics', label: 'Basics' },
      { key: 'params', label: 'Parameters' },
    ];
    if (profileEditor) {
      base.push({ key: 'profiles', label: 'Profiles' });
    }
    base.push({ key: 'review', label: 'Review' });
    return base;
  }, [profileEditor]);

  const currentStepKey: StepKey = steps[currentStep]?.key ?? 'basics';

  // An input is answered by a pick, by the package tolerating none, or by the
  // Environment answering for it through the package default. The last one used
  // to block the wizard on a service that needed no choice at all.
  const isInputAnswered = (input: PackageInput) =>
    input.optional || Boolean(input.default) || !!connectionChoices[input.parameter!];

  const nameError = useMemo(() => k8sNameError(instanceName), [instanceName]);

  const isFormValid = useMemo(() => {
    // The last gate before Deploy, so it repeats the connection check rather
    // than trusting that the wizard was walked step by step.
    const baseValid =
      !!selectedTag &&
      !nameError &&
      !!instanceName &&
      inputsState === 'loaded' &&
      packageInputs.every(isInputAnswered);
    if (profileEditor) {
      return baseValid && profiles.length > 0;
    }
    return baseValid;
  }, [
    selectedTag,
    nameError,
    instanceName,
    profileEditor,
    profiles,
    inputsState,
    packageInputs,
    connectionChoices,
  ]);

  const canAdvance = (): boolean => {
    switch (currentStepKey) {
      case 'basics':
        return !!instanceName && !nameError && !!selectedTag;
      case 'params':
        // A required connection input without a selection would fail at
        // reconciliation. Block it here instead. An unread list of inputs is
        // not an empty one, so anything but 'loaded' blocks too.
        return (
          !schemaLoading &&
          inputsState === 'loaded' &&
          paramsValid &&
          packageInputs.every(isInputAnswered)
        );
      case 'profiles':
        // Only rendered when the schema declares a profile editor — require
        // at least one profile defined before moving on.
        return profiles.length > 0;
      default:
        return true;
    }
  };

  const reviewParams = useMemo(() => {
    const entries = Object.fromEntries(
      Object.entries(parameters).filter(([k]) => k !== 'profiles'),
    );
    return flattenReviewParams(entries);
  }, [parameters]);

  useEffect(() => {
    serviceApi
      .getProfileImages()
      .then(setProfileImages)
      .catch(() => undefined);

    let cancelled = false;
    serviceApi
      .getPlatformServices()
      .then((services) => {
        if (cancelled) return;
        // A requested service must match exactly — falling back to another
        // service would silently deploy the wrong thing (the empty state
        // below handles the no-match case).
        // Bespoke deploy pages pass ?service=; the generic services/:svcType
        // area carries the service type in the URL param instead.
        const requestedService = searchParams.get('service') ?? svcType;
        const svc = requestedService
          ? services.find((s) => s.name === requestedService)
          : services[0];
        if (svc) {
          setService(svc);
          setInstanceName(svc.name);
          setVersionOptions(versionOptionsFor(svc));
          setSelectedTag(svc.defaultVersion);
          loadSchema(svc.name, svc.defaultVersion);
          loadInputs(svc.name, svc.defaultVersion);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        showError('Failed to load service info');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearProgressTick = useCallback(() => {
    if (progressTickRef.current !== null) {
      clearInterval(progressTickRef.current);
      progressTickRef.current = null;
    }
  }, []);

  // Route change during an in-flight deploy must not leak the interval, nor
  // let the success-redirect timer navigate after the user already left.
  useEffect(
    () => () => {
      clearProgressTick();
      if (navTimerRef.current !== null) {
        clearTimeout(navTimerRef.current);
      }
    },
    [clearProgressTick],
  );

  const onVersionChange = (tag: string) => {
    if (!service || !tag) return;
    setSelectedTag(tag);
    setServiceSchema(null);
    setParameters({});
    setConnectionChoices({});
    loadSchema(service.name, tag);
    loadInputs(service.name, tag);
  };

  const goBack = () => {
    if (!projectId) return;

    const returnTo = searchParams.get('returnTo');
    if (returnTo) {
      navigate(returnTo);
    } else {
      navigate(`/projects/${projectId}/${areaBasePath(service?.name).join('/')}`);
    }
  };

  const deploy = () => {
    if (!projectId || !service) return;

    setDeploying(true);
    setDeployProgress(0);

    const mergedParams: Record<string, any> = profileEditor
      ? { ...parameters, profiles }
      : { ...parameters };
    // The chosen connections ride the parameters the package declared for
    // them. None stays an empty string, which the package resolves to no
    // binding at all.
    for (const input of packageInputs) {
      if (!input.parameter) continue;
      const chosen = connectionChoices[input.parameter];
      if (chosen) {
        mergedParams[input.parameter] = chosen;
        continue;
      }
      // Writing an empty string here is not the same as writing nothing: KuboCD
      // merges the submitted parameters over the package defaults, so the empty
      // value wins and the default, a template the Environment answers, never
      // renders. A choice not made is left out.
      delete mergedParams[input.parameter];
    }

    // Animate progress stages while the request is in flight.
    progressTickRef.current = setInterval(() => {
      setDeployProgress((current) =>
        current < PROGRESS_STAGES.length - 1 ? current + 1 : current,
      );
    }, 700);

    serviceApi
      .deployService(projectId, {
        service: service.name,
        tag: selectedTag,
        instanceName,
        parameters: mergedParams,
      })
      .then(() => {
        clearProgressTick();
        setDeployProgress(PROGRESS_STAGES.length);
        showSuccess(`${instanceName} is being provisioned.`, 'Deploying instance');
        navTimerRef.current = setTimeout(() => {
          setDeploying(false);
          const returnTo = searchParams.get('returnTo');
          if (returnTo) {
            navigate(returnTo);
          } else {
            navigate(`/projects/${projectId}/${areaBasePath(service.name).join('/')}`);
          }
        }, 400);
      })
      .catch((err) => {
        clearProgressTick();
        showError(apiErrorMessage(err, 'Deployment failed'));
        setDeploying(false);
      });
  };

  return (
    <>
      <Toast ref={toast} />

      <div className="deploy-page animate-in">
        <div className="page-header">
          <nav className="breadcrumb">
            <a
              className="breadcrumb-link"
              onClick={goBack}
              onKeyDown={(e) => e.key === 'Enter' && goBack()}
              tabIndex={0}
            >
              <i className="pi pi-arrow-left text-[11px]"></i>
              {parentLabel(service?.name)}
            </a>
            <i className="pi pi-angle-right text-[10px] text-fg-muted"></i>
            <span className="breadcrumb-current">New instance</span>
          </nav>
          <div className="header-row">
            <div className="header-badge">
              <i className="pi pi-play"></i>
            </div>
            <div className="header-text">
              <h2>Deploy new instance</h2>
              <p className="page-desc">
                Configure and launch a new {service?.name || 'service'} instance in this project.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <EmptyState
            variant="panel"
            icon="pi pi-spin pi-spinner"
            title="Loading service configuration…"
          />
        ) : deploying ? (
          <div className="form-card deploy-progress">
            {PROGRESS_STAGES.map((stage, i) => (
              <div
                key={stage.label}
                className={[
                  'progress-stage',
                  deployProgress > i ? 'done' : '',
                  deployProgress === i ? 'active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="ps-dot">
                  {deployProgress > i ? (
                    <i className="pi pi-check"></i>
                  ) : deployProgress === i ? (
                    <i className="pi pi-spin pi-spinner"></i>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="ps-label">{stage.label}</span>
                {deployProgress === i ? (
                  <span className="ps-status muted-text">in progress</span>
                ) : deployProgress > i ? (
                  <span className="ps-status ok">done</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : service ? (
          <>
            <div className="wizard-stepper">
              {steps.map((s, i) => (
                <div
                  key={s.key}
                  className={[
                    'wstep',
                    currentStep === i ? 'active' : '',
                    currentStep > i ? 'done' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="wstep-num">
                    {currentStep > i ? <i className="pi pi-check"></i> : i + 1}
                  </span>
                  <span className="wstep-label">{s.label}</span>
                  {i < steps.length - 1 && <span className="wstep-line"></span>}
                </div>
              ))}
            </div>

            <div className="form-card">
              {currentStepKey === 'basics' && (
                <div className="form-section">
                  <div className="form-field">
                    <label>Instance name</label>
                    <input
                      className="text-input mono"
                      placeholder="e.g. my-notebook"
                      value={instanceName}
                      onChange={(e) => setInstanceName(e.target.value)}
                    />
                    {nameError ? (
                      <small className="field-hint err">{nameError}</small>
                    ) : (
                      <small className="field-hint">
                        Lowercase letters, digits and dashes. Must start and end with an
                        alphanumeric character.
                      </small>
                    )}
                  </div>

                  <div className="form-field">
                    <div className="field-head">
                      <label style={{ margin: 0 }}>Version</label>
                      <span className="muted-text small mono">{service.name}</span>
                    </div>
                    <small className="field-hint" style={{ marginTop: 0, marginBottom: '10px' }}>
                      Pick a version. Each version ships its own schema; the parameters step adapts.
                    </small>
                    <Dropdown
                      value={selectedTag}
                      options={versionOptions}
                      optionLabel="label"
                      optionValue="value"
                      placeholder="Select a version"
                      appendTo={document.body}
                      className="w-full"
                      onChange={(e) => onVersionChange(e.value)}
                    />
                  </div>
                </div>
              )}

              {/* Kept mounted when hidden: going back to this step finds what was typed. */}
              <div hidden={currentStepKey !== 'params'}>
                {schemaLoading ? (
                  <div className="form-section">
                    <div className="flex items-center gap-3 pt-2 pb-5">
                      <i className="pi pi-spin pi-spinner text-[18px] text-primary"></i>
                      <div>
                        <strong>Loading parameter schema…</strong>
                        <div className="muted-text small">
                          Fetching {service.name}:{selectedTag} configuration.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="form-section">
                    {/* Which connections this service needs is not known yet, or
                        could not be read. Deploying anyway would leave the
                        release waiting on a connection nobody was asked for. */}
                    {inputsState === 'loading' && (
                      <p className="muted-text small">Reading the connections this service needs…</p>
                    )}
                    {inputsState === 'error' && (
                      <div className="form-field">
                        <small className="field-hint err">
                          Could not read the connections this service needs. Deploying now could
                          leave it waiting for one.
                        </small>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ alignSelf: 'flex-start', marginTop: '8px' }}
                          onClick={() =>
                            service && selectedTag && loadInputs(service.name, selectedTag)
                          }
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {packageInputs.map((input) => (
                      <ConnectionInputPicker
                        key={input.alias}
                        projectId={projectId!}
                        input={input}
                        value={connectionChoices[input.parameter!] ?? ''}
                        onChange={(connectionName) =>
                          setConnectionChoices((choices) => ({
                            ...choices,
                            [input.parameter!]: connectionName,
                          }))
                        }
                      />
                    ))}
                    {visibleSchema ? (
                      <DynamicSchemaForm
                        schema={visibleSchema}
                        projectId={projectId}
                        onParametersChange={setParameters}
                        onValidityChange={setParamsValid}
                      />
                    ) : packageInputs.length === 0 ? (
                      <p className="muted-text">No configurable parameters for this version.</p>
                    ) : null}
                  </div>
                )}
              </div>

              {profileEditor && (
                <div className="form-section" hidden={currentStepKey !== 'profiles'}>
                  <div className="field-head">
                    <label style={{ margin: 0 }}>Profiles</label>
                    <span className="muted-text small">
                      Define notebook environments users can launch.
                    </span>
                  </div>
                  <ProfileListEditor profileImages={profileImages} onProfilesChange={setProfiles} />
                  {profiles.length === 0 && (
                    <small className="field-hint err">
                      At least one profile is required to deploy.
                    </small>
                  )}
                </div>
              )}

              {currentStepKey === 'review' && (
                <div className="form-section">
                  <div className="review-grid">
                    <div className="review-row">
                      <span className="review-label">Instance name</span>
                      <span className="review-value mono">{instanceName || '—'}</span>
                    </div>
                    <div className="review-row">
                      <span className="review-label">Service</span>
                      <span className="review-value mono">{service.name}</span>
                    </div>
                    <div className="review-row">
                      <span className="review-label">Version</span>
                      <span className="review-value mono">{selectedTag}</span>
                    </div>
                    {profileEditor && (
                      <div className="review-row">
                        <span className="review-label">Profiles</span>
                        <span className="review-value">{profiles.length} configured</span>
                      </div>
                    )}
                    {packageInputs.map((input) => (
                      <div key={input.alias} className="review-row">
                        <span className="review-label">Connection ({input.alias})</span>
                        <span className="review-value mono">
                          {connectionChoices[input.parameter!] || 'None'}
                        </span>
                      </div>
                    ))}
                    {reviewParams.map((entry) => (
                      <div key={entry.key} className="review-row">
                        <span className="review-label">{entry.key}</span>
                        <span className="review-value mono">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="wizard-actions">
              <button className="btn-secondary" onClick={goBack}>
                Cancel
              </button>
              <div className="wa-right">
                {currentStep > 0 && (
                  <button
                    className="btn-secondary"
                    onClick={() => setCurrentStep((s) => Math.max(s - 1, 0))}
                  >
                    Back
                  </button>
                )}
                {currentStep < steps.length - 1 ? (
                  <button
                    className="create-btn"
                    disabled={!canAdvance()}
                    onClick={() => setCurrentStep((s) => Math.min(s + 1, steps.length - 1))}
                  >
                    Next
                    <i className="pi pi-angle-right"></i>
                  </button>
                ) : (
                  <button className="create-btn" disabled={!isFormValid} onClick={deploy}>
                    <i className="pi pi-play"></i>
                    Deploy instance
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            variant="panel"
            icon="pi pi-exclamation-triangle"
            title="Service unavailable"
            description="No deployable service configuration was found."
            action={
              <button className="btn-secondary" onClick={goBack}>
                <i className="pi pi-arrow-left"></i>
                Back to instances
              </button>
            }
          />
        )}
      </div>
    </>
  );
}
