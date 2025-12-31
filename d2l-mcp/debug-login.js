#!/usr/bin/env node
import "dotenv/config";
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const D2L_HOST = process.env.D2L_HOST || "learn.ul.ie";
const HOME_URL = `https://${D2L_HOST}/d2l/home`;

async function debugLogin() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Navigating to ${HOME_URL}...`);
  await page.goto(HOME_URL, { waitUntil: "networkidle" });

  console.log(`Current URL: ${page.url()}`);

  // Save page HTML
  const html = await page.content();
  writeFileSync("login-page.html", html);
  console.log("Saved login page HTML to login-page.html");

  // List all input fields
  const inputs = await page.$$eval("input", (elements) =>
    elements.map((el) => ({
      type: el.type,
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      class: el.className,
    }))
  );
  console.log("\nFound input fields:");
  console.log(JSON.stringify(inputs, null, 2));

  // List all buttons
  const buttons = await page.$$eval("button", (elements) =>
    elements.map((el) => ({
      type: el.type,
      text: el.textContent?.trim(),
      class: el.className,
    }))
  );
  console.log("\nFound buttons:");
  console.log(JSON.stringify(buttons, null, 2));

  console.log("\nPress Ctrl+C when done inspecting...");
  await page.waitForTimeout(300000); // Wait 5 minutes

  await browser.close();
}

debugLogin().catch(console.error);
