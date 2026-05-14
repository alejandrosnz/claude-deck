/**
 * Claude Deck plugin entry point.
 *
 * Registers actions and starts the WebSocket connection to OpenDeck /
 * Stream Deck software.
 */

import streamDeck from '@elgato/streamdeck';
import { Usage5hAction } from './actions/usage-5h';
import { Usage7dAction } from './actions/usage-7d';

// Write directly to stdout so the startup line appears in OpenDeck's log file
// regardless of whether streamDeck.logger is functional at this point.
console.log('[claude-deck] plugin.ts loading — process pid=' + process.pid);

streamDeck.actions.registerAction(new Usage5hAction());
streamDeck.actions.registerAction(new Usage7dAction());

void streamDeck.connect();
