import { useMemo, useState } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import {
  connectionApi,
  type Connection,
  type ConnectionRequest,
  type ConnectionTestResult,
  type ConnectionValues,
  type ContractDescriptor,
} from '../../../core/api/connection-api';
import { apiErrorMessage } from '../../../core/api/http';
import { DynamicSchemaForm } from '../../../shared/components/dynamic-schema-form';
import { DialogFooter } from '../../../shared/components/dialog-footer';
import { k8sNameError } from '../../../shared/utils/k8s-names';
import { missingRequiredFields, omitBlankSecrets, toDynamicSchema } from './connection-schema';
import { CredentialsBlock, type CredentialsMode } from './credentials-block';
import { ConnectionTestReport } from './connection-test-result';

/**
 * The form declaring an external connection, on the Connections page and in a
 * service's deploy form alike, so both get the same fields, checks and Test
 * button. The type is fixed when a package input asks for one contract. It
 * starts from its props: mount it when it opens.
 */
export function ConnectionFormDialog({
  projectId,
  types,
  typeFixed = false,
  connection,
  confirmLabel,
  onHide,
  onSaved,
}: {
  projectId: string;
  /** The types offered, the first one selected. */
  types: ContractDescriptor[];
  /** Hides the choice of type, the first one being the only one wanted. */
  typeFixed?: boolean;
  /** The connection to edit. Absent, the form creates one. */
  connection?: Connection;
  confirmLabel?: string;
  onHide: () => void;
  onSaved: (name: string) => void;
}) {
  const editMode = Boolean(connection);
  const api = useMemo(() => connectionApi.project(projectId), [projectId]);

  const [name, setName] = useState(connection?.name ?? '');
  const [description, setDescription] = useState(connection?.description ?? '');
  const [typeName, setTypeName] = useState(connection?.type ?? types[0]?.name ?? '');
  const [values, setValues] = useState<ConnectionValues>({ ...connection?.values });
  // Credentials live in their own state because they have their own
  // destination: a Secret, not spec.values. The schema form does not know
  // them (toDynamicSchema drops the secret fields) and re-emits the whole
  // set of values it owns, which would wipe them on the next keystroke.
  // On an edit they start blank, absent from the response by design, and are
  // only written when the user types a new one.
  const [credentials, setCredentials] = useState<ConnectionValues>({});
  // Values the form starts from. Kept apart from `values`, which the form owns
  // and streams back on every keystroke: feeding those back in as initial
  // values would restart the form's own initialisation effect on each change.
  const [initialValues, setInitialValues] = useState<ConnectionValues>({ ...connection?.values });
  // Credentials either get typed in, and the console writes a Secret, or they
  // already live in one, typically projected from a vault by External Secrets.
  // The server records which of the two it is, so an edit reopens in the right
  // mode instead of guessing from the Secret's name.
  const pointsElsewhere =
    Boolean(connection?.credentialsSecret) && !connection!.credentialsSecret!.owned;
  const [credentialsMode, setCredentialsMode] = useState<CredentialsMode>(
    pointsElsewhere ? 'existing' : 'enter',
  );
  const [existingSecret, setExistingSecret] = useState(
    pointsElsewhere ? connection!.credentialsSecret!.name : '',
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState('');

  const selectedType = types.find((type) => type.name === typeName);

  // Memoised: DynamicSchemaForm re-initialises whenever the schema's identity
  // changes, so handing it a fresh object each render would loop.
  const schema = useMemo(
    () => (selectedType ? toDynamicSchema(selectedType) : null),
    [selectedType],
  );

  const nameError = k8sNameError(name);
  const missingFields = selectedType ? missingRequiredFields(selectedType, values) : [];
  const credentialFields = selectedType?.fields.filter((field) => field.secret) ?? [];
  // On an edit the stored credentials are kept when nothing is retyped, so a
  // blank field is not a missing one.
  const missingCredentials =
    credentialsMode === 'existing'
      ? existingSecret
        ? []
        : ['Secret name']
      : editMode
        ? []
        : credentialFields.filter((f) => f.required && !credentials[f.name]).map((f) => f.label);
  // Testing sends only what the form holds, the endpoint cannot read a Secret,
  // so credentials must be present even on an edit and even when the connection
  // points at an existing Secret.
  const missingToTest = [
    ...missingFields,
    ...credentialFields.filter((f) => f.required && !credentials[f.name]).map((f) => f.label),
  ];
  const formValid =
    Boolean(selectedType) &&
    Boolean(name) &&
    !nameError &&
    missingFields.length === 0 &&
    missingCredentials.length === 0;

  const changeType = (type: string) => {
    setTypeName(type);
    // The fields of the previous type do not apply to the new one.
    setValues({});
    setInitialValues({});
    setCredentials({});
    setTestResult(null);
  };

  // Everything the form holds, credentials included. The test endpoint cannot
  // read a Secret, so it needs them whichever mode is selected.
  const submittedValues = () =>
    selectedType
      ? omitBlankSecrets(selectedType, { ...values, ...credentials })
      : { ...values, ...credentials };

  const buildRequest = (): ConnectionRequest => ({
    name,
    type: typeName,
    description: description || undefined,
    // Naming an existing Secret means the credentials stay where they are. Any
    // value typed before switching mode is left out rather than stored under a
    // name the user did not choose.
    values:
      credentialsMode === 'existing'
        ? selectedType
          ? omitBlankSecrets(selectedType, values)
          : values
        : submittedValues(),
    existingSecret: credentialsMode === 'existing' ? existingSecret : undefined,
  });

  const testConnection = () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    api
      .test({ type: typeName, values: submittedValues() })
      .then(setTestResult)
      .catch((err) => setError(apiErrorMessage(err, 'Could not run the connection test')))
      .finally(() => setTesting(false));
  };

  const save = () => {
    setSaving(true);
    setError('');
    const request = buildRequest();
    (editMode ? api.update(name, request) : api.create(request))
      .then(() => {
        setSaving(false);
        onSaved(name);
      })
      .catch((err) => {
        setSaving(false);
        setError(apiErrorMessage(err, `Failed to ${editMode ? 'update' : 'create'} connection`));
      });
  };

  return (
    <Dialog
      header={
        editMode
          ? 'Edit connection'
          : typeFixed && selectedType
            ? `New ${selectedType.displayName} connection`
            : 'Add connection'
      }
      visible
      modal
      draggable={false}
      resizable={false}
      style={{ width: '600px' }}
      className="db-dialog"
      closable
      onHide={onHide}
      footer={
        <DialogFooter
          onCancel={onHide}
          onConfirm={save}
          confirmLabel={confirmLabel ?? (editMode ? 'Save' : 'Create')}
          confirmDisabled={testing || !formValid}
          cancelDisabled={testing}
          busy={saving}
          leading={
            <Button
              severity="secondary"
              outlined
              icon={testing ? 'pi pi-spin pi-spinner' : 'pi pi-check-circle'}
              label="Test connection"
              onClick={testConnection}
              disabled={testing || saving || !selectedType || missingToTest.length > 0}
              tooltip={
                missingToTest.length > 0
                  ? `Fill in ${missingToTest.join(', ')} to test the connection`
                  : undefined
              }
            />
          }
        />
      }
    >
      <div className="dialog-content">
        <div className="field">
          <label htmlFor="connectionName">Connection name</label>
          <InputText
            id="connectionName"
            value={name}
            disabled={editMode}
            onChange={(e) => setName(e.target.value)}
            placeholder="corporate-warehouse"
          />
          {nameError && <small className="p-error">{nameError}</small>}
        </div>

        {!typeFixed && (
          <div className="field">
            <label htmlFor="contract">Type</label>
            <Dropdown
              inputId="contract"
              value={typeName}
              disabled={editMode}
              options={types.map((type) => ({ label: type.displayName, value: type.name }))}
              onChange={(e) => changeType(e.value)}
              placeholder="Select a type"
            />
            {selectedType?.description && (
              <small className="text-fg-secondary">{selectedType.description}</small>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="connectionDescription">Description</label>
          <InputTextarea
            id="connectionDescription"
            value={description}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this connection is for"
          />
        </div>

        {selectedType && schema && (
          <DynamicSchemaForm
            // Remounting on a type change resets the form to the new
            // schema's defaults instead of carrying stale values over.
            key={selectedType.name}
            schema={schema}
            initialValues={initialValues}
            onParametersChange={(params) => setValues(params as ConnectionValues)}
          />
        )}

        {selectedType && (
          <CredentialsBlock
            contract={selectedType}
            mode={credentialsMode}
            onModeChange={setCredentialsMode}
            values={credentials}
            onValueChange={(field, value) => setCredentials((c) => ({ ...c, [field]: value }))}
            existingSecret={existingSecret}
            onExistingSecretChange={setExistingSecret}
            editMode={editMode}
          />
        )}

        {/* The confirm button is disabled until the form is complete. Naming
            what is missing beats leaving the user to hunt for it. */}
        {selectedType && [...missingFields, ...missingCredentials].length > 0 && (
          <small className="field-hint">
            Still to fill in: {[...missingFields, ...missingCredentials].join(', ')}.
          </small>
        )}

        {testResult && <ConnectionTestReport result={testResult} />}
        {error && <Message severity="error" text={error} />}
      </div>
    </Dialog>
  );
}
