<script lang="ts">
	import type { EncounterBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block }: { block: EncounterBlock } = $props();

	const strategyHtml = $derived(block.strategy ? marked.parse(block.strategy, { async: false }) as string : '');
</script>

<div class="encounter-block">
	<div class="encounter-header">
		<span class="encounter-icon" aria-hidden="true">☠</span>
		<h3 class="encounter-name">{block.heading ?? block.name}</h3>
	</div>

	{#if block.stats && Object.keys(block.stats).length > 0}
		<dl class="encounter-stats">
			{#each Object.entries(block.stats) as [key, value]}
				<div class="stat-row">
					<dt class="stat-key">{key}</dt>
					<dd class="stat-val">{@html marked.parseInline(value)}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#if block.strategy}
		<details class="encounter-strategy" open>
			<summary>Strategy</summary>
			<div class="strategy-content">{@html strategyHtml}</div>
		</details>
	{/if}

	{#if block.reward || block.drops}
		<div class="encounter-rewards">
			{#if block.reward}<span class="reward-badge">🏆 {@html marked.parseInline(block.reward)}</span>{/if}
			{#if block.drops}<span class="drops-badge">💎 {@html marked.parseInline(block.drops)}</span>{/if}
		</div>
	{/if}
</div>

<style>
	.encounter-block {
		border: 1px solid var(--border, #333);
		border-left: 4px solid #dc2626;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		background: var(--surface-alt, #1a1a2e);
	}
	.encounter-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.encounter-icon {
		font-size: 1.3rem;
	}
	.encounter-name {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e0e0e0);
	}
	.encounter-stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.25rem 1rem;
		margin: 0.5rem 0;
		font-size: 0.85rem;
	}
	.stat-row {
		display: flex;
		gap: 0.5rem;
	}
	.stat-key {
		font-weight: 600;
		color: var(--text-muted, #888);
		text-transform: capitalize;
		min-width: 5rem;
	}
	.stat-val {
		color: var(--text-secondary, #b0b0b0);
		margin: 0;
	}
	.encounter-strategy {
		margin: 0.5rem 0;
		font-size: 0.9rem;
	}
	.encounter-strategy summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--text-primary, #e0e0e0);
	}
	.encounter-strategy .strategy-content {
		margin: 0.25rem 0 0;
		color: var(--text-secondary, #b0b0b0);
		line-height: 1.5;
	}
	.encounter-strategy .strategy-content :global(p) {
		margin: 0.4rem 0;
	}
	.encounter-strategy .strategy-content :global(ul),
	.encounter-strategy .strategy-content :global(ol) {
		margin: 0.3rem 0;
		padding-left: 1.25rem;
	}
	.encounter-strategy .strategy-content :global(strong) {
		color: var(--text-primary, #e0e0e0);
	}
	.encounter-rewards {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.reward-badge,
	.drops-badge {
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		background: var(--surface, #111);
		color: var(--text-secondary, #b0b0b0);
	}
</style>
