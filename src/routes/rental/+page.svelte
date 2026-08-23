<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Edit3, Image } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { rentalService } from '$lib/services/RentalService';
  import type { Rental } from '$lib/models';

  let rental = $state<Rental | null>(null);
  let editing = $state(false); let address = $state(''); let rent = $state(0); let saved = $state(false);
  let isAdmin = $derived(pocketbase.client.authStore.model?.role === 'admin');
  let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'rentor');
  let roleLabel = $derived(userRole === 'admin' ? 'Admin' : 'Renter');
  let adminRows = $derived(rental ? [
    { label: 'collectionId', value: rental.collectionId ?? '—' },
    { label: 'collectionName', value: rental.collectionName ?? 'rental' },
    { label: 'id', value: rental.id ?? '—' },
    { label: 'address', value: rental.address ?? '—' },
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
      rental = rentalId ? await rentalService.getById(rentalId) : await rentalService.getCurrent();
      console.log('[rental page] rental:', rental);
      console.log('[rental page] adminRows:', adminRows);
    } catch (error) {
      console.error('[rental page] fetch error:', error);
    }

    address = rental?.address ?? '';
    rent = rental?.rent ?? 0;
  });

  async function save() { if (!rental) return; await rentalService.update(rental.id, { address, rent }); rental = { ...rental, address, rent }; editing = false; saved = true; setTimeout(() => saved = false, 2500); }
</script>
<svelte:head><title>Rental · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">The place you call home</p><h1>Rental details</h1><p class="muted">Keep the important property information in one place.</p><span class="role-badge">{roleLabel} role</span></div>{#if isAdmin && rental}<button class="button" onclick={() => editing = !editing}><Edit3 size={16} /> {editing ? 'Cancel' : 'Edit rental'}</button>{/if}</div>
<div class="rental-grid"><section class="panel"><h2 class="panel-title">Property information</h2>{#if editing}<label class="field">Address<input bind:value={address} /></label><label class="field">Monthly rent<input bind:value={rent} type="number" /></label><button class="button" onclick={save}>Save changes</button>{:else}<dl class="detail-list"><div><dt>Address</dt><dd>{rental?.address ?? 'No rental set up'}</dd></div><div><dt>Monthly rent</dt><dd>${(rental?.rent ?? 0).toLocaleString()}</dd></div><div><dt>Renter</dt><dd>{(rental?.expand?.renter?.name ?? (typeof rental?.renter === 'object' ? rental.renter.name : rental?.renter) ?? 'Not assigned')}</dd></div></dl>{/if}{#if saved}<p class="success">Rental details saved.</p>{/if}</section><section class="panel"><h2 class="panel-title">Property photos</h2>{#if rental?.photos?.length}<img class="property-photo" src={rental.photos[0]} alt="Rental property" />{:else}<div class="photo-placeholder"><Image size={27} /><span>No photos added yet</span></div>{/if}</section></div>
<section class="panel" style="margin-top: 24px;">
  <h2 class="panel-title">Admin data</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {#each adminRows as row}
          <tr>
            <td>{row.label}</td>
            <td>{row.value}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
<style>.field { display: grid; gap: 7px; margin-bottom: 16px; color: #71837c; font-size: 13px; }.field input { display: block; width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 11px; }.success { color: #28664b; font-size: 13px; }.property-photo { width: 100%; min-height: 260px; object-fit: cover; border-radius: 7px; }.table-wrap { overflow-x: auto; border: 1px solid #dfe8df; border-radius: 10px; background: white; } table { width: 100%; border-collapse: collapse; min-width: 720px; text-align: left; } th { padding: 14px 18px; color: #71837c; background: #f8faf7; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; } td { padding: 18px; border-top: 1px solid #edf1ec; font-size: 14px; }</style>
