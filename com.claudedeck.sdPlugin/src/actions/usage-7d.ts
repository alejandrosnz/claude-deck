/**
 * Usage 7d — rolling 7-day token usage keypad button.
 */

import { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent, type KeyDownEvent } from '@elgato/streamdeck';
import { registerButton, unregisterButton, toggleResetInfoForButton, type KeyActionLike } from '../poller';

@action({ UUID: 'com.claudedeck.usage7d' })
export class Usage7dAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    registerButton(ev.action.id, 'com.claudedeck.usage7d', ev.action as unknown as KeyActionLike);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    unregisterButton(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    toggleResetInfoForButton(ev.action.id);
  }
}
