import type { AspectRatio, PdpImageModel, PdpImageModelOption, PdpRuntimeConfigResponse } from "@runacademy/shared";
import { resolveGeminiApiKeyHeaderValue } from "./pdp-settings";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000/v1";

export const RATIO_OPTIONS: Array<{
  value: AspectRatio;
  label: string;
  description: string;
  icon: "square" | "portrait" | "phone" | "landscape" | "wide";
}> = [
  { value: "1:1", label: "정사각", description: "썸네일, 마켓 대표 이미지", icon: "square" },
  { value: "3:4", label: "일반 세로", description: "상세페이지 기본형", icon: "portrait" },
  { value: "9:16", label: "모바일 세로", description: "모바일 집중형 상세페이지", icon: "phone" },
  { value: "4:3", label: "일반 가로", description: "배너, 중간 섹션 컷", icon: "landscape" },
  { value: "16:9", label: "와이드", description: "히어로 배너형", icon: "wide" }
];

export const TONE_OPTIONS = [
  "AI 자동 추천",
  "프리미엄",
  "모던",
  "따뜻한 감성",
  "미니멀",
  "생동감",
  "빈티지 감성",
  "하이엔드"
];

export const FALLBACK_PDP_IMAGE_MODELS: PdpImageModelOption[] = [
  {
    value: "gemini-3.1-flash-image-preview",
    label: "Nano Banana 2",
    description: "추천 기본값. Gemini 3.1 Flash Image preview로 속도와 퀄리티 균형이 가장 좋습니다."
  },
  {
    value: "gemini-3-pro-image-preview",
    label: "Nano Banana Pro",
    description: "가장 공들인 프리미엄 컷용. 시간이 조금 더 걸려도 완성도를 우선할 때 적합합니다."
  },
  {
    value: "gemini-2.5-flash-image",
    label: "Nano Banana",
    description: "이전 세대 밸런스형 옵션. 이미 써 본 결과와 비슷한 느낌을 유지하고 싶을 때 적합합니다."
  }
];

export function getPdpImageModelOptions(runtimeConfig?: Pick<PdpRuntimeConfigResponse, "availableImageModels"> | null) {
  if (runtimeConfig?.availableImageModels?.length) {
    return runtimeConfig.availableImageModels;
  }

  return FALLBACK_PDP_IMAGE_MODELS;
}

export function getPdpImageModelLabel(
  imageModel: PdpImageModel,
  runtimeConfig?: Pick<PdpRuntimeConfigResponse, "availableImageModels"> | null
) {
  return getPdpImageModelOptions(runtimeConfig).find((option) => option.value === imageModel)?.label ?? imageModel;
}

export async function apiJson<T>(
  path: string,
  init?: RequestInit,
  options?: { geminiApiKey?: string | null }
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");

  const hasExplicitGeminiOption = Boolean(options && "geminiApiKey" in options);
  const customGeminiApiKey = hasExplicitGeminiOption
    ? typeof options?.geminiApiKey === "string"
      ? resolveGeminiApiKeyHeaderValue({ customGeminiApiKey: options.geminiApiKey })
      : null
    : resolveGeminiApiKeyHeaderValue();

  if (customGeminiApiKey) {
    headers.set("X-Gemini-Api-Key", customGeminiApiKey);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  });

  return response.json() as Promise<T>;
}

export function toDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

export async function prepareImageFile(file: File) {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const sourceImage = await loadImage(sourceDataUrl);

  const maxDimension = 1024;
  const minLongestDimension = 512;
  let width = sourceImage.width;
  let height = sourceImage.height;

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const longestSide = Math.max(width, height);
  if (longestSide < minLongestDimension) {
    const scale = minLongestDimension / longestSide;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("이미지 캔버스를 초기화하지 못했습니다.");
  }

  context.drawImage(sourceImage, 0, 0, width, height);

  const previewUrl = canvas.toDataURL("image/jpeg", 0.84);
  const base64 = previewUrl.split(",")[1] ?? "";

  if (!base64) {
    throw new Error("이미지 변환 결과가 비어 있습니다.");
  }

  return {
    base64,
    mimeType: "image/jpeg" as const,
    previewUrl,
    fileName: file.name
  };
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}
