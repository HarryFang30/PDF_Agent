import { test, expect } from "@playwright/test";
import { mockApi, resetStorage } from "./helpers";

test.describe("Smoke", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorage(page);
  });

  test("app shell renders", async ({ page }) => {
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("topbar is visible with brand", async ({ page }) => {
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".brand")).toBeVisible();
  });

  test("settings button opens settings dialog", async ({ page }) => {
    await page.locator(".rail-settings-button").click();
    await expect(page.locator(".settings-overlay")).toBeVisible();
    await expect(page.locator(".settings-dialog")).toBeVisible();
    await expect(page.locator(".settings-nav-item")).toHaveCount(9);
    await expect(page.locator(".settings-nav")).toContainText(/Provider|模型|Models|服务/i);
  });

  test("provider settings show catalog model metadata", async ({ page }) => {
    await mockApi(page, {
      "/api/model-config": {
        version: 1,
        selectedProviderId: "anthropic",
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            type: "anthropic-messages",
            defaultChatEndpoint: "anthropic-messages",
            apiHost: "https://api.anthropic.com",
            apiKeyRequired: true,
            enabled: true,
            models: ["claude-sonnet-4-5"],
            hasApiKey: true,
            endpointConfigs: {
              "anthropic-messages": { baseUrl: "https://api.anthropic.com", adapterFamily: "anthropic" },
            },
            catalog: { source: "cherry-studio" },
          },
        ],
        defaults: {
          assistant: { providerId: "anthropic", model: "claude-sonnet-4-5" },
          teachingFast: { providerId: "anthropic", model: "claude-sonnet-4-5" },
          teachingBalanced: { providerId: "anthropic", model: "claude-sonnet-4-5" },
          teachingQuality: { providerId: "anthropic", model: "claude-sonnet-4-5" },
        },
      },
      "/api/model-catalog/models": {
        models: [
          {
            id: "claude-sonnet-4-5",
            apiModelId: "claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            family: "claude",
            ownedBy: "anthropic",
            capabilities: ["function-call", "reasoning"],
            contextWindow: 200000,
          },
        ],
      },
    });
    await page.reload();
    await page.waitForSelector(".app-shell", { timeout: 10_000 });

    await page.locator(".rail-settings-button").click();
    await page.locator(".settings-nav-item").nth(1).click();

    await expect(page.locator(".settings-catalog-models")).toBeVisible();
    await expect(page.locator(".settings-catalog-model-item")).toContainText("Claude Sonnet 4.5");
    await expect(page.locator(".settings-catalog-model-item")).toContainText("function-call");
    await expect(page.locator(".settings-catalog-model-item")).toContainText("200K ctx");
  });

  test("provider check targets the configured GPT-5.6 assistant model", async ({ page }) => {
    let checkedModel = "";
    await mockApi(page, {
      "/api/model-config": {
        version: 2,
        selectedProviderId: "codex_oauth",
        providers: [
          {
            id: "codex_oauth",
            name: "OpenAI OAuth",
            type: "codex-oauth",
            apiHost: "https://chatgpt.com/backend-api/codex/",
            apiKeyRequired: false,
            enabled: true,
            models: ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
          },
        ],
        defaults: {
          assistant: { providerId: "codex_oauth", model: "gpt-5.6-sol" },
          teachingFast: { providerId: "codex_oauth", model: "gpt-5.6-luna" },
          teachingBalanced: { providerId: "codex_oauth", model: "gpt-5.6-terra" },
          teachingQuality: { providerId: "codex_oauth", model: "gpt-5.6-sol" },
        },
      },
      "/api/model-catalog/models": { models: [] },
    });
    await page.route("**/api/model-config/check", async (route) => {
      checkedModel = String(route.request().postDataJSON()?.model || "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, endpoint: "codex-oauth", model: checkedModel, text: "OK" }),
      });
    });
    await page.reload();
    await page.waitForSelector(".app-shell", { timeout: 10_000 });

    await page.locator(".rail-settings-button").click();
    const navItems = page.locator(".settings-nav-item");
    await expect(navItems).toHaveCount(9);
    await navItems.nth(1).click();
    const checkButton = page.locator(".settings-provider-panel").getByRole("button", { name: "Check", exact: true });
    await expect(checkButton).toHaveCount(1);
    await checkButton.click();

    await expect.poll(() => checkedModel).toBe("gpt-5.6-sol");
    await expect(page.locator(".settings-provider-panel")).toContainText("Check passed · gpt-5.6-sol");
  });

  test("desktop save folder settings stay inside the dialog with long paths", async ({ page }) => {
    await page.setViewportSize({ width: 1220, height: 720 });
    await page.addInitScript(() => {
      const config = {
        available: true,
        currentDataDir: "/Users/harry/Library/Application Support/synchropage-current-data-folder-with-a-very-long-name",
        configuredDataDir: "/Users/harry/Library/Application Support/SynchroPage Next Workspace Folder",
        pendingDataDir: "/Users/harry/Library/Application Support/SynchroPage Next Workspace Folder",
        backendDataDir: "/Users/harry/Library/Application Support/synchropage-current-data-folder-with-a-very-long-name/backend",
        oauthStoragePath: "/Users/harry/Library/Application Support/synchropage-current-data-folder-with-a-very-long-name/backend/openai_oauth.json",
        configPath: "/Users/harry/Library/Application Support/SynchroPage/desktop-config.json",
        dataDirManagedByEnv: false,
        restartRequired: true,
      };
      (window as unknown as {
        synchropageDesktop: {
          getStorageConfig: () => Promise<typeof config>;
          chooseDataDirectory: () => Promise<typeof config>;
          resetDataDirectory: () => Promise<typeof config>;
          restart: () => Promise<{ ok: true }>;
        };
      }).synchropageDesktop = {
        getStorageConfig: async () => config,
        chooseDataDirectory: async () => config,
        resetDataDirectory: async () => config,
        restart: async () => ({ ok: true }),
      };
    });
    await resetStorage(page);

    await page.locator(".rail-settings-button").click();
    await page.locator(".settings-nav-item").filter({ hasText: /存储|Storage/i }).click();

    const dialog = page.locator(".settings-dialog");
    const directoryRow = page.locator(".settings-row-directory");
    await expect(directoryRow).toBeVisible();
    await expect(directoryRow).toContainText(/当前目录|Current folder/i);
    await expect(directoryRow).toContainText(/重启后目录|After restart/i);
    await expect(page.getByRole("button", { name: /重启应用|Restart app/i })).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    const rowBox = await directoryRow.boundingBox();
    const actionsBox = await directoryRow.locator(".settings-directory-actions").boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
  });

  test("command menu opens and shows actions", async ({ page }) => {
    await page.locator(".command-menu > .mini-button").click();
    const menu = page.locator(".command-menu-popover");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button")).toHaveCount(4);
    await expect(menu).toContainText(/OpenAI|OAuth/i);
  });

  test("theme data attributes are initialized", async ({ page }) => {
    const html = page.locator("html");
    const initialTheme = await html.getAttribute("data-synchropage-resolved-theme");
    expect(["light", "dark"]).toContain(initialTheme);
  });
});
