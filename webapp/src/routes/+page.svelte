<script lang="ts">
	import type { PageData } from './$types.js';
	import { countCheckableSteps, computeProgress, loadProgress, formatHours, HLTB_MODE_LABELS, HLTB_MODE_FULL_TITLES } from '$lib/state.js';
	import { onMount } from 'svelte';

	let { data }: { data: PageData } = $props();

	// Per-walkthrough progress percentages loaded from IndexedDB
	let progressMap = $state<Record<string, number>>({});
	let loaded = $state(false);

	onMount(async () => {
		const results: Record<string, number> = {};
		for (const wt of data.walkthroughs) {
			const record = await loadProgress(wt.id);
			if (record) {
				results[wt.id] = record.checkedSteps.length;
			}
		}
		progressMap = results;
		loaded = true;
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
		<div class="hero-icon" aria-hidden="true">🎮</div>
		<h1 class="hero-title">Walkthroughs</h1>
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
			{#each data.walkthroughs as wt, idx (wt.id)}
				{@const checked = progressMap[wt.id] ?? 0}
				<li class="card-wrapper" style="--delay: {idx * 60}ms" class:visible={loaded}>
					<a href="/{wt.id}" class="card" aria-label="{wt.game} — {wt.title}">
						<div class="card-body">
							<span class="game-name">{wt.game}</span>
							<span class="wt-title">{wt.title}</span>
							<span class="author">by {wt.author}</span>
							{#if wt.hltb?.main_story != null || wt.hltb?.main_story_sides != null || wt.hltb?.completionist != null}
								<span class="hltb-meta" aria-label="HowLongToBeat time estimates">
									⏱
									{#if wt.hltb.main_story != null}
										<span title="{HLTB_MODE_FULL_TITLES.main_story}">{formatHours(wt.hltb.main_story)}</span>
									{/if}
									{#if wt.hltb.main_story != null && wt.hltb.main_story_sides != null}
										<span class="hltb-sep">·</span>
									{/if}
									{#if wt.hltb.main_story_sides != null}
										<span title="{HLTB_MODE_FULL_TITLES.main_story_sides}">{formatHours(wt.hltb.main_story_sides)} {HLTB_MODE_LABELS.main_story_sides}</span>
									{/if}
									{#if (wt.hltb.main_story != null || wt.hltb.main_story_sides != null) && wt.hltb.completionist != null}
										<span class="hltb-sep">·</span>
									{/if}
									{#if wt.hltb.completionist != null}
										<span title="{HLTB_MODE_FULL_TITLES.completionist}">{formatHours(wt.hltb.completionist)} {HLTB_MODE_LABELS.completionist}</span>
									{/if}
								</span>
							{/if}
						</div>
						{#if checked > 0}
							<div class="progress-chip" aria-label="{checked} steps completed">
								<span class="chip-glow"></span>
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
		padding: 2.5rem 0 2rem;
	}

	.hero-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
		filter: drop-shadow(0 0 12px rgba(124,106,247,0.4));
	}

	.hero-title {
		font-size: 2.4rem;
		font-weight: 700;
		background: linear-gradient(135deg, #a89df7 0%, #7c6af7 40%, #54d66a 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.subtitle {
		margin-top: 0.5rem;
		color: #6a6a8a;
		font-size: 0.95rem;
		letter-spacing: 0.3px;
	}

	.banner {
		border-radius: 12px;
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		backdrop-filter: blur(8px);
	}

	:global(body[data-power-save]) .banner {
		backdrop-filter: none;
	}

	.banner.warning {
		background: rgba(255, 180, 0, 0.08);
		border: 1px solid rgba(255, 180, 0, 0.25);
		color: #ffd060;
	}

	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card-wrapper {
		opacity: 0;
		transform: translateY(12px);
		transition: opacity 0.4s ease, transform 0.4s ease;
		transition-delay: var(--delay);
	}

	.card-wrapper.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(20, 20, 36, 0.7);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(124,106,247,0.12);
		border-radius: 16px;
		padding: 1.1rem 1rem 1.1rem 1.25rem;
		cursor: pointer;
		transition: border-color 0.2s, background 0.2s, box-shadow 0.2s, transform 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	:global(body[data-power-save]) .card {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}

	.card:hover,
	.card:focus-visible {
		border-color: rgba(124,106,247,0.5);
		background: rgba(26, 26, 50, 0.85);
		box-shadow: 0 0 20px rgba(124,106,247,0.12), inset 0 1px 0 rgba(255,255,255,0.03);
		transform: translateY(-1px);
	}

	.card:active {
		transform: scale(0.98);
	}

	.card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.game-name {
		font-family: 'Rajdhani', system-ui, sans-serif;
		font-size: 1.15rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #f0f0ff;
	}

	.wt-title {
		font-size: 0.85rem;
		color: #8888aa;
	}

	.author {
		font-size: 0.78rem;
		color: #555577;
	}

	.hltb-meta {
		font-size: 0.75rem;
		color: #3d7a4a;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.1rem;
	}

	.hltb-sep {
		color: #3a3a5c;
	}

	.progress-chip {
		position: relative;
		background: rgba(124, 106, 247, 0.15);
		border: 1px solid rgba(124, 106, 247, 0.35);
		color: #a89df7;
		border-radius: 20px;
		padding: 0.25rem 0.7rem;
		font-size: 0.78rem;
		white-space: nowrap;
		flex-shrink: 0;
		overflow: hidden;
	}

	.chip-glow {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		box-shadow: inset 0 0 8px rgba(124,106,247,0.3);
		pointer-events: none;
	}

	.chevron {
		color: #3a3a5c;
		font-size: 1.5rem;
		flex-shrink: 0;
		line-height: 1;
		transition: color 0.2s, transform 0.2s;
	}

	.card:hover .chevron {
		color: #7c6af7;
		transform: translateX(2px);
	}

	.empty {
		text-align: center;
		color: #555577;
		padding: 3rem 1rem;
	}

	.empty .hint {
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: #444466;
	}

	.empty code {
		background: rgba(42, 42, 68, 0.6);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		font-size: 0.82rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.card-wrapper {
			opacity: 1;
			transform: none;
			transition: none;
		}
	}
</style>

