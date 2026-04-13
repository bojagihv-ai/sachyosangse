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
  const currentKeyPreview = maskedCustomApiKey || "저장된 개인 Gemini API 키가 없습니다.";
  const serverProviderAvailable = Boolean(runtimeConfig && !runtimeConfig.requiresClientApiKey);
  const displayedConnectionMode = serverProviderAvailable ? localSettings.connectionMode : "gemini-api-key";
  const serverProviderLabel =
    runtimeConfig?.provider === "vertex-ai"
      ? "서버 연결 (Vertex AI)"
      : runtimeConfig?.provider === "gemini-api-key"
        ? "서버 연결 (Gemini API)"
        : "서버 연결 미설정";

  useEffect(() => {
    if (open) {
      setLocalSettings(settings);
      setErrorMessage("");
    }
  }, [open, settings]);

  const handleSave = () => {
    if (displayedConnectionMode === "gemini-api-key" && !localSettings.customGeminiApiKey.trim()) {
      setErrorMessage("개인 Gemini API 키를 입력해 주세요.");
      return;
    }

    if (displayedConnectionMode === "server" && !serverProviderAvailable) {
      setErrorMessage("백엔드 서버 연결이 아직 준비되지 않았습니다.");
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
            설정
          </div>
          <SheetTitle>생성 엔진 설정</SheetTitle>
          <SheetDescription>
            연결 방식과 이미지 생성 모델을 고를 수 있습니다. 서버에 Vertex AI가 연결돼 있으면 개인 API 키 없이도
            바로 작업할 수 있습니다.
          </SheetDescription>
        </SheetHeader>

        <div className={styles.settingsSheetBody}>
          <section className={styles.settingsCard}>
            <div className={styles.settingsCardHeader}>
              <div>
                <span className={styles.panelLabel}>현재 연결</span>
                <h3 className={styles.settingsCardTitle}>
                  {displayedConnectionMode === "server" ? serverProviderLabel : "개인 Gemini API 키"}
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
                    ? "사용 가능"
                    : "미설정"
                  : maskedCustomApiKey
                    ? "저장됨"
                    : "미설정"}
              </span>
            </div>

            <div className={styles.settingsKeyPreview}>
              <strong>선택 모델</strong>
              <code>{getPdpImageModelLabel(localSettings.selectedImageModel, runtimeConfig)}</code>
            </div>

            <div className={styles.settingsStatusList}>
              <div className={styles.settingsStatusRow}>
                <ServerCog size={14} />
                <span>서버 연결</span>
                <strong>{serverProviderAvailable ? serverProviderLabel : "준비되지 않음"}</strong>
              </div>
              <div className={styles.settingsStatusRow}>
                <UserRound size={14} />
                <span>개인 키</span>
                <strong>{currentKeyPreview}</strong>
              </div>
            </div>
          </section>

          <section className={styles.settingsCard}>
            <div className={styles.settingsLockedNotice}>
              <ShieldCheck size={16} />
              Vertex AI가 서버에 설정돼 있으면 브라우저 키를 따로 넣지 않고도 같은 화면에서 바로 모델을 선택해
              사용할 수 있습니다.
            </div>

            <label className={styles.settingsField}>
              <span className={styles.fieldLabel}>연결 방식</span>
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
                <option value="gemini-api-key">개인 Gemini API 키</option>
              </select>
            </label>

            <label className={styles.settingsField}>
              <span className={styles.fieldLabel}>이미지 생성 모델</span>
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
                "선택한 모델 설명을 불러오지 못했습니다."}
            </p>

            {displayedConnectionMode === "gemini-api-key" ? (
              <>
                <label className={styles.settingsField}>
                  <span className={styles.fieldLabel}>Gemini API 키</span>
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
                    placeholder="AIza..."
                    type="password"
                    value={localSettings.customGeminiApiKey}
                  />
                </label>

                <p className={styles.settingsHelper}>
                  개인 키는 Git에 포함되지 않고, 이 브라우저의 `localStorage`에만 저장됩니다.
                </p>
              </>
            ) : (
              <p className={styles.settingsHelper}>
                서버 연결 모드에서는 브라우저 키를 저장하지 않습니다. 백엔드에서 Vertex AI 또는 서버 측 Gemini
                인증을 사용합니다.
              </p>
            )}

            {errorMessage ? <div className={styles.settingsError}>{errorMessage}</div> : null}

            <div className={styles.settingsActions}>
              <button className={styles.secondaryButton} onClick={() => onOpenChange(false)} type="button">
                닫기
              </button>
              <button className={styles.primaryButton} onClick={handleSave} type="button">
                설정 저장
              </button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
