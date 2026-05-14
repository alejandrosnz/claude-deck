/**
 * Usage 5h — rolling 5-hour token usage keypad button.
 */

import streamDeck, { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent, type KeyDownEvent } from '@elgato/streamdeck';
import { registerButton, unregisterButton, toggleResetInfoForButton, type KeyActionLike } from '../poller';

@action({ UUID: 'com.claudedeck.usage5h' })
export class Usage5hAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    registerButton(ev.action.id, 'com.claudedeck.usage5h', ev.action as unknown as KeyActionLike);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    unregisterButton(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    streamDeck.logger.info(`[claude-deck] onKeyDown usage5h id=${ev.action.id}`);
    toggleResetInfoForButton(ev.action.id);
  }
}
