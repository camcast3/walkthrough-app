/**
 * Gamepad navigation for the walkthrough viewer.
 *
 * Power-optimised: polling only runs when a gamepad is connected and the page
 * is visible.  Uses setTimeout (~15 fps) instead of requestAnimationFrame so
 * the browser can coalesce timers during idle and the CPU can sleep between
 * ticks — a significant battery saving on handhelds like the ROG Ally.
 *
 * Button mapping (standard gamepad layout):
 *   0 = A (South) — check/uncheck focused step
 *   1 = B (East)  — navigate back
 *   2 = X (West)  — checkout / context action
 *   4 = LB        — previous section
 *   5 = RB        — next section
 *   12 = D-pad Up   (repeat-on-hold)
 *   13 = D-pad Down (repeat-on-hold)
 *   14 = D-pad Left  (previous section alias)
 *   15 = D-pad Right (next section alias)
 */

export type GamepadAction =
	| 'check'
	| 'back'
	| 'prev-section'
	| 'next-section'
	| 'focus-up'
	| 'focus-down'
	| 'checkout';

interface ButtonState {
	pressed: boolean;
	wasPressed: boolean;
	/** Timestamp (ms) when the button was first held down, or null if not held. */
	heldSince: number | null;
	/** Timestamp (ms) of the most recent repeat fire, or null. */
	lastRepeat: number | null;
}

/** Buttons that fire repeat events while held (D-pad Up / Down for scrolling). */
const REPEAT_BUTTONS = new Set([12, 13]);

/** Delay before the first repeat fires (ms). */
const HOLD_DELAY_MS = 400;

/** Interval between subsequent repeat fires while held (ms). */
const REPEAT_INTERVAL_MS = 100;

const BUTTON_MAP: Record<number, GamepadAction> = {
	0: 'check',
	1: 'back',
	2: 'checkout',
	4: 'prev-section',
	5: 'next-section',
	12: 'focus-up',
	13: 'focus-down',
	14: 'prev-section',
	15: 'next-section'
};

const POLL_INTERVAL_MS = 66; // ~15 fps — responsive enough for button presses

export class GamepadNavigator {
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private buttonStates: Map<number, ButtonState> = new Map();
	private onAction: (action: GamepadAction) => void;
	private gamepadCount = 0;

	constructor(onAction: (action: GamepadAction) => void) {
		this.onAction = onAction;
	}

	start(): void {
		window.addEventListener('gamepadconnected', this.onGamepadConnected);
		window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
		document.addEventListener('visibilitychange', this.onVisibilityChange);

		// If a gamepad is already connected (e.g. page reload), start polling
		this.gamepadCount = (navigator.getGamepads?.() ?? []).filter(Boolean).length;
		if (this.gamepadCount > 0) this.startPolling();
	}

	stop(): void {
		this.stopPolling();
		window.removeEventListener('gamepadconnected', this.onGamepadConnected);
		window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
		document.removeEventListener('visibilitychange', this.onVisibilityChange);
	}

	private onGamepadConnected = (): void => {
		this.gamepadCount++;
		if (this.gamepadCount === 1 && !document.hidden) this.startPolling();
	};

	private onGamepadDisconnected = (): void => {
		this.gamepadCount = Math.max(0, this.gamepadCount - 1);
		if (this.gamepadCount === 0) this.stopPolling();
	};

	private onVisibilityChange = (): void => {
		if (document.hidden) {
			this.stopPolling();
		} else if (this.gamepadCount > 0) {
			this.startPolling();
		}
	};

	private startPolling(): void {
		if (this.timerId !== null) return;
		this.poll();
	}

	private stopPolling(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}

	private poll = (): void => {
		const gamepads = navigator.getGamepads?.() ?? [];
		const now = Date.now();
		for (const gp of gamepads) {
			if (!gp) continue;
			for (const [btnIndex, action] of Object.entries(BUTTON_MAP)) {
				const idx = Number(btnIndex);
				const button = gp.buttons[idx];
				if (!button) continue;

				const state = this.buttonStates.get(idx) ?? {
					pressed: false,
					wasPressed: false,
					heldSince: null,
					lastRepeat: null
				};
				const isPressed = button.pressed;

				if (isPressed && !state.wasPressed) {
					// Leading edge — fire immediately
					this.onAction(action);
					this.buttonStates.set(idx, {
						pressed: true,
						wasPressed: true,
						heldSince: now,
						lastRepeat: now
					});
				} else if (isPressed && state.wasPressed) {
					// Held — fire repeats only for designated repeat buttons
					if (REPEAT_BUTTONS.has(idx) && state.heldSince !== null) {
						const held = now - state.heldSince;
						if (held >= HOLD_DELAY_MS) {
							const sinceRepeat = now - (state.lastRepeat ?? now);
							if (sinceRepeat >= REPEAT_INTERVAL_MS) {
								this.onAction(action);
								this.buttonStates.set(idx, { ...state, lastRepeat: now });
							}
						}
					}
				} else if (!isPressed) {
					// Released — reset state
					this.buttonStates.set(idx, {
						pressed: false,
						wasPressed: false,
						heldSince: null,
						lastRepeat: null
					});
				}
			}
		}
		this.timerId = setTimeout(this.poll, POLL_INTERVAL_MS);
	};
}
