/**
 * Gamepad navigation for the walkthrough viewer.
 *
 * Button mapping (standard gamepad layout):
 *   0 = A (South) — check/uncheck focused step
 *   1 = B (East)  — navigate back
 *   4 = LB        — previous section
 *   5 = RB        — next section
 *   12 = D-pad Up
 *   13 = D-pad Down
 *   14 = D-pad Left  (previous section alias)
 *   15 = D-pad Right (next section alias)
 */

export type GamepadAction =
	| 'check'
	| 'back'
	| 'prev-section'
	| 'next-section'
	| 'focus-up'
	| 'focus-down';

interface ButtonState {
	pressed: boolean;
	wasPressed: boolean;
}

const BUTTON_MAP: Record<number, GamepadAction> = {
	0: 'check',
	1: 'back',
	4: 'prev-section',
	5: 'next-section',
	12: 'focus-up',
	13: 'focus-down',
	14: 'prev-section',
	15: 'next-section'
};

export class GamepadNavigator {
	private rafId: number | null = null;
	private buttonStates: Map<number, ButtonState> = new Map();
	private onAction: (action: GamepadAction) => void;

	constructor(onAction: (action: GamepadAction) => void) {
		this.onAction = onAction;
	}

	start(): void {
		this.poll();
	}

	stop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	private poll = (): void => {
		const gamepads = navigator.getGamepads?.() ?? [];
		for (const gp of gamepads) {
			if (!gp) continue;
			for (const [btnIndex, action] of Object.entries(BUTTON_MAP)) {
				const idx = Number(btnIndex);
				const button = gp.buttons[idx];
				if (!button) continue;

				const state = this.buttonStates.get(idx) ?? { pressed: false, wasPressed: false };
				const isPressed = button.pressed;

				// Fire on the leading edge (press, not hold)
				if (isPressed && !state.wasPressed) {
					this.onAction(action);
				}

				this.buttonStates.set(idx, { pressed: isPressed, wasPressed: isPressed });
			}
		}
		this.rafId = requestAnimationFrame(this.poll);
	};
}
