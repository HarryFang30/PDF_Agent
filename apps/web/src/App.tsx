import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Columns3,
  FileInput,
  FileJson,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  PdfScrollViewer,
  type PdfScrollViewerHandle,
  type PdfViewMode,
} from "./components/pdf/PdfScrollViewer";
import { OAuthDeviceDialog } from "./components/OAuthDeviceDialog";
import { SelectionToolbar } from "./components/SelectionToolbar";
import {
  AgentPanel,
  type QuickSelectionPrompt,
} from "./components/agent/AgentPanel";
import { selectedContextSourceLabel } from "./components/agent/agentLabels";
import {
  FileButton,
  GenerationDetailsPopover,
  IconButton,
  MarkdownBlock,
  PageNavigator,
  PaneToolbar,
  SlidePreview,
  StructurePanel,
} from "./components/workspace/WorkspaceChrome";
import { useOAuthFlow } from "./hooks/useOAuthFlow";
import { useGenerationEngine } from "./hooks/useGenerationEngine";
import {
  usePageSelection,
  type SelectedContext,
} from "./hooks/usePageSelection";
import { getAppCopy, type AppCopy } from "./i18n";
import {
  selectedContextPayload,
  type AgentAttachment,
  type AgentContextItem,
  type ChatPersistInput,
} from "./lib/assistant/agentChatAdapter";
import {
  generationFailureMarkdown,
  resolveTeachingOutputLanguage,
  type PageData,
  type PagePack,
} from "./lib/generation/teachingGeneration";
import {
  generationPageStatus,
  hasCompletedTeaching,
  type GenerationPageStatus,
} from "./lib/generation/generationRuntime";
import { cachedPdfDirectFileInputFromUrl } from "./lib/pdf/directFile";
import { requestJson } from "./lib/http/requestJson";
import {
  buildPdfContextFromPack,
  type PdfContextPage,
  type PdfContextPayload,
} from "./lib/pdf/textExtraction";
import {
  defaultModelApiConfig,
  defaultUiPreferences,
  loadUiPreferences,
  normalizeModelApiConfig,
  type ModelApiConfig,
  type ModelApiProvider,
  type UiPreferences,
  uiPreferencesStorageKey,
} from "./settings";
import {
  chatMessageToThreadMessageLike,
  clearSelectedContext as clearPersistedSelectedContext,
  clearWorkspace,
  classifyPersistenceError,
  createChatThread,
  createCourseProject,
  deleteCourseProject,
  deleteWorkspaceDocument,
  estimateStorage,
  ensureWorkspace,
  exportWorkspace,
  importWorkspace,
  loadCourseProjects,
  loadLastWorkspace,
  loadWorkspaceDocument,
  loadWorkspaceDocuments,
  loadWorkspaceProject,
  requestPersistentStorage,
  repairWorkspaceStorage,
  saveChatMessage,
  saveDocumentPatch,
  saveGeneratedPagesFromPack,
  saveImportedPagePack,
  savePdfBlob,
  saveSelectedContext,
  saveSettings,
  saveWorkspacePatch,
  updateStreamingMessage,
  type ChatMessageRecord,
  type CourseProjectRecord,
  type DocumentSidebarItem,
  type ExportedWorkspace,
  type LoadedWorkspace,
  type SaveStatusKind,
  type StorageEstimate,
  type ThreadMessageLike,
} from "./lib/persistence";
import {
  agentAnswerModeReasoningEffort,
  asPersistedRecord,
  createDraftPagePack,
  createId,
  isActiveTab,
  isPanelVisibility,
  normalizePack,
  pagePackFromPersistence,
  settingsRecordToPreferences,
  storageRepairCount,
  upsertThreadMessage,
  workspaceLayoutSnapshot,
  type GeneratePageMode,
  type PanelKey,
  type PanelVisibility,
} from "./lib/workspace/synchroPageState";
import {
  AppCopyContext,
  useAppCopy,
} from "./lib/contexts";

type SettingsSection =
  | "general"
  | "providers"
  | "models"
  | "appearance"
  | "agent"
  | "pdf"
  | "account"
  | "storage"
  | "advanced";

const SettingsModal = lazy(() => import("./SettingsModal").then((module) => ({ default: module.SettingsModal })));
const MarkdownRenderer = lazy(() => import("./components/MarkdownRenderer"));

type RailConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
};
// PdfViewMode, PdfScrollViewerHandle moved to ./components/pdf/PdfScrollViewer.tsx

// QuickSelectionPrompt type moved to ./components/agent/AgentPanel.tsx

type SaveState = {
  kind: SaveStatusKind;
  message?: string;
  updatedAt?: number;
};

type PersistentStorageState = "unknown" | "persisted" | "best-effort" | "unsupported";

function desktopApi() {
  return typeof window === "undefined" ? undefined : window.synchropageDesktop;
}

const fullPanelVisibility: PanelVisibility = {
  rail: true,
  notes: true,
  agent: true,
};

const defaultPanelVisibility: PanelVisibility = {
  rail: true,
  notes: true,
  agent: false,
};

const samplePack: PagePack = {
  schema: "synchropage.lecture.v1",
  document: {
    id: "demo_course_pdf",
    title: "课程 PDF 逐页讲解",
    source_pdf_url: "",
    page_count: 3,
  },
  pages: [
    {
      page_no: 1,
      source: {
        pdf_page_ref: "#page=1",
        text_md: "课程目标：把 PDF 课件转换为逐页讲解。核心约束是页级对齐、结构化输出、可重跑。",
        ocr_used: false,
        parser: "docling",
      },
      teaching: {
        output_language: "zh-CN",
        slide_title: "从讲解 PDF 改为双栏工作台",
        speaker_notes_md:
          "## 从讲解 PDF 改为双栏工作台\n\n这一页建立产品方向：系统不再把讲解重新排成 PDF，而是保留原始 PDF 页面作为左侧参照，在右侧生成可编辑的讲解内容。\n\n### 讲课口径\n\n- 先强调原 PDF 是事实来源，讲解只是对当前页的教学化展开。\n- 再说明 SynchroPage JSON 会把页号、解析文本、讲解稿和置信度绑定在一起。\n- 最后指出这种格式更适合校对、重跑和版本管理。",
        concepts: ["SynchroPage JSON", "左右对照", "页级对齐"],
        visual_explanations: ["左侧保留原页面语境，右侧只承载可编辑讲解。"],
        prerequisites: ["课程 PDF 已完成页级解析"],
        confidence: 0.94,
      },
      status: "ready",
    },
    {
      page_no: 2,
      source: {
        pdf_page_ref: "#page=2",
        text_md: "系统流程：上传 PDF -> 解析 Page JSON -> 全局摘要 -> 逐页生成 -> JSON 校验 -> Web 展示。",
        ocr_used: false,
        parser: "docling",
      },
      teaching: {
        output_language: "zh-CN",
        slide_title: "最优技术路径",
        speaker_notes_md:
          "## 最优技术路径\n\n解析层使用 Docling 或 PyMuPDF 生成稳定 Page JSON；生成层通过 OpenAI Gateway 调用 Responses API；展示层读取 synchropage.lecture.v1.json。\n\n### 讲课口径\n\n- 解析和生成分离，避免把整份 PDF 直接塞给模型。\n- OpenAI Gateway 是唯一模型入口，前端只关心任务状态和结果数据。\n- 如果遇到扫描件或公式密集页，再通过 fallback 路由切换 OCR 或专业解析器。",
        concepts: ["OpenAI Gateway", "Docling", "PyMuPDF", "Structured Outputs"],
        visual_explanations: ["流程图应突出 parser、generator、validator 三个边界。"],
        prerequisites: ["已确认不生成讲解 PDF"],
        confidence: 0.91,
      },
      status: "ready",
    },
    {
      page_no: 3,
      source: {
        pdf_page_ref: "#page=3",
        text_md: "认证：前端走 OAuth 登录，模型请求走后端代理。输出：JSON 与 Markdown，而非 PDF。",
        ocr_used: false,
        parser: "docling",
      },
      teaching: {
        output_language: "zh-CN",
        slide_title: "OAuth 与输出格式",
        speaker_notes_md:
          "## OAuth 与输出格式\n\n浏览器不应直接持有模型 API 凭据。用户通过 OpenAI OAuth 或应用会话进入系统，后端再统一代理模型调用。\n\n### 讲课口径\n\n- OAuth 负责用户身份和授权入口。\n- OpenAI Gateway 负责模型调用、限流、日志和缓存。\n- 最终展示格式是 JSON 加 Markdown 渲染，必要时再导出 Markdown 或 PPTX。",
        concepts: ["OAuth", "后端代理", "Markdown 渲染"],
        visual_explanations: ["认证链路应从浏览器指向后端，再由后端进入模型 API。"],
        prerequisites: ["已有后端 session 设计"],
        confidence: 0.88,
      },
      status: "ready",
    },
  ],
};

const englishSamplePack: PagePack = {
  schema: "synchropage.lecture.v1",
  document: {
    id: "demo_course_pdf",
    title: "Course PDF Page-by-Page Notes",
    source_pdf_url: "",
    page_count: 3,
  },
  pages: [
    {
      page_no: 1,
      source: {
        pdf_page_ref: "#page=1",
        text_md: "Course goal: convert PDF slides into page-by-page teaching notes. Core constraints are page alignment, structured output, and repeatable runs.",
        ocr_used: false,
        parser: "docling",
      },
      teaching: {
        output_language: "en-US",
        slide_title: "From Notes PDF to Split Workspace",
        speaker_notes_md:
          "## From Notes PDF to Split Workspace\n\nThis page sets the product direction: instead of regenerating an explanation PDF, the app keeps the original PDF page as the reference and places editable teaching notes beside it.\n\n### Teaching Line\n\n- Emphasize that the original PDF remains the source of truth, while notes are a teaching-oriented expansion of the current page.\n- Explain that SynchroPage JSON binds page number, parsed text, notes, and confidence together.\n- Close by pointing out why this format is easier to review, rerun, and version.",
        concepts: ["SynchroPage JSON", "Side-by-side review", "Page alignment"],
        visual_explanations: ["The left side preserves page context; the right side carries editable notes only."],
        prerequisites: ["The course PDF has been parsed at page level"],
        confidence: 0.94,
      },
      status: "ready",
    },
    {
      page_no: 2,
      source: {
        pdf_page_ref: "#page=2",
        text_md: "System flow: upload PDF -> parse Page JSON -> global summary -> page-by-page generation -> JSON validation -> web display.",
        ocr_used: false,
        parser: "docling",
      },
      teaching: {
        output_language: "en-US",
        slide_title: "Recommended Technical Path",
        speaker_notes_md:
          "## Recommended Technical Path\n\nUse Docling or PyMuPDF in the parsing layer to generate stable Page JSON; use OpenAI Gateway and the Responses API in the generation layer; render synchropage.lecture.v1.json in the web layer.\n\n### Teaching Line\n\n- Keep parsing and generation separate instead of sending the full PDF directly to the model.\n- Treat OpenAI Gateway as the only model entry point, while the frontend only tracks task status and result data.\n- For scanned or formula-heavy pages, route through OCR or a specialized parser fallback.",
        concepts: ["OpenAI Gateway", "Docling", "PyMuPDF", "Structured Outputs"],
        visual_explanations: ["The flow diagram should emphasize the parser, generator, and validator boundaries."],
        prerequisites: ["The team has confirmed it will not generate a notes PDF"],
        confidence: 0.91,
      },
      status: "ready",
    },
    {
      page_no: 3,
      source: {
        pdf_page_ref: "#page=3",
        text_md: "Authentication: the frontend uses OAuth sign-in; model requests go through the backend proxy. Output is JSON and Markdown, not PDF.",
        ocr_used: false,
        parser: "docling",
      },
      teaching: {
        output_language: "en-US",
        slide_title: "OAuth and Output Format",
        speaker_notes_md:
          "## OAuth and Output Format\n\nThe browser should not hold model API credentials directly. The user enters through OpenAI OAuth or an app session, and the backend proxies model calls in one place.\n\n### Teaching Line\n\n- OAuth handles user identity and authorization entry.\n- OpenAI Gateway handles model calls, rate limits, logs, and caching.\n- The final display format is JSON plus Markdown rendering, with optional export to Markdown or PPTX later.",
        concepts: ["OAuth", "Backend proxy", "Markdown rendering"],
        visual_explanations: ["The authentication path should point from browser to backend, then from backend to the model API."],
        prerequisites: ["A backend session design already exists"],
        confidence: 0.88,
      },
      status: "ready",
    },
  ],
};

const samplePacks: Record<UiPreferences["language"], PagePack> = {
  "zh-CN": samplePack,
  "en-US": englishSamplePack,
};

// contextSourceLabel, selectedContextSourceLabel, composerContextPreview,
// pageSuggestions, readFileAsDataUrl moved to ./components/agent/AgentPanel.tsx

function generationStatusLabel(status: GenerationPageStatus, copy: AppCopy) {
  if (status === "done") return copy.topbar.generationStatusDone;
  if (status === "running") return copy.topbar.generationStatusRunning;
  if (status === "retrying") return copy.topbar.generationStatusRetrying;
  if (status === "failed") return copy.topbar.generationStatusFailed;
  return copy.topbar.generationStatusPending;
}

export default function App() {
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => loadUiPreferences());
  const [modelApiConfig, setModelApiConfig] = useState<ModelApiConfig>(defaultModelApiConfig);
  const [modelApiStatus, setModelApiStatus] = useState("Model API: OpenAI OAuth");
  const copy = useMemo(() => getAppCopy(uiPreferences.language), [uiPreferences.language]);
  const [pack, setPack] = useState<PagePack>(() => samplePacks[uiPreferences.language]);
  const [currentPageNo, setCurrentPageNo] = useState(1);
  const [pdfUrl, setPdfUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"notes" | "structure" | "json">("notes");
  const [panels, setPanels] = useState<PanelVisibility>(defaultPanelVisibility);
  const [query, setQuery] = useState("");
  const [jobStatus, setJobStatus] = useState(copy.status.localPrototype);
  const {
    oauthMode,
    oauthAccount,
    oauthDevice,
    oauthCodeCopied,
    oauthSecondsLeft,
    copyOAuthUserCode,
    openOAuthVerification,
    cancelOAuthLogin,
    connectOAuth,
  } = useOAuthFlow({ copy, setJobStatus });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [railActionMenuOpen, setRailActionMenuOpen] = useState(false);
  const [generateMenuOpen, setGenerateMenuOpen] = useState(false);
  const [generatePageMode, setGeneratePageMode] = useState<GeneratePageMode>("missing");
  const [generateRangeDraft, setGenerateRangeDraft] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [contexts, setContexts] = useState<AgentContextItem[]>([]);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [selectedContext, setSelectedContext] = useState<SelectedContext | null>(null);
  const [pdfTextContext, setPdfTextContext] = useState<PdfContextPayload | null>(null);
  const [pdfExtractedPages, setPdfExtractedPages] = useState<PdfContextPage[]>([]);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [generationDetailsOpen, setGenerationDetailsOpen] = useState(false);
  const [pendingSelectionPrompt, setPendingSelectionPrompt] = useState<QuickSelectionPrompt | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [courseProjects, setCourseProjects] = useState<CourseProjectRecord[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentItems, setDocumentItems] = useState<DocumentSidebarItem[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [courseDraftName, setCourseDraftName] = useState("");
  const [railConfirmAction, setRailConfirmAction] = useState<RailConfirmAction | null>(null);
  const [isRestoringWorkspace, setIsRestoringWorkspace] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "draft", message: copy.persistence.localDraft });
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [persistentStorageState, setPersistentStorageState] = useState<PersistentStorageState>("unknown");
  const [desktopStorageConfig, setDesktopStorageConfig] = useState<SynchroPageDesktopStorageConfig | null>(null);
  const [desktopStorageBusy, setDesktopStorageBusy] = useState(false);
  const [persistedMessages, setPersistedMessages] = useState<ThreadMessageLike[]>([]);
  const [agentRuntimeKey, setAgentRuntimeKey] = useState("thread:initial");
  const lastSelectionRef = useRef<SelectedContext | null>(null);
  const currentPdfObjectUrlRef = useRef("");
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const railActionMenuRef = useRef<HTMLDivElement>(null);
  const generateMenuRef = useRef<HTMLDivElement>(null);
  const jsonImportInputRef = useRef<HTMLInputElement>(null);
  const workspaceImportInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const pdfScrollViewerRef = useRef<PdfScrollViewerHandle>(null);
  const fullscreenIntentRef = useRef(false);
  const panelsBeforePdfFocusRef = useRef<PanelVisibility>(defaultPanelVisibility);
  const restoredOnceRef = useRef(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);

  const pdfNavigationPageCount = Math.max(pdfUrl ? pdfPageCount || pack.document.page_count || pack.pages.length : pack.pages.length, 1);
  const currentPdfPageNo = Math.min(Math.max(currentPageNo, 1), pdfNavigationPageCount);
  const teachingOutputLanguage = resolveTeachingOutputLanguage(uiPreferences);
  const stopNotesGeneration = useCallback(() => {
    const message = copy.errors.generationStopped;
    generationAbortControllerRef.current?.abort();
    generationAbortControllerRef.current = null;
    setIsGeneratingNotes(false);
    setGenerateMenuOpen(false);
    setJobStatus(message);
    setPack((current) => ({
      ...current,
      pages: current.pages.map((page) => {
        if (page.status !== "running" && page.status !== "retrying") return page;
        return {
          ...page,
          status: "failed",
          teaching: {
            ...page.teaching,
            output_language: teachingOutputLanguage,
            slide_title: page.teaching.slide_title || `PDF p.${page.page_no}`,
            speaker_notes_md: generationFailureMarkdown(message, teachingOutputLanguage),
            confidence: 0,
            needs_review: true,
          },
        };
      }),
    }));
  }, [copy.errors.generationStopped, teachingOutputLanguage]);
  const pageLookup = useMemo(() => {
    const pagesByNumber = new Map<number, PageData>();
    const indexesByNumber = new Map<number, number>();
    pack.pages.forEach((item, index) => {
      pagesByNumber.set(item.page_no, item);
      indexesByNumber.set(item.page_no, index);
    });
    return { pagesByNumber, indexesByNumber };
  }, [pack.pages]);
  const page =
    pageLookup.pagesByNumber.get(currentPdfPageNo) ||
    pack.pages[Math.min(Math.max(currentPdfPageNo - 1, 0), Math.max(pack.pages.length - 1, 0))] ||
    samplePacks[uiPreferences.language].pages[0];
  const currentIndex = Math.max(0, pageLookup.indexesByNumber.get(page.page_no) ?? -1);
  const generatedPageCount = useMemo(
    () => pack.pages.filter((item) => hasCompletedTeaching(item, teachingOutputLanguage)).length,
    [pack.pages, teachingOutputLanguage],
  );
  const generationProgressPages = useMemo(() => Array.from({ length: pdfNavigationPageCount }, (_, index) => {
    const pageNo = index + 1;
    const progressPage = pageLookup.pagesByNumber.get(pageNo);
    return {
      pageNo,
      status: generationPageStatus(progressPage, teachingOutputLanguage),
    };
  }), [pageLookup.pagesByNumber, pdfNavigationPageCount, teachingOutputLanguage]);
  const generationProgressSummary = useMemo(() => generationProgressPages.reduce(
    (summary, item) => ({
      done: summary.done + (item.status === "done" ? 1 : 0),
      running: summary.running + (item.status === "running" ? 1 : 0),
      retrying: summary.retrying + (item.status === "retrying" ? 1 : 0),
      failed: summary.failed + (item.status === "failed" ? 1 : 0),
      pending: summary.pending + (item.status === "pending" ? 1 : 0),
    }),
    { done: 0, running: 0, retrying: 0, failed: 0, pending: 0 },
  ), [generationProgressPages]);
  const generateScopeSummary =
    generatePageMode === "current"
      ? copy.topbar.generateScopeCurrent(currentPdfPageNo)
      : generatePageMode === "custom"
        ? copy.topbar.generateScopeCustomSummary(generateRangeDraft.trim() || copy.topbar.generateScopeCustomPlaceholder)
        : generatePageMode === "all"
          ? copy.topbar.generateScopeAll
          : copy.topbar.generateScopeMissing;
  const pdfOnly = !panels.rail && !panels.notes && !panels.agent;
  const fullWorkbench = panels.rail && panels.notes && panels.agent;
  const sidebarDocuments: DocumentSidebarItem[] = documentItems.length
    ? documentItems
    : [
        {
          id: pack.document.id,
          workspaceId: workspaceId || "sample",
          documentId: documentId || pack.document.id,
          title: pack.document.title,
          fileName: pack.document.source_pdf_url,
          mimeType: pdfUrl ? "application/pdf" : "application/json",
          pageCount: pdfPageCount || pack.document.page_count || pack.pages.length,
          currentPdfPageNumber: currentPdfPageNo,
          generatedPageCount,
          status: "ready",
          updatedAt: 0,
          uploadedAt: 0,
          isActive: true,
        },
      ];
  const sidebarProjects: CourseProjectRecord[] = courseProjects.length
    ? courseProjects
    : [
        {
          id: activeProjectId || "sample-course",
          workspaceId: workspaceId || "sample",
          name: copy.rail.defaultCourse,
          description: "",
          color: "clay",
          icon: "book-open",
          createdAt: 0,
          updatedAt: 0,
          lastOpenedAt: 0,
          documentCount: sidebarDocuments.length,
          activeDocumentId: documentId || pack.document.id,
        },
      ];
  const currentProjectId = activeProjectId || sidebarProjects[0]?.id || null;
  const activeProject = sidebarProjects.find((item) => item.id === currentProjectId) || sidebarProjects[0] || null;
  const normalizedDocumentQuery = query.trim().toLowerCase();
  const filteredProjects = sidebarProjects.filter((project) =>
    normalizedDocumentQuery ? project.name.toLowerCase().includes(normalizedDocumentQuery) : true,
  );
  const activeProjectDocuments = currentProjectId
    ? sidebarDocuments.filter((item) => item.projectId === currentProjectId || (!item.projectId && currentProjectId === activeProject?.id))
    : sidebarDocuments;
  const documentsForSidebar = normalizedDocumentQuery
    ? sidebarDocuments.filter((item) => `${item.title} ${item.fileName}`.toLowerCase().includes(normalizedDocumentQuery))
    : activeProjectDocuments;
  const recentDocuments = sidebarDocuments
    .slice()
    .sort((left, right) => (right.lastOpenedAt || right.updatedAt) - (left.lastOpenedAt || left.updatedAt))
    .filter((item) => item.documentId !== documentId)
    .slice(0, 4);
  const visiblePaneCount = 1 + Number(panels.rail) + Number(panels.notes) + Number(panels.agent);
  const pdfViewerSrc = pdfUrl
    ? `${pdfUrl}#page=${currentPdfPageNo}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`
    : "";
  const pdfViewMode: PdfViewMode = uiPreferences.pdfViewMode || "continuous";
  const { toolbar: selectionToolbar, clearSelection } = usePageSelection({
    documentTitle: pack.document.title,
    page,
    copy,
    createId,
    setLastSelection: (context) => {
      lastSelectionRef.current = context;
    },
  });

  const togglePanel = useCallback((key: PanelKey) => {
    setPanels((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const exitPdfFullscreen = useCallback(async () => {
    fullscreenIntentRef.current = false;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setPanels(panelsBeforePdfFocusRef.current);
  }, []);

  const enterPdfFullscreen = useCallback(async () => {
    panelsBeforePdfFocusRef.current = panels;
    setPanels({ rail: false, notes: false, agent: false });
    fullscreenIntentRef.current = true;

    const target = appShellRef.current;
    if (!target?.requestFullscreen) {
      fullscreenIntentRef.current = false;
      setJobStatus("当前浏览器不支持全屏，已切换到 PDF 专注模式");
      return;
    }

    if (!document.fullscreenElement) {
      await target.requestFullscreen().catch(() => {
        fullscreenIntentRef.current = false;
        setJobStatus("浏览器未允许全屏，已切换到 PDF 专注模式");
      });
    }
  }, [panels]);

  const togglePdfOnly = useCallback(() => {
    if (isBrowserFullscreen || pdfOnly) {
      void exitPdfFullscreen();
      return;
    }
    void enterPdfFullscreen();
  }, [enterPdfFullscreen, exitPdfFullscreen, isBrowserFullscreen, pdfOnly]);

  const openSettings = useCallback((section: SettingsSection = "general") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  const closeCommandMenu = useCallback(() => {
    setCommandMenuOpen(false);
  }, []);

  const updatePreference = useCallback(<K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => {
    setUiPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  const resetPreferences = useCallback(() => {
    setUiPreferences(defaultUiPreferences);
    window.localStorage.removeItem(uiPreferencesStorageKey);
    setJobStatus(getAppCopy(defaultUiPreferences.language).status.preferencesReset);
  }, []);

  useEffect(() => {
    let canceled = false;
    void requestJson<ModelApiConfig>("/api/model-config")
      .then((config) => {
        if (canceled) return;
        const normalized = normalizeModelApiConfig(config);
        setModelApiConfig(normalized);
        const provider = normalized.providers.find((item) => item.id === normalized.selectedProviderId);
        setModelApiStatus(`Model API: ${provider?.name || "OpenAI OAuth"}`);
      })
      .catch(() => {
        if (!canceled) setModelApiStatus("Model API: backend offline, using OpenAI OAuth");
      });
    return () => {
      canceled = true;
    };
  }, []);

  const updateModelApiConfig = useCallback((next: ModelApiConfig | ((current: ModelApiConfig) => ModelApiConfig)) => {
    setModelApiConfig((current) => normalizeModelApiConfig(typeof next === "function" ? next(current) : next));
    setModelApiStatus("Model API: unsaved changes");
  }, []);

  const saveModelApiConfig = useCallback(async (config = modelApiConfig) => {
    const normalized = normalizeModelApiConfig(config);
    const saved = await requestJson<ModelApiConfig>("/api/model-config", {
      method: "POST",
      body: JSON.stringify(normalized),
    });
    const nextConfig = normalizeModelApiConfig(saved);
    setModelApiConfig(nextConfig);
    const provider = nextConfig.providers.find((item) => item.id === nextConfig.selectedProviderId);
    setModelApiStatus(`Model API: saved${provider ? ` · ${provider.name}` : ""}`);
    return nextConfig;
  }, [modelApiConfig]);

  const fetchProviderModels = useCallback(async (provider: ModelApiProvider) => {
    const response = await requestJson<{ models?: Array<{ id?: string; owned_by?: string }> }>("/api/model-config/models", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
    const models = Array.from(new Set<string>(
      (response.models || []).flatMap((item) => {
        const model = typeof item.id === "string" ? item.id.trim() : "";
        return model ? [model] : [];
      }),
    ));
    if (!models.length) throw new Error("Provider returned no models");
    setModelApiConfig((current) => normalizeModelApiConfig({
      ...current,
      providers: current.providers.map((item) => item.id === provider.id ? { ...item, models, enabled: true } : item),
    }));
    setModelApiStatus(`Model API: fetched ${models.length} models from ${provider.name}`);
    return models;
  }, []);

  const checkProviderModel = useCallback(async (provider: ModelApiProvider, model: string) => {
    const response = await requestJson<{ ok?: boolean; endpoint?: string; model?: string; text?: string }>("/api/model-config/check", {
      method: "POST",
      body: JSON.stringify({ provider, model }),
    });
    if (!response.ok) throw new Error("Provider returned an empty check response");
    setModelApiStatus(`Model API: checked ${response.model || model} via ${response.endpoint || provider.type}`);
    return response;
  }, []);

  const getSnapshot = useCallback(
    () => ({
      contexts,
      attachments,
      selectedContext,
      pdfContext: pdfUrl ? pdfTextContext : buildPdfContextFromPack(pack, uiPreferences),
      answerMode: uiPreferences.agentAnswerMode,
      reasoningEffort: agentAnswerModeReasoningEffort(uiPreferences.agentAnswerMode),
      assistantModel: modelApiConfig.defaults.assistant,
    }),
    [attachments, contexts, modelApiConfig.defaults.assistant, pack, pdfTextContext, pdfUrl, selectedContext, uiPreferences],
  );
  const getDocumentFile = useCallback(async () => {
    if (!pdfUrl) return null;
    const filename = pack.document.source_pdf_url || pack.document.title || "document.pdf";
    return cachedPdfDirectFileInputFromUrl(pdfUrl, filename);
  }, [pack.document.source_pdf_url, pack.document.title, pdfUrl]);
  const getPack = useCallback(() => pack, [pack]);
  const getPage = useCallback(() => page, [page]);

  const focusComposer = useCallback(() => {
    window.setTimeout(() => composerInputRef.current?.focus(), 20);
  }, []);

  const captureSelection = useCallback((context = selectionToolbar?.context || lastSelectionRef.current) => {
    if (!context) {
      setJobStatus(copy.status.noSelection);
      return;
    }
    setSelectedContext(context);
    setPanels((current) => ({ ...current, agent: true }));
    clearSelection();
    focusComposer();
    setJobStatus(copy.status.selectionAdded);
  }, [clearSelection, copy.status.noSelection, copy.status.selectionAdded, focusComposer, selectionToolbar?.context]);

  const sendSelectionPrompt = useCallback((context: SelectedContext, intent: "explain" | "summarize") => {
    const label = selectedContextSourceLabel(context, copy);
    const prompt = intent === "explain"
      ? copy.agent.quickExplainPrompt(label)
      : copy.agent.quickSummarizePrompt(label);
    setSelectedContext(context);
    setPanels((current) => ({ ...current, agent: true }));
    setPendingSelectionPrompt({ id: createId("quick_prompt"), prompt, context });
    clearSelection();
    setJobStatus(intent === "explain" ? copy.status.explainingSelection : copy.status.summarizingSelection);
  }, [clearSelection, copy]);

  const refreshStorageEstimate = useCallback(async () => {
    const estimate = await estimateStorage();
    setStorageEstimate(estimate);
    setPersistentStorageState(
      estimate.persisted === true
        ? "persisted"
        : estimate.persisted === false
          ? "best-effort"
          : "unknown",
    );
    return estimate;
  }, []);

  const persistOperation = useCallback(async <T,>(operation: () => Promise<T>, successMessage?: string) => {
    setSaveState({ kind: "saving", message: copy.persistence.saving });
    try {
      const result = await operation();
      setSaveState({ kind: "saved", message: successMessage || copy.persistence.saved, updatedAt: Date.now() });
      void refreshStorageEstimate().catch(() => undefined);
      return result;
    } catch (error) {
      const classified = classifyPersistenceError(error);
      setSaveState({
        kind: classified.kind === "quota" ? "quota" : "error",
        message: classified.kind === "quota" ? copy.persistence.quota : `${copy.persistence.failed}: ${classified.message}`,
        updatedAt: Date.now(),
      });
      throw error;
    }
  }, [copy.persistence.failed, copy.persistence.quota, copy.persistence.saved, copy.persistence.saving, refreshStorageEstimate]);

  const persistChatMessage = useCallback(async (input: ChatPersistInput) => {
    if (!workspaceId || !threadId) return;
    const now = Date.now();
    const baseRecord: ChatMessageRecord = {
      id: input.id,
      threadId,
      workspaceId,
      documentId: documentId || undefined,
      role: input.role,
      content: input.content,
      contentMarkdown: input.content,
      selectedContext: input.selectedContext ?? null,
      sourceRefs: input.sourceRefs || [],
      status: input.status,
      createdAt: input.createdAt || now,
      updatedAt: now,
    };
    await persistOperation(async () => {
      if (input.role === "assistant") {
        await updateStreamingMessage({
          id: input.id,
          threadId,
          workspaceId,
          documentId: documentId || undefined,
          content: input.content,
          status: input.status,
          selectedContext: input.selectedContext ?? null,
          sourceRefs: input.sourceRefs || [],
        });
      } else {
        await saveChatMessage(baseRecord);
      }
    });
    setPersistedMessages((messages) => upsertThreadMessage(messages, chatMessageToThreadMessageLike(baseRecord)));
  }, [documentId, persistOperation, threadId, workspaceId]);

  const replacePdfObjectUrl = useCallback((nextUrl: string) => {
    generationAbortControllerRef.current?.abort();
    generationAbortControllerRef.current = null;
    if (currentPdfObjectUrlRef.current) {
      URL.revokeObjectURL(currentPdfObjectUrlRef.current);
    }
    currentPdfObjectUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }, []);

  const currentLayoutState = useCallback(() => workspaceLayoutSnapshot({
    panels,
    activeTab,
    query,
    activeProjectId,
    contexts,
    attachments,
  }), [activeProjectId, activeTab, attachments, contexts, panels, query]);

  const forceSaveSnapshot = useCallback(async () => {
    await persistOperation(async () => {
      await saveSettings(uiPreferences, workspaceId || "global");
      if (!workspaceId) return;
      await saveWorkspacePatch(workspaceId, {
        activeProjectId: activeProjectId || undefined,
        currentPdfPageNumber: currentPdfPageNo,
        currentGeneratedPageIndex: currentIndex,
        layoutState: currentLayoutState(),
        settingsSnapshot: uiPreferences,
      });
      if (documentId) {
        if (pack.document.id !== documentId) return;
        await saveDocumentPatch(documentId, {
          currentPdfPageNumber: currentPdfPageNo,
          pageCount: pdfPageCount || pack.document.page_count || pack.pages.length,
        });
        await saveGeneratedPagesFromPack({ workspaceId, documentId, pack });
        if (selectedContext) {
          await saveSelectedContext({
            workspaceId,
            documentId,
            context: asPersistedRecord(selectedContextPayload(selectedContext)) as Record<string, unknown> & {
              id?: string;
              text?: string;
              sourceType?: string;
              pdfPageNumber?: number;
              generatedPageNumber?: number;
              sectionTitle?: string;
              selectionRects?: Record<string, unknown>[];
              pdfSource?: Record<string, unknown>;
            },
          });
        } else {
          await clearPersistedSelectedContext(workspaceId, documentId);
        }
      }
    }, copy.persistence.saved);
  }, [
    copy.persistence.saved,
    activeProjectId,
    currentIndex,
    currentLayoutState,
    currentPdfPageNo,
    documentId,
    pack,
    pdfPageCount,
    persistOperation,
    selectedContext,
    uiPreferences,
    workspaceId,
  ]);

  const resetLocalWorkspaceState = useCallback(() => {
    replacePdfObjectUrl("");
    setWorkspaceId(null);
    setActiveProjectId(null);
    setCourseProjects([]);
    setDocumentId(null);
    setDocumentItems([]);
    setThreadId(null);
    setPdfPageCount(null);
    setCurrentPageNo(1);
    setSelectedContext(null);
    setPdfTextContext(null);
    setPdfExtractedPages([]);
    setContexts([]);
    setAttachments([]);
    setPersistedMessages([]);
    setAgentRuntimeKey(`thread:initial:${Date.now()}`);
    setPack(samplePacks[uiPreferences.language]);
  }, [replacePdfObjectUrl, uiPreferences.language]);

  const refreshDocumentItems = useCallback(async (
    nextWorkspaceId = workspaceId,
    activeDocumentId = documentId,
    nextActiveProjectId = activeProjectId,
  ) => {
    if (!nextWorkspaceId) {
      setDocumentItems([]);
      setCourseProjects([]);
      return [];
    }
    const [projects, items] = await Promise.all([
      loadCourseProjects(nextWorkspaceId, nextActiveProjectId),
      loadWorkspaceDocuments(nextWorkspaceId, activeDocumentId),
    ]);
    setCourseProjects(projects);
    if (nextActiveProjectId) setActiveProjectId(nextActiveProjectId);
    setDocumentItems(items);
    return items;
  }, [activeProjectId, documentId, workspaceId]);

  const applyLoadedWorkspace = useCallback((
    loaded: LoadedWorkspace,
    options: { restoreLayout?: boolean } = {},
  ) => {
    const restoredPreferences = settingsRecordToPreferences(loaded.settings || loaded.workspace.settingsSnapshot);
    const restoredCopy = getAppCopy(restoredPreferences.language);
    setUiPreferences(restoredPreferences);
    setWorkspaceId(loaded.workspace.id);
    setActiveProjectId(loaded.activeProject?.id || loaded.workspace.activeProjectId || null);
    setCourseProjects(loaded.courseProjects);
    setDocumentId(loaded.document?.id || null);
    setDocumentItems(loaded.documentItems);
    setThreadId(loaded.thread?.id || null);
    setPdfTextContext(null);
    setPdfExtractedPages([]);

    if (options.restoreLayout) {
      const layout = (loaded.workspace.layoutState || {}) as {
        panels?: unknown;
        activeTab?: unknown;
        query?: unknown;
        activeProjectId?: unknown;
        contexts?: unknown;
        attachments?: unknown;
      };
      if (isPanelVisibility(layout.panels)) setPanels(layout.panels);
      if (isActiveTab(layout.activeTab)) setActiveTab(layout.activeTab);
      if (typeof layout.query === "string") setQuery(layout.query);
      if (typeof layout.activeProjectId === "string") setActiveProjectId(layout.activeProjectId);
      if (Array.isArray(layout.contexts)) setContexts(layout.contexts as AgentContextItem[]);
      if (Array.isArray(layout.attachments)) setAttachments(layout.attachments as AgentAttachment[]);
    } else {
      setContexts([]);
      setAttachments([]);
    }

    if (loaded.document) {
      const restoredPack = pagePackFromPersistence(loaded.document, loaded.generatedPages, restoredCopy);
      const pageCount = loaded.document.pageCount || restoredPack.pages.length || 1;
      setPack(restoredPack);
      setPdfPageCount(loaded.document.pageCount || null);
      setCurrentPageNo(
        Math.min(
          Math.max(loaded.workspace.currentPdfPageNumber || loaded.document.currentPdfPageNumber || 1, 1),
          Math.max(pageCount, 1),
        ),
      );
      if (loaded.pdfBlob?.blob) {
        replacePdfObjectUrl(URL.createObjectURL(loaded.pdfBlob.blob));
      } else {
        replacePdfObjectUrl("");
        if (loaded.document.pdfBlobId) {
          setJobStatus(restoredCopy.persistence.pdfMissing);
          setSaveState({ kind: "error", message: restoredCopy.persistence.pdfMissing, updatedAt: Date.now() });
        }
      }
    } else {
      replacePdfObjectUrl("");
      setPack(samplePacks[restoredPreferences.language]);
      setPdfPageCount(null);
      setPdfExtractedPages([]);
      setCurrentPageNo(1);
    }

    setSelectedContext((loaded.selectedContext?.payload as unknown as SelectedContext) || null);
    const restoredMessages = loaded.messages.map(chatMessageToThreadMessageLike);
    setPersistedMessages(restoredMessages);
    setAgentRuntimeKey(`${loaded.thread?.id || "thread"}:${restoredMessages.length}:${loaded.workspace.updatedAt}`);
  }, [replacePdfObjectUrl]);

  const handleSaveStatusClick = useCallback(() => {
    if (saveState.kind === "error" || saveState.kind === "quota") {
      void forceSaveSnapshot().catch(() => undefined);
      return;
    }
    openSettings("storage");
  }, [forceSaveSnapshot, openSettings, saveState.kind]);

  useEffect(() => {
    let cancelled = false;

    const restoreWorkspace = async () => {
      setIsRestoringWorkspace(true);
      try {
        const loaded = await loadLastWorkspace();
        if (cancelled) return;
        const persistent = await navigator.storage?.persisted?.().catch(() => null);
        if (!cancelled) {
          setPersistentStorageState(
            persistent === true
              ? "persisted"
              : persistent === false
                ? "best-effort"
                : "unsupported",
          );
        }

        if (!loaded) {
          setSaveState({ kind: "draft", message: getAppCopy(uiPreferences.language).persistence.localDraft });
          void refreshStorageEstimate().catch(() => undefined);
          return;
        }

        const restoredPreferences = settingsRecordToPreferences(loaded.settings || loaded.workspace.settingsSnapshot);
        applyLoadedWorkspace(loaded, { restoreLayout: true });
        setSaveState({ kind: "saved", message: getAppCopy(restoredPreferences.language).persistence.restored, updatedAt: Date.now() });
        void refreshStorageEstimate().catch(() => undefined);
      } catch (error) {
        if (!cancelled) {
          setSaveState({ kind: "error", message: (error as Error).message || getAppCopy(uiPreferences.language).persistence.restoreFailed, updatedAt: Date.now() });
          setJobStatus((error as Error).message || getAppCopy(uiPreferences.language).persistence.restoreFailed);
        }
      } finally {
        if (!cancelled) {
          restoredOnceRef.current = true;
          setIsRestoringWorkspace(false);
        }
      }
    };

    void restoreWorkspace();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (currentPdfObjectUrlRef.current) {
      URL.revokeObjectURL(currentPdfObjectUrlRef.current);
      currentPdfObjectUrlRef.current = "";
    }
  }, []);

  useEffect(() => {
    if (isRestoringWorkspace || !restoredOnceRef.current) return undefined;
    const timer = window.setTimeout(() => {
      void persistOperation(() => saveSettings(uiPreferences, workspaceId || "global")).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [isRestoringWorkspace, persistOperation, uiPreferences, workspaceId]);

  useEffect(() => {
    if (isRestoringWorkspace || !restoredOnceRef.current || !workspaceId) return undefined;
    const timer = window.setTimeout(() => {
      void persistOperation(async () => {
        await saveWorkspacePatch(workspaceId, {
          activeProjectId: activeProjectId || undefined,
          currentPdfPageNumber: currentPdfPageNo,
          currentGeneratedPageIndex: currentIndex,
          layoutState: currentLayoutState(),
          settingsSnapshot: uiPreferences,
        });
        if (documentId && pack.document.id === documentId) {
          await saveDocumentPatch(documentId, {
            currentPdfPageNumber: currentPdfPageNo,
            pageCount: pdfPageCount || pack.document.page_count || pack.pages.length,
          });
        }
      }).catch(() => undefined);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    currentIndex,
    currentLayoutState,
    currentPdfPageNo,
    activeProjectId,
    documentId,
    isRestoringWorkspace,
    pack.document.id,
    pack.document.page_count,
    pack.pages.length,
    pdfPageCount,
    persistOperation,
    uiPreferences,
    workspaceId,
  ]);

  useEffect(() => {
    if (isRestoringWorkspace || !restoredOnceRef.current || !workspaceId || !documentId) return undefined;
    const timer = window.setTimeout(() => {
      void persistOperation(async () => {
        if (selectedContext) {
          await saveSelectedContext({
            workspaceId,
            documentId,
            context: asPersistedRecord(selectedContextPayload(selectedContext)) as Record<string, unknown> & {
              id?: string;
              text?: string;
              sourceType?: string;
              pdfPageNumber?: number;
              generatedPageNumber?: number;
              sectionTitle?: string;
              selectionRects?: Record<string, unknown>[];
              pdfSource?: Record<string, unknown>;
            },
          });
        } else {
          await clearPersistedSelectedContext(workspaceId, documentId);
        }
      }).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [documentId, isRestoringWorkspace, persistOperation, selectedContext, workspaceId]);

  useEffect(() => {
    if (isGeneratingNotes || isRestoringWorkspace || !restoredOnceRef.current || !workspaceId || !documentId || pack.document.id !== documentId) return undefined;
    const timer = window.setTimeout(() => {
      void persistOperation(() => saveGeneratedPagesFromPack({ workspaceId, documentId, pack })).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [documentId, isGeneratingNotes, isRestoringWorkspace, pack, persistOperation, workspaceId]);

  useEffect(() => {
    if (!documentId || pack.document.id !== documentId) return;
    setDocumentItems((items) => items.map((item) =>
      item.documentId === documentId
        ? {
            ...item,
            title: pack.document.title,
            fileName: pack.document.source_pdf_url,
            pageCount: pdfPageCount || pack.document.page_count || pack.pages.length,
            currentPdfPageNumber: currentPdfPageNo,
            generatedPageCount,
            projectId: item.projectId || activeProjectId || undefined,
            isActive: true,
          }
        : { ...item, isActive: false },
    ));
  }, [
    currentPdfPageNo,
    activeProjectId,
    documentId,
    generatedPageCount,
    pack.document.id,
    pack.document.source_pdf_url,
    pack.document.title,
    pack.document.page_count,
    pack.pages.length,
    pdfPageCount,
  ]);

  useEffect(() => {
    if (isRestoringWorkspace || !restoredOnceRef.current) return undefined;
    const flushSnapshot = () => {
      void forceSaveSnapshot().catch(() => undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSnapshot();
    };
    window.addEventListener("pagehide", flushSnapshot);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushSnapshot);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [forceSaveSnapshot, isRestoringWorkspace]);

  useEffect(() => {
    if (!commandMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && commandMenuRef.current?.contains(target)) return;
      setCommandMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCommandMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [commandMenuOpen]);

  useEffect(() => {
    if (!railActionMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && railActionMenuRef.current?.contains(target)) return;
      setRailActionMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRailActionMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [railActionMenuOpen]);

  useEffect(() => {
    if (!generateMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && generateMenuRef.current?.contains(target)) return;
      setGenerateMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGenerateMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [generateMenuOpen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === appShellRef.current;
      setIsBrowserFullscreen(isFullscreen);

      if (!document.fullscreenElement && fullscreenIntentRef.current) {
        fullscreenIntentRef.current = false;
        setPanels(panelsBeforePdfFocusRef.current);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.synchropageTheme = uiPreferences.theme;
      root.dataset.synchropageResolvedTheme =
        uiPreferences.theme === "system" ? (media.matches ? "dark" : "light") : uiPreferences.theme;
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [uiPreferences.theme]);

  useEffect(() => {
    document.documentElement.lang = uiPreferences.language === "en-US" ? "en" : "zh-CN";
    document.documentElement.dataset.synchropageLanguage = uiPreferences.language;
  }, [uiPreferences.language]);

  useEffect(() => {
    if (pdfUrl) setPdfTextContext(null);
  }, [pdfUrl, uiPreferences.pdfContextEdgePageCount, uiPreferences.pdfContextFullPageLimit]);

  useEffect(() => {
    setPack((current) => {
      if (current.document.id !== "demo_course_pdf" || current.document.source_pdf_url) return current;
      return samplePacks[uiPreferences.language];
    });
  }, [uiPreferences.language]);

  useEffect(() => {
    if (!uiPreferences.autoSaveSession) {
      window.localStorage.setItem(uiPreferencesStorageKey, JSON.stringify({ autoSaveSession: false }));
      return;
    }
    window.localStorage.setItem(uiPreferencesStorageKey, JSON.stringify(uiPreferences));
  }, [uiPreferences]);

  const loadPdfFiles = useCallback((files: File[]) => {
    const pdfFiles = files.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    const lastFile = pdfFiles[pdfFiles.length - 1];
    if (!lastFile) return;

    replacePdfObjectUrl("");
    setDocumentId(null);
    setThreadId(null);
    setPdfPageCount(null);
    setCurrentPageNo(1);
    setSelectedContext(null);
    setPdfTextContext(null);
    setPdfExtractedPages([]);
    setContexts([]);
    setAttachments([]);
    setPersistedMessages([]);
    setDocumentItems((items) => items.map((item) => ({ ...item, isActive: false })));
    const title = lastFile.name.replace(/\.pdf$/i, "") || lastFile.name || "Untitled PDF";
    setPack(createDraftPagePack(title, lastFile.name, 1));

    void persistOperation(async () => {
      let nextWorkspaceId = workspaceId;
      let saved: Awaited<ReturnType<typeof savePdfBlob>> | null = null;
      for (const file of pdfFiles) {
        saved = await savePdfBlob({
          workspaceId: nextWorkspaceId,
          projectId: activeProjectId,
          file,
          settingsSnapshot: uiPreferences,
          layoutState: currentLayoutState(),
        });
        nextWorkspaceId = saved.workspace.id;
      }
      if (!saved) return null;

      setWorkspaceId(saved.workspace.id);
      setActiveProjectId(saved.workspace.activeProjectId || saved.document.projectId || null);
      setDocumentId(saved.document.id);
      await refreshDocumentItems(saved.workspace.id, saved.document.id, saved.workspace.activeProjectId || saved.document.projectId || null);
      setThreadId(saved.thread.id);
      setPersistedMessages([]);
      setAgentRuntimeKey(`${saved.thread.id}:0:${Date.now()}`);
      setPack(createDraftPagePack(saved.document.title, saved.document.fileName, Math.max(saved.document.pageCount || 1, 1), saved.document.id));
      replacePdfObjectUrl(URL.createObjectURL(saved.fileBlob.blob));
      return saved;
    }, copy.persistence.uploadSaved).catch((error) => {
      setJobStatus((error as Error).message || copy.persistence.failed);
    });
  }, [
    activeProjectId,
    copy.persistence.failed,
    copy.persistence.uploadSaved,
    currentLayoutState,
    persistOperation,
    refreshDocumentItems,
    replacePdfObjectUrl,
    uiPreferences,
    workspaceId,
  ]);

  const handlePdfDocumentReady = useCallback((pageCount: number) => {
    setPdfPageCount(pageCount);
    setCurrentPageNo((current) => Math.min(Math.max(current, 1), Math.max(pageCount, 1)));
    setPack((current) => {
      if (current.pages.every((item) => item.status === "draft" && !item.teaching.speaker_notes_md)) {
        return createDraftPagePack(current.document.title, current.document.source_pdf_url, pageCount, current.document.id);
      }
      return {
        ...current,
        document: {
          ...current.document,
          page_count: pageCount,
        },
      };
    });
    if (documentId && pack.document.id === documentId) {
      setDocumentItems((items) => items.map((item) =>
        item.documentId === documentId
          ? { ...item, pageCount, currentPdfPageNumber: currentPdfPageNo, generatedPageCount, status: "ready" }
          : item,
      ));
    }
    if (workspaceId && documentId && pack.document.id === documentId) {
      void persistOperation(async () => {
        await saveWorkspacePatch(workspaceId, { currentPdfPageNumber: currentPdfPageNo });
        await saveDocumentPatch(documentId, {
          pageCount,
          currentPdfPageNumber: currentPdfPageNo,
          status: "ready",
        });
      }).catch(() => undefined);
    }
  }, [currentPdfPageNo, documentId, generatedPageCount, pack.document.id, persistOperation, workspaceId]);

  const handlePdfContextReady = useCallback((context: PdfContextPayload) => {
    setPdfTextContext(context);
  }, []);

  const handlePdfPagesTextReady = useCallback((pages: PdfContextPage[]) => {
    setPdfExtractedPages(pages);
  }, []);

  const loadJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = normalizePack(JSON.parse(String(reader.result)), copy);
        replacePdfObjectUrl("");
        setDocumentId(null);
        setThreadId(null);
        setPdfPageCount(null);
        setPdfTextContext(null);
        setPdfExtractedPages([]);
        setCurrentPageNo(next.pages[0]?.page_no || 1);
        setSelectedContext(null);
        setContexts([]);
        setAttachments([]);
        setPersistedMessages([]);
        setDocumentItems((items) => items.map((item) => ({ ...item, isActive: false })));
        setPack(next);
        setJobStatus(copy.status.jsonImported);
        void persistOperation(async () => {
          const saved = await saveImportedPagePack({
            workspaceId,
            projectId: activeProjectId,
            pack: next,
            settingsSnapshot: uiPreferences,
            layoutState: currentLayoutState(),
          });
          setWorkspaceId(saved.workspace.id);
          setActiveProjectId(saved.workspace.activeProjectId || saved.document.projectId || null);
          setDocumentId(saved.document.id);
          await refreshDocumentItems(saved.workspace.id, saved.document.id, saved.workspace.activeProjectId || saved.document.projectId || null);
          setThreadId(saved.thread.id);
          setAgentRuntimeKey(`${saved.thread.id}:0:${Date.now()}`);
          setPack({
            ...next,
            document: {
              ...next.document,
              id: saved.document.id,
              title: saved.document.title,
              source_pdf_url: saved.document.fileName,
              page_count: saved.document.pageCount || next.document.page_count,
            },
          });
          return saved;
        }, copy.persistence.saved).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
      } catch (error) {
        setJobStatus((error as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${pack.document.id || "lecture"}-synchropage.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportCurrentWorkspace = useCallback(() => {
    if (!workspaceId) {
      openSettings("storage");
      return;
    }
    void persistOperation(async () => {
      await forceSaveSnapshot();
      const payload = await exportWorkspace(workspaceId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${payload.workspace.title || "synchropage-workspace"}-workspace.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }, copy.persistence.workspaceExported).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [copy.persistence.failed, copy.persistence.workspaceExported, forceSaveSnapshot, openSettings, persistOperation, workspaceId]);

  const importWorkspaceBackup = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      void persistOperation(async () => {
        const payload = JSON.parse(String(reader.result)) as ExportedWorkspace;
        await importWorkspace(payload);
        const loaded = await loadLastWorkspace();
        if (!loaded) throw new Error(copy.persistence.restoreFailed);
        applyLoadedWorkspace(loaded, { restoreLayout: true });
        await refreshStorageEstimate();
        return loaded;
      }, copy.persistence.workspaceImported)
        .catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
    };
    reader.onerror = () => setJobStatus(reader.error?.message || copy.persistence.failed);
    reader.readAsText(file);
  }, [
    applyLoadedWorkspace,
    copy.persistence.failed,
    copy.persistence.restoreFailed,
    copy.persistence.workspaceImported,
    persistOperation,
    refreshStorageEstimate,
  ]);

  const clearCurrentWorkspace = useCallback(() => {
    if (!workspaceId) return;
    void persistOperation(async () => {
      await clearWorkspace(workspaceId);
      resetLocalWorkspaceState();
    }, copy.persistence.workspaceCleared)
      .then(() => void refreshStorageEstimate().catch(() => undefined))
      .catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [copy.persistence.failed, copy.persistence.workspaceCleared, persistOperation, refreshStorageEstimate, resetLocalWorkspaceState, workspaceId]);

  const resetCurrentWorkspace = useCallback(() => {
    if (workspaceId) {
      void clearWorkspace(workspaceId).catch(() => undefined);
    }
    resetLocalWorkspaceState();
    setSaveState({ kind: "draft", message: copy.persistence.localDraft, updatedAt: Date.now() });
    void refreshStorageEstimate().catch(() => undefined);
  }, [copy.persistence.localDraft, refreshStorageEstimate, resetLocalWorkspaceState, workspaceId]);

  const enablePersistentStorage = useCallback(() => {
    void persistOperation(async () => {
      const granted = await requestPersistentStorage();
      await refreshStorageEstimate();
      setPersistentStorageState(
        granted === true
          ? "persisted"
          : granted === false
            ? "best-effort"
            : "unsupported",
      );
      setJobStatus(granted ? copy.persistence.persistentEnabled : copy.persistence.persistentUnavailable);
    }, copy.persistence.saved).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [
    copy.persistence.failed,
    copy.persistence.persistentEnabled,
    copy.persistence.persistentUnavailable,
    copy.persistence.saved,
    persistOperation,
    refreshStorageEstimate,
  ]);

  const refreshDesktopStorageConfig = useCallback(async () => {
    const api = desktopApi();
    if (!api?.getStorageConfig) {
      setDesktopStorageConfig(null);
      return null;
    }
    const config = await api.getStorageConfig();
    setDesktopStorageConfig(config);
    return config;
  }, []);

  useEffect(() => {
    void refreshDesktopStorageConfig().catch(() => setDesktopStorageConfig(null));
  }, [refreshDesktopStorageConfig]);

  const chooseDesktopDataDirectory = useCallback(() => {
    const api = desktopApi();
    if (!api?.chooseDataDirectory) return;
    setDesktopStorageBusy(true);
    void api.chooseDataDirectory()
      .then((config) => {
        setDesktopStorageConfig(config);
        if (!config.canceled) {
          setJobStatus(config.restartRequired ? copy.settings.storage.dataDirectoryRestartRequired : copy.settings.storage.dataDirectorySaved);
        }
      })
      .catch((error) => setJobStatus((error as Error).message || copy.settings.storage.dataDirectoryFailed))
      .finally(() => setDesktopStorageBusy(false));
  }, [
    copy.settings.storage.dataDirectoryFailed,
    copy.settings.storage.dataDirectoryRestartRequired,
    copy.settings.storage.dataDirectorySaved,
  ]);

  const resetDesktopDataDirectory = useCallback(() => {
    const api = desktopApi();
    if (!api?.resetDataDirectory) return;
    setDesktopStorageBusy(true);
    void api.resetDataDirectory()
      .then((config) => {
        setDesktopStorageConfig(config);
        setJobStatus(config.restartRequired ? copy.settings.storage.dataDirectoryRestartRequired : copy.settings.storage.dataDirectoryReset);
      })
      .catch((error) => setJobStatus((error as Error).message || copy.settings.storage.dataDirectoryFailed))
      .finally(() => setDesktopStorageBusy(false));
  }, [
    copy.settings.storage.dataDirectoryFailed,
    copy.settings.storage.dataDirectoryReset,
    copy.settings.storage.dataDirectoryRestartRequired,
  ]);

  const restartDesktopApp = useCallback(() => {
    const api = desktopApi();
    if (!api?.restart) return;
    void api.restart().catch((error) => setJobStatus((error as Error).message || copy.settings.storage.dataDirectoryFailed));
  }, [copy.settings.storage.dataDirectoryFailed]);

  const repairLocalStorage = useCallback(() => {
    void persistOperation(async () => {
      const result = await repairWorkspaceStorage(workspaceId);
      await refreshStorageEstimate();
      setJobStatus(copy.persistence.storageRepaired(storageRepairCount(result)));
    }, copy.persistence.saved).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [copy.persistence, persistOperation, refreshStorageEstimate, workspaceId]);

  const startNewPersistedConversation = useCallback(() => {
    setPersistedMessages([]);
    setAgentRuntimeKey(`thread:local:${Date.now()}`);
    if (!workspaceId) return;
    void persistOperation(async () => {
      const thread = await createChatThread({
        workspaceId,
        documentId: documentId || undefined,
        title: "Main chat",
      });
      setThreadId(thread.id);
      setAgentRuntimeKey(`${thread.id}:0:${Date.now()}`);
      if (documentId) await clearPersistedSelectedContext(workspaceId, documentId);
    }).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [copy.persistence.failed, documentId, persistOperation, workspaceId]);

  const switchDocument = useCallback((nextDocumentId: string) => {
    if (!workspaceId || nextDocumentId === documentId) return;
    void persistOperation(async () => {
      await forceSaveSnapshot();
      const loaded = await loadWorkspaceDocument(workspaceId, nextDocumentId);
      applyLoadedWorkspace(loaded);
      return loaded;
    }, copy.persistence.restored).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [
    applyLoadedWorkspace,
    copy.persistence.failed,
    copy.persistence.restored,
    documentId,
    forceSaveSnapshot,
    persistOperation,
    workspaceId,
  ]);

  const switchProject = useCallback((nextProjectId: string) => {
    if (!workspaceId || nextProjectId === activeProjectId) return;
    void persistOperation(async () => {
      await forceSaveSnapshot();
      const loaded = await loadWorkspaceProject(workspaceId, nextProjectId);
      applyLoadedWorkspace(loaded);
      return loaded;
    }, copy.persistence.restored).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [
    activeProjectId,
    applyLoadedWorkspace,
    copy.persistence.failed,
    copy.persistence.restored,
    forceSaveSnapshot,
    persistOperation,
    workspaceId,
  ]);

  const openDocumentFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, nextDocumentId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    switchDocument(nextDocumentId);
  }, [switchDocument]);

  const openProjectFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, nextProjectId: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    switchProject(nextProjectId);
  }, [switchProject]);

  const archiveDocumentToCurrentProject = useCallback((item: DocumentSidebarItem) => {
    if (!workspaceId || !currentProjectId || !activeProject) {
      setJobStatus(copy.rail.archiveUnavailable);
      return;
    }
    if (item.projectId === currentProjectId) {
      setJobStatus(copy.rail.alreadyArchivedToCourse(item.title, activeProject.name));
      return;
    }
    void persistOperation(async () => {
      await saveDocumentPatch(item.documentId, { projectId: currentProjectId });
      await refreshDocumentItems(workspaceId, documentId, currentProjectId);
      return item;
    }, copy.rail.archivedToCourse(item.title, activeProject.name)).catch((error) => {
      setJobStatus((error as Error).message || copy.persistence.failed);
    });
  }, [
    activeProject,
    copy.persistence.failed,
    copy.rail,
    currentProjectId,
    documentId,
    persistOperation,
    refreshDocumentItems,
    workspaceId,
  ]);

  const executeDeleteDocumentFromRail = useCallback((item: DocumentSidebarItem) => {
    if (!workspaceId) return;
    void persistOperation(async () => {
      await forceSaveSnapshot();
      const loaded = await deleteWorkspaceDocument(workspaceId, item.documentId);
      if (loaded) applyLoadedWorkspace(loaded);
      return loaded;
    }, copy.rail.documentDeleted(item.title)).catch((error) => {
      setJobStatus((error as Error).message || copy.persistence.failed);
    });
  }, [
    applyLoadedWorkspace,
    copy.persistence.failed,
    copy.rail,
    forceSaveSnapshot,
    persistOperation,
    workspaceId,
  ]);

  const deleteDocumentFromRail = useCallback((item: DocumentSidebarItem) => {
    if (!workspaceId) return;
    setRailConfirmAction({
      title: copy.rail.deleteDocument(item.title),
      description: copy.rail.confirmDeleteDocument(item.title),
      confirmLabel: copy.rail.confirmDeleteAction,
      onConfirm: () => executeDeleteDocumentFromRail(item),
    });
  }, [copy.rail, executeDeleteDocumentFromRail, workspaceId]);

  const executeDeleteProjectFromRail = useCallback((project: CourseProjectRecord) => {
    if (!workspaceId) return;
    void persistOperation(async () => {
      await forceSaveSnapshot();
      const loaded = await deleteCourseProject(workspaceId, project.id);
      if (loaded) applyLoadedWorkspace(loaded);
      return loaded;
    }, copy.rail.courseDeleted(project.name)).catch((error) => {
      setJobStatus((error as Error).message || copy.persistence.failed);
    });
  }, [
    applyLoadedWorkspace,
    copy.persistence.failed,
    copy.rail,
    forceSaveSnapshot,
    persistOperation,
    workspaceId,
  ]);

  const deleteProjectFromRail = useCallback((project: CourseProjectRecord) => {
    if (!workspaceId) return;
    setRailConfirmAction({
      title: copy.rail.deleteCourse(project.name),
      description: copy.rail.confirmDeleteCourse(project.name, project.documentCount),
      confirmLabel: copy.rail.confirmDeleteAction,
      onConfirm: () => executeDeleteProjectFromRail(project),
    });
  }, [copy.rail, executeDeleteProjectFromRail, workspaceId]);

  const createProjectFromDialog = useCallback(() => {
    const name = courseDraftName.trim();
    if (!name) {
      setCourseDialogOpen(false);
      setCourseDraftName("");
      return;
    }
    void persistOperation(async () => {
      await forceSaveSnapshot();
      const workspace = await ensureWorkspace({
        workspaceId,
        settingsSnapshot: uiPreferences,
        layoutState: currentLayoutState(),
      });
      const project = await createCourseProject({ workspaceId: workspace.id, name });
      const loaded = await loadWorkspaceProject(workspace.id, project.id);
      applyLoadedWorkspace(loaded);
      setCourseDialogOpen(false);
      setCourseDraftName("");
      return project;
    }, copy.persistence.saved).catch((error) => setJobStatus((error as Error).message || copy.persistence.failed));
  }, [
    applyLoadedWorkspace,
    copy.persistence.failed,
    copy.persistence.saved,
    courseDraftName,
    currentLayoutState,
    forceSaveSnapshot,
    persistOperation,
    uiPreferences,
    workspaceId,
  ]);

  const handleActivePdfPageChange = useCallback((pageNumber: number) => {
    setCurrentPageNo((current) => {
      const nextPage = Math.min(Math.max(pageNumber, 1), pdfNavigationPageCount);
      return current === nextPage ? current : nextPage;
    });
  }, [pdfNavigationPageCount]);

  const movePage = (delta: number) => {
    const targetPage = Math.min(Math.max(currentPdfPageNo + delta, 1), pdfNavigationPageCount);
    if (pdfUrl && pdfScrollViewerRef.current && pdfViewMode === "continuous") {
      setCurrentPageNo(targetPage);
      pdfScrollViewerRef.current.scrollToPage(targetPage, "smooth");
      return;
    }
    setCurrentPageNo(targetPage);
  };

  const { handleGenerateNotes, handleGenerateProjectMissingNotes } = useGenerationEngine({
    isGeneratingNotes,
    setIsGeneratingNotes,
    pack,
    setPack,
    pdfExtractedPages,
    setPdfExtractedPages,
    pdfPageCount,
    pdfUrl,
    generatePageMode,
    generateRangeDraft,
    currentPdfPageNo,
    setCurrentPageNo,
    teachingOutputLanguage,
    workspaceId,
    documentId,
    activeProjectId,
    documentItems,
    copy,
    uiPreferences,
    modelApiConfig,
    generationAbortControllerRef,
    setJobStatus,
    setPanels,
    setActiveTab,
    refreshDocumentItems,
  });

  const activeModelProvider = modelApiConfig.providers.find((provider) => provider.id === modelApiConfig.selectedProviderId);
  const authText =
    activeModelProvider && activeModelProvider.type !== "codex-oauth"
      ? `Model API: ${activeModelProvider.name}${activeModelProvider.enabled ? "" : " · disabled"}`
      : oauthMode === "connected"
        ? copy.auth.gatewayConnected(oauthAccount)
        : oauthMode === "polling"
          ? copy.auth.gatewayWaiting
          : oauthMode === "offline"
            ? copy.auth.gatewayOffline
            : copy.auth.gatewayDisconnected;
  const connectionText =
    oauthMode === "connected"
      ? copy.auth.connectionConnected
      : oauthMode === "polling"
        ? copy.auth.connectionWaiting
        : oauthMode === "offline" || oauthMode === "mock"
          ? copy.auth.connectionLocal
          : copy.auth.connectionReady;

  return (
    <AppCopyContext.Provider value={copy}>
      <div
        ref={appShellRef}
        className={`app-shell ${pdfOnly ? "pdf-focus" : ""} ${uiPreferences.compactMode ? "compact-mode" : ""}`}
        data-accent={uiPreferences.accentColor}
        data-font-scale={uiPreferences.fontScale}
        data-pdf-background={uiPreferences.pdfBackground}
        data-scrollbar-style={uiPreferences.scrollbarStyle}
        data-theme-mode={uiPreferences.theme}
        data-debug-mode={uiPreferences.debugMode}
        data-fullscreen-mode={isBrowserFullscreen}
        lang={uiPreferences.language === "en-US" ? "en" : "zh-CN"}
      >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">SP</div>
          <div>
            <h1>SynchroPage</h1>
            <p>{pack.document.title}</p>
          </div>
        </div>
        <PageNavigator
          className="topbar-page-nav"
          currentPage={currentPdfPageNo}
          pageCount={pdfNavigationPageCount}
          previousLabel={copy.pdf.previousPage}
          nextLabel={copy.pdf.nextPage}
          onPrevious={() => movePage(-1)}
          onNext={() => movePage(1)}
        />
        <div className="topbar-actions">
          <button
            className={`save-status-pill ${isRestoringWorkspace ? "saving" : saveState.kind}`}
            type="button"
            aria-label={copy.persistence.saveStatusLabel}
            title={saveState.kind === "error" || saveState.kind === "quota" ? copy.persistence.retrySave : copy.persistence.saveStatusLabel}
            onClick={handleSaveStatusClick}
          >
            {isRestoringWorkspace || saveState.kind === "saving" ? <Clock /> : saveState.kind === "saved" ? <Check /> : <span aria-hidden="true" />}
            <span>{isRestoringWorkspace ? copy.persistence.saving : saveState.message || copy.persistence.localDraft}</span>
          </button>
          <div className="layout-switcher" role="group" aria-label={copy.topbar.layoutSwitcherAria}>
            <IconButton label={copy.topbar.restoreWorkbench} active={fullWorkbench} onClick={() => setPanels(fullPanelVisibility)}>
              <Columns3 />
            </IconButton>
            <IconButton label={panels.rail ? copy.topbar.hideRail : copy.topbar.showRail} active={panels.rail} onClick={() => togglePanel("rail")}>
              {panels.rail ? <PanelLeftClose /> : <PanelLeftOpen />}
            </IconButton>
            <IconButton label={panels.notes ? copy.topbar.hideNotes : copy.topbar.showNotes} active={panels.notes} onClick={() => togglePanel("notes")}>
              <NotebookText />
            </IconButton>
            <IconButton label={panels.agent ? copy.topbar.hideAgent : copy.topbar.showAgent} active={panels.agent} onClick={() => togglePanel("agent")}>
              {panels.agent ? <PanelRightClose /> : <PanelRightOpen />}
            </IconButton>
            <IconButton label={pdfOnly ? copy.topbar.exitPdfFocus : copy.topbar.pdfOnly} active={pdfOnly || isBrowserFullscreen} onClick={togglePdfOnly}>
              {isBrowserFullscreen ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
          </div>
          <div className="command-menu" ref={commandMenuRef}>
            <button
              className={`mini-button ${commandMenuOpen ? "active" : ""}`}
              type="button"
              aria-label={copy.topbar.moreActions}
              aria-expanded={commandMenuOpen}
              title={copy.topbar.moreActions}
              onClick={() => {
                setGenerateMenuOpen(false);
                setCommandMenuOpen((open) => !open);
              }}
            >
              <MoreHorizontal />
            </button>
            {commandMenuOpen ? (
              <div className="command-menu-popover">
                <button type="button" onClick={() => {
                  closeCommandMenu();
                  void connectOAuth();
                }}>
                  <Lock />
                  {oauthMode === "polling" ? copy.topbar.viewOpenAiCode : copy.topbar.connectOpenAi}
                </button>
                <button type="button" onClick={() => {
                  jsonImportInputRef.current?.click();
                  closeCommandMenu();
                }}>
                  <FileInput />
                  {copy.topbar.importJson}
                </button>
                <button type="button" onClick={() => {
                  closeCommandMenu();
                  exportJson();
                }}>
                  <FileJson />
                  {copy.topbar.exportJson}
                </button>
                <button type="button" onClick={() => {
                  closeCommandMenu();
                  openSettings("advanced");
                }}>
                  <Settings2 />
                  {copy.topbar.advancedSettings}
                </button>
              </div>
            ) : null}
            <input
              ref={jsonImportInputRef}
              className="command-menu-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) loadJson(file);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={workspaceImportInputRef}
              className="command-menu-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importWorkspaceBackup(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
          <div className="generate-split" ref={generateMenuRef}>
            <button
              className={`primary-button generate-main-button ${isGeneratingNotes ? "is-stopping" : ""}`}
              type="button"
              onClick={() => {
                setGenerateMenuOpen(false);
                if (isGeneratingNotes) {
                  stopNotesGeneration();
                } else {
                  handleGenerateNotes();
                }
              }}
              title={isGeneratingNotes ? copy.topbar.stopGeneration : generateScopeSummary}
            >
              {isGeneratingNotes ? <Square /> : <Sparkles />}
              {isGeneratingNotes ? copy.topbar.stopGeneration : copy.topbar.generate}
            </button>
            <button
              className={`primary-button generate-menu-button ${generateMenuOpen ? "active" : ""} ${isGeneratingNotes ? "is-stopping" : ""}`}
              type="button"
              aria-label={copy.topbar.generateScopeLabel}
              aria-expanded={generateMenuOpen}
              title={generateScopeSummary}
              disabled={isGeneratingNotes}
              onClick={() => {
                setCommandMenuOpen(false);
                setGenerateMenuOpen((open) => !open);
              }}
            >
              <ChevronDown />
            </button>
            {generateMenuOpen ? (
              <div className="generate-menu-popover">
                <div className="generate-menu-heading">
                  <span>{copy.topbar.generateScopeLabel}</span>
                  <small>{generateScopeSummary}</small>
                </div>
                {([
                  ["missing", copy.topbar.generateScopeMissing, copy.topbar.generateScopeMissingDescription],
                  ["current", copy.topbar.generateScopeCurrent(currentPdfPageNo), copy.topbar.generateScopeCurrentDescription],
                  ["all", copy.topbar.generateScopeAll, copy.topbar.generateScopeAllDescription],
                ] as const).map(([mode, label, description]) => (
                  <button
                    key={mode}
                    className={`generate-scope-option ${generatePageMode === mode ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      setGeneratePageMode(mode);
                      setGenerateMenuOpen(false);
                    }}
                  >
                    <Check />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </button>
                ))}
                <label className={`generate-range-field ${generatePageMode === "custom" ? "active" : ""}`}>
                  <span>
                    <strong>{copy.topbar.generateScopeCustom}</strong>
                    <small>{copy.topbar.generateScopeCustomDescription}</small>
                  </span>
                  <input
                    value={generateRangeDraft}
                    placeholder={copy.topbar.generateScopeCustomPlaceholder}
                    onFocus={() => setGeneratePageMode("custom")}
                    onChange={(event) => {
                      setGeneratePageMode("custom");
                      setGenerateRangeDraft(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setGenerateMenuOpen(false);
                    }}
                  />
                </label>
                <button
                  className="generate-scope-option"
                  type="button"
                  onClick={() => {
                    setGenerateMenuOpen(false);
                    handleGenerateProjectMissingNotes();
                  }}
                >
                  <FileInput />
                  <span>
                    <strong>{copy.topbar.generateScopeProjectMissing}</strong>
                    <small>{copy.topbar.generateScopeProjectMissingDescription}</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {oauthDevice && (
        <OAuthDeviceDialog
          copy={copy}
          device={oauthDevice}
          secondsLeft={oauthSecondsLeft}
          copied={oauthCodeCopied}
          onCopy={copyOAuthUserCode}
          onOpen={openOAuthVerification}
          onCancel={cancelOAuthLogin}
        />
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            activeSection={settingsSection}
            onSectionChange={setSettingsSection}
            preferences={uiPreferences}
            onPreferenceChange={updatePreference}
            modelApiConfig={modelApiConfig}
            modelApiStatus={modelApiStatus}
            onModelApiConfigChange={updateModelApiConfig}
            onSaveModelApiConfig={saveModelApiConfig}
            onFetchProviderModels={fetchProviderModels}
            onCheckProviderModel={checkProviderModel}
            onResetLayout={() => {
              setPanels(defaultPanelVisibility);
              setJobStatus(copy.status.layoutReset);
            }}
            onResetPreferences={resetPreferences}
            onConnectOAuth={connectOAuth}
            oauthMode={oauthMode}
            oauthAccount={oauthAccount}
            providerStatus={authText}
            jobStatus={jobStatus}
            documentTitle={pack.document.title}
            saveState={saveState}
            storageEstimate={storageEstimate}
            persistentStorageState={persistentStorageState}
            desktopStorageConfig={desktopStorageConfig}
            desktopStorageBusy={desktopStorageBusy}
            hasWorkspace={Boolean(workspaceId)}
            onRequestPersistentStorage={enablePersistentStorage}
            onChooseDesktopDataDirectory={chooseDesktopDataDirectory}
            onResetDesktopDataDirectory={resetDesktopDataDirectory}
            onRestartDesktopApp={restartDesktopApp}
            onExportWorkspace={exportCurrentWorkspace}
            onImportWorkspace={() => workspaceImportInputRef.current?.click()}
            onClearWorkspace={clearCurrentWorkspace}
            onRepairStorage={repairLocalStorage}
            onResetWorkspace={resetCurrentWorkspace}
          />
        </Suspense>
      )}

      <SelectionToolbar
        state={selectionToolbar}
        onAdd={(context) => captureSelection(context)}
        onExplain={(context) => sendSelectionPrompt(context, "explain")}
        onSummarize={(context) => sendSelectionPrompt(context, "summarize")}
      />

      {courseDialogOpen && (
        <div className="course-dialog-overlay" role="presentation" onMouseDown={() => setCourseDialogOpen(false)}>
          <div className="course-dialog" role="dialog" aria-modal="true" aria-label={copy.rail.courseDialogTitle} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{copy.rail.courseDialogTitle}</h2>
            <input
              autoFocus
              value={courseDraftName}
              onChange={(event) => setCourseDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createProjectFromDialog();
                if (event.key === "Escape") setCourseDialogOpen(false);
              }}
              placeholder={copy.rail.courseNamePlaceholder}
            />
            <div className="course-dialog-actions">
              <button type="button" onClick={() => setCourseDialogOpen(false)}>{copy.rail.cancel}</button>
              <button type="button" disabled={!courseDraftName.trim()} onClick={createProjectFromDialog}>{copy.rail.createCourse}</button>
            </div>
          </div>
        </div>
      )}

      {railConfirmAction && (
        <div
          className="rail-confirm-overlay"
          role="presentation"
          onMouseDown={() => setRailConfirmAction(null)}
        >
          <div
            className="rail-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rail-confirm-title"
            aria-describedby="rail-confirm-description"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setRailConfirmAction(null);
            }}
          >
            <h2 id="rail-confirm-title">{railConfirmAction.title}</h2>
            <p id="rail-confirm-description">{railConfirmAction.description}</p>
            <div className="rail-confirm-actions">
              <button className="settings-button" type="button" autoFocus onClick={() => setRailConfirmAction(null)}>
                {copy.settings.confirm.cancel}
              </button>
              <button
                className="settings-button destructive-outline"
                type="button"
                onClick={() => {
                  const action = railConfirmAction;
                  setRailConfirmAction(null);
                  action.onConfirm();
                }}
              >
                {railConfirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="workspace" data-pane-count={visiblePaneCount}>
        <PanelGroup orientation="horizontal" className="workspace-panels">
          <Panel className="workspace-panel" hidden={!panels.rail} defaultSize={17} minSize={14}>
            <aside className="page-rail document-rail">
              <div className="rail-top">
                <div className="rail-header">
                  <div className="rail-header-copy">
                    <span className="rail-eyebrow">{copy.rail.courses}</span>
                    <strong>{activeProject?.name || copy.rail.defaultCourse}</strong>
                  </div>
                  <div className="rail-header-actions" ref={railActionMenuRef}>
                    <button
                      className={`rail-icon-button ${railActionMenuOpen ? "active" : ""}`}
                      type="button"
                      onClick={() => setRailActionMenuOpen((open) => !open)}
                      title={copy.rail.uploadDocument}
                      aria-label={copy.rail.uploadDocument}
                      aria-haspopup="menu"
                      aria-expanded={railActionMenuOpen}
                    >
                      <Plus />
                    </button>
                    {railActionMenuOpen ? (
                      <div className="rail-action-menu" role="menu">
                        <FileButton
                          label={copy.rail.uploadDocument}
                          accept="application/pdf"
                          multiple
                          onFiles={(files) => {
                            setRailActionMenuOpen(false);
                            loadPdfFiles(files);
                          }}
                        >
                          <Upload />
                          <span>{copy.rail.uploadDocument}</span>
                        </FileButton>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setRailActionMenuOpen(false);
                            setCourseDialogOpen(true);
                          }}
                        >
                          <BookOpen />
                          <span>{copy.rail.newCourse}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="search-box">
                  <Search aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.rail.searchPlaceholder} />
                </div>
              </div>
              <div className="rail-nav">
                <section className="rail-section">
                  <div className="rail-section-label">
                    <span>{copy.rail.courses}</span>
                    <small>{sidebarProjects.length}</small>
                  </div>
                  {filteredProjects.map((project) => (
                    <div
                      className={`course-item ${project.id === currentProjectId ? "active" : ""}`}
                      key={project.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => switchProject(project.id)}
                      onKeyDown={(event) => openProjectFromKeyboard(event, project.id)}
                    >
                      <BookOpen />
                      <span>{project.name}</span>
                      <small>{copy.rail.courseDocumentCount(project.documentCount)}</small>
                      {workspaceId && (
                        <span className="rail-row-actions">
                          <button
                            className="rail-row-action rail-delete-button"
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              deleteProjectFromRail(project);
                            }}
                            title={copy.rail.deleteCourse(project.name)}
                            aria-label={copy.rail.deleteCourse(project.name)}
                          >
                            <Trash2 />
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </section>

                <section className="rail-section">
                  <div className="rail-section-label">
                    <span>{copy.rail.documents}</span>
                    <small>{copy.rail.documentCount(documentsForSidebar.length)}</small>
                  </div>
                  <div className="document-list">
                    {documentsForSidebar.map((item) => (
                      <div
                        className={`document-item ${item.isActive ? "active" : ""}`}
                        key={item.documentId}
                        role="button"
                        tabIndex={0}
                        onClick={() => switchDocument(item.documentId)}
                        onKeyDown={(event) => openDocumentFromKeyboard(event, item.documentId)}
                      >
                        <span className="document-dot" />
                        <span className="document-copy">
                          <strong>{item.title}</strong>
                          <span>{copy.rail.documentMeta(Math.max(item.pageCount || 1, 1), item.generatedPageCount)}</span>
                        </span>
                        <span className={`document-state ${item.status === "missing-file" ? "missing" : ""}`} />
                        {workspaceId && (
                          <span className="rail-row-actions">
                            {item.projectId !== currentProjectId && (
                              <button
                                className="rail-row-action document-archive-button"
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  archiveDocumentToCurrentProject(item);
                                }}
                                title={copy.rail.archiveToCourse(activeProject?.name || copy.rail.defaultCourse)}
                                aria-label={copy.rail.archiveToCourse(activeProject?.name || copy.rail.defaultCourse)}
                              >
                                <Archive />
                              </button>
                            )}
                            <button
                              className="rail-row-action rail-delete-button"
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                deleteDocumentFromRail(item);
                              }}
                              title={copy.rail.deleteDocument(item.title)}
                              aria-label={copy.rail.deleteDocument(item.title)}
                            >
                              <Trash2 />
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                    {!documentsForSidebar.length && (
                      <div className="rail-empty">{normalizedDocumentQuery ? copy.rail.emptyDocuments : copy.rail.emptyCourseDocuments}</div>
                    )}
                  </div>
                </section>

                {!!recentDocuments.length && (
                  <section className="rail-section">
                    <div className="rail-section-label">
                      <span>{copy.rail.recents}</span>
                    </div>
                    {recentDocuments.map((item) => (
                      <div
                        className="recent-item"
                        key={item.documentId}
                        role="button"
                        tabIndex={0}
                        onClick={() => switchDocument(item.documentId)}
                        onKeyDown={(event) => openDocumentFromKeyboard(event, item.documentId)}
                      >
                        <span>{item.title}</span>
                        {workspaceId && (
                          <span className="rail-row-actions">
                            {item.projectId !== currentProjectId && (
                              <button
                                className="rail-row-action document-archive-button"
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  archiveDocumentToCurrentProject(item);
                                }}
                                title={copy.rail.archiveToCourse(activeProject?.name || copy.rail.defaultCourse)}
                                aria-label={copy.rail.archiveToCourse(activeProject?.name || copy.rail.defaultCourse)}
                              >
                                <Archive />
                              </button>
                            )}
                            <button
                              className="rail-row-action rail-delete-button"
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                deleteDocumentFromRail(item);
                              }}
                              title={copy.rail.deleteDocument(item.title)}
                              aria-label={copy.rail.deleteDocument(item.title)}
                            >
                              <Trash2 />
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </div>
              <div className="rail-footer">
                <button className="rail-settings-button" type="button" onClick={() => openSettings("general")}>
                  <Settings />
                  <span>{copy.rail.settings}</span>
                  <small>{saveState.kind === "saved" ? copy.persistence.saved : saveState.message || copy.persistence.localDraft}</small>
                </button>
              </div>
            </aside>
          </Panel>

          {panels.rail && <WorkspaceResizeHandle />}

          <Panel
            className="workspace-panel"
            defaultSize={pdfOnly ? 100 : panels.notes && panels.agent ? 36 : panels.notes ? 52 : panels.agent ? 55 : 83}
            minSize={28}
          >
            <section className="pdf-pane">
              <PaneToolbar
                title={pdfUrl ? copy.common.sourcePdfPage(currentPdfPageNo) : copy.pdf.samplePdfPage}
                right={isBrowserFullscreen ? (
                  <div className="toolbar-actions">
                    <PageNavigator
                      className="pane-page-nav"
                      currentPage={currentPdfPageNo}
                      pageCount={pdfNavigationPageCount}
                      previousLabel={copy.pdf.previousPage}
                      nextLabel={copy.pdf.nextPage}
                      onPrevious={() => movePage(-1)}
                      onNext={() => movePage(1)}
                    />
                    <IconButton label={copy.topbar.exitPdfFocus} onClick={togglePdfOnly}>
                      <Minimize2 />
                    </IconButton>
                  </div>
                ) : undefined}
              />
              <div className={`pdf-frame ${pdfUrl ? "has-pdf" : ""}`}>
                {pdfUrl ? (
                  <PdfScrollViewer
                    ref={pdfScrollViewerRef}
                    documentId={pack.document.id}
                    documentTitle={pack.document.title}
                    fallbackSrc={pdfViewerSrc}
                    pageNumber={currentPdfPageNo}
                    url={pdfUrl}
                    viewMode={pdfViewMode}
                    pdfContextFullPageLimit={uiPreferences.pdfContextFullPageLimit}
                    pdfContextEdgePageCount={uiPreferences.pdfContextEdgePageCount}
                    onDocumentReady={handlePdfDocumentReady}
                    onActivePageChange={handleActivePdfPageChange}
                    onPdfContextReady={handlePdfContextReady}
                    onPdfPagesTextReady={handlePdfPagesTextReady}
                    onViewerScroll={clearSelection}
                  />
                ) : (
                  <SlidePreview page={page} copy={copy} />
                )}
              </div>
            </section>
          </Panel>

          {(panels.notes || panels.agent) && <WorkspaceResizeHandle />}

          <Panel className="workspace-panel" hidden={!panels.notes} defaultSize={panels.agent ? 25 : 31} minSize={22}>
            <section className="notes-pane">
              <PaneToolbar
                title={copy.notes.title}
                right={
                  <div className="notes-toolbar-right">
                    <div className="generation-details-control">
                      <button
                        className="source-pill generation-progress-trigger"
                        type="button"
                        aria-expanded={generationDetailsOpen}
                        aria-label={copy.topbar.generationDetailsLabel}
                        title={copy.topbar.generationDetailsLabel}
                        onClick={() => setGenerationDetailsOpen((open) => !open)}
                      >
                        <span className="generation-progress-mini" aria-hidden="true">
                          <span style={{ width: `${Math.round((currentPdfPageNo / pdfNavigationPageCount) * 100)}%` }} />
                        </span>
                        <span className="generation-progress-text">{copy.common.explanationProgress(currentPdfPageNo, pdfNavigationPageCount)}</span>
                      </button>
                      {generationDetailsOpen && (
                        <GenerationDetailsPopover
                          copy={copy}
                          currentPageNo={currentPdfPageNo}
                          pages={generationProgressPages}
                          summary={generationProgressSummary}
                          statusLabel={generationStatusLabel}
                        />
                      )}
                    </div>
                    <div className="tab-group">
                      {(["notes", "structure", "json"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={`tab-button ${activeTab === tab ? "active" : ""}`}
                          onClick={() => setActiveTab(tab)}
                        >
                          <span className="tab-label-full">
                            {tab === "notes" ? copy.notes.tabNotes : tab === "structure" ? copy.notes.tabStructure : copy.notes.tabJson}
                          </span>
                          <span className="tab-label-short" aria-hidden="true">
                            {tab === "notes" ? copy.notes.tabNotesShort : tab === "structure" ? copy.notes.tabStructureShort : copy.notes.tabJsonShort}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                }
              />
              <div className="notes-content">
                {activeTab === "notes" && <MarkdownBlock markdown={page.teaching.speaker_notes_md} concepts={page.teaching.concepts} />}
                {activeTab === "structure" && <StructurePanel page={page} copy={copy} />}
                {activeTab === "json" && <pre className="json-panel">{JSON.stringify(page, null, 2)}</pre>}
              </div>
            </section>
          </Panel>

          {panels.notes && panels.agent && <WorkspaceResizeHandle />}

          <Panel className="workspace-panel" hidden={!panels.agent} defaultSize={panels.notes ? 22 : 28} minSize={20}>
            {panels.agent && (
              <AgentPanel
                key={agentRuntimeKey}
                contexts={contexts}
                attachments={attachments}
                selectedContext={selectedContext}
                initialMessages={persistedMessages}
                pendingSelectionPrompt={pendingSelectionPrompt}
                setContexts={setContexts}
                setAttachments={setAttachments}
                setSelectedContext={setSelectedContext}
                clearPendingSelectionPrompt={(id) => {
                  setPendingSelectionPrompt((current) => (current?.id === id ? null : current));
                }}
                composerInputRef={composerInputRef}
                getSnapshot={getSnapshot}
                getDocumentFile={getDocumentFile}
                getPack={getPack}
                getPage={getPage}
                backendOffline={oauthMode === "offline" || oauthMode === "mock"}
                oauthMode={oauthMode}
                showSourcePills={uiPreferences.showSourcePills}
                pageAwareSuggestions={uiPreferences.pageAwareSuggestions}
                persistChatMessage={persistChatMessage}
                onNewConversation={startNewPersistedConversation}
              />
            )}
          </Panel>
        </PanelGroup>
      </main>

      {uiPreferences.debugMode && (
        <footer className="statusbar">
          <button
            className={`connection-indicator ${oauthMode}`}
            type="button"
            title={connectionText}
            aria-label={connectionText}
            onClick={() => openSettings("account")}
          >
            <span aria-hidden="true" />
          </button>
          <span>{jobStatus}</span>
        </footer>
      )}
      </div>
    </AppCopyContext.Provider>
  );
}

function WorkspaceResizeHandle() {
  const copy = useAppCopy();
  return (
    <PanelResizeHandle className="workspace-resize-handle" aria-label={copy.topbar.resizeHandle}>
      <span />
    </PanelResizeHandle>
  );
}

// AgentPanel, AgentPanelLoaded, and related types moved to ./components/agent/AgentPanel.tsx

// SelectionToolbar moved to ./components/SelectionToolbar.tsx

// PdfScrollViewer, PdfPageLayer, PdfPagePlaceholder, pdfPageDisplayMetrics,
// useElementWidth, hasSelectableText, isPdfRenderCancel moved to
// ./components/pdf/PdfScrollViewer.tsx
