# Ghostty Terminal

Ghostty Terminal opens [Ghostty](https://ghostty.org/) at your vault, current note folder, or a selected file/folder location.

## Features

- Open Ghostty from the left ribbon.
- Open Ghostty from the command palette.
- Open Ghostty at the vault root.
- Open Ghostty at the active note's folder.
- Open Ghostty from the file explorer context menu.
- Optionally send initial input after the Ghostty window opens.

## Requirements

- macOS.
- Obsidian desktop.
- Ghostty 1.3.0 or newer for AppleScript support.

The first launch may trigger a macOS Automation permission prompt allowing Obsidian to control Ghostty.

## Usage

- Click the terminal icon in Obsidian's left ribbon.
- Run `Open Ghostty`, `Open Ghostty at vault root`, or `Open Ghostty at current file folder` from the command palette.
- Right-click a file or folder in the file explorer and choose `Open in Ghostty`.

## Settings

- `Ghostty app name`: AppleScript application name. Keep the default `Ghostty` unless your app is renamed.
- `Ribbon default location`: choose whether the ribbon and default command open the current file folder or vault root.
- `Initial input`: optional text to send after opening the new Ghostty window, such as `nvim .`.

## Community Plugin Install

After the plugin is accepted into the Obsidian community plugin directory:

1. Open `Settings` -> `Community plugins`.
2. Search for `Ghostty Terminal`.
3. Install and enable the plugin.

## Manual Install

Download `main.js` and `manifest.json` from the latest GitHub release, then copy them into:

```text
<your-vault>/.obsidian/plugins/ghostty-terminal
```

Restart Obsidian or reload community plugins, then enable `Ghostty Terminal`.

## Build

```bash
npm install
npm run build
```
