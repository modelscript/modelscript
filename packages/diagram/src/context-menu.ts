// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  icon?: string | Node;
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
let activeCleanup: (() => void) | null = null;
let previousFocusedEl: HTMLElement | null = null;

/**
 * Hides and removes any active diagram context menu.
 */
export function hideContextMenu(container?: HTMLElement | null): void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
  if (container) {
    const existing = container.querySelector("#modelscript-context-menu");
    if (existing) existing.remove();
  }
  if (previousFocusedEl && typeof previousFocusedEl.focus === "function") {
    try {
      previousFocusedEl.focus({ preventScroll: true });
    } catch {
      // Ignore if element is detached
    }
    previousFocusedEl = null;
  }
}

/**
 * Renders and displays a desktop CAD context menu at the given viewport coordinates.
 */
export function showContextMenu(opts: ContextMenuOptions): HTMLElement {
  hideContextMenu(opts.container);
  previousFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const menu = document.createElement("div");
  menu.id = "modelscript-context-menu";
  menu.className = "modelscript-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-orientation", "vertical");
  menu.style.position = "fixed";
  menu.style.zIndex = "1100";
  menu.style.minWidth = "180px";
  menu.style.maxHeight = "calc(100vh - 16px)";
  menu.style.overflowY = "auto";
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

  const buttons: HTMLButtonElement[] = [];

  opts.items.forEach((item) => {
    if ("type" in item && item.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      sep.setAttribute("role", "separator");
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
    btn.setAttribute("role", "menuitem");
    btn.tabIndex = -1;
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
      if (typeof menuItem.icon === "string") {
        // Render text-only icons safely without raw innerHTML sink
        iconSpan.textContent = menuItem.icon;
      } else {
        iconSpan.appendChild(menuItem.icon.cloneNode(true));
      }
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

    const highlight = () => {
      btn.style.background = menuItem.danger
        ? "var(--ms-danger-soft, rgba(248, 81, 73, 0.15))"
        : "var(--ms-surface-hover, rgba(125, 125, 125, 0.12))";
    };
    const unhighlight = () => {
      btn.style.background = "transparent";
    };
    btn.onmouseenter = highlight;
    btn.onmouseleave = unhighlight;
    btn.onfocus = highlight;
    btn.onblur = unhighlight;

    btn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      hideContextMenu(opts.container);
      menuItem.action();
    };

    buttons.push(btn);
    menu.appendChild(btn);
  });

  opts.container.appendChild(menu);

  // Clamp to viewport on all four sides
  const mRect = menu.getBoundingClientRect();
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const posX = Math.max(8, Math.min(opts.x, vw - mRect.width - 8));
  const posY = Math.max(8, Math.min(opts.y, vh - mRect.height - 8));

  menu.style.left = `${Math.round(posX)}px`;
  menu.style.top = `${Math.round(posY)}px`;

  activeContextMenu = menu;
  if (buttons.length > 0) {
    buttons[0]!.focus({ preventScroll: true });
  }

  const onMouseDown = (evt: MouseEvent) => {
    const target = evt.target as Node | null;
    if (!target || !menu.contains(target)) {
      hideContextMenu(opts.container);
    }
  };
  const onKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      evt.preventDefault();
      evt.stopPropagation();
      hideContextMenu(opts.container);
      return;
    }
    if (buttons.length === 0) return;
    const curIdx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (evt.key === "ArrowDown") {
      evt.preventDefault();
      buttons[(curIdx + 1) % buttons.length]!.focus({ preventScroll: true });
    } else if (evt.key === "ArrowUp") {
      evt.preventDefault();
      buttons[(curIdx - 1 + buttons.length) % buttons.length]!.focus({ preventScroll: true });
    } else if (evt.key === "Home") {
      evt.preventDefault();
      buttons[0]!.focus({ preventScroll: true });
    } else if (evt.key === "End") {
      evt.preventDefault();
      buttons[buttons.length - 1]!.focus({ preventScroll: true });
    }
  };
  const onPassiveDismiss = (evt: Event) => {
    if (evt.type === "scroll" || evt.type === "wheel") {
      const target = evt.target as Node | null;
      if (target && menu.contains(target)) return;
    }
    hideContextMenu(opts.container);
  };

  let attached = false;
  const timerId = setTimeout(() => {
    if (activeContextMenu !== menu) return;
    attached = true;
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onPassiveDismiss, true);
    window.addEventListener("scroll", onPassiveDismiss, true);
    window.addEventListener("blur", onPassiveDismiss);
    window.addEventListener("resize", onPassiveDismiss);
  }, 0);

  activeCleanup = () => {
    clearTimeout(timerId);
    if (attached) {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onPassiveDismiss, true);
      window.removeEventListener("scroll", onPassiveDismiss, true);
      window.removeEventListener("blur", onPassiveDismiss);
      window.removeEventListener("resize", onPassiveDismiss);
    }
  };

  return menu;
}
