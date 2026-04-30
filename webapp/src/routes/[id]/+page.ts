import { fetchWalkthrough } from '$lib/sync.js';
import type { PageLoad } from './$types.js';
import type { Walkthrough } from '$lib/types.js';
import { error } from '@sveltejs/kit';

export const load: PageLoad = async ({ params }) => {
	try {
		const walkthrough = await fetchWalkthrough(params.id) as Walkthrough;
		return { walkthrough };
	} catch {
		error(404, `Walkthrough "${params.id}" not found.`);
	}
};
