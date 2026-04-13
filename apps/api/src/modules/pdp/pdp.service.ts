import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type {
  AspectRatio,
  ImageGenOptions,
  LandingPageBlueprint,
  PdpImageModel,
  PdpImageModelOption,
  PdpGuidePriorityMode,
  PdpAnalyzeRequest,
  PdpErrorCode,
  PdpRuntimeConfigResponse,
  SectionBlueprint
} from "@runacademy/shared";

const ANALYZE_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_IMAGE_MODEL: PdpImageModel = "gemini-3.1-flash-image-preview";
const DEFAULT_IMAGE_MIME = "image/jpeg";
const REFERENCE_MODEL_MAX_ATTEMPTS = 3;
const SUPPORTED_IMAGE_MODELS: PdpImageModelOption[] = [
  {
    value: "gemini-3.1-flash-image-preview",
    label: "Nano Banana 2",
    description: "추천 기본값. Gemini 3.1 Flash Image preview로 속도와 퀄리티의 균형이 가장 좋습니다."
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

type GeneratedImagePayload = {
  base64: string;
  mimeType: string;
};

type ReferenceModelProfile = {
  genderPresentation: string;
  ageImpression: string;
  faceShape: string;
  hairstyle: string;
  skinTone: string;
  eyeDetails: string;
  browDetails: string;
  lipDetails: string;
  overallVibe: string;
  distinctiveFeatures: string[];
  keepTraits: string[];
  flexibleTraits: string[];
};

type GeneratedImageValidation = {
  isSamePerson: boolean;
  genderPresentationPreserved: boolean;
  styleMatch: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  correctionFocus: string[];
};

type InternalImageGenOptions = ImageGenOptions & {
  guidePriorityMode: PdpGuidePriorityMode;
  referenceModelProfile?: ReferenceModelProfile | null;
  retryDirective?: string;
};

type NormalizedReferenceModelImage = {
  base64: string;
  mimeType: string;
};

export class PdpServiceError extends Error {
  constructor(
    readonly code: PdpErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "PdpServiceError";
  }
}

export class PdpService {
  getRuntimeConfig(): PdpRuntimeConfigResponse {
    const serverProvider = resolveServerProvider();

    return {
      ok: true,
      provider: serverProvider,
      requiresClientApiKey: serverProvider === "unconfigured",
      defaultImageModel: DEFAULT_IMAGE_MODEL,
      availableImageModels: SUPPORTED_IMAGE_MODELS
    };
  }

  async analyzeProduct(request: PdpAnalyzeRequest, geminiApiKeyOverride?: string) {
    const normalizedImage = sanitizeBase64Payload(request.imageBase64);
    const mimeType = normalizeMimeType(request.mimeType);
    const imageModel = normalizeRequestedImageModel(request.imageModel);
    const referenceModelImage = normalizeReferenceModelImage(request.modelImageBase64, request.modelImageMimeType);
    const client = this.getClient(geminiApiKeyOverride);
    const referenceModelProfile =
      referenceModelImage ? await this.extractReferenceModelProfile(client, referenceModelImage) : null;

    const blueprint = await retryOperation(async () => {
      const response = await client.models.generateContent({
        model: ANALYZE_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              buildHighResolutionInlinePart(mimeType, normalizedImage),
              ...(referenceModelImage ? [buildHighResolutionInlinePart(referenceModelImage.mimeType, referenceModelImage.base64)] : []),
              {
                text: buildAnalyzePrompt(request.additionalInfo, request.desiredTone, referenceModelProfile)
              }
            ]
          }
        ] as any,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: { type: Type.STRING },
              scorecard: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    score: { type: Type.STRING },
                    reason: { type: Type.STRING }
                  }
                }
              },
              blueprintList: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    section_id: { type: Type.STRING },
                    section_name: { type: Type.STRING },
                    goal: { type: Type.STRING },
                    headline: { type: Type.STRING },
                    headline_en: { type: Type.STRING },
                    subheadline: { type: Type.STRING },
                    subheadline_en: { type: Type.STRING },
                    bullets: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    bullets_en: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    },
                    trust_or_objection_line: { type: Type.STRING },
                    trust_or_objection_line_en: { type: Type.STRING },
                    CTA: { type: Type.STRING },
                    CTA_en: { type: Type.STRING },
                    layout_notes: { type: Type.STRING },
                    compliance_notes: { type: Type.STRING },
                    image_id: { type: Type.STRING },
                    purpose: { type: Type.STRING },
                    prompt_ko: { type: Type.STRING },
                    prompt_en: { type: Type.STRING },
                    negative_prompt: { type: Type.STRING },
                    style_guide: { type: Type.STRING },
                    reference_usage: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });

      return parseBlueprintResponse(response);
    });

    const firstSection = blueprint.sections[0];

    if (!firstSection) {
      throw new PdpServiceError(
        "GEMINI_RESPONSE_INVALID",
        "?곸꽭?섏씠吏 ?뱀뀡???앹꽦?섏? 紐삵뻽?듬땲??",
        "No sections returned from analyze response."
      );
    }

    const firstImage = await this.generateSectionImageInternal({
      originalImageBase64: normalizedImage,
      section: firstSection,
      aspectRatio: request.aspectRatio,
      desiredTone: request.desiredTone,
      imageModel,
      client,
      options: {
        style: "studio",
        withModel: true,
        modelGender: "female",
        modelAgeRange: "20s",
        modelCountry: "korea",
        guidePriorityMode: "guide-first",
        headline: firstSection.headline,
        subheadline: firstSection.subheadline,
        referenceModelImageBase64: referenceModelImage?.base64,
        referenceModelImageMimeType: referenceModelImage?.mimeType,
        referenceModelProfile
      }
    });

    blueprint.sections[0] = {
      ...firstSection,
      generatedImage: toDataUrl(firstImage.mimeType, firstImage.base64)
    };

    return {
      originalImage: normalizedImage,
      blueprint
    };
  }

  async generateSectionImage(request: {
    originalImageBase64: string;
    section: SectionBlueprint;
    aspectRatio: AspectRatio;
    desiredTone?: string;
    imageModel?: PdpImageModel;
    options?: ImageGenOptions;
  }, geminiApiKeyOverride?: string) {
    const client = this.getClient(geminiApiKeyOverride);
    const normalizedReferenceModel = normalizeReferenceModelImage(
      request.options?.referenceModelImageBase64,
      request.options?.referenceModelImageMimeType
    );
    const referenceModelProfile =
      normalizedReferenceModel && request.options?.withModel
        ? await this.extractReferenceModelProfile(client, normalizedReferenceModel)
        : null;

    const image = await this.generateSectionImageInternal({
      ...request,
      client,
      options: request.options
        ? {
            ...request.options,
            guidePriorityMode: request.options.guidePriorityMode ?? "guide-first",
            referenceModelImageBase64: normalizedReferenceModel?.base64,
            referenceModelImageMimeType: normalizedReferenceModel?.mimeType,
            referenceModelProfile
          }
        : undefined
    });

    return {
      imageBase64: image.base64,
      mimeType: image.mimeType
    };
  }

  private async generateSectionImageInternal(request: {
    originalImageBase64: string;
    section: SectionBlueprint;
    aspectRatio: AspectRatio;
    desiredTone?: string;
    imageModel?: PdpImageModel;
    options?: InternalImageGenOptions;
    client?: GoogleGenAI;
  }): Promise<GeneratedImagePayload> {
    const client = request.client ?? this.getClient();
    const originalImageBase64 = sanitizeBase64Payload(request.originalImageBase64);
    const section = normalizeSection(request.section, 0);
    const imageModel = normalizeRequestedImageModel(request.imageModel);
    const normalizedReferenceModel = normalizeReferenceModelImage(
      request.options?.referenceModelImageBase64,
      request.options?.referenceModelImageMimeType
    );
    const options = normalizeImageOptions(request.options);
    const referenceModelProfile =
      normalizedReferenceModel && options.withModel
        ? request.options?.referenceModelProfile ?? (await this.extractReferenceModelProfile(client, normalizedReferenceModel))
        : null;

    if (!section.prompt_en) {
      throw new PdpServiceError(
        "INVALID_REQUEST",
        "?대?吏 ?꾨＼?꾪듃媛 ?녿뒗 ?뱀뀡?낅땲??",
        "Section prompt_en is missing."
      );
    }

    const maxAttempts = normalizedReferenceModel && options.withModel ? REFERENCE_MODEL_MAX_ATTEMPTS : 1;
    let lastGeneratedImage: GeneratedImagePayload | null = null;
    let retryDirective = options.retryDirective;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const prompt = buildImagePrompt(section, request.desiredTone, {
        ...options,
        isRegeneration: options.isRegeneration || attempt > 0,
        referenceModelImageBase64: normalizedReferenceModel?.base64,
        referenceModelImageMimeType: normalizedReferenceModel?.mimeType,
        referenceModelProfile,
        retryDirective
      });

      const generatedImage = await retryOperation(async () => {
        const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [
          {
            inlineData: {
              mimeType: DEFAULT_IMAGE_MIME,
              data: originalImageBase64
            }
          }
        ];

        if (normalizedReferenceModel && options.withModel) {
          parts.push({
            inlineData: {
              mimeType: normalizedReferenceModel.mimeType,
              data: normalizedReferenceModel.base64
            }
          });
        }

        parts.push({
          text: prompt
        });

        const response = await client.models.generateContent({
          model: imageModel,
          contents: [
            {
              role: "user",
              parts
            }
          ],
          config: {
            imageConfig: {
              aspectRatio: request.aspectRatio
            }
          }
        });

        const nextImage = extractGeneratedImage(response);

        if (!nextImage) {
          throw new PdpServiceError(
            "PDP_IMAGE_GENERATION_FAILED",
            "?대?吏瑜??앹꽦?섏? 紐삵뻽?듬땲??",
            "Gemini image response did not include inline image data."
          );
        }

        return nextImage;
      });

      lastGeneratedImage = generatedImage;

      if (!normalizedReferenceModel || !options.withModel || !referenceModelProfile) {
        return generatedImage;
      }

      const validation = await this.validateGeneratedImage(client, {
        generatedImage,
        referenceModelImage: normalizedReferenceModel,
        referenceModelProfile,
        expectedStyle: options.style
      });

      if (validation.isSamePerson && validation.genderPresentationPreserved && validation.styleMatch) {
        return generatedImage;
      }

      retryDirective = buildRetryDirective(validation, referenceModelProfile, options.style);
    }

    if (!lastGeneratedImage) {
      throw new PdpServiceError(
        "PDP_IMAGE_GENERATION_FAILED",
        "?대?吏瑜??앹꽦?섏? 紐삵뻽?듬땲??",
        "No image was generated during the retry loop."
      );
    }

    return lastGeneratedImage;
  }

  private getClient(geminiApiKeyOverride?: string) {
    const apiKey = geminiApiKeyOverride?.trim();

    if (apiKey) {
      return new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    }

    const serverProvider = resolveServerProvider();

    if (serverProvider === "vertex-ai") {
      const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
      const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "global";

      if (!project) {
        throw new PdpServiceError(
          "INVALID_REQUEST",
          "Vertex AI 프로젝트 설정이 비어 있습니다.",
          "GOOGLE_CLOUD_PROJECT must be set when GOOGLE_GENAI_USE_VERTEXAI is enabled."
        );
      }

      return new GoogleGenAI({
        vertexai: true,
        project,
        location
      });
    }

    if (serverProvider === "gemini-api-key") {
      const serverApiKey = readServerGeminiApiKey();

      if (!serverApiKey) {
        throw new PdpServiceError(
          "GEMINI_API_KEY_MISSING",
          "서버 Gemini API 키가 비어 있습니다.",
          "Set GOOGLE_API_KEY or GEMINI_API_KEY for server-side Gemini usage."
        );
      }

      return new GoogleGenAI({ apiKey: serverApiKey, apiVersion: "v1alpha" });
    }

    throw new PdpServiceError(
      "GEMINI_API_KEY_MISSING",
      "설정 메뉴에서 본인 Gemini API 키를 입력하거나, 서버 Vertex AI 연결을 먼저 설정해 주세요."
    );
  }

  private async extractReferenceModelProfile(client: GoogleGenAI, referenceModelImage: NormalizedReferenceModelImage) {
    const response = await client.models.generateContent({
      model: ANALYZE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Analyze the uploaded reference person image and describe the same identifiable person for future commercial image generation. Focus on stable visual identity traits, not styling suggestions. Return JSON only."
            },
            buildHighResolutionInlinePart(referenceModelImage.mimeType, referenceModelImage.base64)
          ]
        }
      ] as any,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            genderPresentation: { type: Type.STRING },
            ageImpression: { type: Type.STRING },
            faceShape: { type: Type.STRING },
            hairstyle: { type: Type.STRING },
            skinTone: { type: Type.STRING },
            eyeDetails: { type: Type.STRING },
            browDetails: { type: Type.STRING },
            lipDetails: { type: Type.STRING },
            overallVibe: { type: Type.STRING },
            distinctiveFeatures: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            keepTraits: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            flexibleTraits: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    });

    return parseReferenceModelProfileResponse(response);
  }

  private async validateGeneratedImage(
    client: GoogleGenAI,
    input: {
      generatedImage: GeneratedImagePayload;
      referenceModelImage: NormalizedReferenceModelImage;
      referenceModelProfile: ReferenceModelProfile;
      expectedStyle: NonNullable<ImageGenOptions["style"]>;
    }
  ) {
    const response = await client.models.generateContent({
      model: ANALYZE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildValidationPrompt(input.referenceModelProfile, input.expectedStyle)
            },
            buildHighResolutionInlinePart(input.referenceModelImage.mimeType, input.referenceModelImage.base64),
            buildHighResolutionInlinePart(input.generatedImage.mimeType, input.generatedImage.base64)
          ]
        }
      ] as any,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isSamePerson: { type: Type.BOOLEAN },
            genderPresentationPreserved: { type: Type.BOOLEAN },
            styleMatch: { type: Type.BOOLEAN },
            confidence: { type: Type.STRING },
            reason: { type: Type.STRING },
            correctionFocus: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    });

    return parseGeneratedImageValidationResponse(response);
  }
}

export function toPdpErrorResponse(error: unknown) {
  if (error instanceof PdpServiceError) {
    return {
      ok: false as const,
      code: error.code,
      message: error.message,
      detail: error.detail
    };
  }

  const detail = stringifyError(error);
  const message = error instanceof Error ? error.message : "?곸꽭?섏씠吏 留덈쾿??泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.";

  if (isImageProcessingError(`${message}\n${detail}`)) {
    return {
      ok: false as const,
      code: "INVALID_IMAGE_PAYLOAD" as const,
      message: "?대?吏 ?덉쭏 ?먮뒗 ?뺤떇 臾몄젣濡?AI媛 ?대?吏瑜??쎌? 紐삵뻽?듬땲?? ?ㅻⅨ ?먮낯 ?대?吏(?좊챸??JPG/PNG)濡??ㅼ떆 ?쒕룄??二쇱꽭??",
      detail
    };
  }

  if (isQuotaError(message)) {
    return {
      ok: false as const,
      code: "GEMINI_QUOTA_EXCEEDED" as const,
      message: "AI ?ъ슜?됱씠 珥덇낵?섏뿀?듬땲?? ?좎떆 ???ㅼ떆 ?쒕룄?섍굅??quota ?곹깭瑜??뺤씤??二쇱꽭??",
      detail
    };
  }

  if (isJsonError(message)) {
    return {
      ok: false as const,
      code: "GEMINI_RESPONSE_INVALID" as const,
      message: "AI ?묐떟???댁꽍?섏? 紐삵뻽?듬땲?? 媛숈? ?대?吏濡??ㅼ떆 ?쒕룄??二쇱꽭??",
      detail
    };
  }

  return {
    ok: false as const,
    code: "PDP_ANALYZE_FAILED" as const,
    message: "?곸꽭?섏씠吏 留덈쾿??泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.",
    detail
  };
}

function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();

  if (!normalized.startsWith("image/")) {
    throw new PdpServiceError(
      "INVALID_IMAGE_PAYLOAD",
      "?대?吏 ?뚯씪留??낅줈?쒗븷 ???덉뒿?덈떎.",
      `Unsupported mime type: ${mimeType}`
    );
  }

  return normalized;
}

function sanitizeBase64Payload(input: string) {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:[^;]+;base64,(.+)$/);
  const normalized = (match ? match[1] : trimmed).replace(/\s/g, "");

  if (!normalized || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
    throw new PdpServiceError(
      "INVALID_IMAGE_PAYLOAD",
      "?대?吏 ?곗씠?곌? ?щ컮瑜댁? ?딆뒿?덈떎.",
      "Malformed base64 payload."
    );
  }

  try {
    const bytes = Buffer.from(normalized, "base64");
    if (!bytes.byteLength) {
      throw new Error("empty payload");
    }
  } catch {
    throw new PdpServiceError(
      "INVALID_IMAGE_PAYLOAD",
      "?대?吏 ?곗씠?곕? ?쎌쓣 ???놁뒿?덈떎.",
      "Buffer.from failed for image payload."
    );
  }

  return normalized;
}

function buildAnalyzePrompt(
  additionalInfo?: string,
  desiredTone?: string,
  referenceModelProfile?: ReferenceModelProfile | null
) {
  const referenceModelPrompt = referenceModelProfile
    ? `[李멸퀬 紐⑤뜽 ?대?吏媛 ?④퍡 ?쒓났??: 紐⑤뜽???ы븿?섎뒗 而룹? ?낅줈?쒕맂 ?숈씪 ?몃Ъ???뺤껜?깆쓣 ?좎??댁빞 ?⑸땲??
- ?좎????듭떖 ?뱀꽦: ${referenceModelProfile.keepTraits.join(", ")}
- ?앸퀎 ?ъ씤?? ${referenceModelProfile.distinctiveFeatures.join(", ")}
- ?꾩껜 ?몄긽: ${referenceModelProfile.overallVibe}`
    : "";

  return `
???쒗뭹 ?대?吏瑜?遺꾩꽍?섏뿬 4~6媛쒖쓽 ?듭떖 ?뱀뀡?쇰줈 援ъ꽦???곸꽭?섏씠吏 ?꾩껜 釉붾（?꾨┛?몃? ?ㅺ퀎?댁＜?몄슂.
${additionalInfo ? `[?ъ슜??異붽? ?뺣낫]: ${additionalInfo}` : ""}
${desiredTone ? `[?먰븯???붿옄????: ${desiredTone}` : ""}
${referenceModelPrompt}

# ?뱀뀡 ?쒗뵆由??꾩닔 ?꾨뱶)
- section_id: S1~S6
- section_name: (?? ?덉뼱濡?泥댄겕由ъ뒪??踰좊꽕??洹쇨굅/?ъ슜踰??꾧린 ??
- goal: ???뱀뀡????븷(吏㏃? ??臾몄옣)
- headline: ?쒓뎅??1以?媛뺥븯寃?
- headline_en: headline???먯뿰?ㅻ윭???곸뼱 踰덉뿭 1以?
- subheadline: ?쒓뎅??1以?紐낇솗?섍쾶)
- subheadline_en: subheadline???먯뿰?ㅻ윭???곸뼱 踰덉뿭 1以?
- bullets: ?쒓뎅??3媛??ㅼ틪?? 媛?1以?
- bullets_en: bullets???먯뿰?ㅻ윭???곸뼱 踰덉뿭 3媛?
- trust_or_objection_line: ?쒓뎅??遺덉븞 ?쒓굅/?좊ː 1臾몄옣
- trust_or_objection_line_en: trust_or_objection_line???먯뿰?ㅻ윭???곸뼱 踰덉뿭 1臾몄옣
- CTA: (?덉쑝硫? ?쒓뎅??1以?
- CTA_en: CTA???먯뿰?ㅻ윭???곸뼱 踰덉뿭 1以?
- layout_notes: ?대?吏 ?덉씠?꾩썐 吏??吏㏐쾶)
- compliance_notes: 移댄뀒怨좊━蹂?洹쒖젣/?쒗쁽 二쇱쓽(吏㏐쾶)

# ?뱀뀡 援ъ꽦 ?먯튃(媛뺤젣)
- 踰좊꽕?륁? 3媛?怨좎젙
- 洹쇨굅 ?뱀뀡? 諛섎뱶??寃곌낵?믪“嫄닳넂?댁꽍 3?⑥쑝濡??묒꽦
- 由щ럭 ?뱀뀡? ?????ъ쭊蹂대떎 ?ъ슜媛?臾몄옣 ?꾧린 移대뱶 6~12媛??곗꽑
- ?ъ슜踰?猷⑦떞? ?좏깮吏瑜?2~3媛쒕줈 以꾩뿬 ?좏깮 ?쇰줈瑜??놁븿 寃?
- CTA??理쒖냼 2???댁긽 諛곗튂
- 媛??뱀뀡???대?吏???⑥닚???쒗뭹 ?꾨겮??洹몃옒?쎌씠 ?꾨땶 ?뚮퉬?먯쓽 援щℓ ?꾪솚???좊룄?????덈뒗 怨좏뭹吏?愿묎퀬 ?ъ쭊 ?먮굦?쇰줈 湲고쉷??寃?
- 泥?踰덉㎏ ?뱀뀡? 援щℓ ?꾪솚??媛??以묒슂?섎?濡?諛섎뱶??留ㅻ젰?곸씤 紐⑤뜽???쒗뭹怨??④퍡 ?곗텧??而룹쑝濡??꾨＼?꾪듃瑜??묒꽦??寃?
- 媛??뱀뀡 ?대?吏???대떦 ?ㅻ뱶?쇱씤怨??쒕툕?ㅻ뱶?쇱씤??硫붿떆吏瑜??쒓컖?곸쑝濡??꾨떖?댁빞 ??

# ?뱀뀡蹂??대?吏 ?앹꽦 ?꾨＼?꾪듃
- image_id: IMG_S1~IMG_S6
- purpose: ???대?吏媛 ?꾨떖?댁빞 ?섎뒗 硫붿떆吏(吏㏃? ??臾몄옣)
- prompt_ko: ?쒓뎅???대?吏 ?앹꽦 ?꾨＼?꾪듃(1~2臾몄옣). 援щ룄, 嫄곕━媛? ?쒖꽑 ?믪씠, ?쒗뭹???꾨젅?꾩뿉??李⑥??섎뒗 鍮꾩쨷???④퍡 紐낆떆??寃?
- prompt_en: ?곸뼱 ?꾨＼?꾪듃(?ㅼ젣 ?대?吏 ?앹꽦??. Include composition, framing distance, camera angle, product prominence, and the key subject action. Keep it neutral enough that studio/lifestyle/outdoor priority can still be controlled at generation time.
- negative_prompt: ?쇳빐?????붿냼
- style_guide: ?꾩껜 ?듭씪 ?ㅽ??? ?ㅽ뒠?붿삤???뺤젣???명듃/議곕챸/吏덇컧, ?쇱씠?꾩뒪??쇱? ?꾩떎媛??덈뒗 怨듦컙/?됰룞, ?꾩썐?꾩뼱???꾩튂媛?怨듦린媛??쒕룞?깆쓣 遺꾨챸???곸쓣 寃? ??媛믪? ?붿옄??媛?대뱶 ?곗꽑 紐⑤뱶?먯꽌留?媛뺥븯寃??곸슜?????덈룄濡??묒꽦??寃?
- reference_usage: ?낅줈?쒕맂 湲곗〈 ?쒗뭹 ?대?吏瑜??대뼸寃?李멸퀬?좎?. ?쒗뭹 ?뺥깭, ?쇰꺼, ?ъ쭏, ?됯컧???좎??섎뒗 湲곗???紐낆떆??寃?
- section_name, goal, layout_notes, compliance_notes, purpose, style_guide, reference_usage??諛섎뱶???쒓뎅?대줈 ?묒꽦??寃?
- ?곸뼱??*_en ?꾨뱶? prompt_en?먮쭔 ?ъ슜??寃?

# ?대?吏 ?앹꽦 怨듯넻 洹쒖튃
- ?몃줈???곸꽭?섏씠吏??
- ?대?吏 ?댁뿉 ?띿뒪?? 濡쒓퀬, ?뚰꽣留덊겕, 湲?먮? ?ｌ? 留?寃?
- 諛곌꼍? ?⑥닚?섍쾶 ?좎??섍퀬 ?쒗뭹/?듭떖 ?ㅻ툕?앺듃???쒖꽑??吏묒쨷?쒗궗 寃?
- ???μ뿉 硫붿떆吏 ?섎굹留??꾨떖??寃?
- 洹쒖젣 由ъ뒪?ш? ?덉쑝硫??덉쟾???쒗쁽?쇰줈 ?섏젙??寃?
- JSON ???띿뒪?몃? 遺숈씠吏 留먭퀬 紐⑤뱺 ?꾨뱶??媛꾧껐?섍쾶 ?묒꽦??寃?

?묐떟? 諛섎뱶???쒓났??JSON ?ㅽ궎留덈? 以?섑빐???⑸땲??
`.trim();
}

function buildImagePrompt(
  section: SectionBlueprint,
  desiredTone?: string,
  options?: InternalImageGenOptions
) {
  const baseSceneDirection = getBaseSceneDirection(section, options?.guidePriorityMode ?? "guide-first");
  let enhancedPrompt = "Create a high-end, conversion-optimized commercial advertising photograph. ";

  if (options?.headline) {
    enhancedPrompt += `Context: The image should visually represent the advertising headline "${options.headline}"`;
    if (options.subheadline) {
      enhancedPrompt += ` and subheadline "${options.subheadline}"`;
    }
    enhancedPrompt += ". ";
  }

  if (options?.withModel && options.referenceModelImageBase64) {
    enhancedPrompt +=
      "Reference Inputs: image 1 is the original product reference and must preserve the exact product. image 2 is the mandatory model identity reference. ";
    enhancedPrompt +=
      "The final image MUST use the same person from image 2. Do not switch to a different model, do not change gender, and do not drift to a generic portrait face. ";
    if (options.referenceModelProfile) {
      enhancedPrompt += buildReferenceModelProfilePrompt(options.referenceModelProfile);
    }
  }

  if (options?.isRegeneration) {
    enhancedPrompt += "\n[USER OVERRIDE INSTRUCTIONS - STRICTLY FOLLOW THESE OVER ANY CONFLICTING BASE INSTRUCTIONS]\n";
    enhancedPrompt += buildImageStyleInstructions(options);
    enhancedPrompt += "[END USER OVERRIDE INSTRUCTIONS]\n\n";
  } else {
    enhancedPrompt += "\nBase Instructions: ";
  }

  if (options?.withModel && options.referenceModelImageBase64) {
    enhancedPrompt +=
      `Using image 1 as the exact product reference and image 2 as the exact person reference, create a new commercial scene based on this direction: ${baseSceneDirection}. `;
    enhancedPrompt +=
      "The person in the final image must be the same person from image 2, with the same face, gender presentation, hairstyle, skin tone, and overall identity. ";
    enhancedPrompt +=
      "Do not replace the person with a different model, do not masculinize or feminize them differently, and do not drift to a generic fashion face. Treat this as the same person in a new pose, new framing, and new environment. ";
  } else {
    enhancedPrompt += `Keep the product exactly as is. Build the scene from this direction: ${baseSceneDirection}. `;
  }

  if (desiredTone) {
    enhancedPrompt += `The overall style and tone should be ${desiredTone}. `;
  }

  enhancedPrompt += buildGuidePriorityInstructions(section, options);

  if (!options?.isRegeneration) {
    enhancedPrompt += buildImagePreferenceInstructions(section, options);
  }

  if (options?.retryDirective) {
    enhancedPrompt += ` Retry correction: ${options.retryDirective} `;
  }

  enhancedPrompt += "\nComposition Rules: ";
  enhancedPrompt +=
    "use a varied, intentional camera distance that matches the scene instead of defaulting to a chest-up portrait. ";
  enhancedPrompt +=
    "Depending on the section, use wide shots, medium shots, tabletop/product detail shots, hands-in-frame moments, over-the-shoulder angles, seated scenes, or environment-led framing when they improve product storytelling. ";
  enhancedPrompt +=
    "Keep the product readable, prominent, and beautifully lit, but allow the frame to breathe with negative space, props, and surrounding context when useful. ";
  enhancedPrompt += "\nCRITICAL: The final image must look like a top-tier magazine advertisement or a premium brand's landing page hero shot. ";
  enhancedPrompt +=
    "It should be highly attractive and induce purchase conversion. IMPORTANT: Do NOT include any text, words, letters, typography, or logos in the generated image.";

  return enhancedPrompt;
}

function buildImageStyleInstructions(options?: InternalImageGenOptions) {
  if (!options) {
    return "";
  }

  let instructions = "";

  if (options.style === "studio") {
    instructions +=
      "- Setting: Professional studio lighting, seamless paper or premium studio set, controlled backdrop, and no lived-in domestic context unless explicitly required.\n";
    instructions +=
      "- Composition: Avoid a default chest-up portrait. Prefer a mix of product-centric wide frames, half-body frames, seated or standing full-figure compositions, tabletop layouts, hand interactions, and close detail inserts depending on the section goal.\n";
    instructions +=
      "- Art Direction: Crisp controlled light, subtle shadows, refined color balance, and a clearly designed studio set that feels intentional rather than empty.\n";
    instructions += "- Scene Guardrail: If any lifestyle or outdoor guidance conflicts, keep the result unmistakably studio-led.\n";
  } else if (options.style === "lifestyle") {
    instructions +=
      "- Setting: Authentic, aspirational lifestyle environment with natural lighting, lived-in textures, and everyday context that feels believable.\n";
    instructions +=
      "- Composition: Use candid moments, on-location interaction, room context, hands using the product, and gentle movement. Vary distance between environmental wide shots, medium shots, and close usage details.\n";
    instructions +=
      "- Art Direction: Warm, human, relatable, and editorial, with enough context to explain why the product fits into daily life.\n";
    instructions += "- Scene Guardrail: Do not collapse the result into a blank studio set unless guide priority explicitly demands it.\n";
  } else if (options.style === "outdoor") {
    instructions +=
      "- Setting: Beautiful outdoor environment with cinematic natural lighting, location depth, airiness, and scene-based storytelling.\n";
    instructions +=
      "- Composition: Use wide scenic frames, dynamic movement, environmental close-ups, and product-in-use storytelling that feels active and open.\n";
    instructions +=
      "- Art Direction: Fresh, expansive, airy, and energetic, with the location helping explain the product mood or usage context.\n";
    instructions += "- Scene Guardrail: Keep the result clearly outdoors, not a studio imitation or an indoor lifestyle room.\n";
  }

  if (options.withModel) {
    if (options.referenceModelImageBase64) {
      instructions += "- Subject: MUST feature the exact same person shown in the attached reference model image.\n";
      instructions += "- Identity Lock: Preserve the face, hairstyle, skin tone, gender presentation, and overall appearance of that same person while adapting pose, styling, and composition to the scene.\n";
      instructions += "- Casting Rule: Never swap to another person. Never reinterpret the reference as a different male or female model.\n";
      if (options.referenceModelProfile) {
        instructions += `- Stable Traits: ${options.referenceModelProfile.keepTraits.join(", ")}.\n`;
        instructions += `- Flexible Traits: ${options.referenceModelProfile.flexibleTraits.join(", ")}.\n`;
      }
    } else {
      const modelDescriptor = buildModelDescriptor(options);
      instructions += `- Subject: MUST feature an attractive, professional model (${modelDescriptor}) posing with and interacting naturally with the product.\n`;
    }
  } else {
    instructions += "- Subject: Do NOT include any people or models. Focus entirely on the product and background.\n";
  }

  return instructions;
}

function buildImagePreferenceInstructions(section: SectionBlueprint, options?: InternalImageGenOptions) {
  if (!options) {
    return "";
  }

  const parts: string[] = [];

  if (options.style === "studio") {
    parts.push("Use a polished studio set with controlled light and flexible framing, not a fixed upper-body portrait.");
  } else if (options.style === "lifestyle") {
    parts.push("Use an authentic lifestyle setting with natural interaction and believable context.");
  } else if (options.style === "outdoor") {
    parts.push("Use an outdoor environment with scenic depth and active visual storytelling.");
  }

  if (options.withModel && options.referenceModelImageBase64) {
    parts.push("Use the attached reference model as the same person for this scene, with identity locked and no model swap.");
  } else if (options.withModel) {
    const modelDescriptor = buildModelDescriptor(options);
    parts.push(`If appropriate for the scene, feature a model (${modelDescriptor}).`);
  }

  parts.push("Keep the product central to the story and avoid collapsing the scene into a generic portrait.");
  parts.push(`Preserve the product using this guidance: ${section.reference_usage || "keep shape, material, color, and branding accurate."}`);

  return parts.length ? `Style Preferences: ${parts.join(" ")}` : "";
}

function buildModelDescriptor(options: ImageGenOptions) {
  const nationalityDescriptor = getModelCountryDescriptor(options.modelCountry);
  const ageDescriptor = getModelAgeDescriptor(options.modelAgeRange);
  const genderDescriptor = options.modelGender === "male" ? "man" : "woman";

  return `${nationalityDescriptor} ${genderDescriptor} ${ageDescriptor}`.trim();
}

function getModelCountryDescriptor(country?: ImageGenOptions["modelCountry"]) {
  if (country === "japan") {
    return "Japanese";
  }
  if (country === "usa") {
    return "American";
  }
  if (country === "france") {
    return "French";
  }
  if (country === "germany") {
    return "German";
  }
  if (country === "africa") {
    return "African";
  }

  return "Korean";
}

function getModelAgeDescriptor(ageRange?: ImageGenOptions["modelAgeRange"]) {
  if (ageRange === "teen") {
    return "in the late teens";
  }
  if (ageRange === "30s") {
    return "in the 30s";
  }
  if (ageRange === "40s") {
    return "in the 40s";
  }
  if (ageRange === "50s_plus") {
    return "in the 50s or older";
  }

  return "in the 20s";
}

function parseBlueprintResponse(response: { text?: string }) {
  try {
    const parsed = JSON.parse(extractResponseText(response)) as Partial<LandingPageBlueprint>;
    return sanitizeBlueprint(parsed);
  } catch (error) {
    throw new PdpServiceError(
      "GEMINI_RESPONSE_INVALID",
      "AI ?묐떟???댁꽍?섏? 紐삵뻽?듬땲??",
      stringifyError(error)
    );
  }
}

function sanitizeBlueprint(input: Partial<LandingPageBlueprint>) {
  const sections = Array.isArray(input.sections)
    ? input.sections.map((section, index) => normalizeSection(section, index))
    : [];

  return {
    executiveSummary: asString(input.executiveSummary),
    scorecard: Array.isArray(input.scorecard)
      ? input.scorecard.map((item) => ({
          category: asString(item?.category),
          score: asString(item?.score),
          reason: asString(item?.reason)
        }))
      : [],
    blueprintList: Array.isArray(input.blueprintList)
      ? input.blueprintList.map((item) => asString(item)).filter(Boolean)
      : sections.map((section) => section.section_name),
    sections
  } satisfies LandingPageBlueprint;
}

function normalizeSection(section: Partial<SectionBlueprint>, index: number): SectionBlueprint {
  return {
    section_id: asString(section.section_id) || `S${index + 1}`,
    section_name: asString(section.section_name) || `?뱀뀡 ${index + 1}`,
    goal: asString(section.goal),
    headline: asString(section.headline),
    headline_en: asString(section.headline_en) || asString(section.headline),
    subheadline: asString(section.subheadline),
    subheadline_en: asString(section.subheadline_en) || asString(section.subheadline),
    bullets: Array.isArray(section.bullets) ? section.bullets.map((item) => asString(item)).filter(Boolean) : [],
    bullets_en: Array.isArray(section.bullets_en)
      ? section.bullets_en.map((item) => asString(item)).filter(Boolean)
      : Array.isArray(section.bullets)
        ? section.bullets.map((item) => asString(item)).filter(Boolean)
        : [],
    trust_or_objection_line: asString(section.trust_or_objection_line),
    trust_or_objection_line_en:
      asString(section.trust_or_objection_line_en) || asString(section.trust_or_objection_line),
    CTA: asString(section.CTA),
    CTA_en: asString(section.CTA_en) || asString(section.CTA),
    layout_notes: asString(section.layout_notes),
    compliance_notes: asString(section.compliance_notes),
    image_id: asString(section.image_id) || `IMG_S${index + 1}`,
    purpose: asString(section.purpose),
    prompt_ko: asString(section.prompt_ko),
    prompt_en:
      asString(section.prompt_en) ||
      asString(section.prompt_ko) ||
      asString(section.headline_en) ||
      asString(section.headline) ||
      "Generate a premium product-centered commercial image with no text or watermark.",
    negative_prompt: asString(section.negative_prompt),
    style_guide: asString(section.style_guide),
    reference_usage: asString(section.reference_usage),
    generatedImage: section.generatedImage
  };
}

function normalizeImageOptions(options?: InternalImageGenOptions): InternalImageGenOptions {
  return {
    style: options?.style ?? "studio",
    withModel: options?.withModel ?? false,
    modelGender: options?.modelGender ?? "female",
    modelAgeRange: options?.modelAgeRange ?? "20s",
    modelCountry: options?.modelCountry ?? "korea",
    guidePriorityMode: options?.guidePriorityMode ?? "guide-first",
    headline: options?.headline,
    subheadline: options?.subheadline,
    isRegeneration: options?.isRegeneration,
    referenceModelImageBase64: options?.referenceModelImageBase64,
    referenceModelImageMimeType: options?.referenceModelImageMimeType,
    referenceModelImageFileName: options?.referenceModelImageFileName,
    referenceModelProfile: options?.referenceModelProfile ?? null,
    retryDirective: options?.retryDirective
  };
}

function buildReferenceModelProfilePrompt(profile: ReferenceModelProfile) {
  const stableTraits = uniqueStrings(profile.keepTraits).join(", ");
  const flexibleTraits = uniqueStrings(profile.flexibleTraits).join(", ");
  const distinctiveFeatures = uniqueStrings(profile.distinctiveFeatures).join(", ");

  return [
    "Reference identity profile:",
    `gender presentation ${profile.genderPresentation};`,
    `age impression ${profile.ageImpression};`,
    `face shape ${profile.faceShape};`,
    `hairstyle ${profile.hairstyle};`,
    `skin tone ${profile.skinTone};`,
    `eye details ${profile.eyeDetails};`,
    `brow details ${profile.browDetails};`,
    `lip details ${profile.lipDetails};`,
    `overall vibe ${profile.overallVibe}.`,
    stableTraits ? `Keep fixed: ${stableTraits}.` : "",
    distinctiveFeatures ? `Identifying markers: ${distinctiveFeatures}.` : "",
    flexibleTraits ? `May vary: ${flexibleTraits}.` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function buildGuidePriorityInstructions(section: SectionBlueprint, options?: InternalImageGenOptions) {
  const mode = options?.guidePriorityMode ?? "guide-first";

  if (mode === "guide-first") {
    return [
      "Design Guide Priority: ON.",
      `Image Purpose: ${section.purpose}.`,
      section.layout_notes ? `Layout Notes: ${section.layout_notes}.` : "",
      section.style_guide ? `Style Guide: ${section.style_guide}.` : "",
      "If the selected shot type and guide conflict, respect the guide first and use the shot type as a supporting constraint."
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Design Guide Priority: OFF.",
    `Image Purpose: ${section.purpose}.`,
    "Ignore Layout Notes and Style Guide whenever they conflict with the selected shot type.",
    "Use the selected shot type as the main scene-defining instruction."
  ].join(" ");
}

function getBaseSceneDirection(section: SectionBlueprint, mode: PdpGuidePriorityMode) {
  if (mode === "guide-first") {
    return [section.prompt_en, section.layout_notes, section.style_guide, section.reference_usage]
      .filter(Boolean)
      .join(" ");
  }

  return [
    `Communicate this purpose clearly: ${section.purpose}.`,
    "Build a fresh scene from the selected shot type.",
    "Do not inherit conflicting layout or style-guide assumptions from the section metadata."
  ].join(" ");
}

function buildValidationPrompt(profile: ReferenceModelProfile, expectedStyle: NonNullable<ImageGenOptions["style"]>) {
  return `
You will compare two images.
- image 1: the uploaded reference person image
- image 2: the newly generated candidate image

Judge whether image 2 preserves the same identifiable person from image 1 while allowing new pose, styling, framing, and environment.

Reference person profile:
- gender presentation: ${profile.genderPresentation}
- age impression: ${profile.ageImpression}
- face shape: ${profile.faceShape}
- hairstyle: ${profile.hairstyle}
- skin tone: ${profile.skinTone}
- eye details: ${profile.eyeDetails}
- brow details: ${profile.browDetails}
- lip details: ${profile.lipDetails}
- overall vibe: ${profile.overallVibe}
- keep traits: ${profile.keepTraits.join(", ")}
- distinctive features: ${profile.distinctiveFeatures.join(", ")}

Expected shot type: ${getStyleLabel(expectedStyle)}.

Return JSON only with:
- isSamePerson: boolean
- genderPresentationPreserved: boolean
- styleMatch: boolean
- confidence: high | medium | low
- reason: short explanation
- correctionFocus: array of short phrases explaining what must be corrected
`.trim();
}

function buildRetryDirective(
  validation: GeneratedImageValidation,
  profile: ReferenceModelProfile,
  expectedStyle: NonNullable<ImageGenOptions["style"]>
) {
  return [
    `The previous attempt did not pass identity/style validation: ${validation.reason}.`,
    `Keep the same person using these fixed traits: ${uniqueStrings(profile.keepTraits).join(", ")}.`,
    `Preserve these identifying markers: ${uniqueStrings(profile.distinctiveFeatures).join(", ")}.`,
    validation.correctionFocus.length ? `Correct these issues: ${validation.correctionFocus.join(", ")}.` : "",
    `The retried image must clearly read as a ${getStyleLabel(expectedStyle)} scene.`
  ]
    .filter(Boolean)
    .join(" ");
}

function parseReferenceModelProfileResponse(response: { text?: string }) {
  try {
    const parsed = JSON.parse(extractResponseText(response)) as Partial<ReferenceModelProfile>;

    return {
      genderPresentation: asString(parsed.genderPresentation) || "same as reference image",
      ageImpression: asString(parsed.ageImpression) || "same age impression as reference image",
      faceShape: asString(parsed.faceShape) || "same face shape as reference image",
      hairstyle: asString(parsed.hairstyle) || "same hairstyle impression as reference image",
      skinTone: asString(parsed.skinTone) || "same skin tone as reference image",
      eyeDetails: asString(parsed.eyeDetails) || "same eye shape and gaze impression",
      browDetails: asString(parsed.browDetails) || "same brow shape and thickness",
      lipDetails: asString(parsed.lipDetails) || "same lip shape and expression impression",
      overallVibe: asString(parsed.overallVibe) || "same overall vibe as the reference person",
      distinctiveFeatures: asStringArray(parsed.distinctiveFeatures),
      keepTraits: asStringArray(parsed.keepTraits),
      flexibleTraits: asStringArray(parsed.flexibleTraits)
    } satisfies ReferenceModelProfile;
  } catch (error) {
    throw new PdpServiceError(
      "GEMINI_RESPONSE_INVALID",
      "李몄“ 紐⑤뜽 ?대?吏瑜??댁꽍?섏? 紐삵뻽?듬땲??",
      stringifyError(error)
    );
  }
}

function parseGeneratedImageValidationResponse(response: { text?: string }) {
  try {
    const parsed = JSON.parse(extractResponseText(response)) as Partial<GeneratedImageValidation>;

    return {
      isSamePerson: Boolean(parsed.isSamePerson),
      genderPresentationPreserved: Boolean(parsed.genderPresentationPreserved),
      styleMatch: Boolean(parsed.styleMatch),
      confidence: parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low",
      reason: asString(parsed.reason) || "identity validation failed",
      correctionFocus: asStringArray(parsed.correctionFocus)
    } satisfies GeneratedImageValidation;
  } catch (error) {
    throw new PdpServiceError(
      "GEMINI_RESPONSE_INVALID",
      "?앹꽦???대?吏 寃利??묐떟???댁꽍?섏? 紐삵뻽?듬땲??",
      stringifyError(error)
    );
  }
}

function extractResponseText(response: { text?: string }) {
  if (!response.text) {
    throw new PdpServiceError(
      "GEMINI_RESPONSE_INVALID",
      "AI ?묐떟??鍮꾩뼱 ?덉뒿?덈떎.",
      "Gemini did not return response.text."
    );
  }

  let text = response.text.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }

  return text.trim();
}

function buildHighResolutionInlinePart(mimeType: string, data: string) {
  return {
    inlineData: {
      mimeType,
      data
    },
    mediaResolution: {
      level: "media_resolution_high"
    }
  } as any;
}

function getStyleLabel(style: NonNullable<ImageGenOptions["style"]>) {
  if (style === "lifestyle") {
    return "lifestyle shot";
  }
  if (style === "outdoor") {
    return "outdoor shot";
  }

  return "studio shot";
}

function normalizeReferenceModelImage(base64?: string, mimeType?: string) {
  if (!base64?.trim()) {
    return null;
  }

  if (!mimeType?.trim()) {
    throw new PdpServiceError(
      "INVALID_IMAGE_PAYLOAD",
      "紐⑤뜽 ?대?吏 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎.",
      "Reference model image is missing mime type."
    );
  }

  return {
    base64: sanitizeBase64Payload(base64),
    mimeType: normalizeMimeType(mimeType)
  };
}

function extractGeneratedImage(response: {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
      }>;
    };
  }>;
}) {
  const parts = response.candidates?.[0]?.content?.parts ?? [];

  for (const part of parts) {
    if (part.inlineData?.data && part.inlineData.mimeType) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType
      };
    }
  }

  return null;
}

async function retryOperation<T>(operation: () => Promise<T>, retries = 2, delay = 1500): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (retries > 0 && (isQuotaError(message) || isJsonError(message))) {
      await wait(delay);
      return retryOperation(operation, retries - 1, delay * 2);
    }

    if (error instanceof PdpServiceError) {
      throw error;
    }

    if (isQuotaError(message)) {
      throw new PdpServiceError(
        "GEMINI_QUOTA_EXCEEDED",
        "AI ?ъ슜?됱씠 珥덇낵?섏뿀?듬땲?? ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??",
        message
      );
    }

    if (isJsonError(message)) {
      throw new PdpServiceError(
        "GEMINI_RESPONSE_INVALID",
        "AI ?묐떟???댁꽍?섏? 紐삵뻽?듬땲??",
        message
      );
    }

    throw error;
  }
}

function isQuotaError(message: string) {
  const lowered = message.toLowerCase();
  return lowered.includes("429") || lowered.includes("quota") || lowered.includes("resource_exhausted");
}

function isJsonError(message: string) {
  return message.includes("JSON") || message.includes("Unexpected token") || message.includes("Unterminated string");
}

function isImageProcessingError(message: string) {
  const lowered = message.toLowerCase();
  return lowered.includes("unable to process input image") || lowered.includes("input image");
}

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

function normalizeRequestedImageModel(imageModel?: string | null): PdpImageModel {
  return SUPPORTED_IMAGE_MODELS.find((option) => option.value === imageModel)?.value ?? DEFAULT_IMAGE_MODEL;
}

function readServerGeminiApiKey() {
  return process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
}

function resolveServerProvider(): PdpRuntimeConfigResponse["provider"] {
  const useVertexAi = ["1", "true", "yes", "on"].includes((process.env.GOOGLE_GENAI_USE_VERTEXAI ?? "").trim().toLowerCase());

  if (useVertexAi) {
    return "vertex-ai";
  }

  if (readServerGeminiApiKey()) {
    return "gemini-api-key";
  }

  return "unconfigured";
}

