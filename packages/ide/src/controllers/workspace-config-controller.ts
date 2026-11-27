// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import {
  FEATURE_LABELS,
  type FeatureChannel,
  getFeatureChannelSetting,
  getLanguageMaturity,
  getLanguageMaturityBadge,
  getStatusBarConfig,
  isFeatureEnabled,
  isLanguageEnabled,
  type ModelScriptFeatureFlags,
  syncFeatureContextKeys,
} from "../utils/config.js";
import type { SafeRegisterCommand } from "./diagram-navigation-controller.js";

export interface WorkspaceConfigLspHost {
  readonly client?: LanguageClient | undefined;
  updateActiveEditorStatusBar(languageId: string | undefined): void;
  syncSettingsToServer(): void;
}

export interface WorkspaceConfigTreeHost {
  readonly libraryTreeProvider: { setDocumentUri(uri: string): void };
}

export function registerWorkspaceConfigController(
  context: vscode.ExtensionContext,
  getLspManager: () => WorkspaceConfigLspHost | undefined,
  treeController: WorkspaceConfigTreeHost,
  safeRegisterCommand: SafeRegisterCommand,
): vscode.Disposable[] {
  const shareStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  shareStatusBar.text = "$(sparkle) Share to Feed";
  shareStatusBar.tooltip = "Share active model snippet or results to ModelScript social feed";
  shareStatusBar.command = "modelscript.shareToFeed";

  const updateShareStatusBarVisibility = () => {
    const { visibility, showSocialFeed } = getStatusBarConfig();
    if (showSocialFeed && visibility !== "never") {
      shareStatusBar.show();
    } else {
      shareStatusBar.hide();
    }
  };
  updateShareStatusBarVisibility();

  void syncFeatureContextKeys();
  getLspManager()?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);

  let visibleRangeTimer: ReturnType<typeof setTimeout> | undefined;

  return [
    shareStatusBar,

    safeRegisterCommand("modelscript.configureFeatures", async () => {
      const currentChannel = getFeatureChannelSetting();
      const channelBadges: Record<FeatureChannel, string> = {
        stable: "🟢 Stable",
        preview: "🟡 Preview",
        experimental: "🧪 Experimental",
        dev: "🔬 Dev / Showcase",
      };

      const modePick = await vscode.window.showQuickPick(
        [
          {
            label: "$(milestone) Switch Feature Release Channel...",
            description: `Current: ${channelBadges[currentChannel]}`,
            detail: "Choose between Stable, Preview, Experimental, or Dev/Showcase channels",
            id: "channel" as const,
          },
          {
            label: "$(checklist) Toggle Individual Features...",
            description: "Customize CodeLens, Formal Verification, Digital Thread, AI Copilot & Demos",
            detail: "Override specific feature flags regardless of the active release channel",
            id: "features" as const,
          },
          {
            label: "$(symbol-namespace) Configure Enabled Languages & Maturity Tiers...",
            description: "Toggle individual engineering languages",
            id: "languages" as const,
          },
        ],
        {
          title: "ModelScript: Configure Features & Release Channel",
          placeHolder: "Select what you would like to configure",
        },
      );
      if (!modePick) return;

      if (modePick.id === "languages") {
        await vscode.commands.executeCommand("modelscript.configureLanguages");
        return;
      }

      const cfg = vscode.workspace.getConfiguration("modelscript.features");
      const lspManager = getLspManager();
      if (modePick.id === "channel") {
        const channelItems: (vscode.QuickPickItem & { channel: FeatureChannel })[] = [
          {
            label: "🟢 Stable (Default)",
            description: currentChannel === "stable" ? "Active" : "",
            detail: "Core LSP, 1-click Simulate CodeLens, 2D/3D viewers, Libraries & Experiments views",
            channel: "stable",
          },
          {
            label: "🟡 Preview",
            description: currentChannel === "preview" ? "Active" : "",
            detail: "Adds Formal Verification, DAE structural proofs, CAE mesh/study workbench, and FMI Co-Simulation",
            channel: "preview",
          },
          {
            label: "🧪 Experimental",
            description: currentChannel === "experimental" ? "Active" : "",
            detail:
              "Adds Cross-Domain Digital Thread, Polyglot Model Projection, Multi-Domain Scaffolding, and AI Copilot",
            channel: "experimental",
          },
          {
            label: "🔬 Dev / Showcase",
            description: currentChannel === "dev" ? "Active" : "",
            detail: "Enables all internal vertical demos, Trade Study Tier 1-3 CodeLenses, and medical/VR showcases",
            channel: "dev",
          },
        ];
        const chosen = await vscode.window.showQuickPick(channelItems, {
          title: "ModelScript: Select Feature Release Channel",
          placeHolder: `Current channel: ${channelBadges[currentChannel]}`,
        });
        if (!chosen) return;
        await cfg.update("channel", chosen.channel, vscode.ConfigurationTarget.Global);
        await syncFeatureContextKeys();
        updateShareStatusBarVisibility();
        lspManager?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
        lspManager?.syncSettingsToServer();
        vscode.window.showInformationMessage(`ModelScript release channel set to ${chosen.label}.`);
        return;
      }

      type FeaturePickItem = vscode.QuickPickItem & { featureKey: keyof ModelScriptFeatureFlags };
      const featureKeys = Object.keys(FEATURE_LABELS) as (keyof ModelScriptFeatureFlags)[];
      const featureItems: FeaturePickItem[] = featureKeys.map((key) => {
        const meta = FEATURE_LABELS[key];
        return {
          label: meta.label,
          description: `[${channelBadges[meta.channel]}]`,
          detail: meta.description,
          picked: isFeatureEnabled(key),
          featureKey: key,
        };
      });

      const selectedFeatures = await vscode.window.showQuickPick(featureItems, {
        canPickMany: true,
        title: "ModelScript: Toggle Individual Features",
        placeHolder: "Check or uncheck features to enable/disable them across the IDE",
      });
      if (!selectedFeatures) return;

      const selectedSet = new Set(selectedFeatures.map((f) => f.featureKey));
      for (const key of featureKeys) {
        const shouldEnable = selectedSet.has(key);
        if (isFeatureEnabled(key) !== shouldEnable) {
          await cfg.update(key, shouldEnable, vscode.ConfigurationTarget.Global);
        }
      }
      await syncFeatureContextKeys();
      updateShareStatusBarVisibility();
      lspManager?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
      lspManager?.syncSettingsToServer();
      vscode.window.showInformationMessage(
        `Updated ModelScript features (${selectedSet.size} of ${featureKeys.length} enabled).`,
      );
    }),

    safeRegisterCommand("modelscript.configureLanguages", async () => {
      const contributedLanguages =
        (context.extension?.packageJSON?.contributes?.languages as
          { id: string; aliases?: string[] | undefined; extensions?: string[] | undefined }[] | undefined) || [];
      if (contributedLanguages.length === 0) {
        vscode.commands.executeCommand("workbench.action.openSettings", "modelscript.languages");
        return;
      }

      type LangPickItem = vscode.QuickPickItem & { langId?: string };
      const items: LangPickItem[] = [];
      const tiers: ("beta" | "alpha" | "pre-alpha")[] = ["beta", "alpha", "pre-alpha"];
      const tierHeaders: Record<"beta" | "alpha" | "pre-alpha", string> = {
        beta: "🟢 Beta Languages (Active domain toolchains)",
        alpha: "🟡 Alpha Languages (Parser & domain lowering)",
        "pre-alpha": "🧪 Pre-Alpha Languages (Early grammar & AST)",
      };

      for (const tier of tiers) {
        const group = contributedLanguages.filter((l) => getLanguageMaturity(l.id) === tier);
        if (group.length === 0) continue;
        items.push({
          label: tierHeaders[tier],
          kind: vscode.QuickPickItemKind.Separator,
        });
        for (const lang of group) {
          const displayName = lang.aliases?.[0] ?? lang.id;
          const badge = getLanguageMaturityBadge(lang.id);
          const exts = (lang.extensions ?? []).join(", ");
          items.push({
            label: displayName,
            description: `[${badge}]  ${exts}`,
            picked: isLanguageEnabled(lang.id),
            langId: lang.id,
          });
        }
      }

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: "ModelScript: Configure Enabled Languages & Maturity Tiers",
        placeHolder: "Select which engineering languages to enable in this workspace",
      });
      if (!selected) return;

      const selectedIds = new Set(selected.map((s) => s.langId).filter((id): id is string => Boolean(id)));
      const cfg = vscode.workspace.getConfiguration("modelscript");
      for (const lang of contributedLanguages) {
        const shouldEnable = selectedIds.has(lang.id);
        if (isLanguageEnabled(lang.id) !== shouldEnable) {
          await cfg.update(`languages.${lang.id}.enabled`, shouldEnable, vscode.ConfigurationTarget.Global);
        }
      }
      const lspManager = getLspManager();
      lspManager?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
      lspManager?.syncSettingsToServer();
      vscode.window.showInformationMessage(
        `Updated ModelScript enabled languages (${selectedIds.size} of ${contributedLanguages.length} enabled).`,
      );
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document && editor.document.uri.scheme !== "output") {
        treeController.libraryTreeProvider.setDocumentUri(editor.document.uri.toString());
      }
      const langId = editor?.document.languageId;
      getLspManager()?.updateActiveEditorStatusBar(langId);
      vscode.commands.executeCommand("setContext", "modelscript.activeLanguage", langId);
      vscode.commands.executeCommand(
        "setContext",
        "modelscript.sysml2Active",
        langId === "sysml" || langId === "sysml2",
      );
      vscode.commands.executeCommand("setContext", "modelscript.owl2Active", langId === "owl2");
      if (langId) {
        vscode.commands.executeCommand("setContext", `modelscript.${langId}Active`, isLanguageEnabled(langId));
      }
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("modelscript.features")) {
        void syncFeatureContextKeys();
      }
      if (
        e.affectsConfiguration("modelscript.ui.statusBar") ||
        e.affectsConfiguration("modelscript.languages") ||
        e.affectsConfiguration("modelscript.features")
      ) {
        updateShareStatusBarVisibility();
        getLspManager()?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
      }
      if (e.affectsConfiguration("modelscript")) {
        getLspManager()?.syncSettingsToServer();
      }
    }),

    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      const client = getLspManager()?.client;
      if (!client) return;
      clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        const uri = e.textEditor.document.uri.toString();
        const ranges = e.visibleRanges.map((r) => ({
          startLine: r.start.line,
          endLine: r.end.line,
        }));
        getLspManager()?.client?.sendNotification("modelscript/visibleRanges", { uri, ranges });
      }, 150);
    }),

    new vscode.Disposable(() => {
      if (visibleRangeTimer !== undefined) {
        clearTimeout(visibleRangeTimer);
        visibleRangeTimer = undefined;
      }
    }),
  ];
}
