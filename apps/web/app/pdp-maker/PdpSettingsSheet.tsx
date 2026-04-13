"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, ServerCog, ShieldCheck, UserRound } from "lucide-react";
import type { PdpRuntimeConfigResponse } from "@runacademy/shared";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import styles from "./pdp-maker.module.css";
import { type PdpClientSettings, maskGeminiApiKey } from "./pdp-settings";
import { getPdpImageModelLabel, getPdpImageModelOptions } from "./pdp-utils";

interface PdpSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: PdpClientSettings;
  onSave: (settings: PdpClientSettings) => void;
  runtimeConfig?: PdpRuntimeConfigResponse | null;
}

const TEXT = {
  kicker: "\uC124\uC815",
  title: "\uC0DD\uC131 \uC5D4\uC9C4 \uC124\uC815",
  description:
    "\uC5F0\uACB0 \uBC29\uC2DD\uACFC \uC774\uBBF8\uC9C0 \uC0DD\uC131 \uBAA8\uB378\uC744 \uACE0\uB97C \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC11C\uBC84\uC5D0 Vertex AI\uAC00 \uC5F0\uACB0\uB3FC \uC788\uC73C\uBA74 \uAC1C\uC778 API \uD0A4 \uC5C6\uC774\uB3C4 \uBC14\uB85C \uC791\uC5C5\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  noStoredApiKey: "\uC800\uC7A5\uB41C \uAC1C\uC778 Gemini API \uD0A4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
  serverVertex: "\uC11C\uBC84 \uC5F0\uACB0 (Vertex AI)",
  serverGemini: "\uC11C\uBC84 \uC5F0\uACB0 (Gemini API)",
  serverUnset: "\uC11C\uBC84 \uC5F0\uACB0 \uBBF8\uC124\uC815",
  apiKeyRequired: "\uAC1C\uC778 Gemini API \uD0A4\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
  serverNotReady: "\uBC31\uC5D4\uB4DC \uC11C\uBC84 \uC5F0\uACB0\uC774 \uC544\uC9C1 \uC900\uBE44\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.",
  currentConnection: "\uD604\uC7AC \uC5F0\uACB0",
  personalApiKey: "\uAC1C\uC778 Gemini API \uD0A4",
  available: "\uC0AC\uC6A9 \uAC00\uB2A5",
  saved: "\uC800\uC7A5\uB428",
  unset: "\uBBF8\uC124\uC815",
  selectedModel: "\uC120\uD0DD \uBAA8\uB378",
  serverConnection: "\uC11C\uBC84 \uC5F0\uACB0",
  personalKey: "\uAC1C\uC778 \uD0A4",
  notReady: "\uC900\uBE44\uB418\uC9C0 \uC54A\uC74C",
  vertexNotice:
    "Vertex AI\uAC00 \uC11C\uBC84\uC5D0 \uC124\uC815\uB3FC \uC788\uC73C\uBA74 \uBE0C\uB77C\uC6B0\uC800 \uD0A4\uB97C \uB530\uB85C \uB123\uC9C0 \uC54A\uACE0\uB3C4 \uAC19\uC740 \uD654\uBA74\uC5D0\uC11C \uBC14\uB85C \uBAA8\uB378\uC744 \uC120\uD0DD\uD574 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  connectionMode: "\uC5F0\uACB0 \uBC29\uC2DD",
  imageModel: "\uC774\uBBF8\uC9C0 \uC0DD\uC131 \uBAA8\uB378",
  missingModelDescription: "\uC120\uD0DD\uD55C \uBAA8\uB378 \uC124\uBA85\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.",
  apiKeyLabel: "Gemini API \uD0A4",
  apiKeyPlaceholder: "AIza...",
  apiKeyStorageNotice:
    "\uAC1C\uC778 \uD0A4\uB294 Git\uC5D0 \uD3EC\uD568\uB418\uC9C0 \uC54A\uACE0, \uC774 \uBE0C\uB77C\uC6B0\uC800\uC758 localStorage\uC5D0\uB9CC \uC800\uC7A5\uB429\uB2C8\uB2E4.",
  serverModeNotice:
    "\uC11C\uBC84 \uC5F0\uACB0 \uBAA8\uB4DC\uC5D0\uC11C\uB294 \uBE0C\uB77C\uC6B0\uC800 \uD0A4\uB97C \uC800\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uBC31\uC5D4\uB4DC\uC5D0\uC11C Vertex AI \uB610\uB294 \uC11C\uBC84 \uCE21 Gemini \uC778\uC99D\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4.",
  close: "\uB2EB\uAE30",
  save: "\uC124\uC815 \uC800\uC7A5"
} as const;

export function PdpSettingsSheet({
  open,
  onOpenChange,
  settings,
  onSave,
  runtimeConfig = null
}: PdpSettingsSheetProps) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [errorMessage, setErrorMessage] = useState("");
  const imageModelOptions = useMemo(() => getPdpImageModelOptions(runtimeConfig), [runtimeConfig]);
  const maskedCustomApiKey = localSettings.customGeminiApiKey ? maskGeminiApiKey(localSettings.customGeminiApiKey) : "";
  const currentKeyPreview = maskedCustomApiKey || TEXT.noStoredApiKey;
  const serverProviderAvailable = Boolean(runtimeConfig && !runtimeConfig.requiresClientApiKey);
  const displayedConnectionMode = serverProviderAvailable ? localSettings.connectionMode : "gemini-api-key";
  const serverProviderLabel =
    runtimeConfig?.provider === "vertex-ai"
      ? TEXT.serverVertex
      : runtimeConfig?.provider === "gemini-api-key"
        ? TEXT.serverGemini
        : TEXT.serverUnset;

  useEffect(() => {
    if (open) {
      setLocalSettings(settings);
      setErrorMessage("");
    }
  }, [open, settings]);

  const handleSave = () => {
    if (displayedConnectionMode === "gemini-api-key" && !localSettings.customGeminiApiKey.trim()) {
      setErrorMessage(TEXT.apiKeyRequired);
      return;
    }

    if (displayedConnectionMode === "server" && !serverProviderAvailable) {
      setErrorMessage(TEXT.serverNotReady);
      return;
    }

    onSave({
      connectionMode: displayedConnectionMode,
      customGeminiApiKey: localSettings.customGeminiApiKey.trim(),
      selectedImageModel: localSettings.selectedImageModel
    });
    onOpenChange(false);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className={styles.settingsSheet} side="right">
        <SheetHeader className={styles.settingsSheetHeader}>
          <div className={styles.settingsSheetKicker}>
            <KeyRound size={14} />
            {TEXT.kicker}
          </div>
          <SheetTitle>{TEXT.title}</SheetTitle>
          <SheetDescription>{TEXT.description}</SheetDescription>
        </SheetHeader>

        <div className={styles.settingsSheetBody}>
          <section className={styles.settingsCard}>
            <div className={styles.settingsCardHeader}>
              <div>
                <span className={styles.panelLabel}>{TEXT.currentConnection}</span>
                <h3 className={styles.settingsCardTitle}>
                  {displayedConnectionMode === "server" ? serverProviderLabel : TEXT.personalApiKey}
                </h3>
              </div>
              <span
                className={
                  displayedConnectionMode === "server"
                    ? serverProviderAvailable
                      ? styles.settingsStatusStrong
                      : styles.settingsStatusSoft
                    : maskedCustomApiKey
                      ? styles.settingsStatusStrong
                      : styles.settingsStatusSoft
                }
              >
                {displayedConnectionMode === "server"
                  ? serverProviderAvailable
                    ? TEXT.available
                    : TEXT.unset
                  : maskedCustomApiKey
                    ? TEXT.saved
                    : TEXT.unset}
              </span>
            </div>

            <div className={styles.settingsKeyPreview}>
              <strong>{TEXT.selectedModel}</strong>
              <code>{getPdpImageModelLabel(localSettings.selectedImageModel, runtimeConfig)}</code>
            </div>

            <div className={styles.settingsStatusList}>
              <div className={styles.settingsStatusRow}>
                <ServerCog size={14} />
                <span>{TEXT.serverConnection}</span>
                <strong>{serverProviderAvailable ? serverProviderLabel : TEXT.notReady}</strong>
              </div>
              <div className={styles.settingsStatusRow}>
                <UserRound size={14} />
                <span>{TEXT.personalKey}</span>
                <strong>{currentKeyPreview}</strong>
              </div>
            </div>
          </section>

          <section className={styles.settingsCard}>
            <div className={styles.settingsLockedNotice}>
              <ShieldCheck size={16} />
              {TEXT.vertexNotice}
            </div>

            <label className={styles.settingsField}>
              <span className={styles.fieldLabel}>{TEXT.connectionMode}</span>
              <select
                className={styles.settingsInput}
                onChange={(event) => {
                  setLocalSettings((current) => ({
                    ...current,
                    connectionMode: event.target.value === "server" ? "server" : "gemini-api-key"
                  }));
                  if (errorMessage) {
                    setErrorMessage("");
                  }
                }}
                value={displayedConnectionMode}
              >
                {serverProviderAvailable ? <option value="server">{serverProviderLabel}</option> : null}
                <option value="gemini-api-key">{TEXT.personalApiKey}</option>
              </select>
            </label>

            <label className={styles.settingsField}>
              <span className={styles.fieldLabel}>{TEXT.imageModel}</span>
              <select
                className={styles.settingsInput}
                onChange={(event) => {
                  setLocalSettings((current) => ({
                    ...current,
                    selectedImageModel: event.target.value as PdpClientSettings["selectedImageModel"]
                  }));
                }}
                value={localSettings.selectedImageModel}
              >
                {imageModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <p className={styles.settingsHelper}>
              {imageModelOptions.find((option) => option.value === localSettings.selectedImageModel)?.description ??
                TEXT.missingModelDescription}
            </p>

            {displayedConnectionMode === "gemini-api-key" ? (
              <>
                <label className={styles.settingsField}>
                  <span className={styles.fieldLabel}>{TEXT.apiKeyLabel}</span>
                  <input
                    autoComplete="off"
                    className={styles.settingsInput}
                    onChange={(event) => {
                      setLocalSettings((current) => ({
                        ...current,
                        customGeminiApiKey: event.target.value
                      }));
                      if (errorMessage) {
                        setErrorMessage("");
                      }
                    }}
                    placeholder={TEXT.apiKeyPlaceholder}
                    type="password"
                    value={localSettings.customGeminiApiKey}
                  />
                </label>

                <p className={styles.settingsHelper}>{TEXT.apiKeyStorageNotice}</p>
              </>
            ) : (
              <p className={styles.settingsHelper}>{TEXT.serverModeNotice}</p>
            )}

            {errorMessage ? <div className={styles.settingsError}>{errorMessage}</div> : null}

            <div className={styles.settingsActions}>
              <button className={styles.secondaryButton} onClick={() => onOpenChange(false)} type="button">
                {TEXT.close}
              </button>
              <button className={styles.primaryButton} onClick={handleSave} type="button">
                {TEXT.save}
              </button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
