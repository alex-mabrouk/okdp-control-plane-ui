import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Toast } from 'primereact/toast';
import { Message } from 'primereact/message';
import {
  connectionApi,
  type Connection,
  type ConnectionCatalog,
  type ConnectionConsumer,
} from '../../../core/api/connection-api';
import { apiErrorMessage, formatMediumDateTime } from '../services/service-utils';
import { connectionStatusTone } from './connection-status';
import { StatusTag } from '../../../shared/components/status-tag';
import { usePolledResources } from '../../../shared/hooks/use-polled-resources';
import SearchFilter from '../../../shared/components/search-filter';
import { PageHeader } from '../../../shared/components/page-header';
import { ConnectionDetailDialog } from './connection-detail-dialog';
import { ConnectionFormDialog } from './connection-form-dialog';
import { useToastMessages } from '../../../shared/hooks/use-toast-messages';
import { useRowActionsMenu } from '../../../shared/hooks/use-row-actions-menu';
import DeleteConfirmDialog from '../../../shared/components/delete-confirm-dialog';

// The comparator decides whether the polled list replaces the one in hand, and
// the edit dialog reads its values from that list: comparing only what the
// table paints would reopen the dialog on values a previous edit replaced.
const isConnectionChanged = (incoming: Connection, current: Connection) =>
  incoming.name !== current.name ||
  incoming.status !== current.status ||
  incoming.message !== current.message ||
  incoming.description !== current.description ||
  incoming.type !== current.type ||
  JSON.stringify(incoming.values) !== JSON.stringify(current.values) ||
  JSON.stringify(incoming.secretFields) !== JSON.stringify(current.secretFields) ||
  JSON.stringify(incoming.credentialsSecret) !== JSON.stringify(current.credentialsSecret);

/** Connections to resources living outside the platform, a corporate
 *  PostgreSQL or an S3 bucket, declared by the user and consumable by the
 *  services deployed in this project. */
export function ExternalConnectionList() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { toast, showSuccess, showError } = useToastMessages();

  const api = useMemo(
    () => connectionApi.project(projectId),
    [projectId],
  );

  const [catalog, setCatalog] = useState<ConnectionCatalog | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);
  // Who consumes the connection about to be deleted. Loaded when the dialog
  // opens: the answer only exists on the cluster, and it changes.
  // Three states, not two: still asking, could not ask, and the answer. A
  // dialog opened during the lookup must not announce a check as failed while
  // it is still running.
  const [consumers, setConsumers] = useState<ConnectionConsumer[] | 'loading' | null>(null);

  const [detail, setDetail] = useState<Connection | null>(null);
  // The connection form, open on a new connection or on the one to edit.
  const [form, setForm] = useState<{ connection?: Connection } | null>(null);

  const fetchList = useCallback(() => api.list(), [api]);

  const {
    items: connections,
    loading,
    reload,
  } = usePolledResources(
    projectId,
    fetchList,
    isConnectionChanged,
    useCallback(() => showError('Failed to load connections'), [showError]),
  );

  useEffect(() => {
    connectionApi
      .catalog()
      .then(setCatalog)
      .catch(() => showError('Failed to load the contracts'));
  }, [showError]);

  const creatableTypes = useMemo(
    () => (catalog?.types ?? []).filter((type) => type.external),
    [catalog],
  );
  const crdAvailable = catalog?.crdAvailable ?? true;

  const deleteConnection = (connection: Connection) => {
    api
      .delete(connection.name)
      .then(() => {
        showSuccess(`Connection "${connection.name}" deleted successfully`);
        reload();
      })
      .catch((err) => showError(apiErrorMessage(err, 'Failed to delete connection')));
  };

  const askDelete = (connection: Connection) => {
    setDeleteTarget(connection);
    setConsumers('loading');
    connectionApi
      .consumers(projectId, connection.name)
      .then(setConsumers)
      // Not knowing is not the same as nobody: the dialog says so.
      .catch(() => setConsumers(null));
  };

  const { menuElement, openMenu } = useRowActionsMenu<Connection>([
    { label: 'Details', icon: 'pi pi-info-circle', command: setDetail },
    { label: 'Edit', icon: 'pi pi-pencil', command: (connection) => setForm({ connection }) },
    { label: 'Delete', icon: 'pi pi-trash', command: askDelete },
  ]);

  const onCopied = (what: string) =>
    what ? showSuccess(`Copied ${what}`) : showError('Could not copy to the clipboard');

  return (
    <div>
      <Toast ref={toast} position="bottom-right" />

      <PageHeader
        title="External connections"
        actions={
          <button className="create-btn" onClick={() => setForm({})} disabled={!crdAvailable}>
            <i className="pi pi-plus"></i>
            <span>Add connection</span>
          </button>
        }
      />

      {!crdAvailable && (
        // The CRDs ship with a KuboCD version the platform does not run yet.
        // Say so plainly rather than letting the user fill a form that cannot
        // be saved.
        <Message
          severity="info"
          className="mb-4 w-full justify-start"
          text="External connections need the KuboCD connection CRDs, which are not installed on this cluster yet. Internal connections are unaffected."
        />
      )}

      <SearchFilter
        value={globalFilter}
        onChange={setGlobalFilter}
        placeholder="Filter connections..."
      />

      <div className="table-wrapper">
        <DataTable paginator rows={25} paginatorTemplate="PrevPageLink PageLinks NextPageLink" alwaysShowPaginator={false}
          value={connections}
          loading={loading}
          globalFilter={globalFilter}
          globalFilterFields={['name', 'type', 'description', 'status']}
          className="minimal-table"
          dataKey="name"
          rowClassName={() => 'cluster-row cursor-pointer'}
          onRowClick={(event) => setDetail(event.data as Connection)}
          emptyMessage={
            <div className="flex items-center justify-center gap-2 p-8 text-[14px] text-fg-secondary">
              <i className="pi pi-cloud text-[1.2rem] opacity-50"></i>
              <span>
                No external connection yet. Click <strong>Add connection</strong> to declare one.
              </span>
            </div>
          }
        >
          <Column
            header="Name"
            field="name"
            style={{ width: '22%' }}
            body={(connection: Connection) => (
              <span className="font-medium">{connection.name}</span>
            )}
          />
          <Column
            header="Type"
            field="type"
            style={{ width: '16%' }}
            body={(connection: Connection) => (
              <span className="inline-flex items-center gap-1.5 rounded-xs border border-border-light bg-surface-secondary px-2 py-[3px] text-[12px] font-medium text-fg-secondary">
                <i className="pi pi-cloud text-[11px]"></i>
                {catalog?.types.find((t) => t.name === connection.type)?.displayName ??
                  connection.type}
              </span>
            )}
          />
          <Column
            header="Description"
            style={{ width: '28%' }}
            className="max-w-0 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap text-fg-secondary"
            body={(connection: Connection) => (
              <span title={connection.description || ''}>{connection.description || '-'}</span>
            )}
          />
          <Column
            header="Status"
            field="status"
            style={{ width: '12%' }}
            body={(connection: Connection) => (
              <span title={connection.message || ''}>
                <StatusTag
                  value={connection.status || 'Unknown'}
                  tone={connectionStatusTone(connection.status)}
                />
              </span>
            )}
          />
          <Column
            header="Created"
            style={{ width: '14%' }}
            className="text-[13px] whitespace-nowrap text-fg-secondary"
            body={(connection: Connection) =>
              connection.createdAt ? formatMediumDateTime(connection.createdAt) : '-'
            }
          />
          <Column
            style={{ width: '8%', textAlign: 'right' }}
            body={(connection: Connection) => (
              <div className="actions">
                <Button
                  icon="pi pi-ellipsis-v"
                  text
                  rounded
                  aria-label={`Actions for ${connection.name}`}
                  onClick={(e) => {
                    // The row opens the detail dialog. The menu must not.
                    e.stopPropagation();
                    openMenu(connection, e);
                  }}
                />
              </div>
            )}
          />
        </DataTable>
        {menuElement}
      </div>

      {form && (
        <ConnectionFormDialog
          projectId={projectId}
          types={creatableTypes}
          connection={form.connection}
          onHide={() => setForm(null)}
          onSaved={(name) => {
            setForm(null);
            showSuccess(
              `Connection "${name}" ${form.connection ? 'updated' : 'created'} successfully`,
            );
            reload();
          }}
        />
      )}

      <DeleteConfirmDialog
        resourceName={deleteTarget?.name ?? null}
        resourceKind="connection"
        message={
          <>
            {/* The credentials Secret goes with the connection, so the pods
                mounting it fail at their next restart, not right away. Saying
                which services those are is the whole point of this dialog. */}
            {consumers === 'loading' ? (
              <span>Checking which services use this connection...</span>
            ) : consumers === null ? (
              <span>
                Could not check which services use this connection. Deleting it removes its
                credentials secret, and any service mounting that secret will fail to restart.
              </span>
            ) : consumers.length === 0 ? (
              <span>
                No service of this project is bound to it. Deleting it also removes its
                credentials secret.
              </span>
            ) : (
              <>
                <span>
                  {consumers.length === 1 ? 'This service uses it' : 'These services use it'}:{' '}
                  <strong>{consumers.map((c) => c.service).join(', ')}</strong>. Deleting the
                  connection removes its credentials secret too, so they will fail to start at
                  their next restart.
                </span>
              </>
            )}
          </>
        }
        onHide={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteConnection(deleteTarget);
          setDeleteTarget(null);
        }}
      />

      <ConnectionDetailDialog
        detail={
          detail && {
            name: detail.name,
            typeDisplay:
              catalog?.types.find((t) => t.name === detail.type)?.displayName ?? detail.type,
            icon: catalog?.types.find((t) => t.name === detail.type)?.icon,
            description: detail.description,
            status: detail.status,
            namespace: detail.namespace,
            message: detail.message,
            values: detail.values,
            credentialsSecret: detail.credentialsSecret,
          }
        }
        visible={detail !== null}
        onHide={() => setDetail(null)}
        onCopied={onCopied}
      />
    </div>
  );
}
