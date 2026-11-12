"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";

let translationMap = {};
let currentLocale = DEFAULT_LOCALE;
let reloadCallbacks = [];

// Read locale from cookie
function getLocaleFromCookie() {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

// Load translation map
async function loadTranslations(locale) {
  try {
    const response = await fetch(`/i18n/literals/${locale}.json`);
    if (!response.ok) throw new Error(`Translation load failed: ${response.status}`);
    translationMap = await response.json();
  } catch (err) {
    console.error("Failed to load translations:", err);
    translationMap = {};
  }
}

// Translate text - exported for use in components
export function translate(text) {
  if (!text || typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  let translated = translationMap[trimmed];
  if (!translated) {
    // Preserve changing counts and dates rather than translating user data.
    const dynamic = trimmed.match(/^(∞\s+|•\s+)?(Connected|Created|Tạo ngày|Unlimited|Không giới hạn)(\s+.*)?$/);
    const count = trimmed.match(/^(\d+) (Connected)$/);
    if (dynamic && translationMap[dynamic[2]]) {
      translated = `${dynamic[1] || ""}${translationMap[dynamic[2]]}${dynamic[3] || ""}`;
    } else if (count && translationMap[count[2]]) {
      translated = `${count[1]} ${translationMap[count[2]]}`;
    }
    if (!translated) {
      const label = trimmed.match(/^(Detected models|Select all|Selected:|Key settings:)(.*)$/);
      if (label && translationMap[label[1]]) translated = translationMap[label[1]] + label[2];
    }
  }
  return translated ? text.replace(trimmed, translated) : text;
}

// Get current locale - exported for use in components
export function getCurrentLocale() {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback) {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter(cb => cb !== callback);
  };
}

// Process text node
function processTextNode(node) {
  const current = node.nodeValue;
  if (!current || !current.trim()) return;

  // Skip if parent is script, style, code, or structural elements
  const parent = node.parentElement;
  if (!parent) return;

  // Skip if parent or any ancestor has data-i18n-skip attribute
  let element = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute('data-i18n-skip')) {
      return;
    }
    element = element.parentElement;
  }

  const tagName = parent.tagName?.toLowerCase();

  // Skip elements that don't allow text nodes
  const skipTags = [
    "script", "style", "code", "pre",
    "colgroup", "table", "thead", "tbody", "tfoot", "tr",
    "select", "datalist", "optgroup"
  ];

  if (skipTags.includes(tagName)) return;

  // React reuses text nodes and rewrites their value on re-render (a
  // characterData mutation, no childList event). When the current value is
  // neither our last translation nor the recorded original, it is fresh
  // source text — re-capture it as the new original before translating.
  const isOurTranslation = node._translated != null && current === node._translated;
  const isSameAsOriginal = current === node._originalText;
  if (!isOurTranslation && !isSameAsOriginal) {
    node._originalText = current;
  }
  if (node._originalText == null) node._originalText = current;

  // Translate from the recorded original so locale switches stay idempotent
  const translated = translate(node._originalText);
  node._translated = translated;

  // Only update if different to avoid unnecessary DOM mutations
  if (translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
}

// Process all text nodes in element
function processElement(element) {
  if (!element) return;
  
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  const nodesToProcess = [];
  
  // Collect all nodes first to avoid live collection issues
  while ((node = walker.nextNode())) {
    nodesToProcess.push(node);
  }
  
  // Process collected nodes
  nodesToProcess.forEach(processTextNode);
  processAttributes(element);
  element.querySelectorAll?.("[title], [placeholder], [aria-label]").forEach(processAttributes);
}

// Translate interface labels too; retain originals across locale switches.
const originalAttributes = new WeakMap();
function processAttributes(element) {
  if (!element.getAttribute || element.closest?.("[data-i18n-skip]")) return;
  const originals = originalAttributes.get(element) || {};
  for (const name of ["title", "placeholder", "aria-label"]) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const previous = originals[name];
    const source = previous && value === previous.translated ? previous.source : value;
    const translated = translate(source);
    originals[name] = { source, translated };
    if (value !== translated) element.setAttribute(name, translated);
  }
  originalAttributes.set(element, originals);
}

// Initialize runtime i18n
export async function initRuntimeI18n() {
  if (typeof window === "undefined") return;
  
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);
  
  // Process existing DOM
  processElement(document.body);
  
  // Watch for new nodes AND in-place text rewrites. React reuses text nodes on
  // re-render (only nodeValue changes → a characterData mutation with no
  // childList event), so observing childList alone leaves later-updated labels
  // untranslated.
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        processAttributes(mutation.target);
        return;
      }
      if (mutation.type === "characterData") {
        processTextNode(mutation.target);
        return;
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processElement(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          processTextNode(node);
        }
      });
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["title", "placeholder", "aria-label"],
  });
}

// Reload translations when locale changes
export async function reloadTranslations() {
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);
  
  // Notify all registered callbacks
  reloadCallbacks.forEach(callback => callback());
  
  // Re-process entire DOM (will use stored original text)
  processElement(document.body);
}
