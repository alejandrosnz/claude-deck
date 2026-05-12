# OpenAction API

## Welcome!

OpenAction is an API for developers looking to create custom actions for programmable control surfaces, like the Elgato Stream Deck, Tacto, and other similar products.

OpenAction is backwards-compatible with the Stream Deck SDK, which already allows developers to work in any programming language that supports WebSockets. Unlike the SD SDK, however, it aims to work on any operating system, and is designed for use with any device.

Provided that your plugin doesn't use extended features of the OpenAction API that aren't supported by the Stream Deck SDK, your plugin should also work with both the Elgato Stream Deck software and third-party software like Mirabox Stream Dock.

## Ecosystem

Generally speaking, developers working with the API to create their own custom actions will be creating OpenAction clients: plugins and their property inspectors. You can browse a catalogue of open source plugins on the OpenAction Marketplace. Once released on the marketplace, users can use these plugins with an OpenAction server.

The reference implementation of an OpenAction server is OpenDeck, an open source project that can be extended to support a variety of devices, and runs on all three major desktop operating systems. Tacto is a derivative of OpenDeck, from the same developer, with a focus on using mobile devices instead of dedicated hardware.

## Recommended development workflow

Although the OpenAction API preserves the flexibility of being able to use any programming language, the recommended workflow for new plugin developers incorporates the Rust programming language using the official OpenAction crate (library).

For building property inspectors, the most ergonomic approach is either to use the Svelte web framework using the official OpenAction Svelte library, or Elgato's SDPI Components framework. Using Svelte is recommended for more involved property inspectors, as it allows for better reactivity and easier reuse of components.

## Next steps

This documentation site is split into multiple sections. The initial section covers the basics of the API, applicable to users of all programming languages, followed by a section that covers the basics of using the Rust crate, and then a final section containing a technical reference on the supported events.

---

## Overview

If you're a developer starting to work with the OpenAction API to create custom actions for a programmable control surface, you're going to be creating a plugin, which is a concept hopefully familiar to you as a user of an OpenAction server (like OpenDeck). This page hopes to cover other key concepts of the API that aren't as visible to the end user.

### Plugin structure

In its distributed form, an OpenAction plugin is a regular filesystem directory (with a name ending in `.sdPlugin`, for backwards-compatibility with the Stream Deck SDK).

This directory contains everything that the plugin needs, including:

- A plugin manifest file (`manifest.json`), which describes the plugin and its actions to the server
- Your plugin's compiled executable file(s) (or script files, if using an interpreted language)
- Icons and images used by the plugin
- Property inspector (action settings UI) files, if needed

All of the user's installed plugins are stored together in a directory on their system, which varies depending on the OpenAction server and operating system being used. If you're using OpenDeck, you can locate this directory by clicking the "Open config directory" button in the OpenDeck settings view, then opening the `plugins` folder within.

Example plugins directory layout:

```
plugins/
├── com.example.coolplugin.sdPlugin/
│   ├── manifest.json                              # Plugin manifest file
│   ├── oacoolplugin-x86_64-pc-windows-msvc.exe   # Compiled executables
│   ├── oacoolplugin-aarch64-apple-darwin
│   ├── oacoolplugin-x86_64-apple-darwin
│   ├── oacoolplugin-x86_64-unknown-linux-gnu
│   ├── oacoolplugin-aarch64-unknown-linux-gnu
│   ├── icon.svg                                   # Plugin icon
│   ├── actions/                                   # Action icons
│   │   └── funaction.svg
│   └── pi/                                        # Action property inspectors
│       └── funaction.html
└── com.example.lesscoolplugin.sdPlugin/           # Another plugin
    ├── manifest.json
    ├── oalesscoolplugin-x86_64-pc-windows-msvc.exe
    ├── icon.svg
    └── actions/
        └── lessfunaction.svg
```

### Actions, instances and contexts

An OpenAction plugin can contain multiple actions, each of which provides different functionality to the user. For example, a plugin for controlling media playback might include actions for play/pause, previous, and next.

When a user adds an action to their control surface (for example, by dragging it onto a button on one of their OpenDeck profiles), this creates an instance of that action. Multiple instances of the same action can exist independently, each with its own settings and state.

Every action instance is identified by a unique **context** string, which is generated by the OpenAction server when the instance is created. This context is used in all communication between clients and the server to identify the instance an event pertains to. It is different from the action's UUID, which identifies all instances of that action.

When the user edits the appearance (state) or settings of an instance, the OpenAction server persists these changes, and notifies the plugin of the changes. Because each instance becomes an independent copy of the action template, you may need to completely remove and re-add your instances when making changes to the action in your plugin's manifest file.

### Property inspectors

Many actions need the user to be able to configure settings specific to that action instance. This is done through a property inspector, which is a user interface provided as part of the plugin.

Property inspectors are implemented using web technologies (HTML, CSS, and JavaScript), so that the OpenAction server can embed them in a webview. This is both due to the flexibility of web technologies for building user interfaces, and behaving in a consistent manner across different platforms.

Property inspectors themselves are also direct consumers of the OpenAction API, making them the other kind of OpenAction client (alongside plugins). All communication between the property inspector and the plugin happens through the OpenAction server.

However, property inspectors only have access to a limited subset of the events of the OpenAction API, primarily those related to reading and writing settings for the action instance they are associated with.

---

## Manifest

Your plugin needs to contain a `manifest.json` file that supplies key information about your plugin to the OpenAction server. It should be present in the root of your plugin directory. The file is the primary description of your plugin and contains information like the path to your plugin's entrypoint and the actions it provides.

### Icon path format

Multiple properties within a plugin manifest are intended to be references to image files supplied in your plugin. These values should be forward-slash delimited path strings that point to image files, relative to your plugin directory.

However, these paths should be supplied without the file type extension. The OpenAction server will resolve the path by attempting to locate `.svg`, `@2x.png`, and `.png` versions of your image.

For example, if you set an icon property to `"icon"` in your plugin manifest, the OpenAction server will look for `icon.svg`, `icon@2x.png`, and `icon.png` files in the root of your plugin directory.

### Example plugin manifest files

- https://github.com/OpenActionPlugins/counter/blob/main/assets/manifest.json
- https://github.com/OpenActionPlugins/system/blob/main/assets/manifest.json

### Plugin manifest format

`*` is used to denote a required field.

```jsonc
{
    // * The user-facing name of your plugin
    Name: string,
    // * The user-facing author string (e.g. "nekename")
    Author: string,
    // * The version of your plugin present (e.g. "2.7.2"),
    // as a Semantic Versioning (https://semver.org) compliant version string
    Version: string,
    // * An icon to represent your plugin, in the icon path format described above
    Icon: string,
    // The category your plugin's actions should appear under
    Category: string = "Custom",
    // An icon to represent the category your plugin's actions appear under,
    // which defaults to your plugin's icon if not specified
    CategoryIcon: string | null,
    // The relative path to the property inspector to be displayed for actions that don't specify their own
    PropertyInspectorPath: string | null,
    // Whether the plugin has its own GUI that the user can request to be shown through the OpenAction server
    // (not supported by Elgato Stream Deck)
    HasSettingsInterface: boolean = false,
    // A list of applications which, when launched or terminated, the OpenAction server should notify your plugin
    // (on macOS, set to the application's bundle ID, and on other platforms, set to the executable's name)
    ApplicationsToMonitor: {
        mac: string[],
        windows: string[],
        linux: string[]
    } = {},
    // * The actions provided by your plugin
    Actions: [
        {
            // * The user-facing name of this action
            Name: string,
            // * A unique identifier for this action, in reverse-DNS format,
            // that must start with your plugin's own UUID
            UUID: string,
            // A tooltip that describes the utility of this action
            Tooltip: string = "",
            // * An icon to represent this action, in the icon path format described above
            Icon: string,
            // Whether to automatically toggle the state of this action on key up
            // (only applies to actions with two states)
            DisableAutomaticStates: boolean = false,
            // Whether this action should be visible in the action list
            VisibleInActionsList: boolean = true,
            // Whether this action should be supported in Multi Actions
            SupportedInMultiActions: boolean = true,
            // The relative path to this action's property inspector, if it differs from your plugin's default
            PropertyInspectorPath: string | null,
            // The types of hardware this action should be supported on,
            // such as "Keypad" (buttons) or "Encoder" (dials, sliders or screens)
            Controllers: string[] = ["Keypad"],
            // * The different states this action can be displayed in
            States: [
                {
                    // The image of this state in the icon path format described above
                    // or set to "actionDefaultImage" to use the action's icon
                    Image: string = "actionDefaultImage",
                    // The name of this state
                    Name: string = "",
                    // The text to display over the image when in this state
                    Title: string = "",
                    // Whether to display the title over the image
                    ShowTitle: boolean = true,
                    // The colour of the state title
                    TitleColor: string = "#FFFFFF",
                    // The vertical alignment of the state title, set to "top", "middle", or "bottom"
                    TitleAlignment: string = "middle",
                    // The font style of the title, set to "Regular", "Bold", "Italic", or "Bold Italic"
                    FontStyle: string = "Regular",
                    // The font size of the state title in pixels, as rendered on a 72x72px state image
                    FontSize: string = "16",
                    // Whether to underline the state title or not
                    FontUnderline: boolean = false
                }
            ]
        }
    ],
    // * The operating systems your plugin is supported on
    OS: [
        {
            // * The platform in question, set to "windows", "mac", or "linux"
            Platform: string,
            // The minimum supported version of the platform in question
            Version: string | null
        }
    ],
    // The relative path to your plugin executable, to be used if no other code path is specified
    // (HTML5 and Node.js plugins should specify values ending in ".html" or ".js", ".cjs" or ".mjs", respectively)
    CodePath: string | null,
    // Overrides for CodePath by platform, specified using the platform's target triple
    // (introduced over the CodePathWin, CodePathMac and CodePathLin properties in order to support multiple CPU architectures,
    // but not supported by Elgato Stream Deck or older versions of OpenDeck;
    // therefore, the other properties below should also be specified)
    CodePaths: {
        "x86_64-pc-windows-msvc": string | null,
        "x86_64-apple-darwin": string | null,
        "aarch64-apple-darwin": string | null,
        "x86_64-unknown-linux-gnu": string | null,
        "aarch64-unknown-linux-gnu": string | null
    },
    // An override for CodePath to be used on Windows when not overridden in CodePaths
    CodePathWin: string | null,
    // An override for CodePath to be used on macOS when not overridden in CodePaths
    CodePathMac: string | null,
    // An override for CodePath to be used on Linux when not overridden in CodePaths
    CodePathLin: string | null
}
```

---

## Registration

The OpenAction server will start your plugin with arguments specifying the means of initialising the WebSocket connection. If you use a plugin SDK, such as openaction-rs, you may be able to skip these steps.

### Compiled plugin registration

Your plugin will be called with the following command-line argument format.

```
yourplugin -port <port> -pluginUUID <uuid> -registerEvent <event> -info <info>
```

Your plugin should initiate a WebSocket connection to the WebSocket server running on the specified port and send a registration event containing the supplied registration event and plugin UUID, similar to the procedure outlined for HTML5 plugins described below.

### HTML5 plugin registration

Your plugin should provide a function similar to the below to register the plugin with the OpenAction server. This function will be called automatically by the OpenAction server.

```javascript
function connectOpenActionSocket(port, pluginUUID, registerEvent, info) {
    const websocket = new WebSocket("ws://localhost:" + port);

    websocket.onopen = () => {
        websocket.send(JSON.stringify({
            "event": registerEvent,
            "uuid": pluginUUID
        }));
    };

    websocket.onmessage = (event) => {
        // Handle inbound events from the OpenAction server here
    };
}

// For Stream Deck compatibility
const connectElgatoStreamDeckSocket = connectOpenActionSocket;
```

### Property inspector registration

Your property inspectors should provide functions similar to the below to register themselves with the OpenAction server. These functions will be called automatically by the OpenAction server.

```javascript
function connectOpenActionSocket(port, propertyInspectorUUID, registerEvent, info) {
    const websocket = new WebSocket("ws://localhost:" + port);

    websocket.onopen = () => {
        websocket.send(JSON.stringify({
            "event": registerEvent,
            "uuid": propertyInspectorUUID
        }));
    };

    websocket.onmessage = (event) => {
        // Handle inbound events from the OpenAction server here
    };
}

// For Stream Deck compatibility
const connectElgatoStreamDeckSocket = connectOpenActionSocket;
```

### Info parameter

The info parameter supplied to both plugins and property inspectors is in the below format. The Stream Deck software supplies additional fields in this parameter, such as an integer to designate the model of Stream Deck in use.

```jsonc
{
    application: {
        font: string,
        language: string,       // e.g. "en"
        platform: string,       // e.g. "mac"
        platformVersion: string, // e.g. "11.6.2"
        version: string         // e.g. "OpenDeck 2.0.0"
    },
    plugin: {
        uuid: string,           // e.g. "com.amansprojects.starterpack"
        version: string         // e.g. "1.0.0"
    },
    devices: [
        {
            id: string,
            name: string,
            size: {
                rows: number,
                columns: number
            }
        }
    ]
}
```

---

## Clientbound events

This chapter describes the events that can be sent by the OpenAction server to either plugins or property inspectors.

### Applications

#### `applicationDidLaunch`

Fired when an application that is registered for monitoring in the plugin manifest is launched.

**Received by:** Plugin

```jsonc
{
    event: "applicationDidLaunch",
    payload: {
        application: string
    }
}
```

#### `applicationDidTerminate`

Fired when an application that is registered for monitoring in the plugin manifest is terminated.

**Received by:** Plugin

```jsonc
{
    event: "applicationDidTerminate",
    payload: {
        application: string
    }
}
```

---

### Deep link

#### `didReceiveDeepLink`

Fired when a deep link URL matching a format for sending messages to the plugin is opened.

The URL formats that can trigger this event are:
- `openaction://plugins/message/<PLUGIN_DIRECTORY_NAME>/<MESSAGE_CONTENT>[?openaction=hidden]`
- `streamdeck://plugins/message/<PLUGIN_UUID>/<MESSAGE_CONTENT>[?streamdeck=hidden]`

where the optional query parameter specifies that the OpenAction server's window should not be brought to the foreground when the deep link is opened.

**Received by:** Plugin

```jsonc
{
    event: "didReceiveDeepLink",
    payload: {
        url: string
    }
}
```

---

### Devices

#### `deviceDidConnect`

Fired when a device is connected.

The Stream Deck software supplies an additional field: an integer to designate the model of Stream Deck in use.

**Received by:** Plugin

```jsonc
{
    event: "deviceDidConnect",
    device: string,
    deviceInfo: {
        name: string,
        size: {
            rows: number,
            columns: number
        }
    }
}
```

#### `deviceDidDisconnect`

Fired when a device is disconnected.

**Received by:** Plugin

```jsonc
{
    event: "deviceDidDisconnect",
    device: string
}
```

---

### Encoder

#### `dialRotate`

Fired on encoder dial rotate or encoder slider move.

**Received by:** Plugin

```jsonc
{
    event: "dialRotate",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        controller: string,
        // For a dial, positive value signifies clockwise rotation,
        // and a negative value signifies anticlockwise rotation.
        // The lowest position is set as 0, and highest position is set as 192.
        ticks: number,
        pressed: boolean
    }
}
```

#### `dialDown`

Fired on encoder dial down.

**Received by:** Plugin

```jsonc
{
    event: "dialDown",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        controller: string
    }
}
```

#### `dialUp`

Fired on encoder dial up.

**Received by:** Plugin

```jsonc
{
    event: "dialUp",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        controller: string
    }
}
```

---

### Keypad

#### `keyDown`

Fired on keypad key down.

**Received by:** Plugin

```jsonc
{
    event: "keyDown",
    // The action UUID supplied in the plugin manifest.
    // Utilise to determine which action was triggered.
    action: string,
    // A unique value to identify the instance.
    context: string,
    // A unique value to identify the device.
    device: string,
    payload: {
        // Instance settings as set using the `setSettings` event.
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        // The currently active state of this instance.
        state: number,
        // Whether or not this event was triggered as part of a Multi Action.
        isInMultiAction: boolean
    }
}
```

#### `keyUp`

Fired on keypad key up.

**Received by:** Plugin

```jsonc
{
    event: "keyUp",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        state: number,
        isInMultiAction: boolean
    }
}
```

---

### Property inspector

#### `sendToPlugin`

Fired when the property inspector uses the `sendToPlugin` event.

**Received by:** Plugin

```jsonc
{
    event: "sendToPlugin",
    action: string,
    context: string,
    payload: any
}
```

#### `sendToPropertyInspector`

Fired when the plugin uses the `sendToPropertyInspector` event.

**Received by:** Property inspector

```jsonc
{
    event: "sendToPropertyInspector",
    action: string,
    context: string,
    payload: any
}
```

#### `propertyInspectorDidAppear`

Fired when an action is selected and its property inspector appears.

**Received by:** Plugin

```jsonc
{
    event: "propertyInspectorDidAppear",
    action: string,
    context: string,
    device: string
}
```

#### `propertyInspectorDidDisappear`

Fired when an action is deselected and its property inspector disappears.

**Received by:** Plugin

```jsonc
{
    event: "propertyInspectorDidDisappear",
    action: string,
    context: string,
    device: string
}
```

---

### Settings

#### `didReceiveSettings`

Fired in response to the `getSettings` event. Additionally fired to the plugin when the property inspector uses `setSettings`, and vice versa.

**Received by:** Plugin, Property inspector

```jsonc
{
    event: "didReceiveSettings",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        isInMultiAction: boolean
    }
}
```

#### `didReceiveGlobalSettings`

Fired in response to the `getGlobalSettings` event. Additionally fired to the plugin when the property inspector uses `setGlobalSettings`, and vice versa.

**Received by:** Plugin, Property inspector

```jsonc
{
    event: "didReceiveGlobalSettings",
    payload: {
        settings: any
    }
}
```

---

### States

#### `titleParametersDidChange`

Fired when the user changes the title parameters of an action.

**Received by:** Plugin

```jsonc
{
    event: "titleParametersDidChange",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        state: number,
        title: string,
        titleParameters: {
            fontFamily: string,
            fontSize: number,
            fontStyle: string,
            fontUnderline: boolean,
            showTitle: boolean,
            titleAlignment: string,
            titleColor: string
        }
    }
}
```

---

### Will appear

#### `willAppear`

Fired when the user switches to a profile containing this action, or a new instance of this action is created.

**Received by:** Plugin

```jsonc
{
    event: "willAppear",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        controller: string,
        state: number,
        isInMultiAction: boolean
    }
}
```

#### `willDisappear`

Fired when the user switches from a profile containing this action, or an instance of this action is removed.

**Received by:** Plugin

```jsonc
{
    event: "willDisappear",
    action: string,
    context: string,
    device: string,
    payload: {
        settings: any,
        coordinates: {
            row: number,
            column: number
        },
        controller: string,
        state: number,
        isInMultiAction: boolean
    }
}
```

---

## Serverbound events

This chapter describes the events that can be sent by either plugins or property inspectors to the OpenAction server.

### Miscellaneous

#### `openUrl`

Used to open a fully-qualified URL in the user's default browser.

**Sent by:** Plugin, Property inspector

```jsonc
{
    event: "openUrl",
    payload: {
        url: string  // e.g. "https://example.com/"
    }
}
```

#### `logMessage`

Used to log a debug message to a log file. It is more strongly advised for plugin developers to handle logging on their own.

**Sent by:** Plugin

```jsonc
{
    event: "logMessage",
    payload: {
        message: string
    }
}
```

#### `showAlert`

Used to show a temporary alert indicator on the instance.

**Sent by:** Plugin

```jsonc
{
    event: "showAlert",
    context: string
}
```

#### `showOk`

Used to show a temporary checkmark indicator on the instance.

**Sent by:** Plugin

```jsonc
{
    event: "showOk",
    context: string
}
```

---

### Property inspector

#### `sendToPlugin`

Fired by a property inspector to send a message to the plugin.

**Sent by:** Property inspector

```jsonc
{
    event: "sendToPlugin",
    action: string,
    context: string,
    payload: any
}
```

#### `sendToPropertyInspector`

Fired by the plugin to send a message to a property inspector.

**Sent by:** Plugin

```jsonc
{
    event: "sendToPropertyInspector",
    action: string,
    context: string,
    payload: any
}
```

---

### Settings

#### `setSettings`

Used to set the settings value of an instance. When used by the plugin, the property inspector will receive a `didReceiveSettings` event, and vice versa.

**Sent by:** Plugin, Property inspector

```jsonc
{
    event: "setSettings",
    // A unique value to identify the instance.
    context: string,
    payload: any
}
```

#### `getSettings`

Used to get the settings value of an instance. When used, the OpenAction server will respond with a `didReceiveSettings` event.

**Sent by:** Plugin, Property inspector

```jsonc
{
    event: "getSettings",
    context: string
}
```

#### `setGlobalSettings`

Used to set the plugin-wide global settings value. When used by the plugin, all property inspectors will receive a `didReceiveGlobalSettings` event, and vice versa. The `context` property should be set to the UUID value received during registration.

**Sent by:** Plugin, Property inspector

```jsonc
{
    event: "setGlobalSettings",
    context: string,
    payload: any
}
```

#### `getGlobalSettings`

Used to get the plugin-wide global settings value. When used, the OpenAction server will respond with a `didReceiveGlobalSettings` event. The `context` property should be set to the UUID value received during registration.

**Sent by:** Plugin, Property inspector

```jsonc
{
    event: "getGlobalSettings",
    context: string
}
```

---

### States

#### `setTitle`

Used to set the title of an instance.

**Sent by:** Plugin

```jsonc
{
    event: "setTitle",
    context: string,
    payload: {
        title: string,
        // 0: Both hardware and software, 1: Hardware only, 2: Software only
        target: number = 0,
        // 0-based index specifying the state to be modified.
        // If not set, the title will be applied to all states.
        state: number | null
    }
}
```

#### `setImage`

Used to set the image of an instance.

**Sent by:** Plugin

```jsonc
{
    event: "setImage",
    context: string,
    payload: {
        // A base-64 data URL encoded image.
        image: string,
        // 0: Both hardware and software, 1: Hardware only, 2: Software only
        target: number = 0,
        // 0-based index specifying the state to be modified.
        // If not set, the image will be applied to all states.
        state: number | null
    }
}
```

#### `setState`

Used to switch an action to a state.

**Sent by:** Plugin

```jsonc
{
    event: "setState",
    payload: {
        // 0-based index specifying the state to be switched to.
        state: number
    }
}
```
