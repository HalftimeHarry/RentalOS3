<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Camera, FileImage, Wrench } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { renterService } from '$lib/services/RenterService';
  import type { RenterProfile } from '$lib/services/RenterService';

  let tenantProfile = $state<RenterProfile | null>(null);
  let problem = $state('');
  let attachmentFiles = $state<File[]>([]);
  let submitting = $state(false);
  let statusMessage = $state('');
  let errorMessage = $state('');
  let cameraOpen = $state(false);
  let cameraError = $state('');
  let videoElement: HTMLVideoElement | null = null;
  let cameraStream: MediaStream | null = null;
  let tenantStatusLoaded = $state(false);
  let maintenanceRequests = $state<Array<{ id: string; created?: string; problem?: string; image?: string | string[]; tenant?: string; status?: string }>>([]);
  let maintenanceLoading = $state(false);
  let maintenanceError = $state('');
  const maintenanceStatusOptions = ['reported', 'active', 'closed', 're-opend'] as const;
  const maintenanceStatusLabel = (status?: string) => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'closed':
        return 'Closed';
      case 're-opend':
        return 'Re-opened';
      default:
        return 'Reported';
    }
  };

  let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'renter');
  let isAdmin = $derived(userRole === 'admin');
  let canSubmit = $derived(isAdmin || (tenantStatusLoaded && tenantProfile?.status === 'active'));

  function formatRequestDate(value?: string) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function normalizeImages(value?: string | string[]) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
  }

  async function loadMaintenanceRequests() {
    if (!isAdmin && !tenantProfile?.id) {
      maintenanceRequests = [];
      return;
    }

    maintenanceLoading = true;
    maintenanceError = '';

    try {
      const filter = isAdmin ? '' : `tenant = "${tenantProfile?.id}"`;
      const records = await pocketbase.client.collection('maintenance').getFullList({
        sort: '-created',
        filter,
        expand: 'tenant.user'
      });
      maintenanceRequests = records as Array<{ id: string; created?: string; problem?: string; image?: string | string[]; tenant?: string; status?: string }>;
    } catch (loadError) {
      console.error('[maintenance page] failed to load maintenance requests:', loadError);
      maintenanceError = 'We could not load your maintenance history right now.';
      maintenanceRequests = [];
    } finally {
      maintenanceLoading = false;
    }
  }

  onMount(async () => {
    try {
      tenantProfile = await renterService.getCurrent();
      await loadMaintenanceRequests();
    } catch (loadError) {
      console.error('[maintenance page] failed to load renter profile:', loadError);
    } finally {
      tenantStatusLoaded = true;
    }
  });

  function addFiles(newFiles: File[]) {
    attachmentFiles = [...attachmentFiles, ...newFiles].filter((file, index, list) => 
      list.findIndex((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified) === index
    );
  }

  function handleFileSelection(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    addFiles(Array.from(input?.files ?? []));
    if (input) input.value = '';
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraError = 'This browser does not support webcam capture. Please use Choose files instead.';
      return;
    }

    cameraError = '';

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });

      cameraOpen = true;
      await tick();

      if (videoElement) {
        videoElement.srcObject = cameraStream;
        videoElement.play().catch(() => undefined);
      }
    } catch (error) {
      console.error('[maintenance page] camera capture failed:', error);
      cameraError = 'Camera access was blocked or unavailable. Please use Choose files instead.';
      cameraOpen = false;
    }
  }

  function closeCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }

    if (videoElement) {
      videoElement.srcObject = null;
    }

    cameraOpen = false;
  }

  function captureCameraPhoto() {
    if (!videoElement) return;

    const video = videoElement;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const context = canvas.getContext('2d');
    if (!context) {
      cameraError = 'The camera image could not be processed. Please try again.';
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        cameraError = 'We could not capture the photo. Please try again.';
        return;
      }

      addFiles([
        new File([blob], `maintenance-photo-${Date.now()}.png`, { type: 'image/png' })
      ]);
      closeCamera();
    }, 'image/png', 0.92);
  }

  function toEditorHtml(value: string) {
    const safe = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<p>${safe.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />')}</p>`;
  }

  async function submitMaintenanceIssue() {
    if (!canSubmit) {
      errorMessage = 'Only active tenants or admins can submit a maintenance issue.';
      return;
    }

    if (!problem.trim()) {
      errorMessage = 'Please describe the maintenance issue.';
      return;
    }

    const tenantId = isAdmin ? undefined : tenantProfile?.id;
    if (!tenantId && !isAdmin) {
      errorMessage = 'Your tenant record is not linked yet. Please contact the admin.';
      return;
    }

    submitting = true;
    errorMessage = '';
    statusMessage = '';

    try {
      const formData = new FormData();
      if (tenantId) formData.append('tenant', tenantId);
      formData.append('problem', toEditorHtml(problem.trim()));
      formData.append('status', 'reported');
      attachmentFiles.forEach((file) => {
        formData.append('image', file, file.name);
      });

      await pocketbase.client.collection('maintenance').create(formData);
      statusMessage = 'Your maintenance request has been submitted.';
      problem = '';
      attachmentFiles = [];
      closeCamera();
      await loadMaintenanceRequests();
    } catch (submitError) {
      console.error('[maintenance page] failed to submit issue:', submitError);
      const responseData = submitError && typeof submitError === 'object' && 'response' in submitError
        ? JSON.stringify((submitError as any).response?.data ?? null, null, 2)
        : 'No backend response details were returned.';
      errorMessage = `We could not submit that maintenance request. ${responseData}`;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Maintenance · RentalOS3</title>
</svelte:head>

<div class="page-header">
  <div>
    <p class="page-kicker">Home support</p>
    <h1>Maintenance request</h1>
    <p class="muted">Report a repair issue and send any photos that help describe the problem.</p>
  </div>
  <span class="badge"><Wrench size={15} /> {isAdmin ? 'Admin view' : 'Tenant request'}</span>
</div>

{#if !isAdmin && !tenantStatusLoaded}
  <section class="panel warning-panel">
    <h2>Checking your tenant status</h2>
    <p>We are confirming whether your tenancy is active before loading the maintenance form.</p>
  </section>
{:else if !canSubmit}
  <section class="panel warning-panel">
    <h2>Maintenance access is limited</h2>
    <p>{tenantProfile ? 'Your tenant status must be active before you can submit a maintenance request.' : 'We could not find a linked tenant record for your account yet. Please contact the admin.'}</p>
  </section>
{:else}
  <section class="panel form-panel">
    <label class="field">
      <span>Issue details</span>
      <textarea bind:value={problem} rows="7" placeholder="Describe the maintenance issue, where it is, and when it started."></textarea>
    </label>

    <label class="field upload-field">
      <span>Photos</span>
      <div class="upload-actions">
        <button class="button secondary-button" type="button" onclick={() => void openCamera()}>
          <Camera size={14} />
          Use camera
        </button>
        <label class="button secondary-button" for="maintenance-gallery-upload">
          <FileImage size={14} />
          Choose files
        </label>
      </div>
      <input id="maintenance-gallery-upload" type="file" accept="image/*" multiple onchange={handleFileSelection} />

      {#if cameraOpen}
        <div class="camera-panel">
          <video bind:this={videoElement} autoplay playsinline muted class="camera-preview"></video>
          <div class="camera-actions">
            <button class="button" type="button" onclick={captureCameraPhoto}>Take photo</button>
            <button class="button secondary-button" type="button" onclick={closeCamera}>Cancel</button>
          </div>
        </div>
      {/if}

      {#if cameraError}
        <p class="error-text">{cameraError}</p>
      {/if}

      {#if attachmentFiles.length}
        <div class="file-list">
          {#each attachmentFiles as file}
            <span class="chip">
              <FileImage size={12} />
              {file.name}
            </span>
          {/each}
        </div>
      {/if}
    </label>

    {#if errorMessage}
      <p class="error-text">{errorMessage}</p>
    {/if}

    {#if statusMessage}
      <p class="success-text">{statusMessage}</p>
    {/if}

    <button class="button" type="button" onclick={() => void submitMaintenanceIssue()} disabled={submitting}>
      {submitting ? 'Submitting...' : 'Submit maintenance request'}
    </button>
  </section>
{/if}

<section class="panel request-table-panel">
  <div class="table-header">
    <div>
      <p class="page-kicker">Request history</p>
      <h2>Submitted maintenance requests</h2>
    </div>
    <span class="badge subtle-badge">{maintenanceRequests.length} record{maintenanceRequests.length === 1 ? '' : 's'}</span>
  </div>

  {#if maintenanceLoading}
    <p class="muted">Loading maintenance requests...</p>
  {:else if maintenanceError}
    <p class="error-text">{maintenanceError}</p>
  {:else if maintenanceRequests.length}
    <div class="table-wrap">
      <table class="request-table">
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Status</th>
            <th>Issue</th>
            <th>Photos</th>
          </tr>
        </thead>
        <tbody>
          {#each maintenanceRequests as request}
            <tr>
              <td>{formatRequestDate(request.created)}</td>
              <td><span class="status-pill {request.status ?? 'reported'}">{maintenanceStatusLabel(request.status)}</span></td>
              <td>
                <div class="request-problem">
                  {@html request.problem ?? '<p>No issue details were provided.</p>'}
                </div>
              </td>
              <td>
                {#if normalizeImages(request.image).length}
                  <div class="request-image-grid">
                    {#each normalizeImages(request.image) as imageUrl}
                      <a class="request-image-link" href={imageUrl} target="_blank" rel="noreferrer noopener">
                        <img src={imageUrl} alt="Maintenance request photo" />
                      </a>
                    {/each}
                  </div>
                {:else}
                  <span class="muted">No photos</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="muted">No maintenance requests have been submitted yet.</p>
  {/if}
</section>

<style>
  .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 22px; }
  .page-kicker { margin: 0 0 8px; color: #688078; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .muted { color: #71837c; }
  .badge { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; background: #edf5d9; color: #183b35; border: 1px solid #cfe0bd; padding: 8px 12px; font-size: 12px; font-weight: 700; }
  .panel { background: #fff; border: 1px solid #dfe8df; border-radius: 16px; padding: 22px; box-shadow: 0 10px 30px rgba(24, 59, 53, 0.05); }
  .warning-panel { display: grid; gap: 8px; }
  .warning-panel h2 { margin: 0; font-size: 1.1rem; }
  .warning-panel p { margin: 0; color: #536864; }
  .form-panel { display: grid; gap: 18px; }
  .field { display: grid; gap: 8px; color: #294744; font-size: 13px; font-weight: 600; }
  .field textarea, .field input[type='file'] { width: 100%; box-sizing: border-box; border: 1px solid #dfe8df; border-radius: 10px; background: #fbfdfb; color: #183b35; padding: 11px 12px; font: inherit; }
  .field textarea { min-height: 180px; resize: vertical; }
  .upload-field { gap: 10px; }
  .upload-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; padding: 10px 16px; border: 1px solid #183b35; background: #183b35; color: white; font-weight: 700; cursor: pointer; }
  .secondary-button { background: white; color: #183b35; border-color: #cfe0bd; }
  .field input[type='file'] { display: none; }
  .camera-panel { display: grid; gap: 12px; padding: 12px; border: 1px solid #dfe8df; border-radius: 12px; background: #f8faf7; }
  .camera-preview { width: 100%; max-height: 280px; border-radius: 10px; background: #0d1a1a; object-fit: cover; }
  .camera-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .file-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; background: #edf5d9; color: #183b35; padding: 6px 10px; font-size: 11px; font-weight: 700; }
  .button:disabled { opacity: 0.7; cursor: wait; }
  .error-text { margin: 0; color: #a14c3b; font-size: 13px; }
  .success-text { margin: 0; color: #1c6c42; font-size: 13px; font-weight: 600; }
  .request-table-panel { margin-top: 24px; }
  .table-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
  .table-header h2 { margin: 0; font-size: 1.25rem; }
  .subtle-badge { background: #f4f7ef; border-color: #dfe8df; }
  .table-wrap { overflow-x: auto; }
  .request-table { width: 100%; border-collapse: collapse; min-width: 680px; }
  .request-table th, .request-table td { border-bottom: 1px solid #e4ece4; padding: 12px 10px; text-align: left; vertical-align: top; }
  .request-table th { color: #536864; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
  .request-problem { line-height: 1.6; color: #183b35; }
  .request-problem :global(p) { margin: 0 0 8px; }
  .request-problem :global(p:last-child) { margin-bottom: 0; }
  .request-image-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .request-image-link { display: block; width: 72px; height: 72px; border-radius: 10px; overflow: hidden; border: 1px solid #dfe8df; background: #f4f8f4; }
  .request-image-link img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .status-pill.reported { background: #eaf4ff; color: #114d8a; }
  .status-pill.active { background: #fff1d6; color: #7c5400; }
  .status-pill.closed { background: #f2f4f5; color: #495d66; }
  .status-pill.re-opend { background: #dff7ea; color: #135a3c; }
</style>
