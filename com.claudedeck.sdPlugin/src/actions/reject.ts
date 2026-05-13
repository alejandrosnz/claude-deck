/**
 * Reject action — denies the pending Claude Code permission request.
 *
 * UUID: com.claudedeck.reject
 *
 * The button shows:
 *   • Idle  (no pending request): dark background, dim × mark
 *   • Active (request pending)  : red tint, bright × mark, tool hint
 *
 * When the user presses the button it calls respondToHook('deny'), which
 * sends the denial response to the waiting Claude Code HTTP hook.
 */

import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';
import { getHookState, onHookStateChange, respondToHook, type HookState } from '../hook-server';
import { renderButtonImage } from '../renderer';

// Registry of all button context IDs currently on screen.
const registeredIds = new Set<string>();
let listenerInstalled = false;

// ── helpers ───────────────────────────────────────────────────────────────────

function isKeyAction(a: unknown): a is { setImage(url: string): Promise<void> } {
  return a != null && typeof (a as Record<string, unknown>).setImage === 'function';
}

async function updateButton(id: string, state: HookState): Promise<void> {
  try {
    const act = streamDeck.actions.getActionById(id);
    if (isKeyAction(act)) {
      await act.setImage(
        renderButtonImage({
          kind: 'reject',
          active: state.hasPending,
          toolName: state.toolName,
          subtext: state.subtext,
        }),
      );
    }
  } catch (err) {
    streamDeck.logger.error(`[claude-deck] reject.updateButton(${id}): ${err}`);
  }
}

async function updateAll(state: HookState): Promise<void> {
  for (const id of registeredIds) {
    await updateButton(id, state);
  }
}

function ensureListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  onHookStateChange((state) => void updateAll(state));
}

// ── Action ─────────────────────────────────────────────────────────────────────

@action({ UUID: 'com.claudedeck.reject' })
export class RejectAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    ensureListener();
    registeredIds.add(ev.action.id);
    await updateButton(ev.action.id, getHookState());
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    registeredIds.delete(ev.action.id);
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    respondToHook('deny');
  }
}
