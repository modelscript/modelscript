// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  icon?: string;
  danger?: boolean;
  action: () => void;
}

export type ContextMenuEntry = ContextMenuItem | { type: "separator" };

export interface ContextMenuOptions {
  x: number;
  y: number;
  container: HTMLElement;
  items: ContextMenuEntry[];
}

let activeContextMenu: HTMLElement | null = null;
let activeDismissListener: EventListener | null = null;

/**
 * Hides and removes any active diagram context menu.
 */
export function hideContextMenu(container?: HTMLElement | null): void {
  if (activeDismissListener) {
    document.removeEventListener("mousedown", activeDismissListener);
    document.removeEventListener("keydown", activeDismissListener);
    activeDismissListener = null;
  }
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
  if (container) {
    const existing = container.querySelector("#modelscript-context-menu");
    if (existing) existing.remove();
  }
}

/**
 * Renders and displays a desktop CAD context menu at the given coordinates.
 */
export function showContextMenu(opts: ContextMenuOptions): HTMLElement {
  hideContextMenu(opts.container);

  const menu = document.createElement("div");
  menu.id = "modelscript-context-menu";
  menu.className = "modelscript-context-menu";
  menu.style.position = "absolute";
  menu.style.zIndex = "1100";
  menu.style.minWidth = "180px";
  menu.style.padding = "4px";
  menu.style.borderRadius = "8px";
  menu.style.background = "var(--ms-surface-glass, rgba(22, 27, 34, 0.96))";
  menu.style.backdropFilter = "blur(14px)";
  menu.style.border = "1px solid var(--ms-border, rgba(255, 255, 255, 0.12))";
  menu.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.45)";
  menu.style.display = "flex";
  menu.style.flexDirection = "column";
  menu.style.gap = "2px";
  menu.style.userSelect = "none";
  menu.style.fontSize = "12px";
  menu.style.color = "var(--ms-text-1, #f0f6fc)";

  // Render items
  opts.items.forEach((item) => {
    if ("type" in item && item.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      sep.style.height = "1px";
      sep.style.margin = "3px 4px";
      sep.style.background = "var(--ms-divider, rgba(255, 255, 255, 0.08))";
      menu.appendChild(sep);
      return;
    }

    const menuItem = item as ContextMenuItem;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-menu-item";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "space-between";
    btn.style.width = "100%";
    btn.style.padding = "5px 8px";
    btn.style.border = "none";
    btn.style.borderRadius = "5px";
    btn.style.background = "transparent";
    btn.style.color = menuItem.danger ? "var(--ms-danger, #f85149)" : "var(--ms-text-1, inherit)";
    btn.style.fontSize = "12px";
    btn.style.fontWeight = "500";
    btn.style.cursor = "pointer";
    btn.style.textAlign = "left";
    btn.style.transition = "background-color 0.1s ease";

    const labelSpan = document.createElement("span");
    labelSpan.style.display = "flex";
    labelSpan.style.alignItems = "center";
    labelSpan.style.gap = "6px";
    if (menuItem.icon) {
      const iconSpan = document.createElement("span");
      iconSpan.innerHTML = menuItem.icon;
      iconSpan.style.display = "inline-flex";
      iconSpan.style.alignItems = "center";
      labelSpan.appendChild(iconSpan);
    }
    const textNode = document.createElement("span");
    textNode.textContent = menuItem.label;
    labelSpan.appendChild(textNode);
    btn.appendChild(labelSpan);

    if (menuItem.shortcut) {
      const shortcutSpan = document.createElement("span");
      shortcutSpan.textContent = menuItem.shortcut;
      shortcutSpan.style.fontSize = "10px";
      shortcutSpan.style.fontWeight = "500";
      shortcutSpan.style.color = "var(--ms-text-2, rgba(255, 255, 255, 0.45))";
      shortcutSpan.style.marginLeft = "12px";
      btn.appendChild(shortcutSpan);
    }

    btn.onmouseenter = () => {
      btn.style.background = menuItem.danger
        ? "var(--ms-danger-soft, rgba(248, 81, 73, 0.15))"
        : "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
    };
    btn.onmouseleave = () => {
      btn.style.background = "transparent";
    };

    btn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      hideContextMenu(opts.container);
      menuItem.action();
    };

    menu.appendChild(btn);
  });

  opts.container.appendChild(menu);

  // Position clamping within container
  const cRect = opts.container.getBoundingClientRect();
  const mRect = menu.getBoundingClientRect();

  let posX = opts.x - cRect.left;
  let posY = opts.y - cRect.top;

  if (posX + mRect.width > cRect.width - 8) {
    posX = Math.max(8, cRect.width - mRect.width - 8);
  }
  if (posY + mRect.height > cRect.height - 8) {
    posY = Math.max(8, cRect.height - mRect.height - 8);
  }

  menu.style.left = `${Math.round(posX)}px`;
  menu.style.top = `${Math.round(posY)}px`;

  activeContextMenu = menu;

  // Auto-dismiss handler
  const onDismiss: EventListener = (evt: Event) => {
    const e = evt as MouseEvent | KeyboardEvent;
    if (e.type === "keydown" && (e as KeyboardEvent).key === "Escape") {
      hideContextMenu(opts.container);
      return;
    }
    if (e.type === "mousedown") {
      const target = e.target as Node;
      if (!menu.contains(target)) {
        hideContextMenu(opts.container);
      }
    }
  };

  activeDismissListener = onDismiss;
  setTimeout(() => {
    document.addEventListener("mousedown", onDismiss);
    document.addEventListener("keydown", onDismiss);
  }, 10);

  return menu;
}
