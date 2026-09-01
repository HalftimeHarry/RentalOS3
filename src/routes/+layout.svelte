<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { ArrowUp, BarChart3, Building2, ClipboardCheck, LayoutDashboard, LogOut, Receipt, Settings2, Wrench, Users } from '@lucide/svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
	import { renterService } from '$lib/services/RenterService';
	import { rentalService } from '$lib/services/RentalService';

	let { children } = $props<{ children?: () => unknown }>();
	let isLoggedIn = $state(false);
	let hydrated = $state(false);
	let hasRentalReference = $state(false);
	let hasActiveTenantStatus = $state(false);
	let showScrollTop = $state(false);
	let pathname = $derived(page.url.pathname as string);
	let isPublicRoute = $derived(pathname === '/' || pathname === '/login' || pathname === '/register');
	let userRole = $derived((pocketbase.client.authStore.model?.role as string | undefined) ?? 'renter');
	let isAdmin = $derived(userRole === 'admin');
	let canViewBills = $derived(isAdmin || hasRentalReference);
	let shouldShowInspectionHistory = $derived(isAdmin);
	let limitSidebarToBasicRoutes = $derived(!isAdmin && !hasRentalReference && !hasActiveTenantStatus);
	let roleLabel = $derived(userRole === 'admin' ? 'Admin' : 'Renter');

	onMount(() => {
		isLoggedIn = pocketbase.client.authStore.isValid;
		hydrated = true;

		const checkScrollPosition = () => {
			showScrollTop = window.scrollY > 260;
		};

		checkScrollPosition();
		window.addEventListener('scroll', checkScrollPosition, { passive: true });

		const syncRentalAccess = async () => {
			if (!pocketbase.client.authStore.isValid) {
				hasRentalReference = false;
				hasActiveTenantStatus = false;
				return;
			}
			if (userRole === 'admin') {
				hasRentalReference = true;
				hasActiveTenantStatus = false;
				return;
			}
			const [rentals, currentTenantProfile] = await Promise.all([
				rentalService.list(),
				renterService.getCurrent()
			]);
			hasRentalReference = rentals.length > 0;
			hasActiveTenantStatus = (currentTenantProfile?.status ?? 'applying') === 'active';
		};
		syncRentalAccess();
		const unsubscribeAuth = pocketbase.client.authStore.onChange(() => {
			isLoggedIn = pocketbase.client.authStore.isValid;
			syncRentalAccess();
		});
		return () => {
			window.removeEventListener('scroll', checkScrollPosition);
			unsubscribeAuth();
		};
	});

	$effect(() => {
		if (!browser || !hydrated) return;
		if (isLoggedIn && isPublicRoute && pathname !== '/dashboard') goto('/dashboard');
		if (!isLoggedIn && !isPublicRoute && pathname !== '/login') goto('/login');
		if (isLoggedIn && pathname === '/dashboard') {
			console.debug('[layout] dashboard route is visible for logged-in user');
		}
	});

	function logout() {
		pocketbase.client.authStore.clear();
		isLoggedIn = false;
		goto('/login');
	}

	function scrollToTop() {
		window.scrollTo({ top: 0, behavior: 'smooth' });
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
				{#if !limitSidebarToBasicRoutes}
					{#if canViewBills}
						<a class:active={pathname === '/bills'} href="/bills"><Receipt size={17} /> Bills</a>
					{/if}
				{/if}
				<a class:active={pathname === '/rental'} href="/rental"><Building2 size={17} /> Rental</a>
				{#if shouldShowInspectionHistory}
					<a class:active={pathname === '/inspections/history'} href="/inspections/history"><ClipboardCheck size={17} /> Inspection history</a>
				{/if}
				{#if !limitSidebarToBasicRoutes}
					<a class:active={pathname === '/maintenance'} href="/maintenance"><Wrench size={17} /> Maintenance / 30-day Notice</a>
					{#if isAdmin}
						<a class:active={pathname === '/inspections'} href="/inspections"><ClipboardCheck size={17} /> Inspections</a>
					{/if}
					{#if isAdmin}
						<div class="nav-group-label">Admin tools</div>
						<a class:active={pathname === '/tenants'} href="/tenants"><Users size={17} /> Tenants</a>
						<a href="/dashboard"><BarChart3 size={17} /> Reports</a>
						<a href="/rental"><Settings2 size={17} /> Settings</a>
					{/if}
				{/if}
				<button class="logout" onclick={logout}><LogOut size={17} /> Sign out</button>
			</nav>
		</aside>
		<main class="main-content">{#if children}{@render children()}{/if}</main>
	</div>
{:else if children}
	{@render children()}
{/if}

{#if showScrollTop}
	<button class="back-to-top" type="button" aria-label="Back to top" onclick={scrollToTop}>
		<ArrowUp size={18} />
	</button>
{/if}

<style>
	.back-to-top {
		position: fixed;
		right: 24px;
		bottom: 24px;
		z-index: 40;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border: 1px solid #183b35;
		border-radius: 999px;
		background: rgba(24, 59, 53, 0.96);
		color: #fff;
		box-shadow: 0 12px 26px rgba(24, 59, 53, 0.2);
		cursor: pointer;
		transition: transform 0.2s ease, opacity 0.2s ease;
	}

	.back-to-top:hover,
	.back-to-top:focus-visible {
		transform: translateY(-2px);
		outline: none;
	}

	@media print {
		:global(body),
		:global(html) {
			background: white !important;
		}

		.sidebar,
		.back-to-top {
			display: none !important;
		}
	}

	@media (max-width: 720px) {
		.back-to-top {
			right: 16px;
			bottom: 16px;
			width: 44px;
			height: 44px;
		}
	}
</style>
