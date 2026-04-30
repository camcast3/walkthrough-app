<script lang="ts">
	import type { PageData } from './$types.js';
	import { countCheckableSteps, computeProgress, loadProgress } from '$lib/state.js';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();

	// Per-walkthrough progress percentages loaded from IndexedDB
	let progressMap = $state<Record<string, number>>({});

	onMount(async () => {
		const results: Record<string, number> = {};
		for (const wt of data.walkthroughs) {
			const record = await loadProgress(wt.id);
			if (record) {
				// We don't have section data here — just show step count
				results[wt.id] = record.checkedSteps.length;
			}
		}
		progressMap = results;
	});

	const STEP_TYPE_ICONS: Record<string, string> = {
		step: '✓',
		note: 'ℹ',
		warning: '⚠',
		collectible: '◆',
		boss: '☠'
	};
	void STEP_TYPE_ICONS;
</script>

<svelte:head>
	<title>Walkthrough Checklist</title>
</svelte:head>

<div class="page">
	<header class="hero">
		<h1>🎮 Walkthroughs</h1>
		<p class="subtitle">Select a walkthrough to continue</p>
	</header>

	{#if data.error}
		<div class="banner warning" role="alert">
			<span>⚠ {data.error}</span>
		</div>
	{/if}

	{#if data.walkthroughs.length === 0}
		<div class="empty">
			<p>No walkthroughs available.</p>
			<p class="hint">Add one by running the Copilot walkthrough-ingest skill and committing the JSON to <code>/walkthroughs/</code>.</p>
		</div>
	{:else}
		<ul class="list" role="list">
			{#each data.walkthroughs as wt (wt.id)}
				{@const checked = progressMap[wt.id] ?? 0}
				<li>
					<a href="/{wt.id}" class="card" aria-label="{wt.game} — {wt.title}">
						<div class="card-body">
							<span class="game-name">{wt.game}</span>
							<span class="wt-title">{wt.title}</span>
							<span class="author">by {wt.author}</span>
						</div>
						{#if checked > 0}
							<div class="progress-chip" aria-label="{checked} steps completed">
								{checked} ✓
							</div>
						{/if}
						<span class="chevron" aria-hidden="true">›</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 700px;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
	}

	.hero {
		text-align: center;
		padding: 2rem 0 1.5rem;
	}

	.hero h1 {
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.5px;
	}

	.subtitle {
		margin-top: 0.4rem;
		color: #8888aa;
		font-size: 0.95rem;
	}

	.banner {
		border-radius: 10px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.banner.warning {
		background: rgba(255, 180, 0, 0.12);
		border: 1px solid rgba(255, 180, 0, 0.3);
		color: #ffd060;
	}

	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: #1a1a2e;
		border: 1px solid #2a2a44;
		border-radius: 14px;
		padding: 1.1rem 1rem 1.1rem 1.25rem;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.card:hover,
	.card:focus-visible {
		border-color: #7c6af7;
		background: #1f1f35;
	}

	.card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.game-name {
		font-size: 1.05rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wt-title {
		font-size: 0.85rem;
		color: #9898b8;
	}

	.author {
		font-size: 0.78rem;
		color: #666688;
	}

	.progress-chip {
		background: rgba(124, 106, 247, 0.2);
		border: 1px solid rgba(124, 106, 247, 0.4);
		color: #a89df7;
		border-radius: 20px;
		padding: 0.2rem 0.6rem;
		font-size: 0.78rem;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.chevron {
		color: #444466;
		font-size: 1.4rem;
		flex-shrink: 0;
		line-height: 1;
	}

	.empty {
		text-align: center;
		color: #666688;
		padding: 3rem 1rem;
	}

	.empty .hint {
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: #555577;
	}

	.empty code {
		background: #2a2a44;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.82rem;
	}
</style>

