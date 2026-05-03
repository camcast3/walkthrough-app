import { fetchClientConfig } from '$lib/sync.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
	const configResult = await Promise.allSettled([fetchClientConfig()]);
	const config = configResult[0].status === 'fulfilled' ? configResult[0].value : null;

	return {
		appMode: config?.appMode ?? '',
		serverUrl: config?.serverUrl ?? '',
		refreshInterval: config?.refreshInterval ?? '',
		syncInterval: config?.syncInterval ?? '',
		cacheDir: config?.cacheDir ?? ''
	};
};
