<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { BarChart3, Building2, LayoutDashboard, LogOut, Receipt, Settings2, Users } from '@lucide/svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
	import { rentalService } from '$lib/services/RentalService';

	let { children } = $props();
	let isLoggedIn = $state(false);
	let hydrated = $state(false);
	let hasRentalReference = $state(false);
	let pathname = $derived(page.url.pathname as string);
	let isPublicRoute = $derived(pathname === '/' || pathname === '/login' || pathname === '/register');
	let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'renter');
	let isAdmin = $derived(userRole === 'admin');
	let canViewBills = $derived(isAdmin || hasRentalReference);
	let roleLabel = $derived(userRole === 'admin' ? 'Admin' : 'Renter');

	onMount(() => {
		isLoggedIn = pocketbase.client.authStore.isValid;
		hydrated = true;
		const syncRentalAccess = async () => {
			if (!pocketbase.client.authStore.isValid) {
				hasRentalReference = false;
				return;
			}
			if (userRole === 'admin') {
				hasRentalReference = true;
				return;
			}
			const rentals = await rentalService.list();
			hasRentalReference = rentals.length > 0;
		};
		syncRentalAccess();
		return pocketbase.client.authStore.onChange(() => {
			isLoggedIn = pocketbase.client.authStore.isValid;
			syncRentalAccess();
		});
	});

	$effect(() => {
		if (!browser || !hydrated) return;
		if (isLoggedIn && isPublicRoute && pathname !== '/dashboard') goto('/dashboard');
		if (!isLoggedIn && !isPublicRoute && pathname !== '/login') goto('/login');
	});

	function logout() {
		pocketbase.client.authStore.clear();
		isLoggedIn = false;
		goto('/login');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if isLoggedIn && !isPublicRoute}
	<div class="app-shell">
		<aside class="sidebar">
			<div class="sidebar-top">
				<a class="brand" href="/dashboard"><span class="brand-mark"><Building2 size={19} /></span><span>Rental<span class="brand-accent">OS3</span></span></a>
				<span class="user-role-badge">{roleLabel}</span>
			</div>
			<nav aria-label="Main navigation">
				<a class:active={pathname === '/dashboard'} href="/dashboard"><LayoutDashboard size={17} /> Overview</a>
				{#if canViewBills}
					<a class:active={pathname === '/bills'} href="/bills"><Receipt size={17} /> Bills</a>
				{/if}
				<a class:active={pathname === '/rental'} href="/rental"><Building2 size={17} /> Rental</a>
				{#if isAdmin}
					<div class="nav-group-label">Admin tools</div>
					<a class:active={pathname === '/tenants'} href="/tenants"><Users size={17} /> Tenants</a>
					<a href="/dashboard"><BarChart3 size={17} /> Reports</a>
					<a href="/rental"><Settings2 size={17} /> Settings</a>
				{/if}
				<button class="logout" onclick={logout}><LogOut size={17} /> Sign out</button>
			</nav>
		</aside>
		<main class="main-content">{@render children()}</main>
	</div>
{:else}
	{@render children()}
{/if}
