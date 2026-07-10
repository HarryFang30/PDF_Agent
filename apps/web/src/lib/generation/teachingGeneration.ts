import type { ModelApiConfig, ModelRef, UiPreferences } from "../../settings";
import type { PdfContextPage, PdfContextPayload } from "../pdf/textExtraction";

export type TeachingOutputLanguage = "zh-CN" | "en-US";

export type PagePack = {
  schema: string;
  document: {
    id: string;
    title: string;
    source_pdf_url: string;
    page_count: number;
  };
  pages: PageData[];
};

export type PageData = {
  page_no: number;
  source: {
    pdf_page_ref: string;
    text_md: string;
    ocr_used: boolean;
    parser: string;
    page_type?: string;
  };
  teaching: {
    output_language?: TeachingOutputLanguage;
    slide_title: string;
    speaker_notes_md: string;
    concepts: string[];
    visual_explanations: string[];
    prerequisites: string[];
    contextual_bridge?: string;
    formula_explanations?: string[];
    evidence?: Array<{
      kind: string;
      quote_or_reference: string;
    }>;
    needs_review?: boolean;
    needs_parser_fallback?: boolean;
    confidence: number;
  };
  status: string;
};

export type AsyncLimiterPriority = "now" | "next" | "later";

export type TeachingGenerationAttempt = "initial" | "retry";

export type TeachingGenerationQualityPlan = {
  providerId: string;
  model: string;
  fallbackProviderId?: string;
  fallbackModel?: string;
  reasoningEffort: UiPreferences["modelReasoningEffort"];
  attachPdf: boolean;
  batchable: boolean;
  retryOnWeakOutput: boolean;
  attempt: TeachingGenerationAttempt;
  reasons: string[];
};

export type TeachingGenerationBatch = {
  pages: PageData[];
  plan: TeachingGenerationQualityPlan;
};

export type GeneratedTeachingPageResponse = {
  page: Partial<PageData> & {
    source?: Partial<PageData["source"]>;
    teaching?: Partial<PageData["teaching"]>;
  };
  model?: string;
};

export type GeneratedTeachingPagesResponse = {
  pages: GeneratedTeachingPageResponse["page"][];
  model?: string;
};

export const TEACHING_GENERATION_CONCURRENCY = 6;
export const TEACHING_DOCUMENT_GENERATION_CONCURRENCY = 3;
const TEACHING_QUALITY_MODEL = "gpt-5.6-sol";
const TEACHING_BALANCED_MODEL = "gpt-5.6-terra";
const TEACHING_FAST_MODEL = "gpt-5.6-luna";
const LEGACY_TEACHING_BALANCED_MODEL = "gpt-5.4";
const TEACHING_TEXT_PAGE_BATCH_SIZE = 12;
const TEACHING_TEXT_COMPACT_PAGE_BATCH_SIZE = 18;
const TEACHING_TEXT_TINY_PAGE_BATCH_SIZE = 24;
const TEACHING_TEXT_FIRST_BATCH_SIZE = 3;
const TEACHING_BALANCED_PAGE_BATCH_SIZE = 2;
const TEACHING_BALANCED_TEXT_PAGE_BATCH_SIZE = 4;
export const TEACHING_BATCH_FALLBACK_CONCURRENCY = 2;
export const TEACHING_PROJECT_MODEL_REQUEST_CONCURRENCY = 6;
export const TEACHING_PROJECT_WARMUP_PAGE_COUNT = 16;
const TEACHING_CONTEXT_PAGE_CHARS = 600;
const TEACHING_FAST_CONTEXT_PAGE_CHARS = 180;
const TEACHING_FAST_SOURCE_REQUEST_CHARS = 2_500;
const TEACHING_BALANCED_SOURCE_REQUEST_CHARS = 8_000;
const TEACHING_QUALITY_SOURCE_REQUEST_CHARS = 16_000;
const TEACHING_FILE_INPUT_MIN_TEXT_CHARS = 32;
const TEACHING_TEXT_HEAVY_MIN_CHARS = 260;
const TEACHING_COMPLEX_TEXT_FAST_MIN_CHARS = 900;
const TEACHING_COMPLEX_TEXT_BALANCED_SIGNAL_COUNT = 4;
const TEACHING_VISUAL_TEXT_MAX_CHARS = 520;
const TEACHING_LOW_QUALITY_CONFIDENCE = 0.58;
const TEACHING_LOW_QUALITY_NOTE_CHARS = 180;
const TEACHING_RETRY_CONFIDENCE = 0.42;
const TEACHING_RETRY_NOTE_CHARS = 90;
export const PDF_PROJECT_TEXT_EXTRACTION_CONCURRENCY = 8;
const TEACHING_TEXT_TINY_PAGE_MAX_CHARS = 700;
const TEACHING_TEXT_COMPACT_PAGE_MAX_CHARS = 1_500;
const TEACHING_TEXT_TINY_AVG_CHARS = 520;
const TEACHING_TEXT_COMPACT_AVG_CHARS = 1_000;
const TEACHING_CONTEXT_NEIGHBOR_PAGES = 2;
const TEACHING_CONTEXT_EDGE_PAGES = 2;

const teachingReasoningRank: Record<UiPreferences["modelReasoningEffort"], number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

export function normalizeTeachingOutputLanguage(value: unknown): TeachingOutputLanguage | undefined {
  return value === "zh-CN" || value === "en-US" ? value : undefined;
}

export function resolveTeachingOutputLanguage(
  preferences: Pick<UiPreferences, "explanationLanguage" | "language">,
): TeachingOutputLanguage {
  return preferences.explanationLanguage === "zh-CN" || preferences.explanationLanguage === "en-US"
    ? preferences.explanationLanguage
    : preferences.language;
}

export function teachingOutputLanguageName(language: TeachingOutputLanguage) {
  return language === "en-US" ? "English" : "Simplified Chinese";
}

export function generationFailureMarkdown(message: string, language: TeachingOutputLanguage) {
  if (language === "en-US") {
    return `## Page notes generation failed\n\n${message}`;
  }
  return `## 本页讲解生成失败\n\n${message}`;
}

export function teachingGenerationReasoningEffort(
  preference: UiPreferences["modelReasoningEffort"],
  requested: UiPreferences["modelReasoningEffort"] = "low",
): UiPreferences["modelReasoningEffort"] {
  if (requested === "low") return preference === "none" ? "none" : "low";
  if (preference === "max") return "max";
  if (preference === "xhigh") return "xhigh";
  if (preference === "high") return "high";
  return requested;
}

export function teachingGenerationQualityPlan(
  page: PageData,
  preference: UiPreferences["modelReasoningEffort"],
  attempt: TeachingGenerationAttempt = "initial",
  modelApiConfig?: ModelApiConfig,
): TeachingGenerationQualityPlan {
  const text = pageTextForSignals(page);
  const sourceText = page.source.text_md.trim();
  const reasons: string[] = [];
  const formulaLike = pageHasFormulaSignals(text);
  const tableLike = pageHasTableSignals(text);
  const codeLike = pageHasCodeSignals(text);
  const visualLike = pageHasVisualSignals(page, text);
  const complexitySignalCount = pageComplexitySignalCount(text);
  const sparseText = sourceText.length < TEACHING_FILE_INPUT_MIN_TEXT_CHARS;
  const shortText = sourceText.length < TEACHING_TEXT_HEAVY_MIN_CHARS;
  const complexTextLike = formulaLike || tableLike || codeLike;
  const denseComplexText =
    complexTextLike &&
    (sourceText.length < TEACHING_COMPLEX_TEXT_FAST_MIN_CHARS ||
      complexitySignalCount >= TEACHING_COMPLEX_TEXT_BALANCED_SIGNAL_COUNT);
  const textGroundedFormulaPage =
    formulaLike &&
    !tableLike &&
    !codeLike &&
    !visualLike &&
    sourceText.length >= TEACHING_FILE_INPUT_MIN_TEXT_CHARS;
  const previousWeak =
    page.status === "failed" ||
    Boolean(page.teaching.needs_review) ||
    Boolean(page.teaching.needs_parser_fallback);

  let requestedReasoning: UiPreferences["modelReasoningEffort"] =
    sourceText.length <= TEACHING_TEXT_COMPACT_PAGE_MAX_CHARS ? "none" : "low";
  let attachPdf = false;
  let batchable = true;
  let retryOnWeakOutput = true;

  if (sparseText) {
    reasons.push("sparse-source-text");
    requestedReasoning = "high";
    attachPdf = true;
    batchable = false;
    retryOnWeakOutput = true;
  } else if (shortText) {
    reasons.push("short-source-text");
    if (visualLike || complexTextLike) {
      requestedReasoning = "medium";
    } else {
      reasons.push("short-text-fast-path");
    }
    batchable = true;
    retryOnWeakOutput = visualLike || complexTextLike;
  }

  if (complexTextLike) {
    if (formulaLike) reasons.push("formula");
    if (tableLike) reasons.push("table");
    if (codeLike) reasons.push("code");
    requestedReasoning = maxTeachingReasoningEffort(requestedReasoning, "medium");
    retryOnWeakOutput = true;
    if (!denseComplexText) reasons.push("light-complex-text-balanced-path");
  }

  if (textGroundedFormulaPage) {
    reasons.push("formula-text-balanced-no-pdf-retry");
    requestedReasoning = maxTeachingReasoningEffort(requestedReasoning, "medium");
    attachPdf = false;
    batchable = true;
    retryOnWeakOutput = false;
  }

  if (visualLike && sourceText.length <= TEACHING_VISUAL_TEXT_MAX_CHARS) {
    reasons.push("visual-heavy");
    requestedReasoning = maxTeachingReasoningEffort(requestedReasoning, "medium");
    attachPdf = true;
    batchable = false;
    retryOnWeakOutput = true;
  }

  if (previousWeak) {
    reasons.push("previous-weak-output");
    requestedReasoning = "high";
    attachPdf = true;
    batchable = false;
    retryOnWeakOutput = true;
  }

  if (attempt === "retry") {
    reasons.push("quality-retry");
    requestedReasoning = "high";
    attachPdf = true;
    batchable = false;
    retryOnWeakOutput = false;
  }

  if (attachPdf) batchable = false;

  if (!reasons.length) reasons.push("text-fast-path");
  const modelDefaults = teachingModelDefaults(modelApiConfig);
  const selectedRef =
    attachPdf || requestedReasoning === "high"
      ? modelDefaults.quality
      : requestedReasoning === "medium"
        ? modelDefaults.balanced
        : modelDefaults.fast;
  const fallbackRef = modelDefaults.quality;
  return {
    providerId: selectedRef.providerId,
    model: selectedRef.model,
    fallbackProviderId:
      selectedRef.providerId === fallbackRef.providerId && selectedRef.model === fallbackRef.model
        ? undefined
        : fallbackRef.providerId,
    fallbackModel: selectedRef.providerId === fallbackRef.providerId && selectedRef.model === fallbackRef.model
      ? undefined
      : fallbackRef.model,
    reasoningEffort: teachingGenerationReasoningEffort(preference, requestedReasoning),
    attachPdf,
    batchable,
    retryOnWeakOutput,
    attempt,
    reasons,
  };
}

export function teachingQualityPlanPayload(plan: TeachingGenerationQualityPlan) {
  return {
    attempt: plan.attempt,
    providerId: plan.providerId,
    model: plan.model,
    fallbackProviderId: plan.fallbackProviderId,
    fallbackModel: plan.fallbackModel,
    reasoningEffort: plan.reasoningEffort,
    attachPdf: plan.attachPdf,
    batchable: plan.batchable,
    reasons: plan.reasons,
  };
}

function teachingModelDefaults(config?: ModelApiConfig): { fast: ModelRef; balanced: ModelRef; quality: ModelRef } {
  if (!config) {
    return {
      fast: { providerId: "codex_oauth", model: TEACHING_FAST_MODEL },
      balanced: { providerId: "codex_oauth", model: TEACHING_BALANCED_MODEL },
      quality: { providerId: "codex_oauth", model: TEACHING_QUALITY_MODEL },
    };
  }
  return {
    fast: config.defaults.teachingFast,
    balanced: config.defaults.teachingBalanced,
    quality: config.defaults.teachingQuality,
  };
}

export function teachingRequestPage(page: PageData, plan: TeachingGenerationQualityPlan) {
  const sourceTextLimit = teachingSourceRequestLimitForPlan(plan);
  const source = {
    pdf_page_ref: page.source.pdf_page_ref,
    text_md: truncateGenerationRequestText(page.source.text_md, sourceTextLimit),
  };
  if (isFastTextTeachingPlan(plan)) {
    return {
      page_no: page.page_no,
      source,
    };
  }
  return {
    page_no: page.page_no,
    source: {
      ...source,
      ocr_used: page.source.ocr_used,
      parser: page.source.parser,
      page_type: page.source.page_type,
    },
    teaching: {
      output_language: page.teaching.output_language,
      slide_title: page.teaching.slide_title,
      speaker_notes_md: truncateGenerationRequestText(page.teaching.speaker_notes_md, 1200),
      confidence: page.teaching.confidence,
      needs_review: page.teaching.needs_review,
      needs_parser_fallback: page.teaching.needs_parser_fallback,
    },
    status: page.status,
  };
}

export function teachingDocumentContextForPlan(
  plan: TeachingGenerationQualityPlan,
  context: PdfContextPayload,
  fastContext: PdfContextPayload,
): PdfContextPayload | null {
  if (isFastTextTeachingPlan(plan)) return fastContext.pages.length ? fastContext : context;
  return context;
}

export function prioritizeTeachingPages(pages: PageData[], priorityPageNo: number) {
  const safePriority = Number.isFinite(priorityPageNo) ? priorityPageNo : pages[0]?.page_no || 1;
  return pages.slice().sort((left, right) => {
    const distance = Math.abs(left.page_no - safePriority) - Math.abs(right.page_no - safePriority);
    return distance || left.page_no - right.page_no;
  });
}

export function prioritizeTeachingPageNumbers(pageNumbers: number[], priorityPageNo: number) {
  const safePriority = Number.isFinite(priorityPageNo) ? priorityPageNo : pageNumbers[0] || 1;
  return [...new Set(pageNumbers)]
    .filter((pageNo) => Number.isFinite(pageNo) && pageNo >= 1)
    .sort((left, right) => {
      const distance = Math.abs(left - safePriority) - Math.abs(right - safePriority);
      return distance || left - right;
    });
}

export function teachingWarmupPageNumbers(pageCountHint: number, priorityPageNo: number, targetPageNumbers: number[] = []) {
  if (targetPageNumbers.length) {
    return prioritizeTeachingPageNumbers(targetPageNumbers, priorityPageNo).slice(0, TEACHING_PROJECT_WARMUP_PAGE_COUNT);
  }
  const pageNumbers: number[] = [];
  const addPage = (pageNo: number) => {
    if (Number.isFinite(pageNo) && pageNo >= 1) pageNumbers.push(Math.floor(pageNo));
  };
  addPage(priorityPageNo);
  for (let offset = 1; offset < TEACHING_PROJECT_WARMUP_PAGE_COUNT; offset += 1) {
    addPage(priorityPageNo + offset);
    addPage(priorityPageNo - offset);
  }
  const fallbackTotal = Math.max(pageCountHint || 0, TEACHING_PROJECT_WARMUP_PAGE_COUNT);
  for (let pageNo = 1; pageNo <= fallbackTotal && pageNumbers.length < TEACHING_PROJECT_WARMUP_PAGE_COUNT * 2; pageNo += 1) {
    addPage(pageNo);
  }
  return prioritizeTeachingPageNumbers(pageNumbers, priorityPageNo).slice(0, TEACHING_PROJECT_WARMUP_PAGE_COUNT);
}

export function teachingModelRequestPriority(
  pages: PageData[],
  priorityPageNo: number,
  priority: AsyncLimiterPriority,
  fallback: AsyncLimiterPriority,
) {
  return pages.some((page) => page.page_no === priorityPageNo) ? priority : fallback;
}

export function generatedTeachingNeedsRetry(page: PageData) {
  const notes = page.teaching.speaker_notes_md.trim();
  return (
    page.status === "failed" ||
    Boolean(page.teaching.needs_parser_fallback) ||
    (Boolean(page.teaching.needs_review) && page.teaching.confidence < TEACHING_LOW_QUALITY_CONFIDENCE) ||
    page.teaching.confidence < TEACHING_RETRY_CONFIDENCE ||
    notes.length < TEACHING_RETRY_NOTE_CHARS
  );
}

export function shouldPreferTeachingCandidate(candidate: PageData, current: PageData) {
  if (generatedTeachingLooksWeak(current) && !generatedTeachingLooksWeak(candidate)) return true;
  return teachingPageQualityScore(candidate) >= teachingPageQualityScore(current) + 25;
}

export function clampPreferenceNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

export function teachingExtractionPageNumbers(pageCount: number, targetPageNumbers: number[]) {
  return [...new Set([...targetPageNumbers, ...teachingContextPageNumbers(pageCount)])]
    .filter((pageNo) => Number.isFinite(pageNo) && pageNo >= 1 && pageNo <= pageCount)
    .sort((left, right) => left - right);
}

export function fullPdfContextForTeachingGeneration(
  pack: PagePack,
  pageCount: number,
  extractedPages: PdfContextPage[],
  targetPageNumbers: number[] = [],
): PdfContextPayload {
  const extractedTextByPage = new Map(extractedPages.map((page) => [page.page_no, page.text_md]));
  const packPagesByNumber = new Map(pack.pages.map((page) => [page.page_no, page]));

  const sortedPageNumbers = teachingContextPageNumbers(pageCount, targetPageNumbers);
  const pages = sortedPageNumbers.map((pageNo) => {
    const packPage = packPagesByNumber.get(pageNo);
    return {
      page_no: pageNo,
      title: packPage?.teaching.slide_title || `PDF p.${pageNo}`,
      text_md: compactTeachingContextText(extractedTextByPage.get(pageNo) || packPage?.source.text_md || ""),
    };
  });
  const truncated = pages.length < pageCount;
  return {
    documentId: pack.document.id,
    documentTitle: pack.document.title,
    pageCount,
    truncated,
    truncationPolicy: truncated ? "target-neighbor-edge" : "all-pages",
    fullPageLimit: pages.length,
    edgePageCount: TEACHING_CONTEXT_EDGE_PAGES,
    includedPageNumbers: sortedPageNumbers,
    pages,
  };
}

export function lightPdfContextForFastTeachingGeneration(
  pack: PagePack,
  pageCount: number,
  extractedPages: PdfContextPage[],
): PdfContextPayload {
  const extractedTextByPage = new Map(extractedPages.map((page) => [page.page_no, page.text_md]));
  const packPagesByNumber = new Map(pack.pages.map((page) => [page.page_no, page]));
  const extractedPageCount = extractedPages.reduce((maxPage, page) => Math.max(maxPage, page.page_no), 0);
  const safePageCount = Math.max(pageCount, pack.pages.length, extractedPageCount, 1);
  const includedPageNumbers = Array.from({ length: safePageCount }, (_, index) => index + 1);
  const pages = includedPageNumbers.map((pageNo) => {
    const packPage = packPagesByNumber.get(pageNo);
    const title = packPage?.teaching.slide_title || `PDF p.${pageNo}`;
    const text = extractedTextByPage.get(pageNo) || packPage?.source.text_md || title;
    return {
      page_no: pageNo,
      title,
      text_md: compactFastTeachingContextText(text),
    };
  });
  return {
    documentId: pack.document.id,
    documentTitle: pack.document.title,
    pageCount: safePageCount,
    truncated: false,
    truncationPolicy: "all-pages",
    fullPageLimit: safePageCount,
    edgePageCount: 0,
    includedPageNumbers,
    pages,
  };
}

export function batchTeachingPages(
  pages: PageData[],
  preference: UiPreferences["modelReasoningEffort"],
  modelApiConfig?: ModelApiConfig,
) {
  const batches: TeachingGenerationBatch[] = [];
  let currentBatch: PageData[] = [];
  let currentPlan: TeachingGenerationQualityPlan | null = null;
  let emittedFastWarmupBatch = false;

  const flushCurrentBatch = () => {
    if (!currentBatch.length) return;
    const plan = currentPlan || teachingGenerationQualityPlan(currentBatch[0], preference, "initial", modelApiConfig);
    if (!emittedFastWarmupBatch && isFastTextTeachingPlan(plan) && currentBatch.length > TEACHING_TEXT_FIRST_BATCH_SIZE) {
      batches.push({ pages: currentBatch.slice(0, TEACHING_TEXT_FIRST_BATCH_SIZE), plan });
      batches.push({ pages: currentBatch.slice(TEACHING_TEXT_FIRST_BATCH_SIZE), plan });
      emittedFastWarmupBatch = true;
    } else {
      batches.push({ pages: currentBatch, plan });
    }
    currentBatch = [];
    currentPlan = null;
  };

  for (const page of pages) {
    const plan = teachingGenerationQualityPlan(page, preference, "initial", modelApiConfig);
    if (!plan.batchable) {
      flushCurrentBatch();
      batches.push({ pages: [page], plan });
      continue;
    }

    if (currentPlan && !teachingPlansCanShareBatch(currentPlan, plan)) {
      flushCurrentBatch();
    }
    currentPlan ??= plan;
    if (currentBatch.length) {
      const candidateBatch = [...currentBatch, page];
      if (candidateBatch.length > teachingBatchSizeForPlan(currentPlan, candidateBatch)) {
        flushCurrentBatch();
        currentPlan = plan;
      }
    }
    currentPlan ??= plan;
    currentBatch.push(page);
    if (currentBatch.length >= teachingBatchSizeForPlan(currentPlan, currentBatch)) flushCurrentBatch();
  }

  flushCurrentBatch();
  return batches;
}

function maxTeachingReasoningEffort(
  left: UiPreferences["modelReasoningEffort"],
  right: UiPreferences["modelReasoningEffort"],
): UiPreferences["modelReasoningEffort"] {
  return teachingReasoningRank[right] > teachingReasoningRank[left] ? right : left;
}

function pageTextForSignals(page: PageData) {
  return `${page.source.text_md || ""}\n${page.teaching.slide_title || ""}`.trim();
}

function pageHasFormulaSignals(text: string) {
  return /\\(?:frac|sum|int|begin|end|cdots|rightarrow|operatorname|sqrt|leq|geq|alpha|beta|gamma|delta)|\$\$?[^$]+\$\$?|[∑∫√∞≈≤≥→↔]|(?:^|\s)[A-Za-z][\w]*\s*\([^)]*\)\s*=/m.test(text);
}

function pageHasTableSignals(text: string) {
  return /\|.+\|/.test(text) || /\b(?:truth table|state table|table|row|column|matrix)\b/i.test(text) || /(?:真值表|状态表|表格|矩阵)/.test(text);
}

function pageHasCodeSignals(text: string) {
  return /\b(?:module|endmodule|always|assign|wire|reg|logic|input|output|verilog|hdl|xor|nand|flip-flop)\b/i.test(text);
}

function countRegexMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern)).length;
}

function pageComplexitySignalCount(text: string) {
  return (
    countRegexMatches(text, /\\(?:frac|sum|int|begin|end|cdots|rightarrow|operatorname|sqrt|leq|geq|alpha|beta|gamma|delta)|[∑∫√∞≈≤≥→↔]/g) +
    countRegexMatches(text, /\$\$?[^$]+\$\$?/g) +
    countRegexMatches(text, /\|.+\|/g) +
    countRegexMatches(text, /\b(?:module|endmodule|always|assign|wire|reg|logic|input|output|verilog|hdl|xor|nand|flip-flop)\b/gi)
  );
}

function pageHasVisualSignals(page: PageData, text: string) {
  const pageType = page.source.page_type || "";
  return (
    /^(figure|table|formula|exercise)$/i.test(pageType) ||
    /\b(?:figure|diagram|chart|plot|graph|waveform|circuit|state diagram|block diagram|timing|layout)\b/i.test(text) ||
    /(?:图|示意|电路图|波形|时序|框图|状态图|流程图)/.test(text)
  );
}

function teachingBatchSizeForPlan(plan: TeachingGenerationQualityPlan, pages: PageData[] = []) {
  if (plan.attachPdf) return 1;
  if (isFastTextTeachingPlan(plan)) {
    if (!pages.length) return TEACHING_TEXT_PAGE_BATCH_SIZE;
    const sourceLengths = pages.map((page) => page.source.text_md.trim().length);
    const maxChars = Math.max(...sourceLengths);
    const avgChars = sourceLengths.reduce((sum, length) => sum + length, 0) / sourceLengths.length;
    if (maxChars <= TEACHING_TEXT_TINY_PAGE_MAX_CHARS && avgChars <= TEACHING_TEXT_TINY_AVG_CHARS) {
      return TEACHING_TEXT_TINY_PAGE_BATCH_SIZE;
    }
    if (maxChars <= TEACHING_TEXT_COMPACT_PAGE_MAX_CHARS && avgChars <= TEACHING_TEXT_COMPACT_AVG_CHARS) {
      return TEACHING_TEXT_COMPACT_PAGE_BATCH_SIZE;
    }
    return TEACHING_TEXT_PAGE_BATCH_SIZE;
  }
  if (!plan.attachPdf && isBalancedTeachingModel(plan.model)) return TEACHING_BALANCED_TEXT_PAGE_BATCH_SIZE;
  return TEACHING_BALANCED_PAGE_BATCH_SIZE;
}

function isFastTextTeachingPlan(plan: TeachingGenerationQualityPlan) {
  return isFastTeachingModel(plan.model) && (plan.reasoningEffort === "none" || plan.reasoningEffort === "low") && !plan.attachPdf;
}

function teachingSourceRequestLimitForPlan(plan: TeachingGenerationQualityPlan) {
  if (plan.attachPdf || plan.reasoningEffort === "high" || plan.reasoningEffort === "xhigh" || plan.reasoningEffort === "max") {
    return TEACHING_QUALITY_SOURCE_REQUEST_CHARS;
  }
  if (isFastTeachingModel(plan.model) && (plan.reasoningEffort === "none" || plan.reasoningEffort === "low")) {
    return TEACHING_FAST_SOURCE_REQUEST_CHARS;
  }
  return TEACHING_BALANCED_SOURCE_REQUEST_CHARS;
}

function isFastTeachingModel(model: string) {
  return model === TEACHING_FAST_MODEL || model.toLowerCase().includes("mini");
}

function isBalancedTeachingModel(model: string) {
  return model === TEACHING_BALANCED_MODEL || model === LEGACY_TEACHING_BALANCED_MODEL;
}

function truncateGenerationRequestText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}…` : value;
}

function teachingPlansCanShareBatch(left: TeachingGenerationQualityPlan, right: TeachingGenerationQualityPlan) {
  return (
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort &&
    left.attachPdf === right.attachPdf &&
    left.batchable === right.batchable &&
    left.attempt === right.attempt
  );
}

function generatedTeachingLooksWeak(page: PageData) {
  const notes = page.teaching.speaker_notes_md.trim();
  return (
    page.status === "failed" ||
    Boolean(page.teaching.needs_review) ||
    Boolean(page.teaching.needs_parser_fallback) ||
    page.teaching.confidence < TEACHING_LOW_QUALITY_CONFIDENCE ||
    notes.length < TEACHING_LOW_QUALITY_NOTE_CHARS
  );
}

function teachingPageQualityScore(page: PageData) {
  const notes = page.teaching.speaker_notes_md.trim();
  let score = page.teaching.confidence * 1000 + Math.min(notes.length, 4000) / 10;
  if (page.status === "failed") score -= 1000;
  if (page.teaching.needs_review) score -= 250;
  if (page.teaching.needs_parser_fallback) score -= 350;
  return score;
}

function compactTeachingContextText(text: string) {
  return truncatePromptContext(text, TEACHING_CONTEXT_PAGE_CHARS);
}

function compactFastTeachingContextText(text: string) {
  return truncatePromptContext(text, TEACHING_FAST_CONTEXT_PAGE_CHARS);
}

function teachingContextPageNumbers(pageCount: number, targetPageNumbers: number[] = []) {
  const includedPageNumbers = new Set<number>();
  const addPage = (pageNo: number) => {
    if (Number.isFinite(pageNo) && pageNo >= 1 && pageNo <= pageCount) includedPageNumbers.add(Math.floor(pageNo));
  };
  for (let pageNo = 1; pageNo <= Math.min(pageCount, TEACHING_CONTEXT_EDGE_PAGES); pageNo += 1) addPage(pageNo);
  for (let pageNo = Math.max(1, pageCount - TEACHING_CONTEXT_EDGE_PAGES + 1); pageNo <= pageCount; pageNo += 1) addPage(pageNo);
  for (const targetPageNo of targetPageNumbers) {
    for (
      let pageNo = targetPageNo - TEACHING_CONTEXT_NEIGHBOR_PAGES;
      pageNo <= targetPageNo + TEACHING_CONTEXT_NEIGHBOR_PAGES;
      pageNo += 1
    ) {
      addPage(pageNo);
    }
  }
  if (!includedPageNumbers.size) {
    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) addPage(pageNo);
  }
  return [...includedPageNumbers].sort((left, right) => left - right);
}

function truncatePromptContext(text: string, max = 6000) {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[Truncated to keep the selected prompt concise.]`;
}
