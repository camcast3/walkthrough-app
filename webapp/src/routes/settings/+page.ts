import { fetchClientConfig } from '$lib/sync.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
	let config = null;
	try {
		config = await fetchClientConfig();
	} catch {
		// Server unreachable — show empty form with defaults
	}

	return {
		appMode: config?.appMode ?? '',
		version: config?.version ?? '',
		serverUrl: config?.serverUrl ?? '',
		refreshInterval: config?.refreshInterval ?? '',
		syncInterval: config?.syncInterval ?? '',
		cacheDir: config?.cacheDir ?? '',
		powerSaverMode: config?.powerSaverMode ?? false
	};
};
