<script lang="ts">
	import type { ChecklistBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block, checkedSteps, onToggle }: {
		block: ChecklistBlock;
		checkedSteps: Set<string>;
		onToggle: (id: string) => void;
	} = $props();

	const STYLE_ICON: Record<string, string> = {
		collectible: '◆',
		missable: '⚠',
		npc: '👤',
		key: '🔑',
		puzzle: '🧩'
	};

	const STYLE_CLASS: Record<string, string> = {
		collectible: 'style-collectible',
		missable: 'style-missable',
		npc: 'style-npc',
		key: 'style-key',
		puzzle: 'style-puzzle'
	};

	const icon = $derived(STYLE_ICON[block.style ?? 'collectible'] ?? '◆');
	const styleClass = $derived(STYLE_CLASS[block.style ?? 'collectible'] ?? 'style-collectible');
</script>

<div class="checklist-block {styleClass}">
	{#if block.heading}
		<h3 class="checklist-heading">
			<span class="checklist-icon" aria-hidden="true">{icon}</span>
			{@html marked.parseInline(block.heading)}
		</h3>
	{/if}
	<ul class="checklist-items">
		{#each block.items as item (item.id)}
			{@const isChecked = checkedSteps.has(item.id)}
			<li class="checklist-item" class:checked={isChecked}>
				<button
					class="checklist-btn"
					role="checkbox"
					aria-checked={isChecked}
					aria-label={item.label}
					onclick={() => onToggle(item.id)}
				>
					<span class="check-box" class:is-checked={isChecked} aria-hidden="true">
						{#if isChecked}✓{/if}
					</span>
					<span class="item-content">
						<span class="item-label">{@html marked.parseInline(item.label)}</span>
						{#if item.detail}
							<span class="item-detail">{@html marked.parseInline(item.detail)}</span>
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.checklist-block {
		border: 1px solid var(--border, #333);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		background: var(--surface-alt, #1a1a2e);
	}
	.checklist-block.style-missable { border-left: 4px solid #dc2626; }
	.checklist-block.style-collectible { border-left: 4px solid #3b82f6; }
	.checklist-block.style-npc { border-left: 4px solid #22c55e; }
	.checklist-block.style-key { border-left: 4px solid #eab308; }
	.checklist-block.style-puzzle { border-left: 4px solid #a855f7; }

	.checklist-heading {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.95rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
		color: var(--text-primary, #e0e0e0);
	}
	.checklist-icon { font-size: 1.1rem; }

	.checklist-items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.checklist-item.checked { opacity: 0.6; }

	.checklist-btn {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
		padding: 0.35rem 0.4rem;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		border-radius: 4px;
		color: inherit;
	}
	.checklist-btn:hover { background: var(--surface, #111); }

	.check-box {
		flex-shrink: 0;
		width: 1.2rem;
		height: 1.2rem;
		border: 2px solid var(--border, #555);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: bold;
		color: var(--accent, #6366f1);
	}
	.check-box.is-checked {
		background: var(--accent, #6366f1);
		border-color: var(--accent, #6366f1);
		color: white;
	}

	.item-content {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.item-label {
		font-size: 0.9rem;
		color: var(--text-primary, #e0e0e0);
	}
	.item-detail {
		font-size: 0.8rem;
		color: var(--text-muted, #888);
	}
</style>
