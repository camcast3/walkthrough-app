<script lang="ts">
	import type { QuestBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block }: { block: QuestBlock } = $props();

	const TYPE_BADGE: Record<string, { icon: string; label: string; color: string }> = {
		main: { icon: '⭐', label: 'Main', color: '#eab308' },
		side: { icon: '📋', label: 'Side', color: '#6366f1' },
		hidden: { icon: '🔍', label: 'Hidden', color: '#8b5cf6' },
		story: { icon: '📖', label: 'Story', color: '#0ea5e9' }
	};

	const badge = $derived(TYPE_BADGE[block.quest_type] ?? TYPE_BADGE.side);
	const contentHtml = $derived(block.content ? marked.parse(block.content, { async: false }) as string : '');
</script>

<div class="quest-block">
	<div class="quest-header">
		<span class="quest-type-badge" style="border-color: {badge.color}">
			<span aria-hidden="true">{badge.icon}</span> {badge.label}
		</span>
		<h3 class="quest-name">{block.heading ?? block.name}</h3>
	</div>

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
</div>

<style>
	.quest-block {
		border: 1px solid var(--border, #333);
		border-left: 4px solid #6366f1;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		background: var(--surface-alt, #1a1a2e);
	}
	.quest-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		flex-wrap: wrap;
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
	}
	.quest-name {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e0e0e0);
	}
	.quest-client {
		font-size: 0.85rem;
		color: var(--text-muted, #888);
		margin: 0.25rem 0;
	}
	.quest-content {
		font-size: 0.9rem;
		color: var(--text-secondary, #b0b0b0);
		line-height: 1.5;
		margin: 0.4rem 0;
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
		margin-top: 0.5rem;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
		background: var(--surface, #111);
		font-size: 0.85rem;
	}
	.reward-icon { font-size: 1rem; }
	.reward-text { color: var(--text-secondary, #b0b0b0); }
</style>
