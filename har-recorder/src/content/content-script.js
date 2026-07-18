// content-script.js — DOM interaction capture. Injected into opted-in tabs by
// the service worker while recording. Emits compact, VALUE-FREE descriptors of
// clicks, form submissions, input focus, and meaningful DOM changes. Never
// reads input values or password fields. Sends events to the background via
// chrome.runtime.sendMessage({ type: "dom-event", payload }).
(() => {
  if (window.__wfRecorderInjected) return;
  window.__wfRecorderInjected = true;

  let active = true;
  const send = (payload) => {
    if (!active) return;
    try {
      chrome.runtime.sendMessage({ type: "dom-event", payload });
    } catch (_) {
      active = false; // extension context gone
    }
  };

  // ---- descriptor helpers --------------------------------------------------

  const INTERACTIVE = "a,button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]";

  function accessibleName(el) {
    if (!el) return "";
    const aria = el.getAttribute?.("aria-label");
    if (aria) return aria.trim();
    const labelledby = el.getAttribute?.("aria-labelledby");
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim();
      if (t) return t;
    }
    if (el.id) {
      const lbl = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (lbl?.textContent) return lbl.textContent.trim();
    }
    const wrapLabel = el.closest?.("label");
    if (wrapLabel?.textContent) return wrapLabel.textContent.trim();
    const title = el.getAttribute?.("title") || el.getAttribute?.("alt");
    if (title) return title.trim();
    const ph = el.getAttribute?.("placeholder");
    if (ph) return ph.trim();
    return "";
  }

  function visibleText(el) {
    const t = (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
    return t.length > 120 ? t.slice(0, 120) + "…" : t;
  }

  function nearbyHeading(el) {
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      let sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (/^H[1-6]$/.test(sib.tagName) || sib.getAttribute?.("role") === "heading") {
          return visibleText(sib);
        }
      }
      node = node.parentElement;
      if (node && (/^H[1-6]$/.test(node.tagName))) return visibleText(node);
    }
    const h = document.querySelector("h1");
    return h ? visibleText(h) : "";
  }

  function cssEscape(s) {
    return window.CSS?.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");
  }

  function locatorFor(el) {
    if (!el || el === document) return null;
    for (const attr of ["data-testid", "data-test", "data-cy", "data-qa"]) {
      const v = el.getAttribute?.(attr);
      if (v) return `[${attr}="${v}"]`;
    }
    if (el.id) return `#${cssEscape(el.id)}`;
    const name = el.getAttribute?.("name");
    if (name && /^(input|select|textarea|button)$/i.test(el.tagName)) {
      return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    }
    // short structural path (max depth 4) with nth-of-type
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let sel = node.tagName.toLowerCase();
      if (node.classList?.length) {
        const cls = [...node.classList].filter((c) => !/\d{3,}|active|selected|hover/.test(c)).slice(0, 2);
        if (cls.length) sel += "." + cls.map(cssEscape).join(".");
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      if (node.id) { parts[0] = `#${cssEscape(node.id)}`; break; }
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function describe(el) {
    return {
      tag: el.tagName?.toLowerCase() || null,
      role: el.getAttribute?.("role") || implicitRole(el),
      label: accessibleName(el),
      text: visibleText(el),
      heading: nearbyHeading(el),
      locator: locatorFor(el),
      inputType: el.tagName === "INPUT" ? el.getAttribute("type") || "text" : null,
    };
  }

  function implicitRole(el) {
    const t = el.tagName;
    if (t === "A" && el.hasAttribute("href")) return "link";
    if (t === "BUTTON") return "button";
    if (t === "INPUT") {
      const it = (el.getAttribute("type") || "text").toLowerCase();
      if (it === "submit" || it === "button") return "button";
      if (it === "checkbox") return "checkbox";
      if (it === "radio") return "radio";
      return "textbox";
    }
    if (t === "SELECT") return "combobox";
    if (t === "TEXTAREA") return "textbox";
    return null;
  }

  // ---- clicks --------------------------------------------------------------
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target?.closest?.(INTERACTIVE) || e.target;
      if (!target || target.nodeType !== 1) return;
      send({ kind: "click", ts: Date.now(), element: describe(target) });
    },
    true
  );

  // ---- input focus (type + label only, NEVER value) ------------------------
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.getAttribute?.("contenteditable") == null) return;
      const type = (el.getAttribute?.("type") || el.tagName.toLowerCase()).toLowerCase();
      if (type === "password") {
        send({ kind: "focus", ts: Date.now(), element: { tag: el.tagName.toLowerCase(), inputType: "password", label: "(password field)", locator: locatorFor(el) } });
        return;
      }
      send({ kind: "focus", ts: Date.now(), element: { tag: el.tagName.toLowerCase(), inputType: type, label: accessibleName(el), locator: locatorFor(el) } });
    },
    true
  );

  // ---- form submit (field name/type/label only, NEVER values) --------------
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (!form || form.tagName !== "FORM") return;
      const fields = [...form.elements]
        .filter((el) => el.name && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))
        .map((el) => ({
          name: el.name,
          type: (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase(),
          label: accessibleName(el),
        }));
      send({
        kind: "submit",
        ts: Date.now(),
        form: {
          locator: locatorFor(form),
          action: form.getAttribute("action") || location.href,
          method: (form.getAttribute("method") || "get").toUpperCase(),
          fields,
        },
      });
    },
    true
  );

  // ---- meaningful DOM changes (debounced, heuristic — not full snapshots) ---
  const ALERT_SEL = "[role=alert],[aria-live=assertive],[aria-live=polite]";
  const DIALOG_SEL = "[role=dialog],[role=alertdialog],dialog[open],.modal";
  const LOADING_SEL = "[aria-busy=true],[role=progressbar],.spinner,.loading,.loader";
  const KW = {
    error: /(error|failed|invalid|denied|unable|couldn't|wrong|not found)/i,
    success: /(success|saved|sent|updated|created|confirmed|done|complete)/i,
  };
  let pending = [];
  let flushTimer = null;
  function queueChange(c) {
    pending.push(c);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = dedupe(pending);
      pending = [];
      for (const c of batch) send({ kind: "dom", ts: Date.now(), ...c });
    }, 400);
  }
  function dedupe(list) {
    const seen = new Set();
    return list.filter((c) => {
      const k = c.change + "|" + (c.textPreview || "").slice(0, 40);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 8);
  }
  function classifyNode(node) {
    if (node.nodeType !== 1) return;
    const el = node;
    const matches = (sel) => el.matches?.(sel) || el.querySelector?.(sel);
    if (matches(DIALOG_SEL)) {
      queueChange({ change: "dialog", description: "dialog appeared", locator: locatorFor(el), textPreview: visibleText(el) });
      return;
    }
    if (matches(LOADING_SEL)) {
      queueChange({ change: "loading", description: "loading indicator", locator: locatorFor(el) });
      return;
    }
    const alertEl = el.matches?.(ALERT_SEL) ? el : el.querySelector?.(ALERT_SEL);
    if (alertEl) {
      const txt = visibleText(alertEl);
      const change = KW.error.test(txt) ? "error" : KW.success.test(txt) ? "success" : "alert";
      queueChange({ change, description: `${change} message`, locator: locatorFor(alertEl), textPreview: txt });
      return;
    }
    // conservative success/error text without explicit role
    const txt = visibleText(el);
    if (txt && txt.length < 120 && (KW.error.test(txt) || KW.success.test(txt))) {
      queueChange({ change: KW.error.test(txt) ? "error" : "success", description: "status text", locator: locatorFor(el), textPreview: txt });
    }
  }
  try {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) classifyNode(node);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  // teardown when recording stops
  chrome.runtime.onMessage?.addListener?.((msg) => {
    if (msg?.type === "wf-stop") active = false;
  });
})();
