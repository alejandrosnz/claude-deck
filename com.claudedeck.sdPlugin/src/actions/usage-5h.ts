/**
 * Usage 5h — rolling 5-hour token usage keypad button.
 */

import { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent, type KeyDownEvent } from '@elgato/streamdeck';
import { registerButton, unregisterButton, toggleResetInfoForButton } from '../poller';

@action({ UUID: 'com.claudedeck.usage5h' })
export class Usage5hAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    registerButton(ev.action.id, 'com.claudedeck.usage5h');
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    unregisterButton(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    toggleResetInfoForButton(ev.action.id);
  }
}
