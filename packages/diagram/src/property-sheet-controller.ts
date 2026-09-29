// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Centralized Property Sheet Controller managing active tabs, field values,
 * dynamic condition evaluation (enabledIf/visibleIf), field validation, and change debouncing.
 */

import { evaluatePropertyPredicate } from "./property-evaluator.js";
import { validatePropertyValue } from "./property-validator.js";
import type {
  ComponentPropertyData,
  EntityPropertySchema,
  PropertyFieldConfig,
  PropertyGroupConfig,
  PropertyTabConfig,
} from "./protocol.js";

export interface PropertyChangeEvent {
  componentId: string;
  key: string;
  value: any;
  previousValue: any;
  isValid: boolean;
  error?: string | null;
}

export type PropertySheetListener = () => void;

export class PropertySheetController {
  private componentId: string | null = null;
  private properties: ComponentPropertyData | null = null;
  private isLoading = false;
  private activeTabMap = new Map<string, string>();
  private values: Record<string, any> = {};
  private errors: Record<string, string> = {};
  private listeners: Set<PropertySheetListener> = new Set();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;

  constructor(options: { debounceMs?: number } = {}) {
    this.debounceMs = options.debounceMs ?? 150;
  }

  public subscribe(listener: PropertySheetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("[PropertySheetController] listener error:", e);
      }
    }
  }

  public setProperties(componentId: string, properties: ComponentPropertyData | null, isLoading: boolean = false) {
    this.componentId = componentId;
    this.properties = properties;
    this.isLoading = isLoading;

    // Initialize or merge values
    this.values = {
      name: componentId,
      description: properties?.description ?? "",
      ...(properties?.values || {}),
    };

    // If parameters array exists, populate missing values
    if (properties?.parameters) {
      for (const p of properties.parameters) {
        if (this.values[p.name] === undefined && p.value !== undefined) {
          this.values[p.name] = p.isBoolean ? p.value === "true" || (p.value as unknown) === true : p.value;
        }
      }
    }

    // Run initial validation
    this.validateAll();
    this.notify();
  }

  public getComponentId(): string | null {
    return this.componentId;
  }

  public getProperties(): ComponentPropertyData | null {
    return this.properties;
  }

  public getSchema(): EntityPropertySchema | undefined {
    return this.properties?.schema;
  }

  public getLoading(): boolean {
    return this.isLoading;
  }

  public getValues(): Record<string, any> {
    return { ...this.values };
  }

  public getValue(key: string, defaultValue?: any): any {
    return this.values[key] ?? defaultValue ?? "";
  }

  public getErrors(): Record<string, string> {
    return { ...this.errors };
  }

  public getFieldError(key: string): string | undefined {
    return this.errors[key];
  }

  public getActiveTabId(): string | null {
    if (!this.componentId) return null;
    const tabs = this.getVisibleTabs();
    if (tabs.length === 0) return null;

    const savedTab = this.activeTabMap.get(this.componentId);
    if (savedTab && tabs.some((t) => t.id === savedTab)) {
      return savedTab;
    }

    const firstTab = tabs[0].id;
    this.activeTabMap.set(this.componentId, firstTab);
    return firstTab;
  }

  public setActiveTabId(tabId: string) {
    if (this.componentId) {
      this.activeTabMap.set(this.componentId, tabId);
      this.notify();
    }
  }

  public getVisibleTabs(): PropertyTabConfig[] {
    const tabs = this.properties?.schema?.tabs || [];
    return tabs.filter((t) => evaluatePropertyPredicate(t.visibleIf, this.values));
  }

  public isGroupVisible(group: PropertyGroupConfig): boolean {
    return evaluatePropertyPredicate(group.visibleIf, this.values);
  }

  public isFieldVisible(field: PropertyFieldConfig): boolean {
    return evaluatePropertyPredicate(field.visibleIf, this.values);
  }

  public isFieldEnabled(field: PropertyFieldConfig): boolean {
    if (field.readOnly) return false;
    return evaluatePropertyPredicate(field.enabledIf, this.values);
  }

  public updateValue(key: string, newValue: any, onChangeCallback?: (event: PropertyChangeEvent) => void) {
    if (!this.componentId) return;

    const prevValue = this.values[key];
    this.values[key] = newValue;

    // Validate field
    const field = this.findField(key);
    let error: string | null = null;
    if (field) {
      error = validatePropertyValue(field, newValue, this.values);
      if (error) {
        this.errors[key] = error;
      } else {
        Reflect.deleteProperty(this.errors, key);
      }
    }

    // Notify listeners so UI updates immediately (including enabledIf / visibleIf shifts)
    this.notify();

    // Debounce callback invocation
    if (onChangeCallback) {
      const timerKey = `${this.componentId}:${key}`;
      const existing = this.debounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);

      const compId = this.componentId;
      this.debounceTimers.set(
        timerKey,
        setTimeout(() => {
          this.debounceTimers.delete(timerKey);
          onChangeCallback({
            componentId: compId,
            key,
            value: newValue,
            previousValue: prevValue,
            isValid: !error,
            error,
          });
        }, this.debounceMs),
      );
    }
  }

  private findField(key: string): PropertyFieldConfig | undefined {
    const tabs = this.properties?.schema?.tabs || [];
    for (const tab of tabs) {
      for (const group of tab.groups || []) {
        for (const field of group.fields || []) {
          if (field.key === key) return field;
        }
      }
    }
    return undefined;
  }

  private validateAll() {
    this.errors = {};
    const tabs = this.properties?.schema?.tabs || [];
    for (const tab of tabs) {
      for (const group of tab.groups || []) {
        for (const field of group.fields || []) {
          const val = this.values[field.key] ?? field.defaultValue;
          const err = validatePropertyValue(field, val, this.values);
          if (err) {
            this.errors[field.key] = err;
          }
        }
      }
    }
  }

  public destroy() {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.listeners.clear();
  }
}
