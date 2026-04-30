import { fetchWalkthroughs } from '$lib/sync.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async ({ fetch: _fetch }) => {
	try {
		const walkthroughs = await fetchWalkthroughs();
		return { walkthroughs, error: null };
	} catch {
		return { walkthroughs: [], error: 'Could not load walkthroughs — showing cached content if available.' };
	}
};
