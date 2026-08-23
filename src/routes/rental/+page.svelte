<script lang="ts">
  import { onMount } from 'svelte';
  import { Edit3, Image } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { rentalService } from '$lib/services/RentalService';
  import type { Rental } from '$lib/models';
  let rental = $state<Rental | null>(null);
  let editing = $state(false); let address = $state(''); let rent = $state(0); let saved = $state(false);
  let isAdmin = $derived(pocketbase.client.authStore.model?.role === 'admin');
  onMount(async () => { rental = await rentalService.getCurrent(); address = rental?.address ?? ''; rent = rental?.rent ?? 0; });
  async function save() { if (!rental) return; await rentalService.update(rental.id, { address, rent }); rental = { ...rental, address, rent }; editing = false; saved = true; setTimeout(() => saved = false, 2500); }
</script>
<svelte:head><title>Rental · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">The place you call home</p><h1>Rental details</h1><p class="muted">Keep the important property information in one place.</p></div>{#if isAdmin && rental}<button class="button" onclick={() => editing = !editing}><Edit3 size={16} /> {editing ? 'Cancel' : 'Edit rental'}</button>{/if}</div>
<div class="rental-grid"><section class="panel"><h2 class="panel-title">Property information</h2>{#if editing}<label class="field">Address<input bind:value={address} /></label><label class="field">Monthly rent<input bind:value={rent} type="number" /></label><button class="button" onclick={save}>Save changes</button>{:else}<dl class="detail-list"><div><dt>Address</dt><dd>{rental?.address ?? 'No rental set up'}</dd></div><div><dt>Monthly rent</dt><dd>${(rental?.rent ?? 0).toLocaleString()}</dd></div><div><dt>Renter</dt><dd>{rental?.renter?.name ?? 'Not assigned'}</dd></div></dl>{/if}{#if saved}<p class="success">Rental details saved.</p>{/if}</section><section class="panel"><h2 class="panel-title">Property photos</h2>{#if rental?.photos?.length}<img class="property-photo" src={rental.photos[0]} alt="Rental property" />{:else}<div class="photo-placeholder"><Image size={27} /><span>No photos added yet</span></div>{/if}</section></div>
<style>.field { display: grid; gap: 7px; margin-bottom: 16px; color: #71837c; font-size: 13px; }.field input { display: block; width: 100%; box-sizing: border-box; border: 1px solid #d8e3d8; border-radius: 7px; padding: 11px; }.success { color: #28664b; font-size: 13px; }.property-photo { width: 100%; min-height: 260px; object-fit: cover; border-radius: 7px; }</style>
