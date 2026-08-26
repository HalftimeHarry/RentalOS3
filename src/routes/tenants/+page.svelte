<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';

  type UserRecord = {
    id: string;
    email?: string;
    name?: string;
    avatar?: string;
    role?: string;
    created?: string;
    updated?: string;
    verified?: boolean;
    emailVisibility?: boolean;
  };

  type RenterRecord = {
    id: string;
    user: string;
    status?: 'applying' | 'active' | 'in-active' | string;
    tenant_name?: string;
    tenant_email?: string;
    creditData?: string[];
    appData?: string[];
    damageData?: string[];
    created?: string;
    updated?: string;
    expand?: {
      user?: {
        id?: string;
        name?: string;
        email?: string;
        role?: string;
      };
    };
  };

  type TenantRow = UserRecord & {
    renter?: RenterRecord | null;
    fileCount: number;
  };

  let { data } = $props();
  let rows = $derived<TenantRow[]>(data.rows ?? []);
  let error = $derived<string | null>(data.error ?? null);
  let searchText = $state(data.search ?? '');
  let sortValue = $state(data.sort ?? '-created');
  let perPageValue = $state(String(data.perPage ?? 12));
  let currentPage = $derived(data.page ?? 1);
  let totalPages = $derived(data.totalPages ?? 1);
  let totalItems = $derived(data.totalItems ?? rows.length);

  const formatDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  };

  const getDisplayName = (user: TenantRow) => user.renter?.tenant_name || user.renter?.expand?.user?.name || user.name || 'Unnamed user';
  const getEmail = (user: TenantRow) => user.renter?.tenant_email || user.renter?.expand?.user?.email || user.email || '—';
  const getRawUserId = (user: TenantRow) => user.renter?.user || user.id || '—';
  const getUserFieldLabel = (user: TenantRow) => getDisplayName(user) === 'Unnamed user' ? getRawUserId(user) : getDisplayName(user);

  const getStoredFileNames = (files?: string[] | null) => (files ?? []).filter((file) => typeof file === 'string' && file.trim().length > 0);
  const getVisibleFileNames = (tenantId: string, field: 'creditData' | 'appData' | 'damageData', existingFiles?: string[] | null) => {
    const selectedFiles = getSelectedTenantFiles(tenantId, field);
    if (selectedFiles.length > 0) {
      return selectedFiles.map((file) => file.name);
    }

    return getStoredFileNames(existingFiles);
  };

  let previewFile = $state<{ url: string; name: string } | null>(null);
  let statusModal = $state<{
    tenantId: string;
    userName: string;
    email: string;
    status: 'applying' | 'active' | 'in-active';
  } | null>(null);

  const statusOptions = ['applying', 'active', 'in-active'] as const;

  const normalizeStatusValue = (status?: string | null): 'applying' | 'active' | 'in-active' => {
    const value = status?.toLowerCase?.() ?? 'applying';
    if (value === 'applying' || value === 'active' || value === 'in-active') return value;
    return 'applying';
  };

  const openFilePreview = (tenant: RenterRecord | null | undefined, field: 'creditData' | 'appData' | 'damageData', fileName: string) => {
    if (!tenant || !fileName) return;
    previewFile = {
      url: pocketbase.client.files.getURL(tenant, fileName),
      name: fileName
    };
  };

  const applyFilters = () => {
    const params = new URLSearchParams(page.url.searchParams.toString());
    if (searchText.trim()) {
      params.set('search', searchText.trim());
    } else {
      params.delete('search');
    }
    params.set('sort', sortValue);
    params.set('perPage', perPageValue);
    params.set('page', '1');
    goto(`/tenants?${params.toString()}`);
  };

  const changePage = (nextPage: number) => {
    const params = new URLSearchParams(page.url.searchParams.toString());
    params.set('page', String(nextPage));
    goto(`/tenants?${params.toString()}`);
  };

  const selectedTenantFiles = $state<Record<string, Record<'creditData' | 'appData' | 'damageData', File[]>>>({});

  const getSelectedTenantFiles = (tenantId: string, field: 'creditData' | 'appData' | 'damageData') =>
    selectedTenantFiles[tenantId]?.[field] ?? [];

  const setSelectedTenantFiles = (
    tenantId: string,
    field: 'creditData' | 'appData' | 'damageData',
    files: FileList | null
  ) => {
    const tenantFiles = selectedTenantFiles[tenantId] ?? { creditData: [], appData: [], damageData: [] };
    tenantFiles[field] = files && files.length > 0 ? Array.from(files) : [];
    selectedTenantFiles[tenantId] = { ...tenantFiles };
  };

  const uploadTenantFiles = async (tenantId: string, field: 'creditData' | 'appData' | 'damageData') => {
    const files = getSelectedTenantFiles(tenantId, field);
    if (!tenantId || files.length === 0) return;

    try {
      const formData = new FormData();
      const tenant = await pocketbase.client.collection('tenants').getOne(tenantId);
      formData.append('user', tenant.user ?? tenantId);

      files.forEach((file) => {
        formData.append(field, file, file.name);
      });

      await pocketbase.client.collection('tenants').update(tenantId, formData);
      selectedTenantFiles[tenantId] = {
        ...(selectedTenantFiles[tenantId] ?? { creditData: [], appData: [], damageData: [] }),
        [field]: []
      };
      await invalidateAll();
    } catch (error) {
      console.error('[tenants] failed to upload tenant files:', error);
    }
  };

  const saveAllTenantFiles = async (tenantId: string) => {
    if (!tenantId) return;

    const tenantFiles = selectedTenantFiles[tenantId] ?? { creditData: [], appData: [], damageData: [] };
    const fieldsToSave = (['creditData', 'appData', 'damageData'] as const).filter(
      (field) => tenantFiles[field].length > 0
    );

    if (fieldsToSave.length === 0) return;

    try {
      const formData = new FormData();
      const tenant = await pocketbase.client.collection('tenants').getOne(tenantId);
      formData.append('user', tenant.user ?? tenantId);

      fieldsToSave.forEach((field) => {
        tenantFiles[field].forEach((file) => {
          formData.append(field, file, file.name);
        });
      });

      await pocketbase.client.collection('tenants').update(tenantId, formData);
      selectedTenantFiles[tenantId] = {
        creditData: [],
        appData: [],
        damageData: []
      };
      await invalidateAll();
    } catch (error) {
      console.error('[tenants] failed to save all tenant files:', error);
    }
  };

  const openStatusModal = (tenant: RenterRecord | null | undefined, user: TenantRow) => {
    if (!tenant) return;
    statusModal = {
      tenantId: tenant.id,
      userName: getDisplayName(user),
      email: getEmail(user),
      status: normalizeStatusValue(tenant.status)
    };
  };

  const saveTenantStatus = async () => {
    if (!statusModal) return;

    try {
      await pocketbase.client.collection('tenants').update(statusModal.tenantId, {
        status: statusModal.status
      });
      statusModal = null;
      await invalidateAll();
    } catch (error) {
      console.error('[tenants] failed to update tenant status:', error);
    }
  };
</script>

<svelte:head>
  <title>Tenants · RentalOS3</title>
</svelte:head>

<div class="page-header">
  <div>
    <p class="page-kicker">People</p>
    <h1>Tenants</h1>
    <p class="muted">Connected user records and renter profile data.</p>
  </div>
</div>

<section class="panel toolbar">
  <div class="toolbar-row">
    <input
      bind:value={searchText}
      type="search"
      placeholder="Search tenants..."
      aria-label="Search tenants"
      class="search-input"
    />
    <select bind:value={sortValue} class="select-input" aria-label="Sort tenants">
      <option value="-created">Newest first</option>
      <option value="created">Oldest first</option>
      <option value="name">Name A-Z</option>
      <option value="-name">Name Z-A</option>
      <option value="email">Email A-Z</option>
      <option value="-email">Email Z-A</option>
    </select>
    <select bind:value={perPageValue} class="select-input" aria-label="Results per page">
      <option value="6">6 per page</option>
      <option value="12">12 per page</option>
      <option value="24">24 per page</option>
      <option value="48">48 per page</option>
    </select>
    <button class="primary-button" type="button" onclick={applyFilters}>Apply</button>
  </div>
</section>

{#if error}
  <section class="panel empty-state">
    <h2>Could not load tenants</h2>
    <p class="muted">{error}</p>
  </section>
{:else}
  <div class="results-summary">
    <span>{totalItems} total tenants</span>
    <span>Page {currentPage} of {totalPages}</span>
  </div>

  {#if previewFile}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close document preview"
      onclick={() => (previewFile = null)}
      onkeydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          previewFile = null;
        }
      }}
    >
      <div class="preview-panel" role="dialog" aria-modal="true" aria-label="Uploaded document preview" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => {
        if (event.key === 'Escape') previewFile = null;
      }}>
        <div class="modal-header">
          <div>
            <p class="page-kicker">Document preview</p>
            <h2>{previewFile.name}</h2>
          </div>
          <button class="icon-button" type="button" onclick={() => (previewFile = null)} aria-label="Close document preview">×</button>
        </div>

        <div class="preview-body">
          {#if /\.pdf$/i.test(previewFile.name)}
            <iframe src={previewFile.url} title={previewFile.name} class="preview-frame"></iframe>
          {:else}
            <a class="preview-link" href={previewFile.url} target="_blank" rel="noreferrer">Open file in a new tab</a>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if statusModal}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close tenant status dialog"
      onclick={() => (statusModal = null)}
      onkeydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          statusModal = null;
        }
      }}
    >
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="Edit tenant status" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => {
        if (event.key === 'Escape') statusModal = null;
      }}>
        <div class="modal-header">
          <div>
            <p class="page-kicker">Tenant details</p>
            <h2>Edit status</h2>
          </div>
          <button class="icon-button" type="button" onclick={() => (statusModal = null)} aria-label="Close tenant status modal">×</button>
        </div>

        <div class="status-modal-content">
          <p class="status-modal-name">{statusModal.userName}</p>
          <p class="status-modal-email">{statusModal.email}</p>
          <label class="status-modal-label">
            Status
            <select bind:value={statusModal.status} class="select-input compact">
              {#each statusOptions as option}
                <option value={option}>{option}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="modal-actions">
          <button class="button-secondary" type="button" onclick={() => (statusModal = null)}>Cancel</button>
          <button class="button-primary" type="button" onclick={() => void saveTenantStatus()}>Save</button>
        </div>
      </div>
    </div>
  {/if}

  <section class="tenant-grid">
    {#each rows as user}
      <article class="panel tenant-card">
        <div class="tenant-head">
          {#if user.avatar}
            <img class="avatar" src={user.avatar} alt={user.name ?? 'User avatar'} />
          {:else}
            <div class="avatar placeholder">{(user.name ?? 'U').charAt(0).toUpperCase()}</div>
          {/if}
          <div class="tenant-title-wrap">
            <h2>{getDisplayName(user)}</h2>
            <span class="role-badge {user.role === 'admin' ? 'admin' : 'renter'}">{user.role || 'renter'}</span>
          </div>
          {#if user.renter}
            <button class="edit-button tenant-edit-button" type="button" onclick={() => openStatusModal(user.renter, user)}>Edit</button>
          {/if}
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Email</span>
            <strong>{getEmail(user)}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">User ID</span>
            <strong>{getRawUserId(user)}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">Verified</span>
            <strong>{user.verified ? 'Yes' : 'No'}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">Created</span>
            <strong>{formatDate(user.created)}</strong>
          </div>
        </div>

        <div class="renter-panel">
          <div class="renter-header">
            <h3>Renter record</h3>
            {#if user.renter}
              <button class="edit-button" type="button" onclick={() => openStatusModal(user.renter, user)}>Edit</button>
            {/if}
          </div>

          {#if user.renter}
            <dl class="field-list">
              <div class="field-row">
                <dt>id</dt>
                <dd>{user.renter.id || '—'}</dd>
              </div>
              <div class="field-row">
                <dt>user</dt>
                <dd>
                  <span class="field-primary">{getUserFieldLabel(user)}</span>
                  {#if getDisplayName(user) !== getRawUserId(user)}
                    <span class="field-secondary">{getRawUserId(user)}</span>
                  {/if}
                </dd>
              </div>
              <div class="field-row">
                <dt>status</dt>
                <dd>
                  <span class="status-pill {user.renter.status ?? 'applying'}">{user.renter.status ?? 'applying'}</span>
                </dd>
              </div>
              <div class="field-row">
                <dt>creditData</dt>
                <dd>
                  <span>{user.renter.creditData?.length ? `${user.renter.creditData.length} file(s)` : '[]'}</span>
                  <div class="upload-stack">
                    <label class="upload-inline">
                      <input type="file" multiple onchange={(event) => setSelectedTenantFiles(user.renter?.id ?? user.id, 'creditData', event.currentTarget.files)} />
                      <span>Select file</span>
                    </label>
                    <div class="selected-file-list">
                      {#if getVisibleFileNames(user.renter?.id ?? user.id, 'creditData', user.renter?.creditData).length}
                        {#each getVisibleFileNames(user.renter?.id ?? user.id, 'creditData', user.renter?.creditData) as fileName}
                          <button class="file-link-button" type="button" onclick={() => openFilePreview(user.renter, 'creditData', fileName)}>
                            <span class="file-icon" aria-hidden="true">📄</span>
                            <span>{fileName}</span>
                          </button>
                        {/each}
                      {:else}
                        <span class="selected-file-name">No file chosen</span>
                      {/if}
                    </div>
                    <button class="upload-button" type="button" onclick={() => void uploadTenantFiles(user.renter?.id ?? user.id, 'creditData')} disabled={!getSelectedTenantFiles(user.renter?.id ?? user.id, 'creditData').length}>Save</button>
                  </div>
                </dd>
              </div>
              <div class="field-row">
                <dt>appData</dt>
                <dd>
                  <span>{user.renter.appData?.length ? `${user.renter.appData.length} file(s)` : '[]'}</span>
                  <div class="upload-stack">
                    <label class="upload-inline">
                      <input type="file" multiple onchange={(event) => setSelectedTenantFiles(user.renter?.id ?? user.id, 'appData', event.currentTarget.files)} />
                      <span>Select file</span>
                    </label>
                    <div class="selected-file-list">
                      {#if getVisibleFileNames(user.renter?.id ?? user.id, 'appData', user.renter?.appData).length}
                        {#each getVisibleFileNames(user.renter?.id ?? user.id, 'appData', user.renter?.appData) as fileName}
                          <button class="file-link-button" type="button" onclick={() => openFilePreview(user.renter, 'appData', fileName)}>
                            <span class="file-icon" aria-hidden="true">📄</span>
                            <span>{fileName}</span>
                          </button>
                        {/each}
                      {:else}
                        <span class="selected-file-name">No file chosen</span>
                      {/if}
                    </div>
                    <button class="upload-button" type="button" onclick={() => void uploadTenantFiles(user.renter?.id ?? user.id, 'appData')} disabled={!getSelectedTenantFiles(user.renter?.id ?? user.id, 'appData').length}>Save</button>
                  </div>
                </dd>
              </div>
              <div class="field-row">
                <dt>damageData</dt>
                <dd>
                  <span>{user.renter.damageData?.length ? `${user.renter.damageData.length} file(s)` : '[]'}</span>
                  <div class="upload-stack">
                    <label class="upload-inline">
                      <input type="file" multiple onchange={(event) => setSelectedTenantFiles(user.renter?.id ?? user.id, 'damageData', event.currentTarget.files)} />
                      <span>Select file</span>
                    </label>
                    <div class="selected-file-list">
                      {#if getVisibleFileNames(user.renter?.id ?? user.id, 'damageData', user.renter?.damageData).length}
                        {#each getVisibleFileNames(user.renter?.id ?? user.id, 'damageData', user.renter?.damageData) as fileName}
                          <button class="file-link-button" type="button" onclick={() => openFilePreview(user.renter, 'damageData', fileName)}>
                            <span class="file-icon" aria-hidden="true">📄</span>
                            <span>{fileName}</span>
                          </button>
                        {/each}
                      {:else}
                        <span class="selected-file-name">No file chosen</span>
                      {/if}
                    </div>
                    <button class="upload-button" type="button" onclick={() => void uploadTenantFiles(user.renter?.id ?? user.id, 'damageData')} disabled={!getSelectedTenantFiles(user.renter?.id ?? user.id, 'damageData').length}>Save</button>
                  </div>
                </dd>
              </div>
            </dl>

            <div class="save-all-bar">
              <button
                class="upload-button primary"
                type="button"
                onclick={() => void saveAllTenantFiles(user.renter?.id ?? user.id)}
                disabled={!Object.values(selectedTenantFiles[user.renter?.id ?? user.id] ?? { creditData: [], appData: [], damageData: [] }).some((files) => files.length > 0)}
              >
                Save all files
              </button>
            </div>
          {:else}
            <p class="no-renter">No renter profile linked to this user.</p>
          {/if}
        </div>
      </article>
    {/each}
  </section>

  <div class="pagination">
    <button type="button" class="secondary-button" disabled={currentPage <= 1} onclick={() => changePage(currentPage - 1)}>Previous</button>
    <span>Page {currentPage} / {totalPages}</span>
    <button type="button" class="secondary-button" disabled={currentPage >= totalPages} onclick={() => changePage(currentPage + 1)}>Next</button>
  </div>
{/if}

<style>
  .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 22px; }
  .add-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid #cfe0bd; background: #edf5d9; color: #183b35; border-radius: 999px; padding: 10px 16px; font-weight: 700; cursor: pointer; }
  .page-kicker { margin: 0 0 8px; color: #688078; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .muted { color: #71837c; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(20, 39, 35, 0.52); display: grid; place-items: center; padding: 20px; z-index: 50; }
  .modal-panel { width: min(100%, 460px); background: white; border-radius: 18px; padding: 24px; border: 1px solid #dfe8df; box-shadow: 0 20px 50px rgba(15, 31, 28, 0.18); }
  .modal-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
  .modal-header h2 { margin: 0; }
  .icon-button { border: 0; background: #f4f8f2; color: #183b35; width: 34px; height: 34px; border-radius: 999px; font-size: 22px; cursor: pointer; }
  .form-error { margin: 0; color: #a14c3b; font-size: 13px; }
  .selected-file-list { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .file-link-button { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #dfe8df; background: #f5faf4; color: #183b35; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .file-icon { font-size: 14px; }
  .preview-panel { width: min(100%, 820px); background: white; border-radius: 18px; padding: 24px; border: 1px solid #dfe8df; box-shadow: 0 20px 50px rgba(15, 31, 28, 0.18); }
  .preview-body { display: grid; place-items: center; min-height: 420px; background: #f8faf8; border: 1px solid #eaf0ea; border-radius: 14px; overflow: hidden; }
  .preview-frame { width: 100%; min-height: 420px; border: 0; background: white; }
  .preview-link { color: #183b35; font-weight: 700; text-decoration: underline; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }
  .button-primary, .button-secondary { border-radius: 999px; padding: 10px 16px; font-weight: 700; cursor: pointer; }
  .button-primary { border: 1px solid #183b35; background: #183b35; color: white; }
  .button-secondary { border: 1px solid #dfe8df; background: white; color: #183b35; }
  .button-primary:disabled { opacity: 0.7; cursor: wait; }
  .empty-state { display: grid; gap: 8px; }
  .panel { background: #fff; border: 1px solid #dfe8df; border-radius: 16px; padding: 22px; box-shadow: 0 10px 30px rgba(24, 59, 53, 0.05); }
  .toolbar { margin-bottom: 18px; }
  .toolbar-row { display: grid; grid-template-columns: minmax(180px, 1fr) 180px 150px auto; gap: 12px; align-items: center; }
  .search-input, .select-input { width: 100%; border: 1px solid #dfe8df; border-radius: 10px; background: #fbfdfb; color: #183b35; padding: 11px 12px; font: inherit; }
  .primary-button, .secondary-button { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; padding: 11px 16px; font-weight: 700; border: 1px solid transparent; cursor: pointer; }
  .primary-button { background: #183b35; color: white; }
  .secondary-button { background: #f8faf7; color: #183b35; border-color: #dfe8df; }
  .secondary-button:disabled { opacity: 0.5; cursor: not-allowed; }
  .results-summary { display: flex; justify-content: space-between; align-items: center; margin: 0 0 16px; color: #71837c; font-size: 13px; font-weight: 600; }
  .tenant-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
  .tenant-card { display: grid; gap: 18px; }
  .tenant-head { display: flex; align-items: center; gap: 14px; }
  .avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; display: block; border: 1px solid #dfe8df; }
  .avatar.placeholder { display: inline-flex; align-items: center; justify-content: center; background: #edf5d9; color: #183b35; font-weight: 700; font-size: 1.2rem; }
  .tenant-title-wrap { display: grid; gap: 6px; }
  .tenant-title-wrap h2 { margin: 0; font-size: 1.2rem; }
  .role-badge { display: inline-flex; align-items: center; justify-content: center; width: max-content; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .role-badge.admin { background: #e9f8e5; color: #1c6c42; }
  .role-badge.renter { background: #fff2d9; color: #8d5a00; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .meta-item { display: grid; gap: 6px; padding: 12px 14px; border-radius: 12px; background: #f8faf7; border: 1px solid #edf1ee; }
  .meta-label { color: #71837c; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .renter-panel { display: grid; gap: 12px; padding: 16px; border-radius: 12px; border: 1px solid #edf1ee; background: #f8faf7; }
  .renter-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .renter-header h3 { margin: 0; font-size: 1rem; }
  .edit-button { appearance: none; border: 1px solid #183b35; background: #183b35; color: white; border-radius: 10px; padding: 9px 14px; font-weight: 800; cursor: pointer; box-shadow: 0 6px 16px rgba(24, 59, 53, 0.16); transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .edit-button:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(24, 59, 53, 0.2); }
  .tenant-edit-button { margin-left: auto; min-width: 88px; }
  .field-list { display: grid; gap: 10px; margin: 0; }
  .field-row { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; background: #fff; border: 1px solid #edf1ee; }
  .field-row dt { color: #71837c; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .field-row dd { margin: 0; color: #183b35; word-break: break-word; display: grid; gap: 8px; }
  .field-primary { font-weight: 700; }
  .field-secondary { color: #71837c; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word; }
  .status-pill { display: inline-flex; width: fit-content; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .status-pill.applying { background: #fff2d9; color: #8d5a00; }
  .status-pill.active { background: #e9f8e5; color: #1c6c42; }
  .status-pill.in-active { background: #f1f6f9; color: #446577; }
  .status-modal-content { display: grid; gap: 10px; }
  .status-modal-name { margin: 0; font-size: 1.05rem; font-weight: 700; color: #183b35; }
  .status-modal-email { margin: 0; color: #71837c; }
  .status-modal-label { display: grid; gap: 8px; color: #294744; font-size: 13px; font-weight: 600; }
  .select-input.compact { padding: 8px 10px; border-radius: 8px; }
  .upload-stack { display: grid; gap: 8px; }
  .upload-inline { display: inline-flex; align-items: center; justify-content: center; position: relative; overflow: hidden; border-radius: 999px; border: 1px solid #cfe0bd; background: #edf5d9; color: #183b35; padding: 8px 12px; font-size: 12px; font-weight: 700; cursor: pointer; width: fit-content; }
  .upload-inline input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .selected-file-name { color: #183b35; font-size: 12px; font-weight: 600; word-break: break-word; }
  .upload-button { border: 1px solid #183b35; background: #183b35; color: white; border-radius: 999px; padding: 8px 12px; font-weight: 700; cursor: pointer; }
  .upload-button:disabled { opacity: 0.5; cursor: not-allowed; }
  .no-renter { margin: 0; color: #71837c; }
  .pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 18px; color: #183b35; font-weight: 600; }
  strong { color: #183b35; word-break: break-word; }

  @media (max-width: 720px) {
    .toolbar-row { grid-template-columns: 1fr; }
    .results-summary, .pagination { flex-direction: column; align-items: flex-start; }
  }
</style>
