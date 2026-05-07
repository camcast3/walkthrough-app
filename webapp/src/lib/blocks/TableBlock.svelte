<script lang="ts">
	import type { TableBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block, blockId, checkedSteps, onToggle, sectionId, blockIdx }: {
		block: TableBlock;
		blockId?: string;
		checkedSteps: Set<string>;
		onToggle: (id: string) => void;
		sectionId?: string;
		blockIdx?: number;
	} = $props();

	const isCheckable = $derived(!!(sectionId != null && blockIdx != null));

	function rowId(rowIdx: number): string {
		return `${sectionId}-tbl-${blockIdx}-r${rowIdx}`;
	}

	const allChecked = $derived(
		isCheckable && block.rows.length > 0 &&
		block.rows.every((_row, i) => checkedSteps.has(rowId(i)))
	);

	function toggleAll() {
		if (!isCheckable) return;
		if (allChecked) {
			// Uncheck all rows
			for (let i = 0; i < block.rows.length; i++) {
				if (checkedSteps.has(rowId(i))) onToggle(rowId(i));
			}
		} else {
			// Check all rows
			for (let i = 0; i < block.rows.length; i++) {
				if (!checkedSteps.has(rowId(i))) onToggle(rowId(i));
			}
		}
	}
</script>

<div class="table-block" class:block-checked={allChecked} data-block-id={blockId}>
	{#if block.heading && isCheckable}
		<button
			class="block-header table-toggle"
			class:is-checked={allChecked}
			role="checkbox"
			aria-checked={allChecked}
			aria-label="{block.heading}"
			onclick={toggleAll}
		>
			<span class="block-check" aria-hidden="true">
				<svg viewBox="0 0 20 20" fill="none">
					<rect class="check-bg" x="1" y="1" width="18" height="18" rx="5" />
					<polyline class="check-mark" class:checked={allChecked} points="5,10 9,14 15,6" />
				</svg>
			</span>
			<h3 class="table-heading">{block.heading}</h3>
			<span class="table-counter">{block.rows.filter((_r, i) => checkedSteps.has(rowId(i))).length}/{block.rows.length}</span>
			<span class="block-collapse-icon" aria-hidden="true">{allChecked ? '▶' : '▼'}</span>
		</button>
	{:else if block.heading}
		<h3 class="table-heading standalone">{block.heading}</h3>
	{/if}

	{#if !allChecked}
		<div class="table-scroll">
			<table>
				<thead>
					<tr>
						{#if isCheckable}<th class="check-col"></th>{/if}
						{#each block.columns as col}
							<th>{@html marked.parseInline(col)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each block.rows as row, rIdx}
						{@const rid = isCheckable ? rowId(rIdx) : ''}
						{@const rowChecked = isCheckable && checkedSteps.has(rid)}
						<tr class:row-checked={rowChecked}>
							{#if isCheckable}
								<td class="check-col">
									<button
										class="row-check-btn block-header"
										role="checkbox"
										aria-checked={rowChecked}
										aria-label="Row {rIdx + 1}"
										onclick={() => onToggle(rid)}
									>
										<svg viewBox="0 0 20 20" fill="none" class="row-check-svg">
											<rect class="check-bg" x="1" y="1" width="18" height="18" rx="5" />
											<polyline class="check-mark" class:checked={rowChecked} points="5,10 9,14 15,6" />
										</svg>
									</button>
								</td>
							{/if}
							{#each row as cell}
								<td>{@html marked.parseInline(cell)}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.table-block {
		margin: 0.75rem 0;
		border: 1px solid var(--border, #333);
		border-radius: 8px;
		overflow: hidden;
		transition: opacity 0.3s, border-color 0.2s;
	}
	.table-block.block-checked {
		opacity: 0.55;
		border-color: rgba(84, 214, 106, 0.3);
	}

	/* Checkable heading button */
	.table-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.7rem 0.85rem;
		background: var(--surface-alt, #1a1a2e);
		border: none;
		border-bottom: 1px solid var(--border, #333);
		cursor: pointer;
		text-align: left;
		transition: background 0.2s;
		-webkit-tap-highlight-color: transparent;
	}
	.table-toggle:hover {
		background: rgba(124, 106, 247, 0.08);
	}
	.table-toggle.is-checked {
		background: rgba(84, 214, 106, 0.06);
		border-bottom: none;
	}
	.table-toggle.is-checked .table-heading {
		color: #54d66a;
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
	.table-toggle.is-checked .block-check :global(.check-bg) {
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

	.table-heading {
		flex: 1;
		font-size: 0.95rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary, #e0e0e0);
	}
	.table-heading.standalone {
		padding: 0.7rem 0.85rem;
		background: var(--surface-alt, #1a1a2e);
		border-bottom: 1px solid var(--border, #333);
	}

	.table-counter {
		font-size: 0.75rem;
		color: var(--text-muted, #888);
		font-weight: 600;
		white-space: nowrap;
	}

	.table-scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th, td {
		padding: 0.4rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid var(--border, #333);
	}
	th {
		background: var(--surface-alt, #1a1a2e);
		font-weight: 600;
		color: var(--text-primary, #e0e0e0);
		position: sticky;
		top: 0;
	}
	td {
		color: var(--text-secondary, #b0b0b0);
	}
	tr:last-child td {
		border-bottom: none;
	}
	tr:hover td {
		background: var(--surface-alt, #1a1a2e);
	}

	/* Row checkbox */
	.check-col {
		width: 32px;
		padding: 0.25rem 0.4rem;
		text-align: center;
	}
	.row-check-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.row-check-svg {
		width: 18px;
		height: 18px;
	}
	.row-check-svg :global(.check-bg) {
		stroke: #3a3a5c;
		stroke-width: 1.5;
		fill: rgba(10, 10, 20, 0.5);
		transition: stroke 0.2s, fill 0.2s;
	}
	.row-checked .row-check-svg :global(.check-bg) {
		stroke: #54d66a;
		fill: rgba(84, 214, 106, 0.15);
	}
	.row-check-svg :global(.check-mark) {
		stroke: #3a3a5c;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 20;
		stroke-dashoffset: 20;
		transition: stroke-dashoffset 0.3s ease, stroke 0.2s;
	}
	.row-check-svg :global(.check-mark.checked) {
		stroke-dashoffset: 0;
		stroke: #54d66a;
	}

	/* Checked row dimming */
	tr.row-checked td {
		opacity: 0.5;
	}
	tr.row-checked:hover td {
		opacity: 0.7;
	}
</style>
