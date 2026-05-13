/**
 * Claude Deck plugin entry point.
 *
 * Registers actions and starts the WebSocket connection to OpenDeck /
 * Stream Deck software.
 */

import streamDeck from '@elgato/streamdeck';
import { Usage5hAction } from './actions/usage-5h';
import { Usage7dAction } from './actions/usage-7d';
import { AcceptAction } from './actions/accept';
import { RejectAction } from './actions/reject';
import { startHookServer } from './hook-server';

streamDeck.actions.registerAction(new Usage5hAction());
streamDeck.actions.registerAction(new Usage7dAction());
streamDeck.actions.registerAction(new AcceptAction());
streamDeck.actions.registerAction(new RejectAction());

// Start the local HTTP server that receives Claude Code PermissionRequest hooks.
// Port 27632 is the default; the user configures this URL in ~/.claude/settings.json.
startHookServer(27632);

void streamDeck.connect();

