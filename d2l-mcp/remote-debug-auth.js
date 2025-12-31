#!/usr/bin/env node
import "dotenv/config";
import { chromium } from "playwright";
import { homedir } from "os";
import { join } from "path";

const D2L_HOST = process.env.D2L_HOST || "learn.uwaterloo.ca";
const HOME_URL = `https://${D2L_HOST}/d2l/home`;
const SESSION_PATH = join(homedir(), ".d2l-session");

async function authWithRemoteDebugging() {
  console.log("🌐 Starting browser with remote debugging...");
  console.log("📍 You'll be able to view this in your local Chrome");
  console.log("");

  // Use Xvfb display if available
  const display = process.env.DISPLAY || ':99';
  console.log(`Using DISPLAY: ${display}`);
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--display=${display}`,
    ],
  });

  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: []
    }
  });
  
  const page = await context.newPage();
  
  console.log("🔑 Navigating to D2L...");
  await page.goto(HOME_URL, { waitUntil: 'networkidle' });
  
  console.log("");
  console.log("✅ Browser is now accessible!");
  console.log("📱 In your LOCAL terminal, create SSH tunnel:");
  console.log("   ssh -i ~/.ssh/PokeIntegrations -L 9222:localhost:9222 ec2-user@3.93.185.101");
  console.log("");
  console.log("🌐 In your LOCAL Chrome browser:");
  console.log("   1. Go to: chrome://inspect");
  console.log("   2. Click 'Configure'");
  console.log("   3. Add: localhost:9222");
  console.log("   4. Wait for target to appear");
  console.log("   5. Click 'inspect' on the D2L page");
  console.log("");
  console.log("⏳ Complete login/2FA in the inspect window...");
  console.log("💾 When done, press Ctrl+C here");
  
  // Keep browser open
  await new Promise(() => {});
}

authWithRemoteDebugging().catch(console.error);
