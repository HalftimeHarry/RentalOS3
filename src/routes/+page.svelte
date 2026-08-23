<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';

	onMount(() => {
		if (!browser) return;
		goto(pocketbase.client.authStore.isValid ? '/dashboard' : '/login');
	});
</script>

<div></div>
