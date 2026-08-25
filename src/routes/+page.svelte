<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { ArrowRight, Building2, CheckCircle2, DollarSign, MapPin } from '@lucide/svelte';

	let slideshowTimer: ReturnType<typeof setInterval> | undefined;
	import { pocketbase } from '$lib/pocketbase/PocketBaseProvider';
	import { rentalService } from '$lib/services/RentalService';
	import type { Rental } from '$lib/models';

	let rental = $state<Rental | null>(null);
	let activePhotoIndex = $state(0);

	const plainText = (value?: string | null) =>
		(value ?? '')
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'")
			.replace(/\s+/g, ' ')
			.trim();

	const toPhotoUrl = (fileName: string) => {
		if (!fileName) return '';
		if (fileName.startsWith('http')) return fileName;
		if (!rental?.collectionId || !rental.id) return '';
		const baseUrl = (pocketbase.client.baseUrl || '').replace(/\/$/, '');
		return `${baseUrl}/api/files/${rental.collectionId}/${rental.id}/${encodeURIComponent(fileName)}`;
	};

	const photoUrls = $derived((rental?.photos ?? []).map((photo) => toPhotoUrl(photo)).filter(Boolean));
	const currentPhoto = $derived(photoUrls[activePhotoIndex] ?? null);

	onMount(async () => {
		if (!browser) return;
		if (pocketbase.client.authStore.isValid) {
			goto('/dashboard');
			return;
		}

		try {
			rental = await rentalService.getCurrent();
		} catch (error) {
			console.error('[landing page] failed to load rental:', error);
		}
	});

	$effect(() => {
		if (!browser || !photoUrls.length) return;

		if (slideshowTimer) clearInterval(slideshowTimer);
		slideshowTimer = setInterval(() => {
			activePhotoIndex = (activePhotoIndex + 1) % photoUrls.length;
		}, 3500);

		return () => {
			if (slideshowTimer) clearInterval(slideshowTimer);
		};
	});
</script>

<svelte:head>
	<title>RentalOS3 · Property management</title>
</svelte:head>

<div class="landing-shell">
	<header class="topbar">
		<div class="brand">
			<span class="brand-mark"><Building2 size={18} /></span>
			<span>Rental<span class="brand-accent">OS3</span></span>
		</div>
		<div class="topbar-actions">
			<a class="secondary-button" href="/login">Sign in</a>
			<a class="primary-button" href="/register">Create account</a>
		</div>
	</header>

	<main class="hero">
		<section class="hero-copy">
			<p class="eyebrow">Find your next home</p>
			<h1>Comfort, convenience, and a place you’ll love to come home to.</h1>
			<p class="lede">
				Discover a modern rental experience designed for easy living—stylish spaces, move-in ready comfort, and amenities that make everyday life easier.
			</p>

			{#if rental}
				<div class="rental-summary">
					<div class="summary-row">
						<MapPin size={16} />
						<span>{plainText(rental.address) || 'Property address pending'}</span>
					</div>
					<div class="summary-row">
						<DollarSign size={16} />
						<span>${(rental.rent ?? 0).toLocaleString()} / month</span>
					</div>
				</div>
			{/if}

			<div class="amenities-list" aria-label="Apartment amenities">
				<span><CheckCircle2 size={16} /> Parking</span>
				<span><CheckCircle2 size={16} /> Washer / Dryer in unit</span>
				<span><CheckCircle2 size={16} /> Pool</span>
				<span><CheckCircle2 size={16} /> Gym</span>
				<span><CheckCircle2 size={16} /> Air conditioning</span>
				<span><CheckCircle2 size={16} /> Garbage disposal</span>
				<span><CheckCircle2 size={16} /> Gated</span>
				<span><CheckCircle2 size={16} /> Public transportation close</span>
			</div>

			<div class="cta-row">
				<a class="primary-button" href="/register">Apply now</a>
				<a class="secondary-button" href="/login">Sign in <ArrowRight size={16} /></a>
			</div>
		</section>

		<section class="gallery-card">
			{#if currentPhoto}
				<div class="slide-wrap">
					<img src={currentPhoto} alt={plainText(rental?.address) || 'Rental property'} />
				</div>
			{:else}
				<div class="empty-gallery">
					<p>No photos uploaded yet.</p>
				</div>
			{/if}

			{#if photoUrls.length > 1}
				<div class="dot-row" aria-label="Photo slideshow indicators">
					{#each photoUrls as _, index}
						<button
							type="button"
							class:active={index === activePhotoIndex}
							aria-label={`View photo ${index + 1}`}
							onclick={() => activePhotoIndex = index}
						></button>
					{/each}
				</div>
			{/if}
		</section>
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: Inter, 'Segoe UI', sans-serif;
		background: #f3f7f2;
		color: #1b2d2a;
	}

	* { box-sizing: border-box; }
	button, a { font: inherit; }

	.landing-shell {
		min-height: 100vh;
		padding: 32px 24px 48px;
		background:
			radial-gradient(circle at top left, rgba(164, 210, 128, 0.35), transparent 28%),
			linear-gradient(135deg, #f8faf7 0%, #edf5ee 100%);
	}

	.topbar {
		max-width: 1200px;
		margin: 0 auto 40px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 14px 18px;
		border-radius: 18px;
		background: #0d1e1d;
		box-shadow: 0 12px 30px rgba(10, 23, 21, 0.18);
		color: white;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 1.2rem;
		font-weight: 700;
		color: white;
	}

	.brand-mark {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: #b9df7f;
		color: #183b35;
	}

	.brand-accent { color: #4f7a39; }

	.topbar-actions, .cta-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.primary-button, .secondary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px 18px;
		border-radius: 999px;
		text-decoration: none;
		font-weight: 700;
		transition: transform 0.2s ease, opacity 0.2s ease;
	}

	.primary-button {
		background: #b9df7f;
		color: #183b35;
	}

	.secondary-button {
		background: rgba(255, 255, 255, 0.08);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	.primary-button:hover, .secondary-button:hover {
		transform: translateY(-1px);
	}

	.hero {
		max-width: 1200px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1.05fr 1.15fr;
		gap: 36px;
		align-items: center;
	}

	.hero-copy {
		display: grid;
		gap: 20px;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #4f7a39;
	}

	.hero-copy h1 {
		margin: 0;
		font-size: clamp(2.7rem, 4vw, 5rem);
		line-height: 1;
		letter-spacing: -0.06em;
	}

	.lede {
		margin: 0;
		max-width: 36rem;
		font-size: 1.08rem;
		line-height: 1.7;
		color: #516e67;
	}

	.rental-summary {
		display: grid;
		gap: 10px;
		padding: 18px 20px;
		max-width: 480px;
		border: 1px solid #dfe9df;
		border-radius: 18px;
		background: rgba(255, 255, 255, 0.7);
	}

	.amenities-list {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		max-width: 620px;
	}

	.amenities-list span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 999px;
		background: rgba(185, 223, 127, 0.18);
		color: #23463d;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.amenities-list svg {
		flex-shrink: 0;
		color: #2f6a4a;
	}

	.summary-row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 600;
		color: #23463d;
	}

	.gallery-card {
		padding: 18px;
		border-radius: 24px;
		background: rgba(255, 255, 255, 0.85);
		border: 1px solid rgba(156, 182, 160, 0.5);
		box-shadow: 0 20px 60px rgba(21, 46, 42, 0.08);
	}

	.slide-wrap {
		position: relative;
		border-radius: 18px;
		overflow: hidden;
		background: #e7efe4;
	}

	.slide-wrap img {
		display: block;
		width: 100%;
		height: min(62vw, 520px);
		object-fit: cover;
	}

	.slide-controls {
		position: absolute;
		inset: auto 16px 16px 16px;
		display: flex;
		justify-content: space-between;
		pointer-events: none;
	}

	.slide-controls button {
		pointer-events: auto;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border: 0;
		border-radius: 999px;
		background: rgba(24, 59, 53, 0.82);
		color: white;
		cursor: pointer;
	}

	.dot-row {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-top: 14px;
	}

	.dot-row button {
		width: 10px;
		height: 10px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: #d5ddd5;
		cursor: pointer;
	}

	.dot-row button.active {
		background: #183b35;
	}

	.empty-gallery {
		display: grid;
		place-items: center;
		min-height: 420px;
		border-radius: 18px;
		background: linear-gradient(135deg, #edf5ee, #dfeee4);
		color: #607d77;
		font-weight: 700;
	}

	@media (max-width: 900px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.landing-shell { padding-inline: 14px; }
		.topbar { margin-bottom: 24px; }
		.topbar-actions { width: 100%; justify-content: flex-end; }
		.primary-button, .secondary-button { flex: 1; }
		.hero-copy h1 { font-size: 2.5rem; }
		.slide-wrap img { height: 360px; }
	}
</style>
