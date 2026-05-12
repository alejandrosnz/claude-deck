/**
 * Claude Deck plugin entry point.
 *
 * Registers actions and starts the WebSocket connection to OpenDeck /
 * Stream Deck software.
 */

import streamDeck from '@elgato/streamdeck';
import { Usage5hAction } from './actions/usage-5h';
import { Usage7dAction } from './actions/usage-7d';

streamDeck.actions.registerAction(new Usage5hAction());
streamDeck.actions.registerAction(new Usage7dAction());

void streamDeck.connect();
