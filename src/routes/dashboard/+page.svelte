<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowUpRight, CalendarDays, CircleDollarSign, House } from '@lucide/svelte';
  import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
  import { rentalService } from '$lib/services/RentalService';
  import type { Bill, Rental } from '$lib/models';

  let { data } = $props();

  let rental = $state<Rental | null>(null);
  let rentals = $state<Rental[]>([]);
  let currentBill = $state<Bill | null>(null);
  let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'rentor');
  let roleLabel = $derived(userRole === 'admin' ? 'Admin' : 'Renter');
  let dayLabel = $state('Today');
  let greeting = $state('Hello');
  const referenceItems = [
    'List/Search',
    'View',
    'Create',
    'Update',
    'Delete',
    'Realtime',
    'Batch'
  ];
  const pocketbaseReference = [
    "import PocketBase from 'pocketbase';",
    '',
    "const pb = new PocketBase('https://pocketbase-production-8d02.up.railway.app');",
    '',
    "const resultList = await pb.collection('rental').getList(1, 50, {",
    "  filter: 'someField1 != someField2',",
    '});',
    '',
    "const records = await pb.collection('rental').getFullList({",
    "  sort: '-created',",
    '});',
    '',
    "const record = await pb.collection('rental').getFirstListItem(",
    "  'someField=\"test\"',",
    "  { expand: 'relField1,relField2.subRelField' },",
    ');',
    '',
    "const created = await pb.collection('rental').create({",
    "  address: '123 Main St',",
    '  rent: 2300,',
    '});',
    '',
    "const updated = await pb.collection('rental').update(created.id, {",
    '  rent: 2400,',
    '});',
    '',
    "await pb.collection('rental').delete(created.id);",
    '',
    "const unsub = pb.collection('rental').subscribe('*', function (e) {",
    '  console.log(e.record);',
    '});',
    '',
    "const batch = await pb.collection('rental').createBatch([",
    "  { address: 'A', rent: 1500 },",
    "  { address: 'B', rent: 1600 },",
    ']);'
  ].join('\n');

  const money = (value = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  const getGreeting = () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.toLocaleDateString('en-US', { weekday: 'long' });
    dayLabel = `${day}, your rental at a glance`;

    if (hour < 12) greeting = 'Good morning.';
    else if (hour < 18) greeting = 'Good afternoon.';
    else greeting = 'Good evening.';
  };

  getGreeting();

  $effect(() => {
    if (data.rental) rental = data.rental as Rental | null;
    if (data.currentBill) currentBill = data.currentBill as Bill | null;
    if ((data.rentals as Rental[] | undefined)?.length) rentals = data.rentals as Rental[];
  });

  onMount(async () => {
    try {
      if (!pocketbase.client.authStore.isValid) {
        console.log('[dashboard page] user not authenticated yet; waiting for auth state');
        return;
      }

      const list = await rentalService.list();
      console.log('[dashboard page] rental list loaded:', list);

      if (list.length) {
        rentals = list;

        const selectedId = new URLSearchParams(window.location.search).get('id');
        if (selectedId) {
          const selected = list.find((item) => item.id === selectedId) ?? null;
          if (selected) {
            rental = selected;
          }
        }

        if (!rental) {
          rental = list[0];
        }
      }

      if (rental?.id) {
        const current = await rentalService.getById(rental.id);
        console.log('[dashboard page] selected rental:', current);
        if (current) rental = current;
      }
    } catch (error) {
      console.error('[dashboard page] rental list fetch error:', error);
    }
  });
</script>
<svelte:head><title>Overview · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">{dayLabel}</p><h1>{greeting}</h1><p class="muted">Here is what needs your attention.</p><span class="role-badge">{roleLabel} role</span></div><a class="button" href="/bills">View all bills <ArrowUpRight size={16} /></a></div>
<div class="stat-grid"><div class="stat"><span class="stat-label"><House size={15} /> Property</span><span class="stat-value">{rental?.address ?? 'No rental set up'}</span></div><div class="stat"><span class="stat-label"><CircleDollarSign size={15} /> Monthly rent</span><span class="stat-value">{money(rental?.rent)}</span></div><div class="stat"><span class="stat-label"><CalendarDays size={15} /> Next due</span><span class="stat-value">{currentBill?.dueDate ? new Date(currentBill.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</span></div></div>
<section class="panel bill-highlight"><div><p class="page-kicker">Current bill</p><h2>{currentBill?.paid ? 'Paid in full' : 'Monthly payment'}</h2><div class="bill-meta"><span>Rent {money(currentBill?.rent ?? rental?.rent)}</span><span>Utilities {money((currentBill?.sdge ?? 0) + (currentBill?.att ?? 0))}</span></div></div><div><div class="bill-total">{money(currentBill?.total ?? rental?.rent)}</div><span class="pill {currentBill?.paid ? 'paid' : 'unpaid'}">{currentBill?.paid ? 'Paid' : 'Awaiting payment'}</span></div></section>
<section class="panel" style="margin-top: 24px;">
  <p class="page-kicker">PocketBase reference</p>
  <h2>List / Search · View · Create · Update · Delete · Realtime · Batch</h2>
  <div class="reference-grid">
    {#each referenceItems as item}
      <div class="reference-pill">{item}</div>
    {/each}
  </div>
  <pre class="code-block">{pocketbaseReference}</pre>
  <p class="docs-link">
    <a href="https://github.com/pocketbase/pocketbase/releases" target="_blank" rel="noreferrer">PocketBase v0.39.1</a>
  </p>
</section>
<section class="panel" style="margin-top: 24px;">
  <p class="page-kicker">Rental records</p>
  <h2>All rentals</h2>
  {#if rentals.length}
    <ul class="rental-list">
      {#each rentals as item}
        <li class="rental-row">
          <a href={`/rental?id=${item.id}`}>{item.id}</a>
          <span>{item.address ?? 'No address set'}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No rental records found.</p>
  {/if}
</section>
<style>.reference-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; } .reference-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 8px 12px; background: #edf5d9; color: #2a5a3f; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; } .code-block { overflow-x: auto; padding: 18px; border: 1px solid #dfe8df; border-radius: 10px; background: #183b35; color: #e8f1e9; font-size: 13px; line-height: 1.6; white-space: pre-wrap; } .docs-link { margin-top: 18px; } .docs-link a { color: #356c4f; font-weight: 700; text-decoration: none; } .docs-link a:hover { text-decoration: underline; } .rental-list { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; } .rental-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid #dfe8df; border-radius: 10px; background: #f7faf6; } .rental-row a { color: #1f5a8a; font-weight: 700; text-decoration: none; } .rental-row a:hover { text-decoration: underline; } .rental-row span { color: #536864; font-size: 13px; } </style>
