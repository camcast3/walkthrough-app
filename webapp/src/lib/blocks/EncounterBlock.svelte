<script lang="ts">
	import type { EncounterBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block, blockId, checkedSteps, onToggle }: {
		block: EncounterBlock;
		blockId?: string;
		checkedSteps: Set<string>;
		onToggle: (id: string) => void;
	} = $props();

	const strategyHtml = $derived(block.strategy ? marked.parse(block.strategy, { async: false }) as string : '');

	const isCheckable = $derived(!!blockId);
	const isChecked = $derived(isCheckable && checkedSteps.has(blockId!));
</script>

<div class="encounter-block" class:block-checked={isChecked} data-block-id={blockId}>
	{#if isCheckable}
		<button
			class="block-header encounter-toggle"
			class:is-checked={isChecked}
			role="checkbox"
			aria-checked={isChecked}
			aria-label="{block.heading ?? block.name}"
			onclick={() => onToggle(blockId!)}
		>
			<span class="block-check" aria-hidden="true">
				<svg viewBox="0 0 20 20" fill="none">
					<rect class="check-bg" x="1" y="1" width="18" height="18" rx="5" />
					<polyline class="check-mark" class:checked={isChecked} points="5,10 9,14 15,6" />
				</svg>
			</span>
			<span class="encounter-icon" aria-hidden="true">☠</span>
			<h3 class="encounter-name">{block.heading ?? block.name}</h3>
			<span class="block-collapse-icon" aria-hidden="true">{isChecked ? '▶' : '▼'}</span>
		</button>
	{:else}
		<div class="encounter-header">
			<span class="encounter-icon" aria-hidden="true">☠</span>
			<h3 class="encounter-name">{block.heading ?? block.name}</h3>
		</div>
	{/if}

	{#if !isChecked}
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
	{/if}
</div>

<style>
	.encounter-block {
		border: 1px solid var(--border, #333);
		border-left: 4px solid #dc2626;
		border-radius: 8px;
		margin: 0.75rem 0;
		background: var(--surface-alt, #1a1a2e);
		overflow: hidden;
		transition: opacity 0.3s, border-color 0.2s;
	}
	.encounter-block.block-checked {
		opacity: 0.55;
		border-color: rgba(84, 214, 106, 0.3);
		border-left-color: rgba(84, 214, 106, 0.5);
	}

	/* Checkable header button */
	.encounter-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.7rem 0.85rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.2s;
		-webkit-tap-highlight-color: transparent;
	}
	.encounter-toggle:hover {
		background: rgba(220, 38, 38, 0.06);
	}
	.encounter-toggle.is-checked {
		background: rgba(84, 214, 106, 0.06);
	}
	.encounter-toggle.is-checked .encounter-name {
		color: #54d66a;
	}

	/* Non-checkable fallback header */
	.encounter-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0.5rem;
	}

	.block-check {
		display: block;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}
	.block-check svg { width: 100%; height: 100%; }
	.block-check :global(.check-bg) {
		stroke: #3a3a5c;
		stroke-width: 1.5;
		fill: rgba(10, 10, 20, 0.5);
		transition: stroke 0.2s, fill 0.2s;
	}
	.encounter-toggle.is-checked .block-check :global(.check-bg) {
		stroke: #54d66a;
		fill: rgba(84, 214, 106, 0.15);
	}
	.block-check :global(.check-mark) {
		stroke: #3a3a5c;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 20;
		stroke-dashoffset: 20;
		transition: stroke-dashoffset 0.3s ease, stroke 0.2s;
	}
	.block-check :global(.check-mark.checked) {
		stroke-dashoffset: 0;
		stroke: #54d66a;
	}

	.block-collapse-icon {
		font-size: 0.6rem;
		color: var(--text-muted, #888);
		flex-shrink: 0;
	}

	.encounter-icon {
		font-size: 1.3rem;
		flex-shrink: 0;
	}
	.encounter-name {
		flex: 1;
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
		padding: 0 1rem;
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
		margin: 0.5rem 1rem;
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
		margin: 0.5rem 1rem 0.75rem;
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
