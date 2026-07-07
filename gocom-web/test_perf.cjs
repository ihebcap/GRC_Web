const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  
  await page.goto('http://localhost:5173/');
  
  // Login
  await page.fill('input[type="text"]', 'PAYX');
  await page.fill('input[type="password"]', '0000');
  await page.click('button[type="submit"]');
  
  await page.waitForTimeout(2000);
  
  // Navigate to Rapprochement
  await page.click('text=Rapprochement Bancaire');
  await page.waitForTimeout(2000);
  
  // Select a bank if needed
  try {
      const select = await page.$('select');
      if (select) {
          const options = await page.$$eval('select option', opts => opts.map(o => o.value));
          if (options.length > 1) {
              await page.selectOption('select', options[1]); // select first real bank
          }
      }
  } catch(e) {}
  
  await page.waitForTimeout(3000);
  
  // Click a GRC row checkbox
  console.log("Clicking first GRC row...");
  const start = Date.now();
  
  const checkboxes = await page.$$('input[type="checkbox"]');
  if (checkboxes.length > 0) {
      await checkboxes[1].click(); // index 0 might be header or releve, let's just click the second one
  }
  
  const end = Date.now();
  console.log(`Click took ${end - start} ms`);
  
  await page.waitForTimeout(1000);
  
  await browser.close();
})();
