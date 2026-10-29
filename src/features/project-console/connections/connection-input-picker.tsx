import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import {
  connectionApi,
  type ContractDescriptor,
  type SelectableConnection,
} from '../../../core/api/connection-api';
import type { PackageInput } from '../../../core/api/service-api';
import { ConnectionFormDialog } from './connection-form-dialog';

/** Internal sentinel for "no connection": PrimeReact's Dropdown mishandles an
 *  option whose value is the empty string, so the option carries this value and
 *  the picker reports '' to its parent: the package resolves an empty parameter
 *  to a name nothing can be called, and skips the binding. */
const NONE = '__none__';

interface PickerChoice {
  status?: string;
  label: string;
  value: string;
  description?: string;
}

/**
 * One picker per input the service's package declares: choose an existing
 * connection of the right contract, managed ones included, leave it empty when
 * the package allows, or create one on the spot: same form and same Test button
 * as the Connections page, with the type fixed by the input's contract.
 */
export function ConnectionInputPicker({
  projectId,
  input,
  value,
  onChange,
}: {
  projectId: string;
  input: PackageInput;
  value: string;
  onChange: (connectionName: string) => void;
}) {
  const [selectable, setSelectable] = useState<SelectableConnection[]>([]);
  /** The descriptor answering this contract, when a user may declare one by
   *  hand. Null for an internal-only contract (trino, ...), where nothing is
   *  offered. */
  const [creatableType, setCreatableType] = useState<ContractDescriptor | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Loading and failure are not the same as "nothing matches": saying "no
   *  compatible connection" while the request is in flight, or after it failed,
   *  sends the user off to create a duplicate of what already exists. */
  const [state, setState] = useState<'loading' | 'error' | 'loaded'>('loading');

  const reload = useCallback(() => {
    setState('loading');
    connectionApi
      .selectable(projectId, input.contract)
      .then((found) => {
        setSelectable(found);
        setState('loaded');
      })
      .catch(() => {
        setSelectable([]);
        setState('error');
      });
  }, [projectId, input.contract]);

  useEffect(() => {
    reload();
    connectionApi
      .catalog()
      .then((catalog) => {
        const found = catalog.types.find((type) => type.name === input.contract);
        // Without the connection CRDs nothing can be persisted, so offering the
        // creation form here would end on a 501 the picker cannot explain.
        setCreatableType(found && found.external && catalog.crdAvailable ? found : null);
      })
      .catch(() => setCreatableType(null));
  }, [reload, input.contract]);

  const options = useMemo<PickerChoice[]>(() => {
    const choices: PickerChoice[] = selectable.map((connection) => ({
      label: connection.name,
      value: connection.name,
      // The status belongs here: a candidate in ERROR is offered like any other,
      // and picking it leaves the release waiting with nothing to explain why.
      status: connection.status,
      description: connection.managed
        ? `Provided by ${connection.providedBy || 'a deployed service'}`
        : connection.description,
    }));
    // "Nothing chosen" is not always "no connection". When the package carries
    // a default, it is a template rendered against the Environment, which is
    // how an Environment says "here, the database is that one". Calling that
    // None, and writing an empty parameter for it, destroyed the inheritance in
    // silence.
    if (input.default) {
      choices.unshift({
        label: 'Inherited from the Environment',
        value: NONE,
        description: 'The Environment decides which connection this service gets',
      });
    } else if (input.optional) {
      choices.unshift({ label: 'None', value: NONE, description: 'Deploy without this connection' });
    }
    return choices;
  }, [selectable, input.optional, input.default]);

  // An optional input, or one the Environment answers for, starts (and stays,
  // unless picked) on that first entry.
  const hasFallback = input.optional || Boolean(input.default);
  const displayedValue = hasFallback ? value || NONE : value || undefined;

  return (
    <div className="form-field" data-testid={`connection-input-${input.alias}`}>
      <div className="field-head">
        <label style={{ margin: 0 }}>
          Connection: {input.alias}
          <span className="muted-text small"> ({input.contract})</span>
        </label>
        {/* Creating is only offered for contracts a user may declare by hand:
            an internal-only contract (trino, ...) exists because a service does. */}
        {creatableType && (
          <Button
            type="button"
            label="New connection"
            icon="pi pi-plus"
            text
            onClick={() => setCreateOpen(true)}
          />
        )}
      </div>
      <small className="field-hint" style={{ marginTop: 0, marginBottom: '10px' }}>
        {input.description ||
          (input.default
            ? 'The Environment provides one by default. Pick another to override it.'
            : input.optional
              ? 'Optional: pick an existing connection, or leave it to None.'
              : 'Required: this service needs a connection of this type.')}
      </small>
      <Dropdown
        value={displayedValue}
        options={options}
        optionLabel="label"
        optionValue="value"
        placeholder={
          state === 'loading'
            ? 'Loading connections...'
            : state === 'error'
              ? 'Could not load connections'
              : options.length === 0
                ? 'No compatible connection available'
                : 'Select a connection'
        }
        disabled={state === 'loading'}
        appendTo={document.body}
        className="w-full"
        onChange={(e) => onChange(e.value === NONE ? '' : (e.value as string))}
        itemTemplate={(option: PickerChoice) => (
          <div>
            <div>
              {option.label}
              {option.status && option.status !== 'READY' && (
                <span className="muted-text small"> [{option.status}]</span>
              )}
            </div>
            {option.description && (
              <div className="muted-text small">{option.description}</div>
            )}
          </div>
        )}
      />

      {createOpen && creatableType && (
        <ConnectionFormDialog
          projectId={projectId}
          types={[creatableType]}
          typeFixed
          confirmLabel="Create and select"
          onHide={() => setCreateOpen(false)}
          onSaved={(name) => {
            setCreateOpen(false);
            reload();
            onChange(name);
          }}
        />
      )}
    </div>
  );
}

export default ConnectionInputPicker;
