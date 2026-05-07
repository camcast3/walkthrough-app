<script lang="ts">
	import type { ProseBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block, blockId, checkedSteps, onToggle }: {
		block: ProseBlock;
		blockId?: string;
		checkedSteps: Set<string>;
		onToggle: (id: string) => void;
	} = $props();

	const CHECKPOINT_RE = /<!--\s*checkpoint:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:\|\s*(.*?))?\s*-->/g;
	const INLINE_CHECKABLE_RE = /<!--\s*(collectible|missable|side_quest):\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:\|\s*(.*?))?\s*-->/g;

	const ICON: Record<string, string> = { collectible: '◆', missable: '⚠', side_quest: '📋' };

	function renderHtml(content: string): string {
		const checkpoints: { id: string; label: string }[] = [];
		const checkables: { type: string; id: string; label: string }[] = [];

		let processed = content.replace(INLINE_CHECKABLE_RE, (_m, type, id, label) => {
			checkables.push({ type, id, label: label?.trim() || id });
			return `___CHECKABLE___${checkables.length - 1}`;
		});

		processed = processed.replace(CHECKPOINT_RE, (_m, id, label) => {
			checkpoints.push({ id, label: label?.trim() || id });
			return `\n\n___CHECKPOINT___${checkpoints.length - 1}\n\n`;
		});

		let html = marked.parse(processed, { async: false }) as string;

		checkpoints.forEach((cp, idx) => {
			const ph = `___CHECKPOINT___${idx}`;
			const replacement = `<div class="checkpoint-slot" data-checkpoint-id="${cp.id}" data-checkpoint-label="${cp.label.replace(/"/g, '&quot;')}"></div>`;
			html = html.replace(new RegExp(`<p>${ph}</p>`, 'g'), replacement);
			html = html.replace(new RegExp(ph, 'g'), replacement);
		});

		checkables.forEach((chk, idx) => {
			const ph = `___CHECKABLE___${idx}`;
			const slot = `<span class="inline-check-slot" data-check-id="${chk.id}" data-check-type="${chk.type}" data-check-label="${chk.label.replace(/"/g, '&quot;')}"></span>`;
			html = html.replace(new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), slot);
		});

		return html;
	}

	const html = $derived(renderHtml(block.content));

	// Block-level check: only available when the block has a heading AND a blockId
	const isBlockCheckable = $derived(!!(block.heading && blockId));
	const isBlockChecked = $derived(isBlockCheckable && checkedSteps.has(blockId!));
</script>

{#if isBlockCheckable}
	<div class="prose-block-wrapper" class:block-checked={isBlockChecked} data-block-id={blockId}>
		<button
			class="block-header"
			class:is-checked={isBlockChecked}
			role="checkbox"
			aria-checked={isBlockChecked}
			aria-label="{block.heading}"
			onclick={() => onToggle(blockId!)}
		>
			<span class="block-check" aria-hidden="true">
				<svg viewBox="0 0 20 20" fill="none">
					<rect class="check-bg" x="1" y="1" width="18" height="18" rx="5" />
					<polyline class="check-mark" class:checked={isBlockChecked} points="5,10 9,14 15,6" />
				</svg>
			</span>
			<h3 class="block-heading">{block.heading}</h3>
			<span class="block-collapse-icon" aria-hidden="true">{isBlockChecked ? '▶' : '▼'}</span>
		</button>
		{#if !isBlockChecked}
			<div class="prose-block">
				{@html html}
			</div>
		{/if}
	</div>
{:else}
	{#if block.heading}
		<h3 class="block-heading standalone">{block.heading}</h3>
	{/if}
	<div class="prose-block">
		{@html html}
	</div>
{/if}

<style>
	.prose-block-wrapper {
		border: 1px solid var(--border, #333);
		border-radius: 10px;
		margin: 0.5rem 0;
		overflow: hidden;
		transition: opacity 0.3s, border-color 0.2s;
	}
	.prose-block-wrapper.block-checked {
		opacity: 0.55;
		border-color: rgba(84, 214, 106, 0.3);
	}

	.block-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.7rem 0.85rem;
		background: var(--surface-alt, #1a1a2e);
		border: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.2s;
		-webkit-tap-highlight-color: transparent;
	}
	.block-header:hover {
		background: rgba(124, 106, 247, 0.08);
	}
	.block-header.is-checked {
		background: rgba(84, 214, 106, 0.06);
	}

	.block-check {
		display: block;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}
	.block-check svg {
		width: 100%;
		height: 100%;
	}
	.block-check :global(.check-bg) {
		stroke: #3a3a5c;
		stroke-width: 1.5;
		fill: rgba(10, 10, 20, 0.5);
		transition: stroke 0.2s, fill 0.2s;
	}
	.block-header.is-checked .block-check :global(.check-bg) {
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

	.block-heading {
		flex: 1;
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e0e0e0);
	}
	.block-heading.standalone {
		font-size: 1.1rem;
		margin: 1rem 0 0.5rem;
	}
	.block-header.is-checked .block-heading {
		color: #54d66a;
	}

	.block-collapse-icon {
		font-size: 0.6rem;
		color: var(--text-muted, #888);
		flex-shrink: 0;
	}

	.prose-block {
		padding: 0.5rem 0.85rem 0.75rem;
		line-height: 1.7;
		color: var(--text-secondary, #b0b0b0);
	}
	.prose-block :global(h2),
	.prose-block :global(h3),
	.prose-block :global(h4) {
		color: var(--text-primary, #e0e0e0);
		margin-top: 1.2rem;
	}
	.prose-block :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.75rem 0;
		font-size: 0.85rem;
	}
	.prose-block :global(th),
	.prose-block :global(td) {
		border: 1px solid var(--border, #333);
		padding: 0.35rem 0.5rem;
		text-align: left;
	}
	.prose-block :global(th) {
		background: var(--surface-alt, #1a1a2e);
		font-weight: 600;
	}
	.prose-block :global(blockquote) {
		border-left: 3px solid var(--accent, #6366f1);
		padding-left: 0.75rem;
		margin: 0.75rem 0;
		color: var(--text-muted, #888);
	}
	.prose-block :global(p) {
		margin: 0.5rem 0;
	}
	.prose-block :global(ul),
	.prose-block :global(ol) {
		margin: 0.4rem 0;
		padding-left: 1.5rem;
	}
	.prose-block :global(li) {
		margin: 0.25rem 0;
	}
	.prose-block :global(strong) {
		color: var(--text-primary, #e0e0e0);
	}
</style>
