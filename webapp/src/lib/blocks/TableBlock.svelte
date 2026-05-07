<script lang="ts">
	import type { TableBlock } from '$lib/types.js';
	import { marked } from 'marked';

	let { block }: { block: TableBlock } = $props();
</script>

<div class="table-block">
	{#if block.heading}
		<h3 class="table-heading">{block.heading}</h3>
	{/if}
	<div class="table-scroll">
		<table>
			<thead>
				<tr>
					{#each block.columns as col}
						<th>{@html marked.parseInline(col)}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each block.rows as row}
					<tr>
						{#each row as cell}
							<td>{@html marked.parseInline(cell)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.table-block {
		margin: 0.75rem 0;
	}
	.table-heading {
		font-size: 0.95rem;
		font-weight: 700;
		margin: 0 0 0.4rem;
		color: var(--text-primary, #e0e0e0);
	}
	.table-scroll {
		overflow-x: auto;
		border-radius: 6px;
		border: 1px solid var(--border, #333);
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
</style>
