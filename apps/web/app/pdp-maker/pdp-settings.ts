"use client";

import type { PdpImageModel } from "@runacademy/shared";

export type PdpConnectionMode = "server" | "gemini-api-key";

export interface PdpClientSettings {
  connectionMode: PdpConnectionMode;
  customGeminiApiKey: string;
  selectedImageModel: PdpImageModel;
}

const PDP_SETTINGS_STORAGE_KEY = "hanirum-pdp-maker-settings-v2";
export const DEFAULT_PDP_IMAGE_MODEL: PdpImageModel = "gemini-3.1-flash-image-preview";

const DEFAULT_SETTINGS: PdpClientSettings = {
  connectionMode: "gemini-api-key",
  customGeminiApiKey: "",
  selectedImageModel: DEFAULT_PDP_IMAGE_MODEL
};

export function loadPdpClientSettings(): PdpClientSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(PDP_SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(rawValue) as Partial<PdpClientSettings>;
    return normalizePdpClientSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function savePdpClientSettings(settings: PdpClientSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PDP_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePdpClientSettings(settings)));
}

export function resolveGeminiApiKeyHeaderValue(settings?: Pick<PdpClientSettings, "customGeminiApiKey">) {
  const nextSettings = settings ?? loadPdpClientSettings();
  const trimmed = nextSettings.customGeminiApiKey.trim();
  return trimmed || null;
}

export function maskGeminiApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return "";
  }

  const visiblePrefixLength = Math.min(10, trimmed.length);
  return `${trimmed.slice(0, visiblePrefixLength)}${"*".repeat(Math.max(6, trimmed.length - visiblePrefixLength))}`;
}

function normalizePdpClientSettings(settings?: Partial<PdpClientSettings> | null): PdpClientSettings {
  const connectionMode = settings?.connectionMode === "server" ? "server" : "gemini-api-key";

  return {
    connectionMode,
    customGeminiApiKey: settings?.customGeminiApiKey?.trim() ?? "",
    selectedImageModel: normalizeImageModel(settings?.selectedImageModel)
  };
}

function normalizeImageModel(imageModel?: string | null): PdpImageModel {
  if (
    imageModel === "gemini-3.1-flash-image-preview" ||
    imageModel === "gemini-3-pro-image-preview" ||
    imageModel === "gemini-2.5-flash-image"
  ) {
    return imageModel;
  }

  return DEFAULT_PDP_IMAGE_MODEL;
}
