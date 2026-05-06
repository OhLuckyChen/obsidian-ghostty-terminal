import { execFile } from "node:child_process";
import * as path from "node:path";
import {
  App,
  FileSystemAdapter,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder
} from "obsidian";

type DefaultOpenLocation = "current-file-folder" | "vault-root";

interface GhosttyTerminalSettings {
  ghosttyAppName: string;
  defaultOpenLocation: DefaultOpenLocation;
  initialInput: string;
}

const DEFAULT_SETTINGS: GhosttyTerminalSettings = {
  ghosttyAppName: "Ghostty",
  defaultOpenLocation: "current-file-folder",
  initialInput: ""
};

export default class GhosttyTerminalPlugin extends Plugin {
  settings: GhosttyTerminalSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("terminal", "Open Ghostty", () => {
      void this.openDefaultLocation();
    });

    this.addCommand({
      id: "open-ghostty-default",
      name: "Open Ghostty",
      callback: () => {
        void this.openDefaultLocation();
      }
    });

    this.addCommand({
      id: "open-ghostty-vault-root",
      name: "Open Ghostty at vault root",
      callback: () => {
        void this.openVaultRoot();
      }
    });

    this.addCommand({
      id: "open-ghostty-current-file-folder",
      name: "Open Ghostty at current file folder",
      callback: () => {
        void this.openCurrentFileFolder();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.addFileMenuItems(menu, file);
      })
    );

    this.addSettingTab(new GhosttyTerminalSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    menu.addItem((item) => {
      item
        .setTitle("Open in Ghostty")
        .setIcon("terminal")
        .onClick(() => {
          void this.openAtAbstractFile(file);
        });
    });
  }

  private async openDefaultLocation(): Promise<void> {
    if (this.settings.defaultOpenLocation === "vault-root") {
      await this.openVaultRoot();
      return;
    }

    await this.openCurrentFileFolder();
  }

  private async openVaultRoot(): Promise<void> {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      new Notice("Ghostty Terminal: desktop vault path is unavailable.");
      return;
    }

    await this.openGhostty(vaultPath);
  }

  private async openCurrentFileFolder(): Promise<void> {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      new Notice("Ghostty Terminal: desktop vault path is unavailable.");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile?.parent?.path) {
      await this.openGhostty(vaultPath);
      return;
    }

    await this.openGhostty(path.join(vaultPath, activeFile.parent.path));
  }

  private async openAtAbstractFile(file: TAbstractFile): Promise<void> {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      new Notice("Ghostty Terminal: desktop vault path is unavailable.");
      return;
    }

    if (file instanceof TFolder) {
      await this.openGhostty(path.join(vaultPath, file.path));
      return;
    }

    if (file instanceof TFile && file.parent) {
      await this.openGhostty(path.join(vaultPath, file.parent.path));
      return;
    }

    await this.openGhostty(vaultPath);
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    return null;
  }

  private async openGhostty(workingDirectory: string): Promise<void> {
    if (process.platform !== "darwin") {
      new Notice("Ghostty Terminal: this plugin currently supports macOS only.");
      return;
    }

    const script = this.buildAppleScript(workingDirectory);

    try {
      await execFileAsync("/usr/bin/osascript", ["-e", script]);
      new Notice(`Opened Ghostty: ${workingDirectory}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Ghostty Terminal failed: ${message}`);
      console.error("Ghostty Terminal failed to open Ghostty", error);
    }
  }

  private buildAppleScript(workingDirectory: string): string {
    const escapedAppName = escapeAppleScriptString(this.settings.ghosttyAppName);
    const escapedWorkingDirectory = escapeAppleScriptString(workingDirectory);
    const escapedInitialInput = escapeAppleScriptString(this.settings.initialInput.trim());
    const initialInputBlock = escapedInitialInput
      ? `
        input text "${escapedInitialInput}" to terminal 1 of selected tab of win
        send key "enter" to terminal 1 of selected tab of win`
      : "";

    return `
      tell application "${escapedAppName}"
        activate
        set cfg to new surface configuration
        set initial working directory of cfg to "${escapedWorkingDirectory}"
        set win to new window with configuration cfg${initialInputBlock}
      end tell
    `;
  }
}

class GhosttyTerminalSettingTab extends PluginSettingTab {
  plugin: GhosttyTerminalPlugin;

  constructor(app: App, plugin: GhosttyTerminalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Ghostty app name")
      .setDesc("The application name used by AppleScript.")
      .addText((text) => {
        text
          .setPlaceholder("Ghostty")
          .setValue(this.plugin.settings.ghosttyAppName)
          .onChange(async (value) => {
            this.plugin.settings.ghosttyAppName = value.trim() || DEFAULT_SETTINGS.ghosttyAppName;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Ribbon default location")
      .setDesc("Choose where the ribbon icon and default command open Ghostty.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("current-file-folder", "Current file folder")
          .addOption("vault-root", "Vault root")
          .setValue(this.plugin.settings.defaultOpenLocation)
          .onChange(async (value: DefaultOpenLocation) => {
            this.plugin.settings.defaultOpenLocation = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Initial input")
      .setDesc("Optional command to send after opening the new Ghostty window.")
      .addText((text) => {
        text
          .setPlaceholder("nvim .")
          .setValue(this.plugin.settings.initialInput)
          .onChange(async (value) => {
            this.plugin.settings.initialInput = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
