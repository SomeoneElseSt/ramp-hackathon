import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Tama Agent',
    description:
      'Tama Agent — subscribe to page events instead of polling. Reflexes for browser agents.',
    // Debugger-free capture: in-page interceptors injected via scripting; no
    // chrome.debugger, no "being debugged" banner.
    permissions: ['tabs', 'storage', 'scripting', 'webNavigation'],
    host_permissions: ['<all_urls>'],
  },
});
