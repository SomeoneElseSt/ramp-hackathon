import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'Reflex',
    description:
      'Give browser agents reflexes — subscribe to page events instead of polling.',
    // Debugger-free capture: in-page interceptors injected via scripting; no
    // chrome.debugger, no "being debugged" banner.
    permissions: ['tabs', 'storage', 'scripting', 'webNavigation'],
    host_permissions: ['<all_urls>'],
  },
});
