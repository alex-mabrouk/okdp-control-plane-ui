import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ConnectionCatalog, SelectableConnection } from '../../../core/api/connection-api';
import type { PackageInput } from '../../../core/api/service-api';

const catalog = vi.fn();
const selectable = vi.fn();
const create = vi.fn();
const test = vi.fn();

vi.mock('../../../core/api/connection-api', () => ({
  connectionApi: {
    catalog: () => catalog(),
    selectable: (...args: unknown[]) => selectable(...args),
    project: () => ({ create, test }),
  },
}));

import { ConnectionInputPicker } from './connection-input-picker';

const CATALOG: ConnectionCatalog = {
  crdAvailable: true,
  types: [
    {
      name: 'database-server',
      displayName: 'PostgreSQL',
      description: 'PostgreSQL database server.',
      icon: 'pi pi-database',
      category: 'database',
      external: true,
      fields: [{ name: 'host', label: 'Host', type: 'string', required: true }],
    },
    {
      name: 'trino',
      displayName: 'Trino',
      description: 'Trino query engine.',
      icon: 'pi pi-server',
      category: 'query-engine',
      external: false,
      fields: [],
    },
  ],
};

const SELECTABLE: SelectableConnection[] = [
  {
    name: 'rnacentral',
    scope: 'project',
    type: 'database-server',
    status: 'READY',
    description: 'Public database',
    managed: false,
  },
  {
    // Published by a deployed release rather than declared by hand.
    name: 'demo-trino-endpoint',
    scope: 'project',
    type: 'database-server',
    status: 'READY',
    managed: true,
    providedBy: 'demo-trino',
  },
];

const INPUT: PackageInput = {
  alias: 'warehouse',
  contract: 'database-server',
  parameter: 'pgConnection',
  optional: true,
};

function renderPicker(input: PackageInput = INPUT, value = '', onChange = vi.fn()) {
  return {
    onChange,
    ...render(
      <ConnectionInputPicker projectId="demo" input={input} value={value} onChange={onChange} />,
    ),
  };
}

describe('ConnectionInputPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalog.mockResolvedValue(CATALOG);
    selectable.mockResolvedValue(SELECTABLE);
  });

  it('should offer the compatible connections, saying who provides a managed one', async () => {
    renderPicker();
    await waitFor(() => expect(selectable).toHaveBeenCalledWith('demo', 'database-server'));

    fireEvent.click(screen.getByRole('button', { name: /Select a connection/ }));

    expect(await screen.findByText('rnacentral')).toBeInTheDocument();
    expect(screen.getByText(/Provided by demo-trino/)).toBeInTheDocument();
  });

  it('should offer None when the package tolerates no connection', async () => {
    renderPicker();
    await waitFor(() => expect(selectable).toHaveBeenCalled());

    // Selected label and panel entry both say None, since an optional input
    // defaults to it before any pick.
    expect((await screen.findAllByText('None')).length).toBeGreaterThan(0);
  });

  it('should not offer None on a required input', async () => {
    renderPicker({ ...INPUT, optional: false });
    await waitFor(() => expect(selectable).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Select a connection/ }));

    expect(await screen.findByText('rnacentral')).toBeInTheDocument();
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });

  it('should report the chosen connection name', async () => {
    const { onChange } = renderPicker();
    await waitFor(() => expect(selectable).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Select a connection/ }));
    fireEvent.click(await screen.findByText('rnacentral'));

    expect(onChange).toHaveBeenCalledWith('rnacentral');
  });

  it('should offer creating a connection for a user-declarable contract', async () => {
    renderPicker();

    expect(await screen.findByRole('button', { name: /New connection/ })).toBeInTheDocument();
  });

  // A trino connection exists because a Trino is deployed, so there is nothing
  // a user could type into a creation form.
  it('should not offer creating for an internal-only contract', async () => {
    renderPicker({ alias: 'engine', contract: 'trino', parameter: 'trinoConnection', optional: true });
    await waitFor(() => expect(catalog).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /New connection/ })).not.toBeInTheDocument();
  });

  it('should create on the spot, then select the new connection', async () => {
    create.mockResolvedValue({ name: 'fresh-pg' });
    const { onChange } = renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /New connection/ }));
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'fresh-pg' },
    });
    fireEvent.change(await screen.findByLabelText(/^Host\b/), {
      target: { value: 'db.corp.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create and select/ }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'fresh-pg', type: 'database-server' }),
      ),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('fresh-pg'));
  });

  // The form is the one of the Connections page, with the type the input asks
  // for: offering another would create a connection the input cannot take.
  it('opens the Connections page form on the type of the input, without a choice', async () => {
    renderPicker();

    fireEvent.click(await screen.findByRole('button', { name: /New connection/ }));

    expect(await screen.findByText('New PostgreSQL connection')).toBeInTheDocument();
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });


  // KuboCD forbids a literal default on a connectionRef: it is always a
  // template rendered against the Context, which is how an Environment says
  // "here, the database is that one". Showing None for it, and writing an empty
  // parameter, destroyed the inheritance in silence.
  it('says a binding is inherited rather than calling it None', async () => {
    renderPicker({
      alias: 'db',
      contract: 'database-server',
      parameter: 'db',
      optional: false,
      default: '{{ .Context.defaultDatabase }}',
    });

    await waitFor(() => expect(selectable).toHaveBeenCalled());

    expect(screen.getByText(/The Environment provides one by default/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox'));
    // Once as the selected value, once as the open option.
    expect(await screen.findAllByText('Inherited from the Environment')).not.toHaveLength(0);
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });
});
