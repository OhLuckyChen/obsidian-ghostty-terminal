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
  setIcon,
  TAbstractFile,
  TFile,
  TFolder
} from "obsidian";

type DefaultOpenLocation = "current-file-folder" | "vault-root";

const FILE_EXPLORER_TITLE_SELECTOR = ".nav-file-title, .nav-folder-title";
const INLINE_ACTIONS_CLASS = "ghostty-terminal-inline-actions";
const INLINE_HOST_CLASS = "ghostty-terminal-inline-host";

interface GhosttyTerminalSettings {
  ghosttyAppName: string;
  defaultOpenLocation: DefaultOpenLocation;
  focusExistingTerminal: boolean;
  initialInput: string;
  enableVibeShellMenu: boolean;
  vibeShellCommand: string;
  showGhosttyInlineButton: boolean;
  showVibeShellInlineButton: boolean;
}

const DEFAULT_SETTINGS: GhosttyTerminalSettings = {
  ghosttyAppName: "Ghostty",
  defaultOpenLocation: "current-file-folder",
  focusExistingTerminal: true,
  initialInput: "",
  enableVibeShellMenu: false,
  vibeShellCommand: "",
  showGhosttyInlineButton: true,
  showVibeShellInlineButton: true
};

interface OpenGhosttyOptions {
  initialInput?: string;
  label?: string;
}

export default class GhosttyTerminalPlugin extends Plugin {
  settings: GhosttyTerminalSettings = DEFAULT_SETTINGS;
  private fileExplorerObserver: MutationObserver | null = null;
  private inlineRefreshTimeout: number | null = null;

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

    this.registerFileExplorerInlineActions();
    this.addSettingTab(new GhosttyTerminalSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshFileExplorerInlineActions(): void {
    this.removeFileExplorerInlineActions();
    this.addFileExplorerInlineActions();
  }

  private addFileExplorerInlineActions(): void {
    if (!this.settings.showGhosttyInlineButton && !this.settings.showVibeShellInlineButton) {
      return;
    }

    document.querySelectorAll<HTMLElement>(FILE_EXPLORER_TITLE_SELECTOR).forEach((titleEl) => {
      this.addInlineActionsToFileExplorerTitle(titleEl);
    });
  }

  private registerFileExplorerInlineActions(): void {
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.queueRefreshFileExplorerInlineActions();
      })
    );

    this.fileExplorerObserver = new MutationObserver(() => {
      this.queueRefreshFileExplorerInlineActions();
    });
    this.fileExplorerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.register(() => {
      this.fileExplorerObserver?.disconnect();
      this.fileExplorerObserver = null;

      if (this.inlineRefreshTimeout !== null) {
        window.clearTimeout(this.inlineRefreshTimeout);
        this.inlineRefreshTimeout = null;
      }

      this.removeFileExplorerInlineActions();
    });

    this.queueRefreshFileExplorerInlineActions();
  }

  private queueRefreshFileExplorerInlineActions(): void {
    if (this.inlineRefreshTimeout !== null) {
      window.clearTimeout(this.inlineRefreshTimeout);
    }

    this.inlineRefreshTimeout = window.setTimeout(() => {
      this.inlineRefreshTimeout = null;
      this.addFileExplorerInlineActions();
    }, 100);
  }

  private addInlineActionsToFileExplorerTitle(titleEl: HTMLElement): void {
    if (titleEl.querySelector(`.${INLINE_ACTIONS_CLASS}`)) {
      return;
    }

    if (!this.getFileFromExplorerTitle(titleEl)) {
      return;
    }

    const actionsEl = document.createElement("div");
    actionsEl.className = INLINE_ACTIONS_CLASS;

    if (this.settings.showGhosttyInlineButton) {
      actionsEl.appendChild(
        this.createInlineActionButton("Open in Ghostty", "terminal", () => {
          void this.openFromExplorerTitle(titleEl, "ghostty");
        })
      );
    }

    if (this.settings.showVibeShellInlineButton) {
      actionsEl.appendChild(
        this.createInlineActionButton("Open in Vibe Shell", "sparkles", () => {
          void this.openFromExplorerTitle(titleEl, "vibe-shell");
        })
      );
    }

    if (actionsEl.childElementCount === 0) {
      return;
    }

    titleEl.classList.add(INLINE_HOST_CLASS);
    titleEl.appendChild(actionsEl);
  }

  private createInlineActionButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.type = "button";
    buttonEl.className = "ghostty-terminal-inline-action";
    buttonEl.ariaLabel = label;
    buttonEl.title = label;
    setIcon(buttonEl, icon);

    buttonEl.addEventListener("mousedown", stopInlineActionEvent);
    buttonEl.addEventListener("pointerdown", stopInlineActionEvent);
    buttonEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });

    return buttonEl;
  }

  private removeFileExplorerInlineActions(): void {
    document.querySelectorAll<HTMLElement>(`.${INLINE_ACTIONS_CLASS}`).forEach((el) => {
      el.remove();
    });

    document.querySelectorAll<HTMLElement>(`.${INLINE_HOST_CLASS}`).forEach((el) => {
      el.classList.remove(INLINE_HOST_CLASS);
    });
  }

  private async openFromExplorerTitle(titleEl: HTMLElement, action: "ghostty" | "vibe-shell"): Promise<void> {
    const file = this.getFileFromExplorerTitle(titleEl);
    if (!file) {
      new Notice("Ghostty Terminal: could not resolve the selected file or folder.");
      return;
    }

    if (action === "vibe-shell") {
      await this.openVibeShellAtAbstractFile(file);
      return;
    }

    await this.openAtAbstractFile(file);
  }

  private getFileFromExplorerTitle(titleEl: HTMLElement): TAbstractFile | null {
    const pathEl = titleEl.hasAttribute("data-path")
      ? titleEl
      : titleEl.closest<HTMLElement>("[data-path]");
    const vaultRelativePath = pathEl?.getAttribute("data-path");
    if (!vaultRelativePath) {
      return null;
    }

    return this.app.vault.getAbstractFileByPath(vaultRelativePath);
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

    if (this.settings.enableVibeShellMenu) {
      menu.addItem((item) => {
        item
          .setTitle("Open in Vibe Shell")
          .setIcon("terminal")
          .onClick(() => {
            void this.openVibeShellAtAbstractFile(file);
          });
      });
    }
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
    const targetPath = this.getPathForAbstractFile(file);
    if (!targetPath) {
      new Notice("Ghostty Terminal: desktop vault path is unavailable.");
      return;
    }

    await this.openGhostty(targetPath);
  }

  private async openVibeShellAtAbstractFile(file: TAbstractFile): Promise<void> {
    const command = this.settings.vibeShellCommand.trim();
    if (!command) {
      new Notice("Ghostty Terminal: set a Vibe Shell command first.");
      return;
    }

    const targetPath = this.getPathForAbstractFile(file);
    if (!targetPath) {
      new Notice("Ghostty Terminal: desktop vault path is unavailable.");
      return;
    }

    await this.openGhostty(targetPath, {
      initialInput: command,
      label: "Vibe Shell"
    });
  }

  private getPathForAbstractFile(file: TAbstractFile): string | null {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return null;
    }

    if (file instanceof TFolder) {
      return joinVaultPath(vaultPath, file.path);
    }

    if (file instanceof TFile && file.parent) {
      return joinVaultPath(vaultPath, file.parent.path);
    }

    return vaultPath;
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    return null;
  }

  private async openGhostty(workingDirectory: string, options: OpenGhosttyOptions = {}): Promise<void> {
    if (process.platform !== "darwin") {
      new Notice("Ghostty Terminal: this plugin currently supports macOS only.");
      return;
    }

    const label = options.label ?? "Ghostty";
    const script = this.buildAppleScript(workingDirectory, options.initialInput);

    try {
      const result = (await execFileAsync("/usr/bin/osascript", ["-e", script])).trim();
      const verb = result === "focused" ? "Focused" : "Opened";
      new Notice(`${verb} ${label}: ${workingDirectory}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Ghostty Terminal failed: ${message}`);
      console.error("Ghostty Terminal failed to open Ghostty", error);
    }
  }

  private buildAppleScript(workingDirectory: string, initialInput?: string): string {
    const escapedAppName = escapeAppleScriptString(this.settings.ghosttyAppName);
    const escapedWorkingDirectory = escapeAppleScriptString(workingDirectory);
    const input = initialInput ?? this.settings.initialInput;
    const escapedInitialInput = escapeAppleScriptString(input.trim());
    const focusExistingBlock = this.settings.focusExistingTerminal
      ? `
        set matchingTerminals to every terminal whose working directory is targetDirectory
        if (count of matchingTerminals) > 0 then
          set targetTerminal to item 1 of matchingTerminals
          focus targetTerminal
          return "focused"
        end if`
      : "";
    const initialInputBlock = escapedInitialInput
      ? `
        input text "${escapedInitialInput}" to targetTerminal
        send key "enter" to targetTerminal`
      : "";

    return `
      tell application "${escapedAppName}"
        activate
        set targetDirectory to "${escapedWorkingDirectory}"${focusExistingBlock}
        set cfg to new surface configuration
        set initial working directory of cfg to targetDirectory
        set win to new window with configuration cfg
        set targetTerminal to terminal 1 of selected tab of win${initialInputBlock}
        return "opened"
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
      .setName("Focus existing terminal")
      .setDesc("Focus an existing Ghostty terminal with the same working directory instead of opening a new window.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.focusExistingTerminal)
          .onChange(async (value) => {
            this.plugin.settings.focusExistingTerminal = value;
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

    new Setting(containerEl)
      .setName("Vibe Shell context menu")
      .setDesc("Add an Open in Vibe Shell action to file and folder context menus.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableVibeShellMenu)
          .onChange(async (value) => {
            this.plugin.settings.enableVibeShellMenu = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Vibe Shell command")
      .setDesc("Command to send only when Open in Vibe Shell creates a new Ghostty window.")
      .addText((text) => {
        text
          .setPlaceholder("vibe shell")
          .setValue(this.plugin.settings.vibeShellCommand)
          .onChange(async (value) => {
            this.plugin.settings.vibeShellCommand = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Show Ghostty inline button")
      .setDesc("Show an Open in Ghostty button on file explorer rows when hovered.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showGhosttyInlineButton)
          .onChange(async (value) => {
            this.plugin.settings.showGhosttyInlineButton = value;
            await this.plugin.saveSettings();
            this.plugin.refreshFileExplorerInlineActions();
          });
      });

    new Setting(containerEl)
      .setName("Show Vibe Shell inline button")
      .setDesc("Show an Open in Vibe Shell button on file explorer rows when hovered.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showVibeShellInlineButton)
          .onChange(async (value) => {
            this.plugin.settings.showVibeShellInlineButton = value;
            await this.plugin.saveSettings();
            this.plugin.refreshFileExplorerInlineActions();
          });
      });
  }
}

function stopInlineActionEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function joinVaultPath(vaultPath: string, vaultRelativePath: string): string {
  if (!vaultRelativePath || vaultRelativePath === "/") {
    return vaultPath;
  }

  return path.join(vaultPath, vaultRelativePath);
}
