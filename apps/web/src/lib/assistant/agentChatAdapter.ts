import type { AppCopy } from "../../i18n";
import type { ModelRef, UiPreferences } from "../../settings";
import type { SelectedContext } from "../../hooks/usePageSelection";
import { requestJson } from "../http/requestJson";
import type { PdfDirectFileInput } from "../pdf/directFile";
import type { PdfContextPayload } from "../pdf/textExtraction";
import type { ChatMessageStatus } from "../persistence";
import { streamAssistantText } from "./streaming";

export type ThreadAssistantMessagePart = { type: "text"; text: string };

export type ChatModelMessage = {
  id?: string;
  role: string;
  content?: unknown[];
  createdAt?: Date;
};

export type ChatModelRunOptions = {
  messages: ChatModelMessage[];
  unstable_assistantMessageId?: string;
  abortSignal: AbortSignal;
};

export type ChatModelAdapter = {
  run(options: ChatModelRunOptions): AsyncGenerator<{
    content: ThreadAssistantMessagePart[];
    status: unknown;
  }>;
};

export type AgentContextItem = {
  id: string;
  type: "page" | "selection" | "formula" | "pdf_reference";
  title: string;
  source: string;
  page_no: number;
  text: string;
};

export type AgentAttachment = {
  id: string;
  type: "image";
  name: string;
  mime: string;
  size: number;
  data_url: string;
};

export type AgentSnapshot = {
  contexts: AgentContextItem[];
  attachments: AgentAttachment[];
  selectedContext: SelectedContext | null;
  pdfContext: PdfContextPayload | null;
  answerMode: UiPreferences["agentAnswerMode"];
  reasoningEffort: UiPreferences["modelReasoningEffort"];
  assistantModel: ModelRef;
};

export type ChatPersistInput = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: ChatMessageStatus;
  createdAt?: number;
  selectedContext?: Record<string, unknown> | null;
  sourceRefs?: Record<string, unknown>[];
};

type AgentPagePack = {
  document: {
    id: string;
    title: string;
    source_pdf_url: string;
    page_count: number;
  };
};

type AgentPageData = {
  page_no: number;
  [key: string]: unknown;
};

type ChallengeRequest = {
  kind: "quiz" | "problem";
  mode: string;
  count: number;
};

const CHALLENGE_MODEL: ModelRef = { providerId: "codex_oauth", model: "gpt-5.6-sol" };
const CHALLENGE_REASONING_EFFORT: UiPreferences["modelReasoningEffort"] = "xhigh";
const DEFAULT_CHALLENGE_COUNT = 1;
const MAX_CHALLENGE_COUNT = 10;

export function createPdfAgentAdapter(args: {
  getSnapshot: () => AgentSnapshot;
  getDocumentFile?: () => Promise<PdfDirectFileInput | null>;
  getPack: () => AgentPagePack;
  getPage: () => AgentPageData;
  copy: AppCopy;
  createId: (prefix: string) => string;
  isBackendOffline: () => boolean;
  clearSelectedContext: () => void;
  persistChatMessage?: (input: ChatPersistInput) => Promise<void>;
}): ChatModelAdapter {
  return {
    async *run(options: ChatModelRunOptions) {
      const snapshot = args.getSnapshot();
      const pack = args.getPack();
      const page = args.getPage();
      const selectedAgentContext = snapshot.selectedContext
        ? selectedContextToAgentContext(snapshot.selectedContext, args.copy)
        : null;
      const selectedPdfSourceContext = snapshot.selectedContext
        ? selectedContextPdfSourceContext(snapshot.selectedContext, args.copy)
        : null;
      const documentFile = await args.getDocumentFile?.().catch(() => null) || null;
      const latestUser = [...options.messages].reverse().find((message) => message.role === "user");
      const latestUserText = latestUser ? messageText(latestUser) : "";
      const challengeRequest = parseChallengeRequest(latestUserText, args.copy);
      const promptInput = buildAgentRequestPrompt({
        question: latestUserText,
        challengeRequest,
        selectedContext: snapshot.selectedContext,
        pdfContext: snapshot.pdfContext,
        pack,
        page,
        copy: args.copy,
      });
      const requestModel = challengeRequest ? CHALLENGE_MODEL : snapshot.assistantModel;
      const requestReasoningEffort = challengeRequest ? CHALLENGE_REASONING_EFFORT : snapshot.reasoningEffort;
      const latestUserMeta = latestUser as { id?: string; createdAt?: Date };
      const assistantMessageId = options.unstable_assistantMessageId || args.createId("assistant");
      const selectedContextRecord = snapshot.selectedContext ? asPersistedRecord(selectedContextPayload(snapshot.selectedContext)) : null;
      const sourceRefs = [
        ...(selectedAgentContext ? [asPersistedRecord(selectedAgentContext)] : []),
        ...(selectedPdfSourceContext ? [asPersistedRecord(selectedPdfSourceContext)] : []),
        ...snapshot.contexts.map((context) => asPersistedRecord(context)),
      ];
      let persistQueue = Promise.resolve();
      let lastPartialSaveAt = 0;
      const enqueuePersist = (input: ChatPersistInput) => {
        persistQueue = persistQueue
          .then(() => args.persistChatMessage?.(input))
          .catch(() => undefined);
        return persistQueue;
      };
      if (latestUserText) {
        await enqueuePersist({
          id: latestUserMeta.id || args.createId("user"),
          role: "user",
          content: latestUserText,
          status: "completed",
          createdAt: latestUserMeta.createdAt?.getTime?.() || Date.now(),
          selectedContext: selectedContextRecord,
          sourceRefs,
        });
      }
      await enqueuePersist({
        id: assistantMessageId,
        role: "assistant",
        content: "",
        status: "pending",
        selectedContext: selectedContextRecord,
        sourceRefs,
      });
      const persistPartial = (content: string, status: ChatMessageStatus, force = false) => {
        const now = Date.now();
        if (!force && now - lastPartialSaveAt < 420) return;
        lastPartialSaveAt = now;
        void enqueuePersist({
          id: assistantMessageId,
          role: "assistant",
          content,
          status,
          selectedContext: selectedContextRecord,
          sourceRefs,
        });
      };

      const parts = [
        promptInput ? { type: "text", text: promptInput } : null,
        selectedAgentContext
          ? {
              type: "quote",
              title: selectedAgentContext.title,
              text: selectedAgentContext.text,
              source: {
                kind: selectedAgentContext.source,
                page_no: selectedAgentContext.page_no,
                document_id: pack.document.id,
                source_type: snapshot.selectedContext?.sourceType,
                pdf_source: snapshot.selectedContext?.pdfSource || null,
              },
            }
          : null,
        selectedPdfSourceContext
          ? {
              type: "pdf_reference",
              title: selectedPdfSourceContext.title,
              text: selectedPdfSourceContext.text,
              source: {
                kind: selectedPdfSourceContext.source,
                page_no: selectedPdfSourceContext.page_no,
                document_id: pack.document.id,
                source_type: "pdf-page",
                relation: "corresponding_pdf_source_for_selected_explanation",
              },
            }
          : null,
        ...snapshot.contexts.map((context) => ({
          type: context.type === "formula" ? "quote" : "pdf_reference",
          title: context.title,
          text: context.text,
          source: {
            kind: context.source,
            page_no: context.page_no,
            document_id: pack.document.id,
          },
        })),
        ...snapshot.attachments.map((attachment) => ({
          type: "file",
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          data_url: attachment.data_url,
        })),
      ].filter(Boolean);

      const payload = {
        modelProviderId: requestModel.providerId,
        model: requestModel.model,
        answerMode: snapshot.answerMode,
        reasoningEffort: requestReasoningEffort,
        document: pack.document,
        documentFile,
        page,
        messages: options.messages.map((message) => ({
          role: message.role,
          status: "success",
          content: messageText(message),
          parts: [{ type: "text", text: messageText(message) }],
        })),
        input: promptInput,
        parts,
        attachments: snapshot.attachments,
        context: [
          ...(selectedAgentContext ? [selectedAgentContext] : []),
          ...(selectedPdfSourceContext ? [selectedPdfSourceContext] : []),
          ...snapshot.contexts,
        ],
        selectedContext: snapshot.selectedContext ? selectedContextPayload(snapshot.selectedContext) : null,
        pdfContext: snapshot.pdfContext,
      };

      try {
        const response = await requestJson<{ message?: { content?: string }; content?: string }>(
          "/api/agent/chat",
          {
            method: "POST",
            body: JSON.stringify(payload),
            signal: options.abortSignal,
          },
          args.copy.errors.accountNotFound,
        );
        const content = response.message?.content || response.content;
        if (!content) throw new Error(args.copy.errors.emptyGatewayResult);
        for await (const partial of streamAssistantText(content, options.abortSignal, args.copy.errors.generationStopped)) {
          persistPartial(partial, "streaming");
          yield {
            content: [{ type: "text", text: partial }] satisfies ThreadAssistantMessagePart[],
            status: { type: "running" },
          };
        }
        persistPartial(content, "completed", true);
        await persistQueue;
        yield {
          content: [{ type: "text", text: content }] satisfies ThreadAssistantMessagePart[],
          status: { type: "complete", reason: "stop" },
        };
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          persistPartial("", "stopped", true);
          await persistQueue;
          throw error;
        }
        if (!args.isBackendOffline()) {
          const failureText = agentFailureText(error, args.copy);
          persistPartial(failureText, "failed", true);
          await persistQueue;
          yield {
            content: [{ type: "text", text: failureText }] satisfies ThreadAssistantMessagePart[],
            status: { type: "running" },
          };
          throw new Error(failureText);
        }
        try {
          const local = [
            args.copy.agent.localPreviewIntro,
            selectedAgentContext ? args.copy.agent.localPreviewSelected(selectedAgentContext.title) : "",
            snapshot.contexts.length ? args.copy.agent.localPreviewContexts(snapshot.contexts.length) : args.copy.agent.localPreviewPage(page.page_no),
            snapshot.attachments.length ? args.copy.agent.localPreviewImages(snapshot.attachments.length) : "",
            latestUserText ? args.copy.agent.localPreviewQuestion(latestUserText) : "",
          ]
            .filter(Boolean)
            .join("\n\n");
          for await (const partial of streamAssistantText(local, options.abortSignal, args.copy.errors.generationStopped)) {
            persistPartial(partial, "streaming");
            yield {
              content: [{ type: "text", text: partial }] satisfies ThreadAssistantMessagePart[],
              status: { type: "running" },
            };
          }
          persistPartial(local, "completed", true);
          await persistQueue;
          yield {
            content: [{ type: "text", text: local }] satisfies ThreadAssistantMessagePart[],
            status: { type: "complete", reason: "stop" },
          };
        } catch (localError) {
          persistPartial((localError as Error).name === "AbortError" ? "" : (localError as Error).message, (localError as Error).name === "AbortError" ? "stopped" : "failed", true);
          await persistQueue;
          throw localError;
        }
      } finally {
        args.clearSelectedContext();
      }
    },
  };
}

export function selectedContextPayload(context: SelectedContext) {
  return {
    id: context.id,
    text: context.text,
    sourceType: context.sourceType,
    documentTitle: context.documentTitle,
    pageNumber: context.pageNumber,
    pdfPageNumber: context.pdfPageNumber,
    generatedPageNumber: context.generatedPageNumber,
    sectionTitle: context.sectionTitle,
    messageId: context.messageId,
    rect: context.rect,
    selectionRects: context.selectionRects,
    viewportScale: context.viewportScale,
    viewportRotation: context.viewportRotation,
    pdfSource: context.pdfSource,
  };
}

function selectedContextToAgentContext(context: SelectedContext, copy: AppCopy): AgentContextItem {
  const pageNo = context.pdfPageNumber || context.generatedPageNumber || context.pageNumber || 1;
  return {
    id: context.id,
    type: detectContextType(context.text),
    title: selectedContextSourceLabel(context, copy),
    source: context.sectionTitle || selectedContextSourceLabel(context, copy),
    page_no: pageNo,
    text: context.text,
  };
}

function selectedContextPdfSourceContext(context: SelectedContext, copy: AppCopy): AgentContextItem | null {
  const pdfSource = context.pdfSource;
  if (!pdfSource?.pageNumber || !pdfSource.text?.trim()) return null;
  return {
    id: `${context.id}:pdf-source`,
    type: "pdf_reference",
    title: copy.common.sourcePdfPage(pdfSource.pageNumber),
    source: pdfSource.title || pdfSource.ref || copy.common.sourcePdfPage(pdfSource.pageNumber),
    page_no: pdfSource.pageNumber,
    text: pdfSource.text,
  };
}

function selectedContextSourceLabel(context: SelectedContext, copy: AppCopy) {
  if (context.sourceType === "pdf-page") return copy.agent.selectedPdfPage(context.pdfPageNumber || context.pageNumber || "?");
  if (context.sourceType === "generated-explanation") return copy.agent.selectedNotesPage(context.generatedPageNumber || context.pageNumber || "?");
  if (context.sourceType === "assistant-message") return copy.agent.assistantMessage;
  if (context.sourceType === "page") return copy.agent.pageSource(context.pageNumber || "?");
  return copy.common.selectedContent;
}

function buildAgentRequestPrompt({
  question,
  challengeRequest,
  selectedContext,
  pdfContext,
  pack,
  page,
  copy,
}: {
  question: string;
  challengeRequest: ChallengeRequest | null;
  selectedContext: SelectedContext | null;
  pdfContext: PdfContextPayload | null;
  pack: AgentPagePack;
  page: AgentPageData;
  copy: AppCopy;
}) {
  if (challengeRequest) {
    return challengeRequest.kind === "problem"
      ? buildChallengeProblemPrompt({
          mode: challengeRequest.mode,
          pack,
          page,
          pdfContext,
        })
      : buildChallengeCoachPrompt({
          mode: challengeRequest.mode,
          count: challengeRequest.count,
          pack,
          page,
          pdfContext,
        });
  }
  return buildSelectedQuestionPrompt(question, selectedContext, pdfContext, copy);
}

const CHALLENGE_COACH_PROMPT = `你是我的理工科 PPT 挑战教练。当前页是我手动选择触发 challenge 的页面，因此你应当默认这页很重要，不需要判断是否出题。

你的目标不是讲课，也不是机械刷题，而是基于当前 PPT 页生成一个高质量问题，用最少的问题暴露最大的理解漏洞。

你会收到：
- 课程名称
- 当前 PPT 页内容
- 当前页图示/公式/例题描述
- AI 对当前页的讲解
- 前后页摘要
- 我的历史薄弱点
- 当前挑战模式

你需要先判断当前页的知识类型：
1. concept：概念/定义页
2. formula：公式/定理/结论页
3. derivation：推导页
4. method：方法/套路页
5. example：例题页
6. diagram：图示/结构/流程页
7. mixed：混合页

然后选择最适合的 challenge 类型：
- 概念页：优先出辨析题，检查概念边界。
- 公式页：优先出适用条件题或误用反例题。
- 推导页：优先问“哪一步用了什么假设”。
- 方法页：优先问“考场第一步怎么想”。
- 例题页：优先出同类题型入口题或轻量变式题。
- 图示页：优先问图中关系、方向、因果、状态变化或结构作用。
- 混合页：选择最能暴露理解漏洞的问题。

出题原则：
1. 按“当前挑战数量”生成题目；每一道题只检查一个关键理解漏洞。
2. 每题可以准备 1 个追问，但不要一开始展示。
3. 多题时不要重复同一种问法，应尽量覆盖不同漏洞。
4. 不要问“请解释一下本页内容”这种泛问题。
5. 不要考纯记忆，除非这是必要前置。
6. 问题必须具体、短、有诊断力。
7. 问题应该能区分：
   - 看懂讲解；
   - 能独立说清；
   - 知道适用条件；
   - 能用于题目；
   - 能处理变式。
8. 如果本页有公式，必须检查适用条件或误用场景。
9. 如果本页有例题，必须检查题型入口或第一步切入。
10. 如果本页和我的历史薄弱点有关，要优先针对薄弱点出题。
11. 不要直接给答案。

你必须输出一个可交互选择题题集的严格 JSON，不要输出 Markdown，不要包裹代码块，不要输出 schema 之外的解释。
JSON schema:
{
  "type": "synchropage.challenge_quiz.v1",
  "title": "short quiz title",
  "question_count": 3,
  "questions": [
    {
      "knowledge_type": "concept|formula|derivation|method|example|diagram|mixed",
      "challenge_type": "short challenge type label",
      "question": "one concrete diagnostic question",
      "options": [
        {"id": "A", "text": "option text"},
        {"id": "B", "text": "option text"},
        {"id": "C", "text": "option text"},
        {"id": "D", "text": "option text"}
      ],
      "correct_option_id": "A|B|C|D",
      "feedback": {
        "correct": "short feedback shown after a correct click",
        "incorrect": "short feedback shown after a wrong click"
      },
      "explanation": "concise explanation shown only after selection",
      "follow_up": "optional hidden follow-up question shown only after selection"
    }
  ]
}

选项要求：
- questions 数组长度必须严格等于“当前挑战数量”。
- 不要输出旧的顶层 question/options 单题格式；所有题必须放进 questions 数组。
- 必须提供 4 个选项，id 必须是 A、B、C、D。
- 只有 1 个正确选项。
- 错误选项必须是有诊断价值的常见误解，不要写明显荒谬的选项。
- correct_option_id 必须和 options 中的 id 完全一致。
- explanation 不要太长，优先说明为什么正确选项成立以及错误选项暴露什么误区。
- JSON 字符串里的 LaTeX 反斜杠必须双重转义，例如写作 "\\vec{E}"、"\\int_A^B"、"\\frac{a}{b}"。`;

const CHALLENGE_PROBLEM_PROMPT = `你是我的理工科 PPT 典型大题挑战教练。当前页是我手动选择触发 challenge 的页面，因此你应当默认这页很重要，但你必须先判断它是否适合生成“典型大题”。

你的目标不是讲课，也不是直接给答案，而是判断当前页是否对应常见考试/作业中的大题入口，并在适合时生成 1 道高质量典型大题 challenge。

典型大题的判定标准：
- 当前页有公式、定理、推导、方法、例题、图示关系、工程流程或可组合的多步知识点。
- 能形成 2-4 个有递进关系的分问。
- 解题需要选择入口、列条件、套用适用条件、完成推导/计算/解释，而不是单句概念回忆。
- 如果本页只是目录、过渡页、纯背景页、零散术语页，或信息不足以支撑大题，不要硬编。

你需要先判断当前页的知识类型：
1. concept：概念/定义页
2. formula：公式/定理/结论页
3. derivation：推导页
4. method：方法/套路页
5. example：例题页
6. diagram：图示/结构/流程页
7. mixed：混合页

出题原则：
1. 默认只生成 1 道典型大题。
2. 大题必须有具体题干和 2-4 个分问。
3. 不要一开始展示完整答案。
4. 可以给第一步入口提示，但不能把完整解法写进题干。
5. 如果有公式，必须在题目或检查点中涉及适用条件或误用场景。
6. 如果有例题，必须检查题型入口、第一步切入或轻量变式。
7. 如果本页和我的历史薄弱点有关，要优先针对薄弱点设计大题。
8. 如果不适合典型大题，has_typical_problem 必须为 false，并给一个短的替代挑战题干；不要伪装成典型大题。

你必须输出严格 JSON，不要输出 Markdown，不要包裹代码块，不要输出 schema 之外的解释。
JSON schema:
{
  "type": "synchropage.challenge_problem.v1",
  "title": "short problem title",
  "knowledge_type": "concept|formula|derivation|method|example|diagram|mixed",
  "challenge_type": "典型大题|大题入口|综合应用|推导证明|计算题|图示分析",
  "suitability": {
    "has_typical_problem": true,
    "reason": "short reason for the suitability judgement",
    "problem_type": "calculation|proof|derivation|application|diagram analysis|mixed"
  },
  "problem": {
    "stem": "complete problem stem shown before any hint",
    "given": ["known condition or definition"],
    "tasks": ["subquestion 1", "subquestion 2"],
    "expected_entry": "what the student should think/do first, without full solution",
    "difficulty": "medium|hard",
    "time_minutes": 8,
    "rubric": ["self-check point, not full answer"]
  },
  "coach": {
    "first_hint": "one short first-step hint",
    "common_traps": ["common misconception or trap"],
    "after_attempt_check": "short guidance for checking an attempted solution"
  }
}

如果 has_typical_problem 为 false：
- problem.stem 应该是一个“替代挑战”，用于暴露本页理解漏洞。
- problem.tasks 可以只有 1-2 个分问。
- reason 必须说明为什么不适合硬出典型大题。

输出要求：
- JSON 字符串里的 LaTeX 反斜杠必须双重转义，例如写作 "\\vec{E}"、"\\int_A^B"、"\\frac{a}{b}"。
- 不要在 stem、expected_entry、first_hint 中直接泄露完整答案。
- rubric 是自查采分点，不是完整标准答案。`;

function buildChallengeCoachPrompt({
  mode,
  count,
  pack,
  page,
  pdfContext,
}: {
  mode: string;
  count: number;
  pack: AgentPagePack;
  page: AgentPageData;
  pdfContext: PdfContextPayload | null;
}) {
  const teaching = objectValue(page.teaching);
  const source = objectValue(page.source);
  const pageNo = numberValue(page.page_no);
  const title = stringValue(teaching.slide_title);
  const concepts = Array.isArray(teaching.concepts)
    ? teaching.concepts.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const neighborContext = neighboringPdfContext(pdfContext, pageNo);
  return [
    CHALLENGE_COACH_PROMPT,
    "",
    "当前挑战上下文：",
    `- 课程名称：${pack.document.title || "Untitled"}`,
    `- 当前页：${pageNo ? `PDF p.${pageNo}` : "unknown page"}${title ? ` · ${title}` : ""}`,
    concepts.length ? `- 当前页概念：${concepts.join("、")}` : null,
    `- 当前挑战模式：${mode}`,
    `- 当前挑战数量：${count}`,
    "- 我的历史薄弱点：暂无显式结构化记录；如果最近对话中已经暴露薄弱点，请优先针对它，不要编造不存在的历史。",
    neighborContext ? `- 前后页摘要：\n${neighborContext}` : "- 前后页摘要：请使用随请求提供的 PDF 文本上下文和最近对话；若没有明确前后页信息，不要编造。",
    source.text_md ? "- 当前 PPT 页内容：已随请求作为 Current page source text 提供。" : "- 当前 PPT 页内容：当前页无可用抽取文本时，请优先使用附加 PDF/图片证据和已有讲解。",
    teaching.speaker_notes_md ? "- AI 对当前页的讲解：已随请求作为 Existing notes 提供。" : "- AI 对当前页的讲解：暂无已生成讲解时，请仅基于 PPT 页内容出题。",
    "",
    `输出要求：返回严格 JSON；questions 数组必须恰好包含 ${count} 道题；前端会把 JSON 渲染为可点击选项卡片。不要在 JSON 之外展示答案或追问。`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildChallengeProblemPrompt({
  mode,
  pack,
  page,
  pdfContext,
}: {
  mode: string;
  pack: AgentPagePack;
  page: AgentPageData;
  pdfContext: PdfContextPayload | null;
}) {
  const teaching = objectValue(page.teaching);
  const source = objectValue(page.source);
  const pageNo = numberValue(page.page_no);
  const title = stringValue(teaching.slide_title);
  const concepts = Array.isArray(teaching.concepts)
    ? teaching.concepts.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const neighborContext = neighboringPdfContext(pdfContext, pageNo);
  return [
    CHALLENGE_PROBLEM_PROMPT,
    "",
    "当前典型大题挑战上下文：",
    `- 课程名称：${pack.document.title || "Untitled"}`,
    `- 当前页：${pageNo ? `PDF p.${pageNo}` : "unknown page"}${title ? ` · ${title}` : ""}`,
    concepts.length ? `- 当前页概念：${concepts.join("、")}` : null,
    `- 当前挑战模式：${mode}`,
    "- 当前挑战题型：典型大题；你必须先判断本页是否适合典型大题。",
    "- 我的历史薄弱点：暂无显式结构化记录；如果最近对话中已经暴露薄弱点，请优先针对它，不要编造不存在的历史。",
    neighborContext ? `- 前后页摘要：\n${neighborContext}` : "- 前后页摘要：请使用随请求提供的 PDF 文本上下文和最近对话；若没有明确前后页信息，不要编造。",
    source.text_md ? "- 当前 PPT 页内容：已随请求作为 Current page source text 提供。" : "- 当前 PPT 页内容：当前页无可用抽取文本时，请优先使用附加 PDF/图片证据和已有讲解。",
    teaching.speaker_notes_md ? "- AI 对当前页的讲解：已随请求作为 Existing notes 提供。" : "- AI 对当前页的讲解：暂无已生成讲解时，请仅基于 PPT 页内容判断和出题。",
    "",
    "输出要求：返回严格 JSON；前端会把 JSON 渲染为典型大题挑战卡片。不要在 JSON 之外展示答案或追问。",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function parseChallengeRequest(question: string, copy: AppCopy): ChallengeRequest | null {
  const value = question.trim();
  if (!value) return null;
  if (!/^(challenge|挑战)[:：]/i.test(value)) return null;
  return {
    kind: challengeKindFromText(value),
    mode: copy.agent.challengeModeDiagnostic,
    count: challengeCountFromText(value),
  };
}

function challengeKindFromText(value: string): ChallengeRequest["kind"] {
  return /(典型大题|大题|major\s*problem|problem\s*challenge)/i.test(value) ? "problem" : "quiz";
}

function challengeCountFromText(value: string) {
  const patterns = [
    /生成\s*(\d{1,2})\s*(?:道|个|题)/i,
    /出\s*(\d{1,2})\s*(?:道|个|题)/i,
    /generate\s*(\d{1,2})/i,
    /(\d{1,2})\s*(?:interactive\s*)?(?:multiple-choice\s*)?questions?/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return normalizeChallengeCount(Number(match[1]));
  }
  return DEFAULT_CHALLENGE_COUNT;
}

function normalizeChallengeCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CHALLENGE_COUNT;
  return Math.max(1, Math.min(MAX_CHALLENGE_COUNT, Math.round(value)));
}

function neighboringPdfContext(pdfContext: PdfContextPayload | null, pageNo: number | null) {
  if (!pdfContext || !pageNo) return "";
  const neighbors = pdfContext.pages
    .filter((item) => item.page_no === pageNo - 1 || item.page_no === pageNo + 1)
    .sort((left, right) => left.page_no - right.page_no);
  if (!neighbors.length) return "";
  return neighbors
    .map((item) => `  - PDF p.${item.page_no} · ${item.title || "Untitled"}：${compactPromptLine(item.text_md, 220)}`)
    .join("\n");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function compactPromptLine(text: unknown, max: number) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value || "[无可用文本]";
  return `${value.slice(0, max)}...`;
}

function buildSelectedQuestionPrompt(
  question: string,
  selectedContext: SelectedContext | null,
  pdfContext: PdfContextPayload | null,
  copy: AppCopy,
) {
  const userQuestion = question.trim() || copy.agent.continuePrompt;
  if (!selectedContext?.text.trim()) return userQuestion;
  const selectedPage = selectedContextPageNumber(selectedContext);
  const pdfSource = selectedContext.pdfSource;
  const sourceLines = [
    selectedContext.sourceType === "generated-explanation" && selectedContext.generatedPageNumber
      ? `Selected explanation page: ${selectedContext.generatedPageNumber}`
      : null,
    selectedPage
      ? selectedContext.sourceType === "generated-explanation"
        ? `Corresponding original PDF page: ${selectedPage}`
        : `PDF page: ${selectedPage}`
      : null,
    selectedContext.sectionTitle ? `Source: ${selectedContext.sectionTitle}` : null,
    pdfSource?.title ? `PDF page title: ${pdfSource.title}` : null,
    pdfSource?.ref ? `PDF page reference: ${pdfSource.ref}` : null,
  ].filter((line): line is string => Boolean(line));
  if (pdfContext?.truncated) {
    const includedPages = formatPageRanges(pdfContext.includedPageNumbers);
    const selectedIncluded = selectedPage ? pdfContext.includedPageNumbers.includes(selectedPage) : false;
    sourceLines.push(
      `PDF context is truncated: original PDF has ${pdfContext.pageCount} pages, configured full-context limit is ${pdfContext.fullPageLimit} pages, and the model received pages ${includedPages || "none"} (${pdfContext.edgePageCount} pages from each edge).`,
    );
    if (selectedPage) {
      sourceLines.push(
        selectedIncluded
          ? `The selected text is on PDF page ${selectedPage}, which is included in the truncated PDF context.`
          : `The selected text is on PDF page ${selectedPage}, which is outside the truncated PDF context; use the selected text as the exact evidence for that page.`,
      );
    }
  }
  const promptSections = [
    "Selected source:",
    ...sourceLines,
    selectedContext.sourceType === "generated-explanation" ? "Selected explanation text:" : "Selected text:",
    selectedContext.text.trim(),
  ];
  if (pdfSource?.text?.trim()) {
    promptSections.push(
      "Corresponding original PDF page text:",
      truncatePromptContext(pdfSource.text),
    );
  }
  promptSections.push("User question:", userQuestion);
  return promptSections.join("\n\n");
}

function selectedContextPageNumber(context: SelectedContext | null) {
  if (!context) return null;
  const pageNo = context.pdfPageNumber || context.generatedPageNumber || context.pageNumber;
  return typeof pageNo === "number" && Number.isFinite(pageNo) ? pageNo : null;
}

function formatPageRanges(pages: number[]) {
  const sorted = Array.from(new Set(pages)).sort((left, right) => left - right);
  const ranges: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  for (const pageNo of sorted) {
    if (start === null || previous === null || pageNo !== previous + 1) {
      if (start !== null && previous !== null) ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
      start = pageNo;
    }
    previous = pageNo;
  }
  if (start !== null && previous !== null) ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join(", ");
}

function truncatePromptContext(text: string, max = 6000) {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[Truncated to keep the selected prompt concise.]`;
}

function detectContextType(text: string): AgentContextItem["type"] {
  return /(\$\$?[^$]+\$\$?|\\\(|\\\[|\\begin\{|[∑∫√∞≈≠≤≥πθλμ])/.test(text)
    ? "formula"
    : "selection";
}

function messageText(message: unknown): string {
  const msg = message as { content?: unknown[]; role?: string };
  return (msg.content || [])
    .map((part) => {
      const p = part as { type?: string; text?: string };
      return p.type === "text" ? p.text || "" : "";
    })
    .join("\n")
    .trim();
}

function agentFailureText(error: unknown, copy: AppCopy) {
  const message = error instanceof Error ? error.message.trim() : String(error || "").trim();
  if (!message || message === copy.agent.generationFailed) return copy.agent.generationFailed;
  return `${copy.agent.generationFailed}\n\n${message}`;
}

function asPersistedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
