<script lang="ts">
	import type { QuestBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block, blockId, checkedSteps, onToggle }: {
		block: QuestBlock;
		blockId?: string;
		checkedSteps: Set<string>;
		onToggle: (id: string) => void;
	} = $props();

	const TYPE_BADGE: Record<string, { icon: string; label: string; color: string }> = {
		main: { icon: '⭐', label: 'Main', color: '#eab308' },
		side: { icon: '📋', label: 'Side', color: '#6366f1' },
		hidden: { icon: '🔍', label: 'Hidden', color: '#8b5cf6' },
		story: { icon: '📖', label: 'Story', color: '#0ea5e9' }
	};

	const badge = $derived(TYPE_BADGE[block.quest_type] ?? TYPE_BADGE.side);
	const contentHtml = $derived(block.content ? marked.parse(block.content, { async: false }) as string : '');

	const isCheckable = $derived(!!blockId);
	const isChecked = $derived(isCheckable && checkedSteps.has(blockId!));
</script>

<div class="quest-block" class:block-checked={isChecked} data-block-id={blockId}>
	{#if isCheckable}
		<button
			class="block-header quest-toggle"
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
			<span class="quest-type-badge" style="border-color: {badge.color}">
				<span aria-hidden="true">{badge.icon}</span> {badge.label}
			</span>
			<h3 class="quest-name">{block.heading ?? block.name}</h3>
			<span class="block-collapse-icon" aria-hidden="true">{isChecked ? '▶' : '▼'}</span>
		</button>
	{:else}
		<div class="quest-header">
			<span class="quest-type-badge" style="border-color: {badge.color}">
				<span aria-hidden="true">{badge.icon}</span> {badge.label}
			</span>
			<h3 class="quest-name">{block.heading ?? block.name}</h3>
		</div>
	{/if}

	{#if !isChecked}
		{#if block.client}
			<p class="quest-client">Client: <strong>{block.client}</strong></p>
		{/if}

		{#if block.content}
			<div class="quest-content">{@html contentHtml}</div>
		{/if}

		{#if block.reward}
			<div class="quest-reward">
				<span class="reward-icon" aria-hidden="true">🏆</span>
				<span class="reward-text">{@html marked.parseInline(block.reward)}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.quest-block {
		border: 1px solid var(--border, #333);
		border-left: 4px solid #6366f1;
		border-radius: 8px;
		margin: 0.75rem 0;
		background: var(--surface-alt, #1a1a2e);
		overflow: hidden;
		transition: opacity 0.3s, border-color 0.2s;
	}
	.quest-block.block-checked {
		opacity: 0.55;
		border-color: rgba(84, 214, 106, 0.3);
		border-left-color: rgba(84, 214, 106, 0.5);
	}

	/* Checkable header button */
	.quest-toggle {
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
		flex-wrap: wrap;
	}
	.quest-toggle:hover {
		background: rgba(99, 102, 241, 0.06);
	}
	.quest-toggle.is-checked {
		background: rgba(84, 214, 106, 0.06);
	}
	.quest-toggle.is-checked .quest-name {
		color: #54d66a;
	}

	/* Non-checkable fallback header */
	.quest-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0.4rem;
		flex-wrap: wrap;
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
	.quest-toggle.is-checked .block-check :global(.check-bg) {
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

	.quest-type-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		border: 1px solid;
		background: var(--surface, #111);
		color: var(--text-secondary, #b0b0b0);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.quest-name {
		flex: 1;
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e0e0e0);
	}
	.quest-client {
		font-size: 0.85rem;
		color: var(--text-muted, #888);
		margin: 0.25rem 1rem;
	}
	.quest-content {
		font-size: 0.9rem;
		color: var(--text-secondary, #b0b0b0);
		line-height: 1.5;
		margin: 0.4rem 1rem;
	}
	.quest-content :global(p) {
		margin: 0.3rem 0;
	}
	.quest-content :global(ul),
	.quest-content :global(ol) {
		margin: 0.3rem 0;
		padding-left: 1.25rem;
	}
	.quest-content :global(strong) {
		color: var(--text-primary, #e0e0e0);
	}
	.quest-reward {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0.5rem 1rem 0.75rem;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
		background: var(--surface, #111);
		font-size: 0.85rem;
	}
	.reward-icon { font-size: 1rem; }
	.reward-text { color: var(--text-secondary, #b0b0b0); }
</style>
