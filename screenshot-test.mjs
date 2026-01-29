import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

async function takeScreenshots() {
  const browser = await chromium.launch({ headless: true });

  console.log('Starting UI tests...\n');

  // Desktop context
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await desktopContext.newPage();

  // Mobile context
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 667 }
  });
  const mobilePage = await mobileContext.newPage();

  try {
    // ===== LOGIN =====
    console.log('1. Testing Login...');
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(500);

    // Fill login form
    await page.fill('input[type="email"]', 'admin@test.local');
    await page.fill('input[type="password"]', 'strongpassword');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-login-filled.png'), fullPage: true });
    console.log('   ✓ Login form filled');

    // Submit login
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // Check if we're on stations page
    await page.waitForSelector('.stations-page', { timeout: 10000 });
    console.log('   ✓ Login successful');

    // ===== STATIONS LIST =====
    console.log('\n2. Testing Stations List...');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-stations-list.png'), fullPage: true });
    console.log('   ✓ Stations list page');

    // Test search
    await page.fill('input[type="search"]', '123');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-stations-search.png'), fullPage: true });
    console.log('   ✓ Search functionality');
    await page.fill('input[type="search"]', ''); // Clear search

    // ===== FILTERS =====
    console.log('\n3. Testing Filters...');

    // Open filter popover
    await page.click('.filter-btn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-filters-open.png'), fullPage: true });
    console.log('   ✓ Filter popover opened');

    // Select a filter chip if available
    const filterChips = await page.$$('.filter-chip');
    if (filterChips.length > 0) {
      await filterChips[0].click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-filter-selected.png'), fullPage: true });
      console.log('   ✓ Filter chip selected');
    }

    // Test placeholder filter checkbox
    const placeholderCheckbox = await page.$('.placeholder-filter input[type="checkbox"]');
    if (placeholderCheckbox) {
      await placeholderCheckbox.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-placeholder-filter.png'), fullPage: true });
      console.log('   ✓ Placeholder filter toggled');
    }

    // Close filter and show active filters
    await page.click('.filter-btn');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-active-filters.png'), fullPage: true });
    console.log('   ✓ Active filters displayed');

    // Clear filters
    await page.click('.filter-btn');
    await page.waitForTimeout(200);
    const clearBtn = await page.$('.clear-filters-btn');
    if (clearBtn) {
      await clearBtn.click();
      await page.waitForTimeout(300);
      console.log('   ✓ Filters cleared');
    }
    await page.click('.filter-btn'); // Close popover

    // ===== STATION PROFILE =====
    console.log('\n4. Testing Station Profile...');

    // Click first station card
    const stationCard = await page.$('.station-card');
    if (stationCard) {
      await stationCard.click();
      await page.waitForTimeout(1000);
      await page.waitForSelector('.station-profile', { timeout: 5000 });

      // Default view - contact info
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-station-profile-default.png'), fullPage: true });
      console.log('   ✓ Station profile - contact info (default)');

      // Check tabs exist
      const bgnTab = await page.$('.tab-btn:first-child');
      const ffTab = await page.$('.tab-btn:last-child');

      // БГН tab (should be active by default)
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-station-bgn-tab.png'), fullPage: true });
      console.log('   ✓ Station profile - БГН tab');

      // Click ФФ tab
      if (ffTab) {
        await ffTab.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10-station-ff-tab.png'), fullPage: true });
        console.log('   ✓ Station profile - ФФ tab (placeholder)');
      }

      // Switch back to БГН
      if (bgnTab) {
        await bgnTab.click();
        await page.waitForTimeout(300);
      }
    }

    // ===== MOBILE TESTS =====
    console.log('\n5. Testing Mobile Views...');

    // Login on mobile
    await mobilePage.goto('http://localhost:5173/');
    await mobilePage.fill('input[type="email"]', 'admin@test.local');
    await mobilePage.fill('input[type="password"]', 'strongpassword');
    await mobilePage.click('button[type="submit"]');
    await mobilePage.waitForTimeout(2000);

    try {
      await mobilePage.waitForSelector('.stations-page', { timeout: 10000 });

      // Mobile stations list
      await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, '11-mobile-stations.png'), fullPage: true });
      console.log('   ✓ Mobile - Stations list');

      // Mobile filter (bottom sheet)
      await mobilePage.click('.filter-btn');
      await mobilePage.waitForTimeout(500);
      await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, '12-mobile-filter-sheet.png'), fullPage: true });
      console.log('   ✓ Mobile - Filter bottom sheet');

      // Close filter
      await mobilePage.click('.filter-header'); // Click outside-ish to close
      await mobilePage.waitForTimeout(300);

      // Mobile station profile
      const mobileStationCard = await mobilePage.$('.station-card');
      if (mobileStationCard) {
        await mobileStationCard.click();
        await mobilePage.waitForTimeout(1000);
        await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, '13-mobile-station-profile.png'), fullPage: true });
        console.log('   ✓ Mobile - Station profile');

        // Mobile ФФ tab
        const mobileFFTab = await mobilePage.$('.tab-btn:last-child');
        if (mobileFFTab) {
          await mobileFFTab.click();
          await mobilePage.waitForTimeout(300);
          await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, '14-mobile-ff-tab.png'), fullPage: true });
          console.log('   ✓ Mobile - ФФ tab');
        }
      }
    } catch (e) {
      console.log('   ⚠ Mobile login may have failed:', e.message);
    }

    console.log('\n✅ All tests completed!');
    console.log('Screenshots saved to:', SCREENSHOTS_DIR);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'error-screenshot.png'), fullPage: true });
  }

  await browser.close();
}

takeScreenshots();
