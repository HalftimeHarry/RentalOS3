<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Camera, FileImage, Printer, Wrench } from '@lucide/svelte';
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
  type MaintenanceThreadUpdate = {
    id?: string;
    author?: 'tenant' | 'admin' | 'system';
    role?: 'tenant' | 'admin';
    message?: string;
    created?: string;
  };

  let tenantStatusLoaded = $state(false);
  let maintenanceRequests = $state<Array<{ id: string; created?: string; problem?: string; image?: string | string[]; tenant?: string; status?: string; updates?: MaintenanceThreadUpdate[]; created_by?: string; updated?: string }>>([]);
  let maintenanceLoading = $state(false);
  let maintenanceError = $state('');
  let statusDrafts = $state<Record<string, string>>({});
  let replyDrafts = $state<Record<string, string>>({});
  let updatingStatusId: string | null = $state(null);
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

  function plainTextFromHtml(value?: string) {
    if (!value) return '';

    return value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeThreadUpdates(value?: unknown): MaintenanceThreadUpdate[] {
    if (!Array.isArray(value)) return [];

    return value
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => {
        const message = typeof entry.message === 'string' ? entry.message : typeof entry.text === 'string' ? entry.text : '';
        const author = entry.author === 'tenant' || entry.author === 'admin' ? entry.author : 'system';
        const role = entry.role === 'tenant' || entry.role === 'admin' ? entry.role : undefined;
        const created = typeof entry.created === 'string' ? entry.created : undefined;
        return {
          id: typeof entry.id === 'string' ? entry.id : undefined,
          author,
          role,
          message,
          created
        };
      })
      .filter((entry) => !!entry.message?.trim());
  }

  function getTimelineEntries(request: { created?: string; updated?: string; updates?: MaintenanceThreadUpdate[] }) {
    const timeline: Array<{ label: string; created?: string; message?: string; author?: 'tenant' | 'admin' | 'system'; }> = [
      {
        label: 'Submitted',
        created: request.created,
        author: 'system',
        message: 'Issue reported by tenant'
      }
    ];

    const updates = normalizeThreadUpdates(request.updates ?? []);
    updates.forEach((update) => {
      timeline.push({
        label: update.author === 'admin' ? 'Admin reply' : update.author === 'tenant' ? 'Tenant reply' : 'Update',
        created: update.created ?? request.updated ?? request.created,
        author: update.author,
        message: update.message
      });
    });

    return timeline.sort((a, b) => {
      const left = new Date(a.created ?? 0).getTime();
      const right = new Date(b.created ?? 0).getTime();
      return left - right;
    });
  }

  function normalizeImages(value?: string | string[] | Record<string, unknown> | Array<Record<string, unknown>> | null, record?: Partial<Record<string, any>>) {
    if (!value) return [];

    const candidates = Array.isArray(value) ? value : [value];

    return candidates.flatMap((entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (!trimmed) return [];

        if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
          return [trimmed];
        }

        if (trimmed.startsWith('/api/files/') || trimmed.startsWith('/')) {
          return [trimmed];
        }

        if (record && record.collectionId) {
          return [pocketbase.client.files.getURL(record as Record<string, any>, trimmed)];
        }

        return [trimmed];
      }

      if (entry && typeof entry === 'object') {
        const recordObject = entry as Record<string, unknown>;
        const candidate = typeof recordObject.url === 'string' ? recordObject.url :
          typeof recordObject.src === 'string' ? recordObject.src :
          typeof recordObject.path === 'string' ? recordObject.path :
          typeof recordObject.file === 'string' ? recordObject.file : '';

        if (!candidate.trim()) {
          console.warn('[maintenance] filtered unsupported object-valued image record', entry);
        }

        return candidate.trim() ? [candidate] : [];
      }

      return [];
    });
  }

  async function loadMaintenanceRequests() {
    if (!isAdmin && !tenantProfile?.id) {
      maintenanceRequests = [];
      statusDrafts = {};
      replyDrafts = {};
      return;
    }

    maintenanceLoading = true;
    maintenanceError = '';

    try {
      const filter = isAdmin ? '' : `tenant = "${tenantProfile?.id}"`;
      const records = await pocketbase.client.collection('maintenance').getFullList({
        sort: '-created',
        filter,
        expand: 'tenant.user,created_by'
      });
      maintenanceRequests = records as Array<{ id: string; created?: string; problem?: string; image?: string | string[]; tenant?: string; status?: string; updates?: MaintenanceThreadUpdate[]; created_by?: string; updated?: string }>;
      statusDrafts = Object.fromEntries(
        maintenanceRequests.map((request) => [request.id, request.status ?? 'reported'])
      );
      replyDrafts = Object.fromEntries(
        maintenanceRequests.map((request) => [request.id, ''])
      );
    } catch (loadError) {
      console.error('[maintenance page] failed to load maintenance requests:', loadError);
      maintenanceError = 'We could not load your maintenance history right now.';
      maintenanceRequests = [];
      statusDrafts = {};
      replyDrafts = {};
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

  function printMaintenanceRequest(request: { id: string; created?: string; problem?: string; tenant?: string; status?: string; updates?: MaintenanceThreadUpdate[] }) {
    if (typeof window === 'undefined') return;

    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) return;

    const noticeDate = formatRequestDate(request.created);
    const tenantLabel = tenantProfile?.tenant_name || 'Tenant';
    const landlordName = 'Dustin Dinsmore';
    const propertyAddress = '2728 B Street, #102\nSan Diego, CA 92102';
    const issueHtml = request.problem && /<\/?[a-z][\s\S]*>/i.test(request.problem)
      ? request.problem
      : `<p>${(request.problem ?? 'No issue details were provided.').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />')}</p>`;

    const timelineHtml = getTimelineEntries(request)
      .map((entry) => {
        const entryDate = formatRequestDate(entry.created);
        const body = entry.message && /<\/?[a-z][\s\S]*>/i.test(entry.message)
          ? entry.message
          : `<p>${(entry.message ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />')}</p>`;

        return `
          <div class="print-timeline-item">
            <div class="print-timeline-label">${entry.label}</div>
            <div class="print-timeline-meta"><strong>${entryDate}</strong> — ${entry.message ? 'Issue reported by tenant' : 'Update'}</div>
            <div class="print-timeline-body">${body}</div>
          </div>
        `;
      })
      .join('');

    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>30-day Notice</title>
          <style>
            body {
              margin: 32px;
              font-family: Arial, Helvetica, sans-serif;
              color: #183b35;
              line-height: 1.6;
            }
            .notice {
              max-width: 820px;
              margin: 0 auto;
            }
            .meta {
              margin-bottom: 18px;
              color: #536864;
              font-size: 13px;
            }
            h1 {
              margin: 0 0 18px;
              font-size: 24px;
            }
            .subject {
              font-weight: 700;
              margin-bottom: 18px;
            }
            .address-block {
              margin: 18px 0;
            }
            .signature {
              margin-top: 26px;
            }
            .timeline {
              margin-top: 28px;
              border-top: 1px solid #dfe8df;
              padding-top: 18px;
            }
            .print-timeline-item {
              border: 1px solid #dfe8df;
              border-radius: 10px;
              padding: 12px 14px;
              margin-bottom: 12px;
            }
            .print-timeline-label {
              font-size: 11px;
              letter-spacing: .08em;
              text-transform: uppercase;
              color: #688078;
              font-weight: 700;
              margin-bottom: 6px;
            }
            .print-timeline-meta {
              font-size: 13px;
              margin-bottom: 6px;
            }
            .print-timeline-body p {
              margin: 0;
            }
            @media print {
              body { margin: 0; }
            }
          </style>
        </head>
        <body>
          <div class="notice">
            <div class="meta">Submitted • ${noticeDate}</div>
            <h1>30-Day Notice</h1>
            <div class="subject">Issue</div>
            <div class="meta">Date: ${noticeDate}</div>
            <div class="address-block">
              <div>To:</div>
              <div><strong>${landlordName}</strong></div>
              <div>Landlord</div>
            </div>
            <div class="address-block">
              <div>From:</div>
              <div><strong>${tenantLabel}</strong></div>
              <div>Tenant</div>
            </div>
            <div class="address-block">
              <div>Rental Property:</div>
              <div>${propertyAddress.replace(/\n/g, '<br />')}</div>
            </div>
            <p>Dear ${landlordName},</p>
            <p>Please accept this letter as my 30-day written notice of my intent to vacate the rental property located at:</p>
            <p>${propertyAddress.replace(/\n/g, '<br />')}</p>
            <p>My intended move-out date is October 1, 2026.</p>
            <p>I will return possession of the property and all keys upon moving out. Please contact me regarding the move-out inspection, return of keys, and any other move-out procedures that need to be completed.</p>
            <p>Thank you.</p>
            <p class="signature">Sincerely,<br /><br /><strong>${tenantLabel}</strong></p>
            <div class="timeline">
              <div class="subject">Timeline</div>
              ${timelineHtml}
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  async function updateMaintenanceStatus(requestId: string, nextStatus: string, nextReply?: string) {
    const normalizedStatus = maintenanceStatusOptions.includes(nextStatus as typeof maintenanceStatusOptions[number])
      ? nextStatus
      : 'reported';

    const cleanedReply = (nextReply ?? '').trim();
    const currentRequest = maintenanceRequests.find((request) => request.id === requestId);
    const currentThread = normalizeThreadUpdates(currentRequest?.updates);

    const nextThreadEntry: MaintenanceThreadUpdate = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      author: isAdmin ? 'admin' : 'tenant',
      role: isAdmin ? 'admin' : 'tenant',
      message: cleanedReply,
      created: new Date().toISOString()
    };

    const nextThread = cleanedReply ? [...currentThread, nextThreadEntry] : currentThread;
    const updatePayload: Record<string, unknown> = {
      status: normalizedStatus,
      updates: nextThread
    };

    updatingStatusId = requestId;
    errorMessage = '';
    statusMessage = '';

    try {
      await pocketbase.client.collection('maintenance').update(requestId, updatePayload);
      statusDrafts[requestId] = normalizedStatus;
      replyDrafts[requestId] = cleanedReply;
      await loadMaintenanceRequests();
      statusMessage = 'Maintenance update saved.';
    } catch (updateError) {
      console.error('[maintenance page] failed to update status:', updateError);
      const responseData = updateError && typeof updateError === 'object' && 'response' in updateError
        ? JSON.stringify((updateError as any).response?.data ?? null, null, 2)
        : 'No backend response details were returned.';
      errorMessage = `We could not update that maintenance request. ${responseData}`;
    } finally {
      updatingStatusId = null;
    }
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
    <h1>Maintenance / 30-day Notice</h1>
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
    <div class="request-card-list">
      {#each maintenanceRequests as request}
        {@const requestImages = normalizeImages(request.image, request as Partial<Record<string, any>>)}
        {@const timelineEntries = getTimelineEntries(request)}
        <article class="request-card">
          <div class="request-card-head">
            <div>
              <p class="request-label">Submitted</p>
              <strong>{formatRequestDate(request.created)}</strong>
            </div>
            <div class="status-control">
              <label class="status-select-wrap">
                <span class="request-label">Status</span>
                <select
                  value={statusDrafts[request.id] ?? request.status ?? 'reported'}
                  onchange={(event) => {
                    const nextStatus = (event.currentTarget as HTMLSelectElement).value;
                    statusDrafts[request.id] = nextStatus;
                  }}
                  disabled={updatingStatusId === request.id}
                >
                  {#each maintenanceStatusOptions as option}
                    <option value={option}>{maintenanceStatusLabel(option)}</option>
                  {/each}
                </select>
              </label>
              <button
                class="button secondary-button compact-button print-button"
                type="button"
                onclick={() => printMaintenanceRequest(request)}
              >
                <Printer size={14} /> Print
              </button>
              <button
                class="button secondary-button compact-button"
                type="button"
                disabled={
                  updatingStatusId === request.id ||
                  ((statusDrafts[request.id] ?? request.status ?? 'reported') === (request.status ?? 'reported') &&
                    (replyDrafts[request.id] ?? '') === plainTextFromHtml(request.reply))
                }
                onclick={() => void updateMaintenanceStatus(request.id, statusDrafts[request.id] ?? request.status ?? 'reported', replyDrafts[request.id])}
              >
                {updatingStatusId === request.id ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </div>

          <div class="request-card-block">
            <p class="request-label">Issue</p>
            <div class="request-problem issue-box">
              {@html request.problem ?? '<p>No issue details were provided.</p>'}
            </div>
          </div>

          <div class="request-card-block">
            <p class="request-label">Timeline</p>
            <div class="timeline-list">
              {#each timelineEntries as entry}
                <div class="timeline-item">
                  <span class={`timeline-pill ${entry.author === 'admin' ? 'admin-pill' : entry.author === 'tenant' ? 'tenant-pill' : ''}`}>
                    {entry.label}
                  </span>
                  <div class="timeline-body">
                    <strong>{formatRequestDate(entry.created)}</strong>
                    {#if entry.message && /<\/?[a-z][\s\S]*>/i.test(entry.message)}
                      <div class="timeline-reply">
                        {@html entry.message}
                      </div>
                    {:else if entry.message}
                      <p class="timeline-meta">{entry.message}</p>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          {#if isAdmin || !isAdmin}
            <div class="request-card-block reply-composer-block">
              <label class="reply-field">
                <span class="request-label">{isAdmin ? 'Add update' : 'Add reply'}</span>
                <textarea
                  rows="3"
                  value={replyDrafts[request.id] ?? ''}
                  onchange={(event) => {
                    const nextReply = (event.currentTarget as HTMLTextAreaElement).value;
                    replyDrafts[request.id] = nextReply;
                  }}
                  placeholder={isAdmin ? 'Share the next update with the tenant...' : 'Share the latest update with the admin...'}
                  disabled={updatingStatusId === request.id}
                ></textarea>
              </label>
              <button
                class="button compact-button reply-submit-button success-button"
                type="button"
                disabled={
                  updatingStatusId === request.id ||
                  !(
                    ((statusDrafts[request.id] ?? request.status ?? 'reported') !== (request.status ?? 'reported')) ||
                    ((replyDrafts[request.id] ?? '').trim().length > 0)
                  )
                }
                onclick={() => void updateMaintenanceStatus(request.id, statusDrafts[request.id] ?? request.status ?? 'reported', replyDrafts[request.id])}
              >
                Submit reply
              </button>
            </div>
          {/if}

          <div class="request-card-block">
            <p class="request-label">Photos</p>
            {#if requestImages.length}
              <div class="request-image-grid">
                {#each requestImages as imageUrl}
                  <a class="request-image-link" href={imageUrl} target="_blank" rel="noreferrer noopener">
                    <img src={imageUrl} alt="Maintenance request photo" />
                  </a>
                {/each}
              </div>
            {:else}
              <span class="muted">No photos</span>
            {/if}
          </div>
        </article>
      {/each}
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
  .request-card-list { display: grid; gap: 16px; }
  .request-card { display: grid; gap: 16px; padding: 18px; border: 1px solid #dfe8df; border-radius: 16px; background: linear-gradient(180deg, #ffffff 0%, #f8faf7 100%); box-shadow: 0 12px 24px rgba(24, 59, 53, 0.04); }
  .request-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .status-control { display: flex; align-items: end; gap: 10px; }
  .status-select-wrap { display: grid; gap: 6px; }
  .status-select-wrap select { min-width: 150px; border: 1px solid #dfe8df; border-radius: 10px; background: #fbfdfb; color: #183b35; padding: 9px 10px; font: inherit; }
  .print-button {
    background: #1c6c42;
    border-color: #1c6c42;
    color: #fff;
  }
  .request-label { margin: 0 0 6px; color: #67807d; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .request-card-block { display: grid; gap: 8px; }
  .compact-button { padding: 9px 12px; font-size: 12px; }
  .timeline-list { display: grid; gap: 12px; }
  .timeline-item { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; padding: 12px 14px; border: 1px solid #dfe8df; border-radius: 12px; background: #fbfdfb; }
  .timeline-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 9px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; background: #edf5d9; color: #183b35; }
  .admin-pill { background: #eef4ff; color: #204a7e; }
  .tenant-pill { background: #edf9f1; color: #1f5e3a; }
  .timeline-body { display: grid; gap: 6px; }
  .timeline-body strong { color: #183b35; }
  .timeline-meta { margin: 0; color: #71837c; font-size: 12px; }
  .timeline-reply { color: #183b35; line-height: 1.6; }
  .timeline-reply :global(p) { margin: 0 0 8px; }
  .timeline-reply :global(p:last-child) { margin-bottom: 0; }
  .reply-composer-block { gap: 10px; }
  .reply-field { display: grid; gap: 6px; }
  .reply-field textarea { width: 100%; box-sizing: border-box; border: 1px solid #dfe8df; border-radius: 10px; background: #fbfdfb; color: #183b35; padding: 11px 12px; resize: vertical; font: inherit; }
  .reply-submit-button { justify-self: start; }
  .success-button { background: #1c6c42; border-color: #1c6c42; color: #fff; }
  .request-problem { line-height: 1.6; color: #183b35; }
  .issue-box { min-height: 128px; padding: 14px; border: 1px solid #dfe8df; border-radius: 12px; background: #fbfdfb; }
  .request-problem :global(p) { margin: 0 0 8px; }
  .request-problem :global(p:last-child) { margin-bottom: 0; }
  .request-image-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; }
  .request-image-link { display: block; width: 100%; aspect-ratio: 1; border-radius: 12px; overflow: hidden; border: 1px solid #dfe8df; background: #f4f8f4; }
  .request-image-link img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .status-pill.reported { background: #eaf4ff; color: #114d8a; }
  .status-pill.active { background: #fff1d6; color: #7c5400; }
  .status-pill.closed { background: #f2f4f5; color: #495d66; }
  .status-pill.re-opend { background: #dff7ea; color: #135a3c; }
</style>
