import { test, expect } from "@playwright/test";
import { activateAgent, resetStorage, mockApi } from "./helpers";

test.describe("Agent Panel", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
    // Mock all API calls so the agent doesn't need a real backend
    await mockApi(page, {
      "/api/agent/chat": { content: "Mock assistant reply from e2e." },
    });
  });

  test("agent panel is present", async ({ page }) => {
    await activateAgent(page);
    await expect(page.locator(".agent-panel")).toBeVisible();
  });

  test("agent toolbar shows model label", async ({ page }) => {
    await activateAgent(page);
    const toolbar = page.locator(".agent-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator(".toolbar-title")).toBeVisible();
    await expect(toolbar.locator(".agent-model")).toHaveText(/OAuth|Local/);
  });

  test("composer input accepts text", async ({ page }) => {
    const composer = await activateAgent(page);
    await composer.click();
    await composer.fill("Hello, this is a test message");
    await expect(composer).toHaveValue("Hello, this is a test message");
  });

  test("composer send button exists", async ({ page }) => {
    await activateAgent(page);
    await expect(page.locator(".composer-send")).toBeVisible();
  });

  test("agent welcome message is shown when empty", async ({ page }) => {
    await activateAgent(page);
    await expect(page.locator(".aui-welcome")).toBeVisible();
    await expect(page.locator(".prompt-suggestions button")).toHaveCount(4);
  });

  test("challenge panel controls stay inside a narrow agent panel", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 720 });
    await activateAgent(page);
    const panel = page.locator(".challenge-panel");
    await expect(panel).toBeVisible();

    const overflow = await panel.evaluate((element) => {
      const panelRect = element.getBoundingClientRect();
      const descendants = Array.from(element.querySelectorAll("*"));
      let minLeft = panelRect.left;
      let maxRight = panelRect.right;
      for (const descendant of descendants) {
        const rect = descendant.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        minLeft = Math.min(minLeft, rect.left);
        maxRight = Math.max(maxRight, rect.right);
      }
      return {
        left: panelRect.left - minLeft,
        right: maxRight - panelRect.right,
      };
    });

    expect(overflow.left).toBeLessThanOrEqual(1);
    expect(overflow.right).toBeLessThanOrEqual(1);
  });

  test("challenge panel sends the current-page challenge coach prompt", async ({ page }) => {
    await page.unroute("**/api/**");
    let requestPayload: {
      input?: string;
      messages?: Array<{ content?: string }>;
      modelProviderId?: string;
      model?: string;
      reasoningEffort?: string;
    } | null = null;
    const challengeContent = String.raw`{
      "type": "synchropage.challenge_quiz.v1",
      "title": "Attention Mechanism Quiz",
      "question_count": 2,
      "questions": [
        {
          "knowledge_type": "concept",
          "challenge_type": "概念边界题",
          "question": "什么是注意力机制的核心思想？",
          "options": [
            {"id": "A", "text": "将所有输入序列无差别地压缩成一个固定长度向量。"},
            {"id": "B", "text": "随机丢弃一部分神经元以防止过拟合。"},
            {"id": "C", "text": "根据当前任务动态分配不同输入位置的权重。"},
            {"id": "D", "text": "通过固定窗口卷积提取局部空间特征。"}
          ],
          "correct_option_id": "C",
          "feedback": {
            "correct": "对，关键是动态加权。",
            "incorrect": "这个选项没有抓住注意力的动态权重分配。"
          },
          "explanation": "注意力机制允许模型根据查询和上下文决定关注哪些输入。",
          "follow_up": "如果所有位置权重都相同，还算有效注意力吗？"
        },
        {
          "knowledge_type": "formula",
          "challenge_type": "适用条件题",
          "question": "在 \vec{q}\cdot\vec{k} 的打分里，哪句话最准确？",
          "options": [
            {"id": "A", "text": "分数越大，softmax 后该位置通常权重越高。"},
            {"id": "B", "text": "\vec{q} 与 \vec{k} 必须完全相同才有注意力。"},
            {"id": "C", "text": "所有 token 的权重必须相等。"},
            {"id": "D", "text": "\frac{1}{\sqrt{d_k}} 会删除无关 token。"}
          ],
          "correct_option_id": "A",
          "feedback": {
            "correct": "对，点积先给相关性打分，再归一化成权重。",
            "incorrect": "这里容易把相关性打分误解成硬匹配或硬删除。"
          },
          "explanation": "缩放点积注意力用 \frac{\vec{q}\cdot\vec{k}}{\sqrt{d_k}} 作为 logits，再经 softmax 得到权重。",
          "follow_up": "如果不除以 \sqrt{d_k}，大维度下 softmax 会有什么风险？"
        }
      ]
    }`;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/agent/chat")) {
        requestPayload = JSON.parse(route.request().postData() || "{}") as typeof requestPayload;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: challengeContent,
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await activateAgent(page);
    await expect(page.locator(".challenge-panel")).toBeVisible();
    await page.locator(".challenge-count-option").filter({ hasText: "5" }).click();
    await page.locator(".challenge-start").click();

    await expect(page.locator(".user-message")).toContainText(/Challenge/i);
    const quiz = page.locator(".challenge-quiz-card");
    await expect(quiz).toBeVisible({ timeout: 10_000 });
    await expect(quiz).toContainText("Attention Mechanism Quiz");
    await expect(quiz.locator(".challenge-quiz-count")).toHaveText("1/2");
    await expect(quiz.locator(".challenge-option")).toHaveCount(4);
    await quiz.locator(".challenge-option").filter({ hasText: "随机丢弃" }).click();
    await expect(quiz.locator(".challenge-option.incorrect")).toContainText("B");
    await expect(quiz.locator(".challenge-option.correct")).toContainText("C");
    await expect(quiz.locator(".challenge-feedback")).toContainText("正确选项");
    await expect(quiz.locator(".challenge-feedback")).toContainText("追问");
    await expect(quiz.locator(".challenge-next")).toContainText("下一题");
    await quiz.locator(".challenge-next").click();
    await expect(quiz.locator(".challenge-quiz-count")).toHaveText("2/2");
    await expect(quiz).toContainText("哪句话最准确");
    await quiz.locator(".challenge-option").filter({ hasText: "softmax" }).click();
    await expect(quiz.locator(".challenge-option.correct")).toContainText("A");
    await expect(quiz.locator(".challenge-next")).toContainText("再来一组");
    await expect.poll(() => requestPayload?.input || "").toContain("你是我的理工科 PPT 挑战教练");
    await expect.poll(() => requestPayload?.input || "").toContain("当前挑战模式");
    await expect.poll(() => requestPayload?.input || "").toContain("当前挑战数量：5");
    await expect.poll(() => requestPayload?.input || "").toContain("questions 数组");
    await expect.poll(() => requestPayload?.input || "").toContain("synchropage.challenge_quiz.v1");
    await expect.poll(() => requestPayload?.modelProviderId || "").toBe("codex_oauth");
    await expect.poll(() => requestPayload?.model || "").toBe("gpt-5.6-sol");
    await expect.poll(() => requestPayload?.reasoningEffort || "").toBe("xhigh");
    await expect.poll(() => requestPayload?.messages?.at(-1)?.content || "").toContain("Challenge");
  });

  test("challenge problem mode renders a typical major problem card", async ({ page }) => {
    await page.unroute("**/api/**");
    let requestPayload: {
      input?: string;
      messages?: Array<{ content?: string }>;
      modelProviderId?: string;
      model?: string;
      reasoningEffort?: string;
    } | null = null;
    const problemContent = String.raw`{
      "type": "synchropage.challenge_problem.v1",
      "title": "缩放点积注意力典型大题",
      "knowledge_type": "formula",
      "challenge_type": "典型大题",
      "suitability": {
        "has_typical_problem": true,
        "reason": "本页包含注意力打分公式、归一化和适用条件，适合设计多步计算与解释题。",
        "problem_type": "calculation"
      },
      "problem": {
        "stem": "给定查询向量 \vec{q} 和两个键向量 \vec{k}_1, \vec{k}_2，要求判断模型更关注哪个 token。",
        "given": ["打分公式为 s_i = \\frac{\vec{q}\\cdot\vec{k}_i}{\\sqrt{d_k}}。", "softmax 后得到注意力权重。"],
        "tasks": ["写出两个 token 的打分表达式。", "说明为什么要除以 \\sqrt{d_k}。", "判断哪类错误会把注意力误解成硬选择。"],
        "expected_entry": "先确认 q、k 的维度一致，再计算点积 logits。",
        "difficulty": "medium",
        "time_minutes": 8,
        "rubric": ["能先写出 logits，而不是直接比较原始 token。", "能说明缩放项控制 logits 量级。"]
      },
      "coach": {
        "first_hint": "第一步不要急着 softmax，先比较两个未归一化打分。",
        "common_traps": ["把 softmax 权重理解成只能选一个 token。", "忽略 \\sqrt{d_k} 的适用原因。"],
        "after_attempt_check": "检查你的解法是否区分了打分、归一化和加权求和三个阶段。"
      }
    }`;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/agent/chat")) {
        requestPayload = JSON.parse(route.request().postData() || "{}") as typeof requestPayload;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ content: problemContent }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await activateAgent(page);
    await page.locator(".challenge-kind-option").filter({ hasText: "大题" }).click();
    await page.locator(".challenge-start").click();

    await expect(page.locator(".user-message")).toContainText("典型大题");
    const problem = page.locator(".challenge-problem-card");
    await expect(problem).toBeVisible({ timeout: 10_000 });
    await expect(problem).toContainText("缩放点积注意力典型大题");
    await expect(problem).toContainText("适合典型大题");
    await expect(problem).toContainText("已知条件");
    await expect(problem).toContainText("分问");
    await expect(problem).toContainText("两个 token 的打分表达式");
    await expect(problem).not.toContainText("第一步不要急着 softmax");

    await problem.getByRole("button", { name: "看第一步提示" }).click();
    await expect(problem).toContainText("第一步不要急着 softmax");
    await problem.getByRole("button", { name: "我做完了，看检查点" }).click();
    await expect(problem).toContainText("自查采分点");
    await expect(problem).toContainText("常见误区");
    await expect(problem).toContainText("打分、归一化和加权求和");

    await expect.poll(() => requestPayload?.input || "").toContain("典型大题挑战教练");
    await expect.poll(() => requestPayload?.input || "").toContain("synchropage.challenge_problem.v1");
    await expect.poll(() => requestPayload?.input || "").toContain("不要硬编");
    await expect.poll(() => requestPayload?.modelProviderId || "").toBe("codex_oauth");
    await expect.poll(() => requestPayload?.model || "").toBe("gpt-5.6-sol");
    await expect.poll(() => requestPayload?.reasoningEffort || "").toBe("xhigh");
    await expect.poll(() => requestPayload?.messages?.at(-1)?.content || "").toContain("典型大题");
  });

  test("sending a message via Enter renders mocked assistant reply", async ({ page }) => {
    const composer = await activateAgent(page);
    await composer.click();
    await composer.fill("Test message from e2e");
    await page.keyboard.press("Enter");

    await expect(page.locator(".user-message")).toContainText("Test message from e2e");
    await expect(page.locator(".assistant-message")).toContainText("Mock assistant reply from e2e.", { timeout: 10_000 });
  });

  test("renders malformed inline math from model replies", async ({ page }) => {
    await page.unroute("**/api/**");
    await mockApi(page, {
      "/api/agent/chat": {
        content: [
          "若系统只允许 $0, 1, 2, 3, 4$ 这些值,那么可选状态就是有限集合。",
          "结果通常是近似值,例如 ((0.715)10 $\\to (0.10110$......)2,因为小数可能无法有限表示。",
          "每一位的权值是 `16^0, 16^1, 16^2, ...`,和十进制一致。",
          "例子 `E $\\times 16^2 + 3 \\times 16^1 +$ A $\\times 16^0$`。",
          "$- \\text{组合电路可以看成}“\\text{当前输入} $$\\to$$$ 当前输出”的直接映射。",
          "严格地说,应写作 T(n) $$\\in$$ O(f(n)),表示 $T(n)$ 属于这个集合。",
        ].join("\\n"),
      },
    });

    const composer = await activateAgent(page);
    await composer.click();
    await composer.fill("Render math");
    await page.keyboard.press("Enter");

    const assistant = page.locator(".assistant-message").last();
    await expect.poll(async () => assistant.locator(".katex").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    await expect(assistant.locator(".katex-error")).toHaveCount(0);
    await expect(assistant.locator("code")).toHaveCount(0);
    await expect(assistant).not.toContainText("$0, 1, 2, 3, 4$");
    await expect(assistant).not.toContainText("$\\to");
    await expect(assistant).not.toContainText("$-");
    await expect(assistant).not.toContainText("\\text{组合电路");
    await expect(assistant).not.toContainText("$$\\to$$$");
    await expect(assistant).not.toContainText("$$\\in$$");
  });

  test("repairs dielectric physics formula fragments from model replies", async ({ page }) => {
    await page.unroute("**/api/**");
    await mockApi(page, {
      "/api/agent/chat": {
        content: [
          "- 关键结论:介质内部电场不再等于真空中的情形,\\text{介电常数从} $$\\varepsilon_{0}",
          "\\text{介电常数从} \\(\\varepsilon_{0}$ \\text{变为} $\\varepsilon=\\varepsilon_$r$\\varepsilon_{0}",
          "- \\varepsilon_r (relativepermittivity/dielectricconstant) 是**无量纲**材料参数,所以 $\\varepsilon=\\varepsilon_{0}",
          "- 这里用“虚构偶极子”说明偶极矩的基本定义:两个等量异号电荷相距很小的位移时,",
          "\\mathbf{p}=$q\\boldsymbol{$\\delta$$}. - **电子极化**: $外电场 $\\mathbf{E}_{\\text{ext}}$ 使电子云发生形变。",
          "- 当 $\\mathbf{E}_{ext}=0$$ \\text{时,若原本中心重合,则净偶极矩为零。}",
          "- 若孤立偶极子处在外场中,局域电场 $E_{loc}$ 可近似看作施加的宏观场 $E_{ext},\\text{并满足} $$p=\\alpha_$$e E_{loc}$。",
        ].join("\\n"),
      },
    });

    const composer = await activateAgent(page);
    await composer.click();
    await composer.fill("Render dielectric math");
    await page.keyboard.press("Enter");

    const assistant = page.locator(".assistant-message").last();
    await expect.poll(async () => assistant.locator(".katex").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(7);
    await expect(assistant.locator(".katex-error")).toHaveCount(0);
    const visibleText = await assistant.innerText();
    expect(visibleText).toContain("介电常数从");
    expect(visibleText).toContain("电子极化");
    expect(visibleText).not.toContain("\\text{");
    expect(visibleText).not.toContain("$$");
    expect(visibleText).not.toContain("\\boldsymbol");
    expect(visibleText).not.toContain("\\varepsilon");
  });

  test("renders table math with vertical bars without splitting columns", async ({ page }) => {
    await page.unroute("**/api/**");
    await mockApi(page, {
      "/api/agent/chat": {
        content: [
          "| 比较项 | $T = 3$ | $T = 7$ |",
          "| --- | --- | --- |",
          "| 时域持续时间 | 较短 | 较长 |",
          "| 能量密度 | $|X(\\omega)|^2$ | $|Y(\\omega)|^2$ |",
        ].join("\n"),
      },
    });

    const composer = await activateAgent(page);
    await composer.click();
    await composer.fill("Render table math");
    await page.keyboard.press("Enter");

    const assistant = page.locator(".assistant-message").last();
    const rows = assistant.locator("table tr");
    await expect(rows).toHaveCount(3, { timeout: 10_000 });
    await expect(rows.nth(2).locator("td")).toHaveCount(3);
    await expect(assistant.locator(".katex-error")).toHaveCount(0);
    await expect(assistant).not.toContainText("$|X");
    await expect(assistant).not.toContainText("^2$");
  });

  test("adding an image shows the preview inside the composer", async ({ page }) => {
    await activateAgent(page);
    const imageInput = page.locator('.agent-action-button input[type="file"][accept="image/*"]');
    await expect(imageInput).toHaveCount(1);
    await imageInput.setInputFiles({
      name: "image.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lL+J+wAAAABJRU5ErkJggg==",
        "base64",
      ),
    });

    const composerShell = page.locator(".composer-shell");
    await expect(composerShell.locator(".composer-attachment-preview")).toBeVisible();
    await expect(composerShell.locator(".composer-image-preview")).toContainText("image.png");
  });
});
