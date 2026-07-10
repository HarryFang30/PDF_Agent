import type { Language } from "./settings";

export type AppCopy = {
  common: {
    assistant: string;
    selectedContent: string;
    image: string;
    ready: string;
    aligned: string;
    none: string;
    listSeparator: string;
    sentenceSeparator: string;
    sourcePdfPage: (pageNo: number | string) => string;
    explanationProgress: (current: number, total: number) => string;
    pageCount: (count: number) => string;
    readyCount: (count: number) => string;
    pageLabel: (pageNo: number | string) => string;
  };
  settings: {
    close: string;
    navAria: string;
    description: string;
    sections: {
      general: string;
      providers: string;
      models: string;
      appearance: string;
      agent: string;
      pdf: string;
      account: string;
      storage: string;
      advanced: string;
    };
    general: {
      languageLabel: string;
      languageDescription: string;
      chinese: string;
      english: string;
      savePreferencesLabel: string;
      savePreferencesDescription: string;
      resetLayoutLabel: string;
      resetLayoutDescription: string;
      resetLayoutButton: string;
    };
    appearance: {
      themeLabel: string;
      themeDescription: string;
      themeSystem: string;
      themeLight: string;
      themeDark: string;
      accentLabel: string;
      accentDescription: string;
      accentClay: string;
      accentGraphite: string;
      accentSage: string;
      pdfBackgroundLabel: string;
      pdfBackgroundDescription: string;
      pdfBackgroundPaper: string;
      pdfBackgroundPlain: string;
      pdfBackgroundSoft: string;
      fontScaleLabel: string;
      fontScaleDescription: string;
      fontCompact: string;
      fontDefault: string;
      fontLarge: string;
      compactModeLabel: string;
      compactModeDescription: string;
    };
    agent: {
      sourcePillsLabel: string;
      sourcePillsDescription: string;
      pageSuggestionsLabel: string;
      pageSuggestionsDescription: string;
      explanationLanguageLabel: string;
      explanationLanguageDescription: string;
      explanationLanguageAuto: string;
      explanationLanguageChinese: string;
      explanationLanguageEnglish: string;
      answerModeLabel: string;
      answerModeDescription: string;
      answerModeConcise: string;
      answerModeGuided: string;
      answerModeDetailed: string;
      modelReasoningEffortLabel: string;
      modelReasoningEffortDescription: string;
      reasoningEffortNone: string;
      reasoningEffortLow: string;
      reasoningEffortMedium: string;
      reasoningEffortHigh: string;
      reasoningEffortXHigh: string;
      reasoningEffortMax: string;
      pdfContextFullPageLimitLabel: string;
      pdfContextFullPageLimitDescription: string;
      pdfContextEdgePageCountLabel: string;
      pdfContextEdgePageCountDescription: string;
    };
    pdf: {
      scrollbarLabel: string;
      scrollbarDescription: string;
      scrollbarThin: string;
      scrollbarSubtle: string;
      scrollbarNative: string;
    };
    account: {
      oauthStatusLabel: string;
      oauthStatusDescription: string;
      connectedEmailLabel: string;
      connectedEmailDescription: string;
      providerStatusLabel: string;
      reconnectLabel: string;
      reconnectDescription: string;
      disconnectButton: string;
      connectButton: string;
      notConnected: string;
      statuses: {
        connected: string;
        polling: string;
        offline: string;
        mock: string;
        ready: string;
        unknown: string;
      };
    };
    storage: {
      saveStateLabel: string;
      saveStateDescription: string;
      workspaceCountLabel: string;
      workspaceCountDescription: string;
      documentCountLabel: string;
      documentCountDescription: string;
      usageLabel: string;
      usageDescription: string;
      persistentLabel: string;
      persistentDescription: string;
      persistentRequestButton: string;
      dataDirectoryLabel: string;
      dataDirectoryDescription: string;
      currentDataDirectory: string;
      pendingDataDirectoryLabel: string;
      pendingDataDirectory: (path: string) => string;
      dataDirectoryBrowserManaged: string;
      dataDirectoryManagedByEnv: string;
      defaultDirectory: string;
      chooseDataDirectoryButton: string;
      resetDataDirectoryButton: string;
      restartButton: string;
      dataDirectorySaved: string;
      dataDirectoryReset: string;
      dataDirectoryRestartRequired: string;
      dataDirectoryFailed: string;
      exportLabel: string;
      exportDescription: string;
      exportButton: string;
      importLabel: string;
      importDescription: string;
      importButton: string;
      clearLabel: string;
      clearDescription: string;
      clearButton: string;
      repairLabel: string;
      repairDescription: string;
      repairButton: string;
      resetLabel: string;
      resetDescription: string;
      resetButton: string;
      persisted: string;
      bestEffort: string;
      unsupported: string;
      unknown: string;
      noWorkspace: string;
    };
    confirm: {
      cancel: string;
      clearWorkspaceTitle: string;
      clearWorkspaceDescription: string;
      clearWorkspaceConfirm: string;
      resetWorkspaceTitle: string;
      resetWorkspaceDescription: string;
      resetWorkspaceConfirm: string;
      disconnectTitle: string;
      disconnectDescription: string;
      disconnectConfirm: string;
      resetPreferencesTitle: string;
      resetPreferencesDescription: string;
      resetPreferencesConfirm: string;
    };
    advanced: {
      debugLabel: string;
      debugDescription: string;
      clearPreferencesLabel: string;
      clearPreferencesDescription: string;
      clearPreferencesButton: string;
      diagnosticsLabel: string;
      diagnosticsHiddenDescription: string;
      visible: string;
      hidden: string;
    };
  };
  status: {
    localPrototype: string;
    preferencesReset: string;
    noSelection: string;
    selectionAdded: string;
    explainingSelection: string;
    summarizingSelection: string;
    codeCopied: (code: string) => string;
    enterCode: (code: string) => string;
    oauthCanceled: string;
    oauthDisconnected: string;
    codeShown: (code: string) => string;
    codeExpired: string;
    oauthConnected: string;
    oauthBackendMock: string;
    jsonImported: string;
    layoutReset: string;
    generationQueued: string;
    generationPreparingCache: (total: number) => string;
    generationStarted: (total: number) => string;
    generationPage: (current: number, total: number, pageNo: number) => string;
    generationPageRetrying: (pageNo: number, attempt: number, total: number) => string;
    generationPageFailed: (pageNo: number, message: string) => string;
    generationDone: (completed: number, total: number, skipped?: number) => string;
    generationBatchStarted: (documents: number, pages: number) => string;
    generationBatchDocument: (current: number, total: number, title: string) => string;
    generationBatchDone: (completed: number, pages: number, documents: number, skipped?: number) => string;
    generationBatchNoDocuments: string;
    generationAlreadyComplete: (total: number) => string;
    generationScopeAlreadyComplete: (scope: string) => string;
    generationInvalidPageRange: (total: number) => string;
    pdfTextExtracting: (ready: number, total: number) => string;
    pdfTextExtractionFallback: string;
  };
  errors: {
    accountNotFound: string;
    jsonNeedsPages: string;
    emptyGatewayResult: string;
    generationStopped: string;
    generationRequestStalled: (seconds: number) => string;
    generationBatchRequestStalled: (seconds: number) => string;
    generationRequestTimedOut: (seconds: number) => string;
    imageReadFailed: string;
    importedDocument: string;
    importedPageTitle: (index: number) => string;
  };
  auth: {
    gatewayConnected: (account: string | null) => string;
    gatewayWaiting: string;
    gatewayOffline: string;
    gatewayDisconnected: string;
    connectionConnected: string;
    connectionWaiting: string;
    connectionLocal: string;
    connectionReady: string;
  };
  persistence: {
    saving: string;
    saved: string;
    failed: string;
    quota: string;
    localDraft: string;
    restored: string;
    pdfMissing: string;
    restoreFailed: string;
    retrySave: string;
    saveStatusLabel: string;
    uploadSaved: string;
    workspaceCleared: string;
    workspaceExported: string;
    workspaceImported: string;
    persistentEnabled: string;
    persistentUnavailable: string;
    storageRepaired: (count: number) => string;
  };
  topbar: {
    resizeHandle: string;
    layoutSwitcherAria: string;
    restoreWorkbench: string;
    hideRail: string;
    showRail: string;
    hideNotes: string;
    showNotes: string;
    hideAgent: string;
    showAgent: string;
    exitPdfFocus: string;
    pdfOnly: string;
    uploadPdf: string;
    openSettings: string;
    moreActions: string;
    viewOpenAiCode: string;
    connectOpenAi: string;
    importJson: string;
    exportJson: string;
    advancedSettings: string;
    generate: string;
    stopGeneration: string;
    generateScopeLabel: string;
    generateScopeAll: string;
    generateScopeAllDescription: string;
    generateScopeMissing: string;
    generateScopeMissingDescription: string;
    generateScopeCurrent: (pageNo: number) => string;
    generateScopeCurrentDescription: string;
    generateScopeCustom: string;
    generateScopeCustomDescription: string;
    generateScopeCustomPlaceholder: string;
    generateScopeCustomSummary: (value: string) => string;
    generateScopeProjectMissing: string;
    generateScopeProjectMissingDescription: string;
    generationDetailsLabel: string;
    generationDetailsGenerated: string;
    generationDetailsPending: string;
    generationDetailsRunning: string;
    generationDetailsRetrying: string;
    generationDetailsFailed: string;
    generationDetailsCurrent: string;
    generationStatusDone: string;
    generationStatusRunning: string;
    generationStatusRetrying: string;
    generationStatusPending: string;
    generationStatusFailed: string;
  };
  rail: {
    searchPlaceholder: string;
    documents: string;
    courses: string;
    recents: string;
    settings: string;
    newCourse: string;
    courseDialogTitle: string;
    courseNamePlaceholder: string;
    createCourse: string;
    cancel: string;
    defaultCourse: string;
    emptyCourseDocuments: string;
    currentWorkspace: string;
    uploadDocument: string;
    emptyDocuments: string;
    activeDocument: string;
    missingFile: string;
    archiveToCourse: (courseName: string) => string;
    archivedToCourse: (documentTitle: string, courseName: string) => string;
    alreadyArchivedToCourse: (documentTitle: string, courseName: string) => string;
    archiveUnavailable: string;
    deleteDocument: (documentTitle: string) => string;
    deleteCourse: (courseName: string) => string;
    confirmDeleteAction: string;
    confirmDeleteDocument: (documentTitle: string) => string;
    confirmDeleteCourse: (courseName: string, documentCount: number) => string;
    documentDeleted: (documentTitle: string) => string;
    courseDeleted: (courseName: string) => string;
    documentMeta: (pageCount: number, generatedCount: number) => string;
    documentCount: (count: number) => string;
    courseDocumentCount: (count: number) => string;
  };
  pdf: {
    samplePdfPage: string;
    previousPage: string;
    nextPage: string;
    previewTitle: string;
    renderFailed: string;
    loading: string;
  };
  notes: {
    title: string;
    tabNotes: string;
    tabStructure: string;
    tabJson: string;
    tabNotesShort: string;
    tabStructureShort: string;
    tabJsonShort: string;
  };
  agent: {
    addImage: string;
    clearContext: string;
    newConversation: string;
    removeContext: string;
    removeImage: string;
    contextFormula: (pageNo: number) => string;
    contextSelection: (pageNo: number) => string;
    contextPdfReference: (pageNo: number) => string;
    contextSource: (pageNo: number, source: string) => string;
    selectedPdfPage: (pageNo: number | string) => string;
    selectedNotesPage: (pageNo: number | string) => string;
    assistantMessage: string;
    pageSource: (pageNo: number | string) => string;
    imagePreview: (name: string) => string;
    selectedFallbackSuggestions: string[];
    pageSuggestions: (title: string, concept: string) => string[];
    challengeTitle: string;
    challengeModeDiagnostic: string;
    challengeAction: string;
    challengeAria: string;
    challengeUserMessage: (kind: "quiz" | "problem", count: number) => string;
    challengeKindLabel: string;
    challengeQuizKind: string;
    challengeProblemKind: string;
    challengeCountLabel: string;
    challengeCorrect: string;
    challengeIncorrect: string;
    challengeAnswerLabel: string;
    challengeFollowUpLabel: string;
    challengeNext: string;
    challengeNewSet: string;
    challengeParseFailed: string;
    challengeProblemSuitable: string;
    challengeProblemUnsuitable: string;
    challengeProblemGivenLabel: string;
    challengeProblemTasksLabel: string;
    challengeProblemEntryLabel: string;
    challengeProblemHintAction: string;
    challengeProblemSelfCheckAction: string;
    challengeProblemTrapLabel: string;
    challengeProblemRubricLabel: string;
    challengeProblemAgain: string;
    quickExplainPrompt: (label: string) => string;
    quickSummarizePrompt: (label: string) => string;
    continuePrompt: string;
    localPreviewIntro: string;
    localPreviewSelected: (title: string) => string;
    localPreviewContexts: (count: number) => string;
    localPreviewPage: (pageNo: number) => string;
    localPreviewImages: (count: number) => string;
    localPreviewQuestion: (question: string) => string;
    selectionSources: {
      pdfPage: string;
      notes: string;
      assistant: string;
      rail: string;
      page: string;
    };
    askCurrentPage: string;
    quoteLabel: string;
    edit: string;
    generationStopped: string;
    generationFailed: string;
    copy: string;
    regenerate: string;
    askWithSelectionPlaceholder: string;
    askPlaceholder: string;
    inputAria: string;
    formulaTitle: string;
    stop: string;
    send: string;
    thinking: string;
    removeSelectedContent: string;
    selectionToolbarAria: string;
    addToConversation: string;
    explainSelection: string;
    summarizeSelection: string;
  };
  oauth: {
    kicker: string;
    title: string;
    cancel: string;
    codeAria: (code: string) => string;
    copied: string;
    copyCode: string;
    openAuthPage: string;
    expiresIn: (time: string) => string;
  };
  structure: {
    pageNo: string;
    parser: string;
    ocr: string;
    confidence: string;
    prerequisites: string;
    visualNotes: string;
    sourceText: string;
    ocrEnabled: string;
    ocrDisabled: string;
  };
};

const zhCN: AppCopy = {
  common: {
    assistant: "助手",
    selectedContent: "选中内容",
    image: "图片",
    ready: "已就绪",
    aligned: "已对齐",
    none: "无",
    listSeparator: "、",
    sentenceSeparator: "；",
    sourcePdfPage: (pageNo) => `来源 PDF p.${pageNo}`,
    explanationProgress: (current, total) => `讲解 ${current} / ${total}`,
    pageCount: (count) => `${count} 页`,
    readyCount: (count) => `${count} 已就绪`,
    pageLabel: (pageNo) => `第 ${pageNo} 页`,
  },
  settings: {
    close: "关闭设置",
    navAria: "设置分区",
    description: "管理低频配置，保持阅读工作区干净。",
    sections: {
      general: "通用",
      providers: "模型供应商",
      models: "默认模型",
      appearance: "外观",
      agent: "助手",
      pdf: "PDF 阅读器",
      account: "账户 / 网关",
      storage: "存储",
      advanced: "高级",
    },
    general: {
      languageLabel: "界面语言",
      languageDescription: "切换 SynchroPage 的固定界面文案。",
      chinese: "中文",
      english: "English",
      savePreferencesLabel: "保存界面偏好",
      savePreferencesDescription: "在本机保存主题、密度和面板显示相关偏好。关闭后，本页修改只在当前会话生效。",
      resetLayoutLabel: "重置界面布局",
      resetLayoutDescription: "恢复目录、讲解和助手面板。",
      resetLayoutButton: "重置布局",
    },
    appearance: {
      themeLabel: "主题",
      themeDescription: "选择清爽浅色、专注深色，或跟随系统外观。",
      themeSystem: "跟随系统",
      themeLight: "浅色",
      themeDark: "深色",
      accentLabel: "强调色",
      accentDescription: "选择用于主操作、焦点和选中状态的界面强调色。",
      accentClay: "靛蓝",
      accentGraphite: "石墨灰",
      accentSage: "鼠尾草绿",
      pdfBackgroundLabel: "PDF 背景",
      pdfBackgroundDescription: "调整文档背后的低噪声底色。",
      pdfBackgroundPaper: "纸张",
      pdfBackgroundPlain: "纯净",
      pdfBackgroundSoft: "柔和",
      fontScaleLabel: "字体大小",
      fontScaleDescription: "应用于讲解、助手输出和阅读文本。",
      fontCompact: "紧凑",
      fontDefault: "默认",
      fontLarge: "偏大",
      compactModeLabel: "紧凑模式",
      compactModeDescription: "减少 toolbar 和 pane 的间距。",
    },
    agent: {
      sourcePillsLabel: "显示来源 pill",
      sourcePillsDescription: "在对话上方显示紧凑来源上下文。",
      pageSuggestionsLabel: "页面感知建议",
      pageSuggestionsDescription: "根据当前页标题和概念生成空状态提示。",
      explanationLanguageLabel: "讲解输出语言",
      explanationLanguageDescription: "控制一键生成讲解的标题、正文和表格说明语言。默认跟随界面语言。",
      explanationLanguageAuto: "跟随界面",
      explanationLanguageChinese: "中文",
      explanationLanguageEnglish: "English",
      answerModeLabel: "问答回答模式",
      answerModeDescription: "控制 Agent 问答的回答结构和实际 reasoning.effort；讲解生成仍使用下方模型思考强度。",
      answerModeConcise: "简洁型 · medium",
      answerModeGuided: "引导型 · high",
      answerModeDetailed: "细节型 · extra high",
      modelReasoningEffortLabel: "模型思考强度",
      modelReasoningEffortDescription: "写入 Responses API 的 reasoning.effort。强度越高通常越慢、成本越高，但复杂任务更可靠。",
      reasoningEffortNone: "none · 最快",
      reasoningEffortLow: "low · 轻量",
      reasoningEffortMedium: "medium · 推荐",
      reasoningEffortHigh: "high · 深度",
      reasoningEffortXHigh: "xhigh · 最强",
      reasoningEffortMax: "max · GPT-5.6 极限",
      pdfContextFullPageLimitLabel: "全文上下文页数阈值",
      pdfContextFullPageLimitDescription: "控制 PDF 直传之外的可缓存页级文本索引：页数不超过时保留全文文本索引，原始 PDF 会优先直传。",
      pdfContextEdgePageCountLabel: "长 PDF 前后截取页数",
      pdfContextEdgePageCountDescription: "超过阈值时，只缓存开头和结尾页的文本索引；原始 PDF 仍会优先作为模型输入。",
    },
    pdf: {
      scrollbarLabel: "滚动条样式",
      scrollbarDescription: "应用于工作区滚动容器。",
      scrollbarThin: "细",
      scrollbarSubtle: "更弱",
      scrollbarNative: "系统默认",
    },
    account: {
      oauthStatusLabel: "OAuth 状态",
      oauthStatusDescription: "OpenAI Gateway 连接状态。",
      connectedEmailLabel: "已连接邮箱",
      connectedEmailDescription: "只在这里显示，不出现在主界面状态栏。",
      providerStatusLabel: "Provider 状态",
      reconnectLabel: "重新连接 / 退出",
      reconnectDescription: "复用现有 OAuth start/logout 流程。",
      disconnectButton: "退出登录",
      connectButton: "连接 OpenAI",
      notConnected: "未连接",
      statuses: {
        connected: "已连接",
        polling: "等待设备验证码",
        offline: "后端未启动",
        mock: "本地预览",
        ready: "可连接",
        unknown: "检查中",
      },
    },
    storage: {
      saveStateLabel: "保存状态",
      saveStateDescription: "当前工作区的本地自动保存状态。",
      workspaceCountLabel: "工作区数量",
      workspaceCountDescription: "本机保存的阅读工作区。",
      documentCountLabel: "文档数量",
      documentCountDescription: "本机保存的 PDF 与讲解文档。",
      usageLabel: "本地存储占用",
      usageDescription: "浏览器报告的站点存储估算值。",
      persistentLabel: "持久存储",
      persistentDescription: "请求浏览器尽量不要在存储压力下清理本地草稿。",
      persistentRequestButton: "启用持久存储",
      dataDirectoryLabel: "保存目录",
      dataDirectoryDescription: "桌面端工作区、PDF Blob、设置和后端 OAuth 数据的保存位置。更改后需重启应用生效。",
      currentDataDirectory: "当前目录",
      pendingDataDirectoryLabel: "重启后目录",
      pendingDataDirectory: (path) => `重启后使用：${path}`,
      dataDirectoryBrowserManaged: "浏览器模式由当前浏览器 profile 管理",
      dataDirectoryManagedByEnv: "由启动环境变量管理",
      defaultDirectory: "默认目录",
      chooseDataDirectoryButton: "选择目录",
      resetDataDirectoryButton: "恢复默认",
      restartButton: "重启应用",
      dataDirectorySaved: "保存目录已更新",
      dataDirectoryReset: "保存目录已恢复默认",
      dataDirectoryRestartRequired: "保存目录已更新，重启应用后生效",
      dataDirectoryFailed: "保存目录更新失败",
      exportLabel: "导出当前工作区",
      exportDescription: "导出 PDF、讲解、对话和本地元数据，便于备份。",
      exportButton: "导出",
      importLabel: "导入工作区",
      importDescription: "导入 SynchroPage 工作区备份并打开。",
      importButton: "导入",
      clearLabel: "清空当前工作区",
      clearDescription: "删除当前 PDF、讲解、对话和选区上下文。",
      clearButton: "清空",
      repairLabel: "检查并清理存储",
      repairDescription: "检查无引用数据并修复损坏引用。",
      repairButton: "检查清理",
      resetLabel: "重置当前工作区",
      resetDescription: "回到初始示例状态，并保留全局 UI 偏好。",
      resetButton: "重置",
      persisted: "已启用",
      bestEffort: "标准存储",
      unsupported: "浏览器不支持",
      unknown: "未知",
      noWorkspace: "暂无工作区",
    },
    confirm: {
      cancel: "取消",
      clearWorkspaceTitle: "清空当前工作区？",
      clearWorkspaceDescription: "这会删除当前 PDF、生成讲解、对话和选区上下文。此操作无法撤销。",
      clearWorkspaceConfirm: "清空",
      resetWorkspaceTitle: "重置当前工作区？",
      resetWorkspaceDescription: "这会移除当前工作区并回到初始示例状态。已保存的 PDF、讲解和对话将被删除。",
      resetWorkspaceConfirm: "重置",
      disconnectTitle: "断开 OpenAI OAuth？",
      disconnectDescription: "断开后，新的 AI 请求将无法继续使用当前 OAuth 会话，直到你重新连接。",
      disconnectConfirm: "断开连接",
      resetPreferencesTitle: "重置本地 UI 偏好？",
      resetPreferencesDescription: "这只会恢复主题、布局和界面偏好，不会删除 PDF、讲解或对话。",
      resetPreferencesConfirm: "重置偏好",
    },
    advanced: {
      debugLabel: "Debug 模式",
      debugDescription: "在低噪声 footer 中显示任务状态和诊断信息。",
      clearPreferencesLabel: "清除本地 UI 偏好",
      clearPreferencesDescription: "只重置本地视觉偏好。",
      clearPreferencesButton: "重置偏好",
      diagnosticsLabel: "开发者诊断",
      diagnosticsHiddenDescription: "开启 Debug 模式后显示运行状态。",
      visible: "可见",
      hidden: "隐藏",
    },
  },
  status: {
    localPrototype: "本地原型",
    preferencesReset: "本地 UI 设置已重置",
    noSelection: "没有可加入的页面选区",
    selectionAdded: "选中内容已加入对话",
    explainingSelection: "正在解释选中内容",
    summarizingSelection: "正在总结选中内容",
    codeCopied: (code) => `授权码 ${code} 已复制`,
    enterCode: (code) => `请在 OpenAI 页面输入授权码 ${code}`,
    oauthCanceled: "OAuth 登录已取消",
    oauthDisconnected: "OAuth 会话已断开",
    codeShown: (code) => `授权码 ${code} 已显示，复制后打开授权页`,
    codeExpired: "OAuth 授权码已过期",
    oauthConnected: "OAuth 已连接",
    oauthBackendMock: "OAuth 后端未启动，已进入静态模拟连接",
    jsonImported: "已导入 SynchroPage JSON",
    layoutReset: "工作区布局已重置",
    generationQueued: "生成任务已交给后端 harness",
    generationPreparingCache: (total) => `正在准备 ${total} 页 PDF 缓存上下文`,
    generationStarted: (total) => `开始生成 ${total} 页讲解`,
    generationPage: (current, total, pageNo) => `正在生成第 ${pageNo} 页讲解（${current}/${total}）`,
    generationPageRetrying: (pageNo, attempt, total) => `第 ${pageNo} 页无响应，正在第 ${attempt}/${total} 次重试`,
    generationPageFailed: (pageNo, message) => `第 ${pageNo} 页讲解生成失败：${message}`,
    generationDone: (completed, total, skipped = 0) => `讲解生成完成：新生成 ${completed} 页，已跳过 ${skipped} 页，当前 ${total} 页已检查`,
    generationBatchStarted: (documents, pages) => `开始批量生成 ${documents} 个文件，共 ${pages} 页待检查`,
    generationBatchDocument: (current, total, title) => `正在生成文件 ${current}/${total}：${title}`,
    generationBatchDone: (completed, pages, documents, skipped = 0) => `批量生成完成：${documents} 个文件，新生成 ${completed} 页，跳过 ${skipped} 页，共检查 ${pages} 页`,
    generationBatchNoDocuments: "当前课程没有可批量生成的 PDF 文件",
    generationAlreadyComplete: (total) => `${total} 页讲解已全部生成，无需重复生成`,
    generationScopeAlreadyComplete: (scope) => `选定页码 ${scope} 已全部生成，无需重复生成`,
    generationInvalidPageRange: (total) => `页码范围无效，请输入 1-${total} 之间的页码，例如 1-3, 8`,
    pdfTextExtracting: (ready, total) => `正在读取 PDF 文本层，已就绪 ${ready}/${total} 页`,
    pdfTextExtractionFallback: "PDF 文本层读取较慢，先使用已就绪内容继续生成",
  },
  errors: {
    accountNotFound: "请先连接 OpenAI OAuth 后再发送。",
    jsonNeedsPages: "JSON 需要包含 pages 数组",
    emptyGatewayResult: "AI 网关返回了空结果",
    generationStopped: "生成已停止",
    generationRequestStalled: (seconds) => `OpenAI 上游超过 ${seconds} 秒没有返回，已自动停止这一页。可能是服务端限流或请求卡住，请稍后重试。`,
    generationBatchRequestStalled: (seconds) => `OpenAI 上游超过 ${seconds} 秒没有返回，已自动拆分为单页重试。`,
    generationRequestTimedOut: (seconds) => `讲解生成超时（${seconds} 秒）。这一页可能是图表密集页、服务端限流或上游模型处理过慢，请稍后重试。`,
    imageReadFailed: "图片读取失败",
    importedDocument: "导入文档",
    importedPageTitle: (index) => `第 ${index + 1} 页讲解`,
  },
  auth: {
    gatewayConnected: (account) => `OpenAI Gateway：OAuth 会话已连接${account ? ` · ${account}` : ""}`,
    gatewayWaiting: "OpenAI Gateway：等待授权",
    gatewayOffline: "OpenAI Gateway：后端未启动",
    gatewayDisconnected: "OpenAI Gateway：未连接",
    connectionConnected: "OAuth 已连接",
    connectionWaiting: "等待验证码",
    connectionLocal: "本地预览",
    connectionReady: "网关就绪",
  },
  persistence: {
    saving: "正在保存...",
    saved: "已保存",
    failed: "保存失败，点击重试",
    quota: "存储空间不足",
    localDraft: "本地草稿",
    restored: "已恢复本地 workspace",
    pdfMissing: "PDF 文件缺失，metadata 已恢复",
    restoreFailed: "恢复 workspace 失败",
    retrySave: "重试保存",
    saveStatusLabel: "保存状态",
    uploadSaved: "PDF 已保存到本机",
    workspaceCleared: "本地 workspace 已清空",
    workspaceExported: "workspace 已导出",
    workspaceImported: "workspace 已导入",
    persistentEnabled: "浏览器已启用持久存储",
    persistentUnavailable: "浏览器未授予持久存储，将继续使用普通本地保存",
    storageRepaired: (count) => `存储检查完成，处理 ${count} 条异常记录`,
  },
  topbar: {
    resizeHandle: "调整面板宽度",
    layoutSwitcherAria: "工作区布局",
    restoreWorkbench: "恢复完整工作台",
    hideRail: "隐藏左侧目录",
    showRail: "显示左侧目录",
    hideNotes: "隐藏讲解面板",
    showNotes: "显示讲解面板",
    hideAgent: "隐藏助手",
    showAgent: "显示助手",
    exitPdfFocus: "退出 PDF 专注",
    pdfOnly: "只看 PDF",
    uploadPdf: "上传 PDF",
    openSettings: "打开设置",
    moreActions: "更多操作",
    viewOpenAiCode: "查看 OpenAI 验证码",
    connectOpenAi: "连接 OpenAI OAuth",
    importJson: "导入 SynchroPage JSON",
    exportJson: "导出 JSON",
    advancedSettings: "高级设置",
    generate: "生成",
    stopGeneration: "停止",
    generateScopeLabel: "生成范围",
    generateScopeAll: "全部页面",
    generateScopeAllDescription: "检查整份 PDF，已生成页会自动跳过",
    generateScopeMissing: "未生成页",
    generateScopeMissingDescription: "只补齐还没有讲解的页面",
    generateScopeCurrent: (pageNo) => `当前页 p.${pageNo}`,
    generateScopeCurrentDescription: "只生成正在查看的 PDF 页",
    generateScopeCustom: "指定页码",
    generateScopeCustomDescription: "输入页码或范围",
    generateScopeCustomPlaceholder: "例如 1-3, 8, 10-12",
    generateScopeCustomSummary: (value) => `指定页码：${value}`,
    generateScopeProjectMissing: "当前课程全部文件",
    generateScopeProjectMissingDescription: "补齐当前课程中所有 PDF 的未生成页面",
    generationDetailsLabel: "生成情况",
    generationDetailsGenerated: "已生成",
    generationDetailsPending: "待生成",
    generationDetailsRunning: "生成中",
    generationDetailsRetrying: "重试中",
    generationDetailsFailed: "失败",
    generationDetailsCurrent: "当前页",
    generationStatusDone: "已生成",
    generationStatusRunning: "正在生成",
    generationStatusRetrying: "正在重试",
    generationStatusPending: "待生成",
    generationStatusFailed: "失败",
  },
  rail: {
    searchPlaceholder: "搜索课程 / 文档",
    documents: "文档",
    courses: "课程",
    recents: "最近",
    settings: "设置",
    newCourse: "新建课程",
    courseDialogTitle: "新建课程",
    courseNamePlaceholder: "课程名称",
    createCourse: "创建",
    cancel: "取消",
    defaultCourse: "默认课程",
    emptyCourseDocuments: "当前课程暂无文档",
    currentWorkspace: "当前工作区",
    uploadDocument: "上传 PDF",
    emptyDocuments: "没有匹配的文档",
    activeDocument: "当前",
    missingFile: "文件缺失",
    archiveToCourse: (courseName) => `归档到 ${courseName}`,
    archivedToCourse: (documentTitle, courseName) => `已将「${documentTitle}」归档到 ${courseName}`,
    alreadyArchivedToCourse: (documentTitle, courseName) => `「${documentTitle}」已在 ${courseName}`,
    archiveUnavailable: "请先选择一个课程",
    deleteDocument: (documentTitle) => `删除文档「${documentTitle}」`,
    deleteCourse: (courseName) => `删除课程「${courseName}」`,
    confirmDeleteAction: "删除",
    confirmDeleteDocument: (documentTitle) => `删除文档「${documentTitle}」？这会同时删除本地 PDF、讲解、对话和选区上下文。`,
    confirmDeleteCourse: (courseName, documentCount) => `删除课程「${courseName}」？其中 ${documentCount} 个文档及其讲解、对话都会被删除。`,
    documentDeleted: (documentTitle) => `已删除「${documentTitle}」`,
    courseDeleted: (courseName) => `已删除课程「${courseName}」`,
    documentCount: (count) => `${count} 个文档`,
    courseDocumentCount: (count) => `${count} 个文档`,
    documentMeta: (pageCount, generatedCount) => `${pageCount} 页 · ${generatedCount} 页讲解`,
  },
  pdf: {
    samplePdfPage: "示例 PDF 页面",
    previousPage: "上一页",
    nextPage: "下一页",
    previewTitle: "PDF 预览",
    renderFailed: "PDF 页面渲染失败，已回退到浏览器预览。",
    loading: "正在加载 PDF 页面",
  },
  notes: {
    title: "讲解",
    tabNotes: "讲解",
    tabStructure: "结构",
    tabJson: "JSON",
    tabNotesShort: "讲解",
    tabStructureShort: "结构",
    tabJsonShort: "JSON",
  },
  agent: {
    addImage: "加入图片",
    clearContext: "清空上下文",
    newConversation: "新对话",
    removeContext: "移除上下文",
    removeImage: "移除图片",
    contextFormula: (pageNo) => `公式 · PDF p.${pageNo}`,
    contextSelection: (pageNo) => `选中内容 · PDF p.${pageNo}`,
    contextPdfReference: (pageNo) => `PDF 来源 · p.${pageNo}`,
    contextSource: (pageNo, source) => `来源 PDF p.${pageNo} · ${source}`,
    selectedPdfPage: (pageNo) => `来源 PDF p.${pageNo}`,
    selectedNotesPage: (pageNo) => `讲解 p.${pageNo}`,
    assistantMessage: "助手消息",
    pageSource: (pageNo) => `页面 p.${pageNo}`,
    imagePreview: (name) => `图片 · ${name}`,
    selectedFallbackSuggestions: ["解释当前页的核心内容", "总结本页关键知识点", "用例子讲清楚这一页", "根据本页内容出几道题"],
    pageSuggestions: () => ["解释当前页的核心内容", "总结本页关键知识点", "用例子讲清楚这一页", "根据本页内容出几道题"],
    challengeTitle: "Challenge",
    challengeModeDiagnostic: "漏洞诊断",
    challengeAction: "生成挑战",
    challengeAria: "当前页 Challenge",
    challengeUserMessage: (kind, count) => kind === "problem"
      ? "Challenge：请先判断当前页是否适合典型大题；如果适合，生成 1 道典型大题 challenge"
      : `Challenge：请基于当前页生成 ${count} 道互动选择题，用于漏洞诊断`,
    challengeKindLabel: "题型",
    challengeQuizKind: "选择题",
    challengeProblemKind: "大题",
    challengeCountLabel: "题数",
    challengeCorrect: "判断正确",
    challengeIncorrect: "再想一下",
    challengeAnswerLabel: "正确选项：",
    challengeFollowUpLabel: "追问：",
    challengeNext: "下一题",
    challengeNewSet: "再来一组",
    challengeParseFailed: "Challenge 题目解析失败，请重新生成。",
    challengeProblemSuitable: "适合典型大题",
    challengeProblemUnsuitable: "本页不适合硬出典型大题",
    challengeProblemGivenLabel: "已知条件",
    challengeProblemTasksLabel: "分问",
    challengeProblemEntryLabel: "第一步怎么想",
    challengeProblemHintAction: "看第一步提示",
    challengeProblemSelfCheckAction: "我做完了，看检查点",
    challengeProblemTrapLabel: "常见误区",
    challengeProblemRubricLabel: "自查采分点",
    challengeProblemAgain: "再来一道大题",
    quickExplainPrompt: (label) => `请解释这段选中内容，优先基于该来源回答：${label}`,
    quickSummarizePrompt: (label) => `请总结这段选中内容，提炼关键概念和可能的公式关系：${label}`,
    continuePrompt: "请根据上下文继续。",
    localPreviewIntro: "本地预览回复：真实回答会通过后端 `/api/agent/chat` 使用 OpenAI OAuth 发送。",
    localPreviewSelected: (title) => `已读取选中内容：${title}。`,
    localPreviewContexts: (count) => `已读取 ${count} 段上下文。`,
    localPreviewPage: (pageNo) => `已读取第 ${pageNo} 页。`,
    localPreviewImages: (count) => `同时包含 ${count} 张图片。`,
    localPreviewQuestion: (question) => `你的问题：${question}`,
    selectionSources: {
      pdfPage: "PDF 页面选区",
      notes: "讲解区选区",
      assistant: "助手消息选区",
      rail: "目录选区",
      page: "页面选区",
    },
    askCurrentPage: "询问当前页面",
    quoteLabel: "选中内容",
    edit: "编辑",
    generationStopped: "生成已停止",
    generationFailed: "生成失败，请重试",
    copy: "复制",
    regenerate: "重新生成",
    askWithSelectionPlaceholder: "基于选中内容提问",
    askPlaceholder: "询问当前页面或选中内容",
    inputAria: "助手输入框",
    formulaTitle: "数学公式",
    stop: "停止",
    send: "发送",
    thinking: "正在基于当前上下文思考",
    removeSelectedContent: "移除选中内容",
    selectionToolbarAria: "选中内容操作",
    addToConversation: "添加到对话",
    explainSelection: "解释选中内容",
    summarizeSelection: "总结选中内容",
  },
  oauth: {
    kicker: "OpenAI Codex 登录",
    title: "输入网页要求的 9 位验证码",
    cancel: "取消 OAuth 登录",
    codeAria: (code) => `授权码 ${code}`,
    copied: "已复制",
    copyCode: "复制验证码",
    openAuthPage: "打开授权页",
    expiresIn: (time) => `${time} 后过期`,
  },
  structure: {
    pageNo: "页号",
    parser: "解析器",
    ocr: "OCR",
    confidence: "对齐置信度",
    prerequisites: "前置概念",
    visualNotes: "图表说明",
    sourceText: "解析文本",
    ocrEnabled: "已启用",
    ocrDisabled: "未启用",
  },
};

const enUS: AppCopy = {
  common: {
    assistant: "Assistant",
    selectedContent: "Selected content",
    image: "Image",
    ready: "Ready",
    aligned: "Aligned",
    none: "None",
    listSeparator: ", ",
    sentenceSeparator: "; ",
    sourcePdfPage: (pageNo) => `Source PDF p.${pageNo}`,
    explanationProgress: (current, total) => `Notes ${current} / ${total}`,
    pageCount: (count) => `${count} ${count === 1 ? "page" : "pages"}`,
    readyCount: (count) => `${count} ready`,
    pageLabel: (pageNo) => `Page ${pageNo}`,
  },
  settings: {
    close: "Close settings",
    navAria: "Settings sections",
    description: "Manage low-frequency options without cluttering the reading workspace.",
    sections: {
      general: "General",
      providers: "Model Providers",
      models: "Default Models",
      appearance: "Appearance",
      agent: "Assistant",
      pdf: "PDF Reader",
      account: "Account / Gateway",
      storage: "Storage",
      advanced: "Advanced",
    },
    general: {
      languageLabel: "Interface language",
      languageDescription: "Switch the fixed SynchroPage interface copy.",
      chinese: "中文",
      english: "English",
      savePreferencesLabel: "Save UI preferences",
      savePreferencesDescription: "Store theme, density, and pane visibility preferences on this device. When off, changes only last for the current session.",
      resetLayoutLabel: "Reset workspace layout",
      resetLayoutDescription: "Restore the outline, notes, and assistant panes.",
      resetLayoutButton: "Reset layout",
    },
    appearance: {
      themeLabel: "Theme",
      themeDescription: "Choose a crisp light theme, a focused dark theme, or follow the system appearance.",
      themeSystem: "System",
      themeLight: "Light",
      themeDark: "Dark",
      accentLabel: "Accent color",
      accentDescription: "Choose the interface color used for primary actions, focus, and selection.",
      accentClay: "Indigo",
      accentGraphite: "Graphite",
      accentSage: "Sage",
      pdfBackgroundLabel: "PDF background",
      pdfBackgroundDescription: "Adjust the quiet background behind the document.",
      pdfBackgroundPaper: "Paper",
      pdfBackgroundPlain: "Plain",
      pdfBackgroundSoft: "Soft",
      fontScaleLabel: "Font size",
      fontScaleDescription: "Applies to notes, assistant output, and reading text.",
      fontCompact: "Compact",
      fontDefault: "Default",
      fontLarge: "Large",
      compactModeLabel: "Compact mode",
      compactModeDescription: "Reduce toolbar and pane spacing.",
    },
    agent: {
      sourcePillsLabel: "Show source pills",
      sourcePillsDescription: "Show compact source context above the conversation.",
      pageSuggestionsLabel: "Page-aware suggestions",
      pageSuggestionsDescription: "Generate empty-state prompts from the current page title and concepts.",
      explanationLanguageLabel: "Notes output language",
      explanationLanguageDescription: "Controls the language for generated note headings, prose, and table explanations. Defaults to the interface language.",
      explanationLanguageAuto: "Follow interface",
      explanationLanguageChinese: "中文",
      explanationLanguageEnglish: "English",
      answerModeLabel: "Q&A answer mode",
      answerModeDescription: "Controls Agent chat structure and the actual reasoning.effort. Generated notes still use the model thinking intensity below.",
      answerModeConcise: "Concise · medium",
      answerModeGuided: "Guided · high",
      answerModeDetailed: "Detailed · extra high",
      modelReasoningEffortLabel: "Model thinking intensity",
      modelReasoningEffortDescription: "Sent to the Responses API as reasoning.effort. Higher effort is slower and more expensive, but can improve complex tasks.",
      reasoningEffortNone: "none · fastest",
      reasoningEffortLow: "low · light",
      reasoningEffortMedium: "medium · recommended",
      reasoningEffortHigh: "high · deep",
      reasoningEffortXHigh: "xhigh · strongest",
      reasoningEffortMax: "max · GPT-5.6 maximum",
      pdfContextFullPageLimitLabel: "Full-context page limit",
      pdfContextFullPageLimitDescription: "Controls the cacheable page-text index in addition to direct PDF input. At or below this count, keep a full text index.",
      pdfContextEdgePageCountLabel: "Long-PDF edge pages",
      pdfContextEdgePageCountDescription: "When the PDF exceeds the limit, cache only this many text-index pages from both edges; the original PDF is still attached when available.",
    },
    pdf: {
      scrollbarLabel: "Scrollbar style",
      scrollbarDescription: "Applies to workspace scroll containers.",
      scrollbarThin: "Thin",
      scrollbarSubtle: "Subtle",
      scrollbarNative: "Native",
    },
    account: {
      oauthStatusLabel: "OAuth status",
      oauthStatusDescription: "OpenAI Gateway connection status.",
      connectedEmailLabel: "Connected email",
      connectedEmailDescription: "Shown only here, not in the main status bar.",
      providerStatusLabel: "Provider status",
      reconnectLabel: "Reconnect / sign out",
      reconnectDescription: "Reuses the existing OAuth start/logout flow.",
      disconnectButton: "Sign out",
      connectButton: "Connect OpenAI",
      notConnected: "Not connected",
      statuses: {
        connected: "Connected",
        polling: "Waiting for device code",
        offline: "Backend offline",
        mock: "Local preview",
        ready: "Ready to connect",
        unknown: "Checking",
      },
    },
    storage: {
      saveStateLabel: "Save status",
      saveStateDescription: "Local autosave state for the current workspace.",
      workspaceCountLabel: "Workspaces",
      workspaceCountDescription: "Workspaces stored in this browser's IndexedDB.",
      documentCountLabel: "Documents",
      documentCountDescription: "Saved PDF / SynchroPage documents on this device.",
      usageLabel: "Local usage",
      usageDescription: "Browser estimate across IndexedDB, Cache, and site storage.",
      persistentLabel: "Persistent storage",
      persistentDescription: "Ask the browser not to evict local drafts under storage pressure.",
      persistentRequestButton: "Enable persistence",
      dataDirectoryLabel: "Save folder",
      dataDirectoryDescription: "Desktop location for workspaces, PDF blobs, settings, and backend OAuth data. Changes apply after restart.",
      currentDataDirectory: "Current folder",
      pendingDataDirectoryLabel: "After restart",
      pendingDataDirectory: (path) => `After restart: ${path}`,
      dataDirectoryBrowserManaged: "Browser mode is managed by the current browser profile",
      dataDirectoryManagedByEnv: "Managed by startup environment variable",
      defaultDirectory: "Default folder",
      chooseDataDirectoryButton: "Choose folder",
      resetDataDirectoryButton: "Use default",
      restartButton: "Restart app",
      dataDirectorySaved: "Save folder updated",
      dataDirectoryReset: "Save folder reset to default",
      dataDirectoryRestartRequired: "Save folder updated; restart the app to apply it",
      dataDirectoryFailed: "Failed to update save folder",
      exportLabel: "Export current workspace",
      exportDescription: "Export metadata, chat, notes, and the PDF Blob for backup.",
      exportButton: "Export",
      importLabel: "Import workspace",
      importDescription: "Import a SynchroPage workspace backup and open it.",
      importButton: "Import",
      clearLabel: "Clear current workspace",
      clearDescription: "Delete the current workspace's PDF, notes, chat, and selections. This cannot be undone.",
      clearButton: "Clear",
      repairLabel: "Check and repair storage",
      repairDescription: "Remove orphan blobs, unreferenced messages, and broken references; documents with missing PDF blobs are marked missing.",
      repairButton: "Repair",
      resetLabel: "Reset current workspace",
      resetDescription: "Return to the initial sample state while keeping global UI preferences.",
      resetButton: "Reset",
      persisted: "Enabled",
      bestEffort: "Standard storage",
      unsupported: "Unsupported",
      unknown: "Unknown",
      noWorkspace: "No workspace yet",
    },
    confirm: {
      cancel: "Cancel",
      clearWorkspaceTitle: "Clear current workspace?",
      clearWorkspaceDescription: "This deletes the current PDF, generated notes, chat, and selected context. This action cannot be undone.",
      clearWorkspaceConfirm: "Clear",
      resetWorkspaceTitle: "Reset current workspace?",
      resetWorkspaceDescription: "This removes the current workspace and returns to the initial sample state. Saved PDFs, notes, and chat will be deleted.",
      resetWorkspaceConfirm: "Reset",
      disconnectTitle: "Disconnect OpenAI OAuth?",
      disconnectDescription: "New AI requests cannot use this OAuth session until you connect again.",
      disconnectConfirm: "Disconnect",
      resetPreferencesTitle: "Reset local UI preferences?",
      resetPreferencesDescription: "This only restores theme, layout, and interface preferences. It does not delete PDFs, notes, or chat.",
      resetPreferencesConfirm: "Reset preferences",
    },
    advanced: {
      debugLabel: "Debug mode",
      debugDescription: "Show task status and diagnostics in the quiet footer.",
      clearPreferencesLabel: "Clear local UI preferences",
      clearPreferencesDescription: "Reset only local visual preferences.",
      clearPreferencesButton: "Reset preferences",
      diagnosticsLabel: "Developer diagnostics",
      diagnosticsHiddenDescription: "Enable Debug mode to show runtime status.",
      visible: "Visible",
      hidden: "Hidden",
    },
  },
  status: {
    localPrototype: "Local prototype",
    preferencesReset: "Local UI settings reset",
    noSelection: "No page selection is available to add",
    selectionAdded: "Selected content added to the conversation",
    explainingSelection: "Explaining selected content",
    summarizingSelection: "Summarizing selected content",
    codeCopied: (code) => `Authorization code ${code} copied`,
    enterCode: (code) => `Enter authorization code ${code} on the OpenAI page`,
    oauthCanceled: "OAuth sign-in canceled",
    oauthDisconnected: "OAuth session disconnected",
    codeShown: (code) => `Authorization code ${code} is shown. Copy it, then open the authorization page.`,
    codeExpired: "OAuth authorization code expired",
    oauthConnected: "OAuth connected",
    oauthBackendMock: "OAuth backend is offline. Switched to static preview mode.",
    jsonImported: "Imported SynchroPage JSON",
    layoutReset: "Workspace layout reset",
    generationQueued: "Generation task sent to the backend harness",
    generationPreparingCache: (total) => `Preparing cacheable PDF context for ${total} pages`,
    generationStarted: (total) => `Generating notes for ${total} pages`,
    generationPage: (current, total, pageNo) => `Generating notes for page ${pageNo} (${current}/${total})`,
    generationPageRetrying: (pageNo, attempt, total) => `Page ${pageNo} did not respond, retrying ${attempt}/${total}`,
    generationPageFailed: (pageNo, message) => `Page ${pageNo} generation failed: ${message}`,
    generationDone: (completed, total, skipped = 0) => `Generation complete: ${completed} new, ${skipped} skipped, ${total} pages checked`,
    generationBatchStarted: (documents, pages) => `Batch generation started for ${documents} documents, ${pages} pages to check`,
    generationBatchDocument: (current, total, title) => `Generating document ${current}/${total}: ${title}`,
    generationBatchDone: (completed, pages, documents, skipped = 0) => `Batch generation complete: ${documents} documents, ${completed} new pages, ${skipped} skipped, ${pages} pages checked`,
    generationBatchNoDocuments: "No PDF documents are available for batch generation in this course",
    generationAlreadyComplete: (total) => `All ${total} pages already have notes`,
    generationScopeAlreadyComplete: (scope) => `Selected pages ${scope} already have notes`,
    generationInvalidPageRange: (total) => `Invalid page range. Enter pages from 1-${total}, for example 1-3, 8`,
    pdfTextExtracting: (ready, total) => `Reading PDF text layer: ${ready}/${total} pages ready`,
    pdfTextExtractionFallback: "PDF text extraction is slow, continuing with the text that is ready",
  },
  errors: {
    accountNotFound: "Connect OpenAI OAuth before sending.",
    jsonNeedsPages: "JSON must contain a pages array",
    emptyGatewayResult: "AI gateway returned an empty result",
    generationStopped: "Generation stopped",
    generationRequestStalled: (seconds) => `OpenAI upstream did not return for ${seconds}s, so this page was stopped automatically. This may be rate limiting or a stuck request. Try again shortly.`,
    generationBatchRequestStalled: (seconds) => `OpenAI upstream did not return for ${seconds}s, so the batch was split into single-page retries.`,
    generationRequestTimedOut: (seconds) => `Notes generation timed out after ${seconds}s. This page may be visual-heavy, rate-limited, or slow upstream. Try again shortly.`,
    imageReadFailed: "Failed to read image",
    importedDocument: "Imported document",
    importedPageTitle: (index) => `Page ${index + 1} notes`,
  },
  auth: {
    gatewayConnected: (account) => `OpenAI Gateway: OAuth session connected${account ? ` · ${account}` : ""}`,
    gatewayWaiting: "OpenAI Gateway: waiting for authorization",
    gatewayOffline: "OpenAI Gateway: backend offline",
    gatewayDisconnected: "OpenAI Gateway: disconnected",
    connectionConnected: "OAuth connected",
    connectionWaiting: "Waiting for code",
    connectionLocal: "Local preview",
    connectionReady: "Gateway ready",
  },
  persistence: {
    saving: "Saving...",
    saved: "Saved",
    failed: "Save failed, click to retry",
    quota: "Storage is full",
    localDraft: "Local draft",
    restored: "Restored local workspace",
    pdfMissing: "PDF file is missing; metadata restored",
    restoreFailed: "Failed to restore workspace",
    retrySave: "Retry save",
    saveStatusLabel: "Save status",
    uploadSaved: "PDF saved locally",
    workspaceCleared: "Local workspace cleared",
    workspaceExported: "Workspace exported",
    workspaceImported: "Workspace imported",
    persistentEnabled: "Persistent storage enabled",
    persistentUnavailable: "Persistent storage was not granted; local save still works",
    storageRepaired: (count) => `Storage check completed, handled ${count} invalid records`,
  },
  topbar: {
    resizeHandle: "Resize pane width",
    layoutSwitcherAria: "Workspace layout",
    restoreWorkbench: "Restore full workspace",
    hideRail: "Hide outline",
    showRail: "Show outline",
    hideNotes: "Hide notes pane",
    showNotes: "Show notes pane",
    hideAgent: "Hide assistant",
    showAgent: "Show assistant",
    exitPdfFocus: "Exit PDF focus",
    pdfOnly: "PDF only",
    uploadPdf: "Upload PDF",
    openSettings: "Open settings",
    moreActions: "More actions",
    viewOpenAiCode: "View OpenAI verification code",
    connectOpenAi: "Connect OpenAI OAuth",
    importJson: "Import SynchroPage JSON",
    exportJson: "Export JSON",
    advancedSettings: "Advanced settings",
    generate: "Generate",
    stopGeneration: "Stop",
    generateScopeLabel: "Generate range",
    generateScopeAll: "All pages",
    generateScopeAllDescription: "Check the whole PDF and skip completed pages",
    generateScopeMissing: "Missing pages",
    generateScopeMissingDescription: "Only fill pages without generated notes",
    generateScopeCurrent: (pageNo) => `Current page p.${pageNo}`,
    generateScopeCurrentDescription: "Only generate the PDF page you are viewing",
    generateScopeCustom: "Specific pages",
    generateScopeCustomDescription: "Enter page numbers or ranges",
    generateScopeCustomPlaceholder: "e.g. 1-3, 8, 10-12",
    generateScopeCustomSummary: (value) => `Specific pages: ${value}`,
    generateScopeProjectMissing: "All course documents",
    generateScopeProjectMissingDescription: "Fill missing pages across every PDF in the current course",
    generationDetailsLabel: "Generation status",
    generationDetailsGenerated: "Generated",
    generationDetailsPending: "Pending",
    generationDetailsRunning: "Running",
    generationDetailsRetrying: "Retrying",
    generationDetailsFailed: "Failed",
    generationDetailsCurrent: "Current",
    generationStatusDone: "Generated",
    generationStatusRunning: "Generating",
    generationStatusRetrying: "Retrying",
    generationStatusPending: "Pending",
    generationStatusFailed: "Failed",
  },
  rail: {
    searchPlaceholder: "Search courses / documents",
    documents: "Documents",
    courses: "Courses",
    recents: "Recents",
    settings: "Settings",
    newCourse: "New course",
    courseDialogTitle: "New course",
    courseNamePlaceholder: "Course name",
    createCourse: "Create",
    cancel: "Cancel",
    defaultCourse: "Default course",
    emptyCourseDocuments: "No documents in this course",
    currentWorkspace: "Current workspace",
    uploadDocument: "Upload PDF",
    emptyDocuments: "No matching documents",
    activeDocument: "Active",
    missingFile: "Missing file",
    archiveToCourse: (courseName) => `Archive to ${courseName}`,
    archivedToCourse: (documentTitle, courseName) => `Archived "${documentTitle}" to ${courseName}`,
    alreadyArchivedToCourse: (documentTitle, courseName) => `"${documentTitle}" is already in ${courseName}`,
    archiveUnavailable: "Select a course first",
    deleteDocument: (documentTitle) => `Delete "${documentTitle}"`,
    deleteCourse: (courseName) => `Delete "${courseName}"`,
    confirmDeleteAction: "Delete",
    confirmDeleteDocument: (documentTitle) => `Delete "${documentTitle}"? This also removes its local PDF, notes, chat, and selected context.`,
    confirmDeleteCourse: (courseName, documentCount) => `Delete "${courseName}"? This removes ${documentCount} ${documentCount === 1 ? "document" : "documents"} plus their notes and chats.`,
    documentDeleted: (documentTitle) => `Deleted "${documentTitle}"`,
    courseDeleted: (courseName) => `Deleted course "${courseName}"`,
    documentCount: (count) => `${count} ${count === 1 ? "document" : "documents"}`,
    courseDocumentCount: (count) => `${count} ${count === 1 ? "document" : "documents"}`,
    documentMeta: (pageCount, generatedCount) => `${pageCount} ${pageCount === 1 ? "page" : "pages"} · ${generatedCount} generated`,
  },
  pdf: {
    samplePdfPage: "Sample PDF page",
    previousPage: "Previous page",
    nextPage: "Next page",
    previewTitle: "PDF preview",
    renderFailed: "PDF page rendering failed. Falling back to browser preview.",
    loading: "Loading PDF page",
  },
  notes: {
    title: "Notes",
    tabNotes: "Notes",
    tabStructure: "Structure",
    tabJson: "JSON",
    tabNotesShort: "Notes",
    tabStructureShort: "Structure",
    tabJsonShort: "JSON",
  },
  agent: {
    addImage: "Add image",
    clearContext: "Clear context",
    newConversation: "New chat",
    removeContext: "Remove context",
    removeImage: "Remove image",
    contextFormula: (pageNo) => `Formula · PDF p.${pageNo}`,
    contextSelection: (pageNo) => `Selection · PDF p.${pageNo}`,
    contextPdfReference: (pageNo) => `PDF source · p.${pageNo}`,
    contextSource: (pageNo, source) => `Source PDF p.${pageNo} · ${source}`,
    selectedPdfPage: (pageNo) => `Source PDF p.${pageNo}`,
    selectedNotesPage: (pageNo) => `Notes p.${pageNo}`,
    assistantMessage: "Assistant message",
    pageSource: (pageNo) => `Page p.${pageNo}`,
    imagePreview: (name) => `Image · ${name}`,
    selectedFallbackSuggestions: ["Explain the core idea of this page", "Summarize the key points", "Teach this page with an example", "Quiz me on this page"],
    pageSuggestions: () => ["Explain the core idea of this page", "Summarize the key points", "Teach this page with an example", "Quiz me on this page"],
    challengeTitle: "Challenge",
    challengeModeDiagnostic: "Diagnostic",
    challengeAction: "Generate",
    challengeAria: "Current-page challenge",
    challengeUserMessage: (kind, count) => kind === "problem"
      ? "Challenge: first decide whether this page supports a typical major problem; if suitable, generate one major-problem challenge"
      : `Challenge: generate ${count} interactive multiple-choice question${count === 1 ? "" : "s"} for current-page diagnosis`,
    challengeKindLabel: "Type",
    challengeQuizKind: "Quiz",
    challengeProblemKind: "Problem",
    challengeCountLabel: "Count",
    challengeCorrect: "Correct",
    challengeIncorrect: "Try again",
    challengeAnswerLabel: "Answer:",
    challengeFollowUpLabel: "Follow-up:",
    challengeNext: "Next",
    challengeNewSet: "New set",
    challengeParseFailed: "Could not parse the Challenge format. Please regenerate it.",
    challengeProblemSuitable: "Suitable major problem",
    challengeProblemUnsuitable: "Not suitable for a forced major problem",
    challengeProblemGivenLabel: "Given",
    challengeProblemTasksLabel: "Tasks",
    challengeProblemEntryLabel: "First move",
    challengeProblemHintAction: "Show first hint",
    challengeProblemSelfCheckAction: "I tried it, show checks",
    challengeProblemTrapLabel: "Common traps",
    challengeProblemRubricLabel: "Self-check points",
    challengeProblemAgain: "Another problem",
    quickExplainPrompt: (label) => `Please explain this selected content. Prioritize answering from this source: ${label}`,
    quickSummarizePrompt: (label) => `Please summarize this selected content, extracting key concepts and possible formula relationships: ${label}`,
    continuePrompt: "Please continue based on the context.",
    localPreviewIntro: "Local preview reply: real answers are sent through the backend `/api/agent/chat` endpoint using OpenAI OAuth.",
    localPreviewSelected: (title) => `Read selected content: ${title}.`,
    localPreviewContexts: (count) => `Read ${count} context ${count === 1 ? "item" : "items"}.`,
    localPreviewPage: (pageNo) => `Read page ${pageNo}.`,
    localPreviewImages: (count) => `Also included ${count} ${count === 1 ? "image" : "images"}.`,
    localPreviewQuestion: (question) => `Your question: ${question}`,
    selectionSources: {
      pdfPage: "PDF page selection",
      notes: "Notes selection",
      assistant: "Assistant message selection",
      rail: "Outline selection",
      page: "Page selection",
    },
    askCurrentPage: "Ask About This Page",
    quoteLabel: "Selected content",
    edit: "Edit",
    generationStopped: "Generation stopped",
    generationFailed: "Generation failed. Try again.",
    copy: "Copy",
    regenerate: "Regenerate",
    askWithSelectionPlaceholder: "Ask about the selected content",
    askPlaceholder: "Ask about the current page or selected content",
    inputAria: "Assistant input",
    formulaTitle: "Math formula",
    stop: "Stop",
    send: "Send",
    thinking: "Thinking with the current context",
    removeSelectedContent: "Remove selected content",
    selectionToolbarAria: "Selected content actions",
    addToConversation: "Add to conversation",
    explainSelection: "Explain selection",
    summarizeSelection: "Summarize selection",
  },
  oauth: {
    kicker: "OpenAI Codex sign-in",
    title: "Enter the 9-character code requested by the web page",
    cancel: "Cancel OAuth sign-in",
    codeAria: (code) => `Authorization code ${code}`,
    copied: "Copied",
    copyCode: "Copy code",
    openAuthPage: "Open authorization page",
    expiresIn: (time) => `Expires in ${time}`,
  },
  structure: {
    pageNo: "Page",
    parser: "Parser",
    ocr: "OCR",
    confidence: "Alignment confidence",
    prerequisites: "Prerequisites",
    visualNotes: "Visual notes",
    sourceText: "Source text",
    ocrEnabled: "Enabled",
    ocrDisabled: "Disabled",
  },
};

export const appCopy: Record<Language, AppCopy> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export function getAppCopy(language: Language) {
  return appCopy[language] || appCopy["zh-CN"];
}
