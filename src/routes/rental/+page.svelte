<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Edit3, Image } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { rentalService } from '$lib/services/RentalService';
  import type { Rental } from '$lib/models';

  const plainText = (value?: string | null) =>
    (value ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

  let rental = $state<Rental | null>(null);
  let editing = $state(false); let address = $state(''); let rent = $state(0); let saved = $state(false);
  const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);

  const getPhotoValidationError = (file: File) => {
    if (!(file instanceof File)) return 'Selected file is not valid.';
    if (!ALLOWED_PHOTO_TYPES.has(file.type)) return 'Only JPG and PNG photos are allowed.';
    if (file.size <= 0) return 'Selected image is empty.';
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      return `Photo is too large (${sizeMb} MB). Maximum allowed is 10 MB.`;
    }
    return null;
  };

  let pendingPhotos = $state<File[]>([]);
  let uploadingPhotos = $state(false);
  let pageError = $state('');
  let pageDebug = $state('');
  let photoUploadError = $state('');
  let photoUploadDebug = $state('');
  let selectedPhotoUrl = $state<string | null>(null);
  let photoSizeLabel = $derived(
    pendingPhotos.length
      ? `${(pendingPhotos.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024)).toFixed(2)} MB total`
      : ''
  );
  let isAdmin = $derived(pocketbase.client.authStore.model?.role === 'admin');
  let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'renter');
  let roleLabel = $derived(userRole === 'admin' ? 'Admin' : 'Renter');

  const getAssignedRenterLabel = () => {
    const tenant = rental?.expand?.tenant as Record<string, any> | undefined;
    const expandedUser = tenant?.expand?.user as Record<string, any> | undefined;
    const directTenant = (typeof rental?.tenant === 'object' ? rental.tenant as Record<string, any> : undefined) ?? undefined;
    const directRenter = (typeof rental?.renter === 'object' ? rental.renter as Record<string, any> : undefined) ?? undefined;

    return (
      tenant?.tenant_name ??
      tenant?.name ??
      expandedUser?.name ??
      directTenant?.tenant_name ??
      directTenant?.name ??
      directTenant?.user?.name ??
      directRenter?.name ??
      'Not assigned'
    );
  };

  const getAssignedRenterEmail = () => {
    const tenant = rental?.expand?.tenant as Record<string, any> | undefined;
    const expandedUser = tenant?.expand?.user as Record<string, any> | undefined;
    const directTenant = (typeof rental?.tenant === 'object' ? rental.tenant as Record<string, any> : undefined) ?? undefined;
    const directRenter = (typeof rental?.renter === 'object' ? rental.renter as Record<string, any> : undefined) ?? undefined;

    return (
      tenant?.tenant_email ??
      tenant?.email ??
      expandedUser?.email ??
      directTenant?.tenant_email ??
      directTenant?.email ??
      directTenant?.user?.email ??
      directRenter?.email ??
      ''
    );
  };

  let adminRows = $derived(rental ? [
    { label: 'collectionId', value: rental.collectionId ?? '—' },
    { label: 'collectionName', value: rental.collectionName ?? 'rental' },
    { label: 'id', value: rental.id ?? '—' },
    { label: 'address', value: plainText(rental.address) || '—' },
    { label: 'rent', value: String(rental.rent ?? 0) },
    { label: 'photos', value: rental.photos?.length ? rental.photos.join(', ') : '---' },
    { label: 'bills', value: rental.bills?.length ? rental.bills.join(', ') : '---' },
    { label: 'created', value: rental.created ?? '—' },
    { label: 'updated', value: rental.updated ?? '—' }
  ] : []);

  onMount(async () => {
    console.log('[rental page] MOUNT');
    const rentalId = page.url.searchParams.get('id');
    console.log('[rental page] rentalId:', rentalId);

    try {
      const fallbackRentalId = 'ox69y3qco02ymgp';
      if (rentalId) {
        rental = await rentalService.getById(rentalId);
      } else {
        rental = await rentalService.getCurrent();
        if (!rental) {
          console.log('[rental page] using fallback rental id:', fallbackRentalId);
          rental = await rentalService.getById(fallbackRentalId, { bypassUserScope: true });
        }
      }

      console.log('[rental page] rental:', rental);
      console.log('[rental page] adminRows:', adminRows);
    } catch (error) {
      console.error('[rental page] fetch error:', error);
      const status = error && typeof error === 'object' && 'status' in error ? String((error as any).status ?? 'unknown') : 'unknown';
      const message = error && typeof error === 'object' && 'message' in error ? String((error as any).message ?? 'Unknown error') : 'Unknown error';
      pageError = '500 Internal Error';
      pageDebug = [
        `status: ${status}`,
        `message: ${message}`,
        `role: ${getAuthRoleLabel()}`,
        `rentalId: ${rentalId ?? 'not provided'}`
      ].join('\n');
    }

    address = plainText(rental?.address) ?? '';
    rent = rental?.rent ?? 0;
  });

  async function save() {
    if (!rental) return;
    const cleanAddress = plainText(address);
    await rentalService.update(rental.id, { address: cleanAddress, rent });
    rental = { ...rental, address: cleanAddress, rent };
    address = cleanAddress;
    editing = false; saved = true; setTimeout(() => saved = false, 2500);
  }

  function openPhotoModal(url: string) {
    selectedPhotoUrl = url;
  }

  function closePhotoModal() {
    selectedPhotoUrl = null;
  }

  function handlePhotoSelection(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    const validFiles: File[] = [];

    for (const file of files) {
      const error = getPhotoValidationError(file);
      if (error) {
        pendingPhotos = [];
        photoUploadError = error;
        photoUploadDebug = `Client-side validation failed for ${file.name}: ${file.type || 'unknown type'} (${(file.size / 1024).toFixed(1)} KB)`;
        if (input) input.value = '';
        return;
      }
      validFiles.push(file);
    }

    pendingPhotos = validFiles.slice(0, 10);
    photoUploadError = '';
    photoUploadDebug = '';
  }

  function getAuthRoleLabel() {
    return userRole === 'admin' ? 'admin' : 'renter';
  }

  async function uploadPhotos() {
    if (!rental || !pendingPhotos.length) return;

    const selectedFile = pendingPhotos[0];
    const validationError = getPhotoValidationError(selectedFile);
    if (validationError) {
      photoUploadError = validationError;
      photoUploadDebug = `Client-side validation failed for ${selectedFile.name}: ${selectedFile.type || 'unknown type'} (${(selectedFile.size / 1024).toFixed(1)} KB)`;
      pendingPhotos = [];
      const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"][accept="image/*"]');
      inputs.forEach((input) => {
        input.value = '';
      });
      return;
    }

    uploadingPhotos = true;
    photoUploadError = '';
    photoUploadDebug = '';

    try {
      const updated = await rentalService.uploadPhotos(rental.id, pendingPhotos);
      const nextPhotos = Array.isArray(updated?.photos) ? updated.photos : rental.photos ?? [];
      rental = { ...rental, photos: nextPhotos };
      pendingPhotos = [];
      const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"][accept="image/*"]');
      inputs.forEach((input) => {
        input.value = '';
      });
      saved = true;
      setTimeout(() => saved = false, 2500);
    } catch (error) {
      console.error('[rental page] photo upload failed:', error);

      const responseData = error && typeof error === 'object' && 'response' in error ? (error as any).response?.data : null;
      const responseStatus = error && typeof error === 'object' && 'status' in error ? (error as any).status : null;
      const responseMessage = error && typeof error === 'object' && 'message' in error ? (error as any).message : null;
      const responseText = typeof responseData === 'string' ? responseData : JSON.stringify(responseData ?? null, null, 2);

      photoUploadDebug = [
        `status: ${responseStatus ?? 'unknown'}`,
        `message: ${responseMessage ?? 'unknown'}`,
        `body: ${responseText || 'empty response body'}`,
        `role: ${getAuthRoleLabel()}`,
        `rentalId: ${rental?.id ?? 'missing'}`
      ].join('\n');

      photoUploadError = 'Unable to upload that photo. Please try again.';
    } finally {
      uploadingPhotos = false;
    }
  }
</script>
<svelte:head><title>Rental · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">The place you call home</p><h1>Rental details</h1><p class="muted">Keep the important property information in one place.</p><span class="role-badge">{roleLabel} role</span></div>{#if isAdmin && rental}<button class="button" onclick={() => editing = !editing}><Edit3 size={16} /> {editing ? 'Cancel' : 'Edit rental'}</button>{/if}</div>
<div class="auth-debug-banner">Logged in as: <strong>{getAuthRoleLabel()}</strong></div>
{#if pageError}
  <div class="error-banner" role="alert">
    <strong>{pageError}</strong>
    {#if pageDebug}
      <pre class="error-debug">{pageDebug}</pre>
    {/if}
  </div>
{/if}
<div class="rental-grid">
  <section class="panel">
    <h2 class="panel-title">Property information</h2>
    {#if !rental}
      <div class="empty-rental-state">
        <p class="empty-rental-title">No property assigned yet</p>
        <p class="muted">Your account is active, but there is no rental record linked to your profile yet. Please contact your landlord or admin to get a property assigned.</p>
      </div>
    {:else if editing}
      <div class="field"><label>ID<input value={rental?.id ?? ''} disabled /></label></div>
      <label class="field">Address<input bind:value={address} /></label>
      <label class="field">Monthly rent<input bind:value={rent} type="number" /></label>
      <div class="field"><span>Photos</span><div class="chip-list">{#if rental?.photos?.length}{#each rental.photos as photo}<span class="chip">{photo}</span>{/each}{:else}<span class="muted">---</span>{/if}</div></div>
      <div class="field"><span>Bills</span><div class="chip-list">{#if rental?.bills?.length}{#each rental.bills as bill}<span class="chip">{bill}</span>{/each}{:else}<span class="muted">---</span>{/if}</div></div>
      <div class="field"><span>Photo upload</span><div class="file-upload"><label class="file-upload-label" for="rental-photos">Choose files</label><input id="rental-photos" name="rental-photos" type="file" accept="image/*" multiple onchange={handlePhotoSelection} /></div></div>
      {#if pendingPhotos.length}<div class="field"><span>{pendingPhotos.length === 1 ? 'Selected photo' : 'Selected photos'}</span><div class="chip-list">{#each pendingPhotos as file}<span class="chip">{file.name}</span>{/each}{#if photoSizeLabel}<span class="chip size-chip">{photoSizeLabel}</span>{/if}</div><button class="button" type="button" onclick={uploadPhotos} disabled={uploadingPhotos}>{uploadingPhotos ? 'Uploading...' : `Upload ${pendingPhotos.length} photo${pendingPhotos.length === 1 ? '' : 's'}`}</button></div>{/if}
      {#if photoUploadError}<p class="error-text">{photoUploadError}</p>{#if photoUploadDebug}<pre class="error-debug">{photoUploadDebug}</pre>{/if}{/if}
      <button class="button" onclick={save}>Save changes</button>
    {:else}
      <dl class="detail-list">
        <div><dt>Address</dt><dd>{plainText(rental?.address) || 'No rental set up'}</dd></div>
        <div><dt>Monthly rent</dt><dd>${(rental?.rent ?? 0).toLocaleString()}</dd></div>
        <div><dt>Renter</dt><dd>{getAssignedRenterLabel()}<span class="muted">{getAssignedRenterEmail() ? ` · ${getAssignedRenterEmail()}` : ''}</span></dd></div>
      </dl>
    {/if}
    {#if saved}<p class="success">Rental details saved.</p>{/if}
  </section>
  <section class="panel" style="margin-top: 24px;">
    <h2 class="panel-title">Property photos</h2>
    {#if rental?.photos?.length}
      <div class="photo-grid">
        {#each rental.photos as photo}
          <img
            class="property-photo"
            src={pocketbase.client.files.getURL(rental, photo)}
            alt="Rental property"
            tabindex="0"
            role="button"
            aria-label="Open photo preview"
            onclick={() => openPhotoModal(pocketbase.client.files.getURL(rental, photo))}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPhotoModal(pocketbase.client.files.getURL(rental, photo));
              }
            }}
          />
        {/each}
      </div>
    {:else}
      <div class="photo-placeholder"><Image size={27} /><span>No photos added yet</span></div>
    {/if}
    {#if isAdmin}
      <div class="upload-block">
        <label class="upload-label" for="property-photo-upload">Upload photos</label>
        <input id="property-photo-upload" type="file" accept="image/*" multiple onchange={handlePhotoSelection} />
        {#if pendingPhotos.length}
          <div class="field"><span>Selected photos</span><div class="chip-list">{#each pendingPhotos as file}<span class="chip">{file.name}</span>{/each}</div><button class="button" type="button" onclick={uploadPhotos} disabled={uploadingPhotos}>{uploadingPhotos ? 'Uploading...' : 'Upload selected photos'}</button></div>
        {/if}
        {#if photoUploadError}<p class="error-text">{photoUploadError}</p>{/if}
      </div>
    {/if}
  </section>
</div>

{#if selectedPhotoUrl}
  <div
    class="photo-modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close photo preview"
    onclick={closePhotoModal}
    onkeydown={(event) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        closePhotoModal();
      }
    }}
  >
    <div class="photo-modal-panel" role="dialog" aria-modal="true" aria-label="Property photo preview" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => {
      if (event.key === 'Escape') closePhotoModal();
    }}>
      <button class="photo-modal-close" type="button" aria-label="Close photo preview" onclick={closePhotoModal}>×</button>
      <img class="photo-modal-image" src={selectedPhotoUrl} alt="Property photo preview" />
    </div>
  </div>
{/if}

<style>.field { display: grid; gap: 7px; margin-bottom: 16px; color: #71837c; font-size: 13px; }.field input { display: block; width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 11px; }.field input:disabled { background: #f4f7f4; color: #6b7d77; cursor: not-allowed; }.chip-list { display: flex; flex-wrap: wrap; gap: 8px; min-height: 28px; }.chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; background: #edf5d9; color: #2a5a3f; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }.size-chip { background: #eef4ff; color: #234a7a; }.muted { color: #72857d; }.success { color: #28664b; font-size: 13px; }.error-text { color: #8c2d2d; font-size: 13px; margin-top: 8px; }.error-debug { margin: 8px 0 0; padding: 10px 12px; border-radius: 8px; background: #fdf0f0; color: #5f1b1b; font-size: 11px; line-height: 1.5; white-space: pre-wrap; overflow-x: auto; }.auth-debug-banner { margin: 0 0 16px; padding: 8px 12px; border-radius: 999px; background: #edf5d9; color: #234a36; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }.error-banner { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #f0c6c6; border-radius: 12px; background: #fff1f1; color: #7d1d1d; display: grid; gap: 8px; } .error-banner strong { font-size: 13px; } .error-banner .error-debug { margin: 0; background: rgba(255,255,255,0.5); } .empty-rental-state { display: grid; gap: 10px; padding: 18px 14px; border: 1px dashed #cfe0bd; border-radius: 12px; background: #f8faf7; } .empty-rental-title { margin: 0; font-size: 1.05rem; font-weight: 700; color: #183b35; } .upload-block { display: grid; gap: 12px; margin-top: 16px; }.upload-label { color: #71837c; font-size: 13px; }.upload-block input[type="file"] { display: block; width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 11px; background: white; }.photo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }.property-photo { width: 100%; min-height: 180px; max-height: 220px; object-fit: cover; border-radius: 7px; cursor: pointer; }.photo-modal-backdrop { position: fixed; inset: 0; display: grid; place-items: start center; padding: 78px 18px 18px; background: rgba(12, 17, 17, 0.68); z-index: 100; }.photo-modal-panel { position: relative; width: min(92vw, 860px); max-height: calc(100vh - 110px); margin-top: 10px; background: rgba(255,255,255,0.97); border-radius: 18px; border: 1px solid rgba(223,232,223,0.9); box-shadow: 0 30px 80px rgba(10, 15, 14, 0.28); overflow: hidden; }.photo-modal-close { position: absolute; top: 12px; right: 12px; width: 38px; height: 38px; border: 0; border-radius: 999px; background: rgba(24, 59, 53, 0.8); color: white; font-size: 24px; cursor: pointer; }.photo-modal-image { display: block; width: 100%; max-height: calc(100vh - 130px); object-fit: contain; background: #f3f6f3; }.table-wrap { overflow-x: auto; border: 1px solid #dfe8df; border-radius: 10px; background: white; } table { width: 100%; border-collapse: collapse; min-width: 720px; text-align: left; } th { padding: 14px 18px; color: #71837c; background: #f8faf7; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; } td { padding: 18px; border-top: 1px solid #edf1ec; font-size: 14px; }</style>
