import { expect, test } from '@playwright/test';

/** The user guides open without signing in, and their flow diagrams draw under the site's CSP. */
for (const guide of ['student', 'faculty', 'admin']) {
  test(`${guide} guide shows its flow diagram`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`/guides/${guide}.html`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('guide');
    await expect(page.locator('pre.mermaid svg').first()).toBeVisible({ timeout: 15_000 });
    expect(problems).toEqual([]);
    // the page itself must not scroll sideways on a phone; wide diagrams scroll inside their frame
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
}
