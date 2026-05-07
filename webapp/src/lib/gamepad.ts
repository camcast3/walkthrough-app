/**
 * Gamepad navigation for the walkthrough viewer.
 *
 * Polling runs via requestAnimationFrame — at least 60 fps on modern displays —
 * so stick scroll and button repeats feel instantaneous.  Polling is
 * automatically suspended by the browser when the page is not visible, and is
 * also stopped explicitly on gamepaddisconnected / visibilitychange so there is
 * no busy-loop when no gamepad is in use.
 *
 * Button mapping (standard gamepad layout):
 *   0 = A (South) — check/uncheck focused item
 *   1 = B (East)  — deselect / navigate back
 *   2 = X (West)  — checkout / context action
 *   3 = Y (North) — cycle HLTB mode
 *   4 = LB        — previous section
 *   5 = RB        — next section
 *   6 = LT        — zoom out (analog: pressure controls speed)
 *   7 = RT        — zoom in  (analog: pressure controls speed)
 *   8 = Back/Select/View — go to walkthrough list (home)
 *   9 = Start/Menu/Pause — open settings
 *   12 = D-pad Up   — focus previous item (repeat-on-hold)
 *   13 = D-pad Down — focus next item (repeat-on-hold)
 *   14 = D-pad Left  — prev section (or prev block in blocks mode)
 *   15 = D-pad Right — next section (or next block in blocks mode)
 *
 * Left stick Y-axis: analog scroll with quadratic response curve
 *
 * Navigation modes (handled by the page, not this module):
 *   Steps mode:  D-pad ↕ moves between step cards, A toggles check
 *   Prose mode:  D-pad ↕ moves between checkpoints/inline checks, A toggles
 *   Blocks mode: D-pad ↕ moves between all interactive elements across blocks,
 *                D-pad ↔ jumps between block boundaries, A toggles,
 *                LB/RB changes section
 */

export type GamepadAction =
	| 'check'
	| 'back'
	| 'prev-section'
	| 'next-section'
	| 'focus-up'
	| 'focus-down'
	| 'checkout'
	| 'cycle-hltb'
	| 'scroll-up'
	| 'scroll-down'
	| 'home'
	| 'settings'
	| 'zoom-in'
	| 'zoom-out';

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
	3: 'cycle-hltb',
	4: 'prev-section',
	5: 'next-section',
	8: 'home',
	9: 'settings',
	12: 'focus-up',
	13: 'focus-down',
	14: 'prev-section',
	15: 'next-section'
};

/** Deadzone for the left-stick Y-axis to avoid drift. */
const STICK_DEADZONE = 0.25;

/** Pixels to scroll per second at full stick deflection. */
const STICK_SCROLL_PPS = 300;

/** Minimum trigger value before zoom is applied (prevents drift). */
const TRIGGER_DEADZONE = 0.05;

/**
 * Zoom delta per second at full trigger press.
 * At full squeeze this gives ~0.9 zoom units/second.
 */
const TRIGGER_ZOOM_RATE = 0.9;

/** Assumed frame time (seconds) used for the very first poll frame when no previous timestamp exists. */
const DEFAULT_FRAME_TIME_SEC = 1 / 60;

/** Maximum elapsed time (seconds) clamped per frame to avoid large jumps after tab switches / pauses. */
const MAX_FRAME_TIME_SEC = 0.1;

export class GamepadNavigator {
	private rafId: number | null = null;
	private prevTimestamp: number | null = null;
	private buttonStates: Map<number, ButtonState> = new Map();
	private onAction: (action: GamepadAction, magnitude?: number) => void;
	private gamepadCount = 0;

	constructor(onAction: (action: GamepadAction, magnitude?: number) => void) {
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
		if (this.rafId !== null) return;
		this.rafId = requestAnimationFrame(this.poll);
	}

	private stopPolling(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.prevTimestamp = null;
	}

	private poll = (timestamp: DOMHighResTimeStamp): void => {
		// Elapsed seconds since last frame; cap to avoid jumps after pauses.
		const elapsed = this.prevTimestamp !== null
			? Math.min((timestamp - this.prevTimestamp) / 1000, MAX_FRAME_TIME_SEC)
			: DEFAULT_FRAME_TIME_SEC;
		this.prevTimestamp = timestamp;
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

			// Left-stick Y-axis: analog free-scroll with quadratic curve for smoothness
			const axisY = gp.axes[1] ?? 0;
			if (Math.abs(axisY) > STICK_DEADZONE) {
				const magnitude = (Math.abs(axisY) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
				// Quadratic curve: gentle near centre, fast at full deflection
				const pixels = Math.round(magnitude * magnitude * STICK_SCROLL_PPS * elapsed * Math.sign(axisY));
				if (pixels !== 0) {
					this.onAction(pixels < 0 ? 'scroll-up' : 'scroll-down', Math.abs(pixels));
				}
			}

			// Triggers: analog zoom proportional to squeeze pressure
			const lt = gp.buttons[6]?.value ?? 0;
			const rt = gp.buttons[7]?.value ?? 0;
			if (lt > TRIGGER_DEADZONE) this.onAction('zoom-out', lt * TRIGGER_ZOOM_RATE * elapsed);
			if (rt > TRIGGER_DEADZONE) this.onAction('zoom-in', rt * TRIGGER_ZOOM_RATE * elapsed);
		}
		this.rafId = requestAnimationFrame(this.poll);
	};
}
