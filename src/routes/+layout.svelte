<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { Building2, LayoutDashboard, LogOut, Receipt } from '@lucide/svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';

	let { children } = $props();
	let isLoggedIn = $state(false);
	let hydrated = $state(false);
	let pathname = $derived(page.url.pathname as string);
	let isPublicRoute = $derived(pathname === '/login' || pathname === '/register');

	onMount(() => {
		isLoggedIn = pocketbase.client.authStore.isValid;
		hydrated = true;
		return pocketbase.client.authStore.onChange(() => {
			isLoggedIn = pocketbase.client.authStore.isValid;
		});
	});

	$effect(() => {
		if (!browser || !hydrated) return;
		if (isLoggedIn && isPublicRoute) goto('/dashboard');
		if (!isLoggedIn && !isPublicRoute) goto('/login');
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
			<a class="brand" href="/dashboard"><span class="brand-mark"><Building2 size={19} /></span><span>Rental<span class="brand-accent">OS3</span></span></a>
			<nav aria-label="Main navigation">
				<a class:active={pathname === '/dashboard'} href="/dashboard"><LayoutDashboard size={17} /> Overview</a>
				<a class:active={pathname === '/bills'} href="/bills"><Receipt size={17} /> Bills</a>
				<a class:active={pathname === '/rental'} href="/rental"><Building2 size={17} /> Rental</a>
			</nav>
			<button class="logout" onclick={logout}><LogOut size={17} /> Sign out</button>
		</aside>
		<main class="main-content">{@render children()}</main>
	</div>
{:else}
	{@render children()}
{/if}
