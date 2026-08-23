<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowUpRight, CalendarDays, CircleDollarSign, House } from '@lucide/svelte';
  import { rentalService } from '$lib/services/RentalService';
  import { billService } from '$lib/services/BillService';
  import type { Bill, Rental } from '$lib/models';

  let rental = $state<Rental | null>(null);
  let currentBill = $state<Bill | null>(null);
  onMount(async () => { rental = await rentalService.getCurrent(); try { currentBill = (await billService.list(rental?.id))[0] ?? null; } catch {} });
  const money = (value = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
</script>
<svelte:head><title>Overview · RentalOS3</title></svelte:head>
<div class="page-header"><div><p class="page-kicker">Monday, your rental at a glance</p><h1>Good morning.</h1><p class="muted">Here is what needs your attention.</p></div><a class="button" href="/bills">View all bills <ArrowUpRight size={16} /></a></div>
<div class="stat-grid"><div class="stat"><span class="stat-label"><House size={15} /> Property</span><span class="stat-value">{rental?.address ?? 'No rental set up'}</span></div><div class="stat"><span class="stat-label"><CircleDollarSign size={15} /> Monthly rent</span><span class="stat-value">{money(rental?.rent)}</span></div><div class="stat"><span class="stat-label"><CalendarDays size={15} /> Next due</span><span class="stat-value">{currentBill?.dueDate ? new Date(currentBill.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</span></div></div>
<section class="panel bill-highlight"><div><p class="page-kicker">Current bill</p><h2>{currentBill?.paid ? 'Paid in full' : 'Monthly payment'}</h2><div class="bill-meta"><span>Rent {money(currentBill?.rent ?? rental?.rent)}</span><span>Utilities {money((currentBill?.sdge ?? 0) + (currentBill?.att ?? 0))}</span></div></div><div><div class="bill-total">{money(currentBill?.total ?? rental?.rent)}</div><span class="pill {currentBill?.paid ? 'paid' : 'unpaid'}">{currentBill?.paid ? 'Paid' : 'Awaiting payment'}</span></div></section>
