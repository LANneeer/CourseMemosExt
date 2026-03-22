// ============================================================
// content.js — CourseMemos AI: DOM scanner + Q&A annotations
// ============================================================

(() => {
  "use strict";

  let CONFIG = {
    backendUrl: "http://localhost:8000",
    courseSlug: "",
    targetSelectors: ["p", "h1", "h2", "h3", "li"],
    minTextLength: 20,
    maxElements: 5,
    token: "",
  };

  // ---- Answer panel ----

  let panel = null;

  function getPanel() {
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "cm-answer-panel";
    panel.innerHTML = `
      <div class="cm-panel-header">
        <span class="cm-panel-title">CourseMemos AI</span>
        <button class="cm-panel-close" title="Close">✕</button>
      </div>
      <div class="cm-panel-body">
        <div class="cm-panel-question"></div>
        <div class="cm-panel-answer"></div>
        <div class="cm-panel-sources"></div>
      </div>
    `;
    panel.querySelector(".cm-panel-close").addEventListener("click", () => {
      panel.classList.remove("cm-panel-visible");
    });
    document.body.appendChild(panel);
    return panel;
  }

  function showPanel(question, answer) {
    const p = getPanel();
    p.querySelector(".cm-panel-question").textContent = question;
    p.querySelector(".cm-panel-answer").textContent = answer;
    p.querySelector(".cm-panel-sources").style.display = "none";
    p.classList.add("cm-panel-visible");
  }

  // ---- DOM cleanup ----

  function clearResults() {
    document.querySelectorAll("[data-cm-id]").forEach((el) => {
      el.classList.remove("cm-processing");
      el.removeAttribute("data-cm-id");
    });
    document.querySelectorAll(".cm-correct-option").forEach((el) => {
      el.classList.remove("cm-correct-option");
      el.querySelector(".cm-correct-mark")?.remove();
    });
    document.querySelectorAll(".cm-answer-text").forEach((el) => {
      el.classList.remove("cm-answer-text");
    });
    document.querySelectorAll(".cm-fail-mark").forEach((el) => el.remove());
    if (panel) panel.classList.remove("cm-panel-visible");
  }

  // ---- Badge ----

  function addBadge(el, type, question, answer) {
    const old = el.querySelector(".cm-badge");
    if (old) old.remove();

    const badge = document.createElement("span");
    badge.className = "cm-badge";
    badge.textContent = type === "answered" ? "✅" : type === "error" ? "⚠️" : "❓";
    badge.title = answer ? answer.substring(0, 120) : (type === "error" ? "Error" : "No info");

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      if (answer) showPanel(question, answer);
    });

    if (!el.style.position || el.style.position === "static") {
      el.style.position = "relative";
    }
    el.insertBefore(badge, el.firstChild);
  }

  // ---- Question payload extraction ----
  //
  // Parses raw DOM text into the API schema:
  //   { question: "...", options: { "1": "...", "2": "...", ... } }
  //
  // Option lines are detected by common MCQ prefixes:
  //   "A. text"  "B) text"  "1. text"  "2) text"  "c- text"  "D: text"
  // At least 2 option lines must be present to populate `options`.
  // If none are found the payload is just { question: "..." }.

  const OPTION_LINE_RE = /^(?:[A-Za-z]|\d+)[\)\.\:\-]\s+\S.*/;

  function extractQuestionPayload(rawText) {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return { question: rawText.trim() };
    }

    // Find the first line that looks like an option
    let optionStart = -1;
    for (let i = 1; i < lines.length; i++) {
      if (OPTION_LINE_RE.test(lines[i])) {
        optionStart = i;
        break;
      }
    }

    // Need at least 2 option lines to treat as MCQ
    const optionLines = optionStart !== -1 ? lines.slice(optionStart) : [];
    const validOptions = optionLines.filter((l) => OPTION_LINE_RE.test(l));

    if (validOptions.length < 2) {
      // Plain question — join all lines
      return { question: lines.join(" ").trim() };
    }

    const question = lines.slice(0, optionStart).join(" ").trim();
    const options = {};
    validOptions.forEach((line, idx) => {
      // Strip "A. " / "1) " prefix, keep only the text
      const text = line.replace(/^(?:[A-Za-z]|\d+)[\)\.\:\-]\s*/, "").trim();
      options[String(idx + 1)] = text;
    });

    return { question, options };
  }

  // ============================================================
  // Coursera DOM Parser
  // ============================================================
  //
  // Targets stable Coursera attributes (data-testid, aria-*, id^="prompt-").
  // Deliberately ignores [data-ai-instructions] blocks injected by Coursera
  // to interfere with AI tooling — only real user-facing DOM is read.
  // ============================================================

  function isCoursera() {
    return location.hostname.includes("coursera.org");
  }

  // Returns true if the element (or any ancestor) is an anti-AI injection block.
  function isInjected(el) {
    return el.closest("[data-ai-instructions]") !== null;
  }

  // Collect all paragraph texts inside a container, skipping injected nodes.
  function readText(container) {
    if (!container || isInjected(container)) return "";
    const paragraphs = container.querySelectorAll("p");
    if (paragraphs.length === 0) return container.innerText?.trim() || "";
    return Array.from(paragraphs)
      .filter((p) => !isInjected(p))
      .map((p) => p.innerText?.trim())
      .filter(Boolean)
      .join(" ");
  }

  // Extract question + options from a single Coursera MCQ element.
  // Returns { payload: {question, options}, optionEls: [{key, text, el}] }
  // or null if the element doesn't look like a valid MCQ.
  function extractCourseraQuestion(questionEl) {
    // ── Question text ──────────────────────────────────────────
    const promptContainer = questionEl.querySelector(
      '[id^="prompt-"] [data-testid="cml-viewer"]'
    );
    const question = readText(promptContainer);
    if (!question) return null;

    // ── Options ───────────────────────────────────────────────
    const rawOptionEls = questionEl.querySelectorAll(".rc-Option");
    if (rawOptionEls.length < 2) return null;

    const options = {};
    const optionEls = []; // [{key, text, el}] — used for answer matching later
    let idx = 1;

    for (const opt of rawOptionEls) {
      if (isInjected(opt)) continue;

      const textContainer =
        opt.querySelector(".cds-checkboxAndRadio-labelText [data-testid='cml-viewer']") ||
        opt.querySelector("[data-testid='cml-viewer']");

      const text = readText(textContainer);
      if (!text) continue;

      const key = String(idx++);
      options[key] = text;
      optionEls.push({ key, text, el: opt });
    }

    if (optionEls.length < 2) return null;

    return { payload: { question, options }, optionEls };
  }

  // ---- Answer → option matching ----

  // Normalise text for comparison: lowercase, collapse spaces, strip punctuation.
  function normText(s) {
    return s.toLowerCase().replace(/[^\wа-яёА-ЯЁ\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  // Find the option element whose text best matches the API answer string.
  // Returns the matching {key, text, el} entry or null.
  function findMatchingOption(answer, optionEls) {
    if (!optionEls || optionEls.length === 0 || !answer) return null;

    const ansNorm = normText(answer);

    // 1. Exact match
    for (const opt of optionEls) {
      if (normText(opt.text) === ansNorm) return opt;
    }

    // 2. Substring containment (answer inside option text or vice-versa)
    for (const opt of optionEls) {
      const optNorm = normText(opt.text);
      if (optNorm.includes(ansNorm) || ansNorm.includes(optNorm)) return opt;
    }

    // 3. Word-ratio match: fraction of option words present in answer
    //    Uses all words (>2 chars) — handles short exam answers like "SAP BASIS"
    let best = null;
    let bestRatio = 0;
    for (const opt of optionEls) {
      const optWords = normText(opt.text).split(/\s+/).filter((w) => w.length > 2);
      if (optWords.length === 0) continue;
      const matched = optWords.filter((w) => ansNorm.includes(w)).length;
      const ratio = matched / optWords.length;
      if (ratio > bestRatio) { bestRatio = ratio; best = opt; }
    }
    if (bestRatio >= 0.5) return best;

    // 4. Reverse ratio: fraction of answer words found in option text
    const ansWords = ansNorm.split(/\s+/).filter((w) => w.length > 2);
    if (ansWords.length > 0) {
      let best2 = null;
      let bestRatio2 = 0;
      for (const opt of optionEls) {
        const optNorm = normText(opt.text);
        const matched = ansWords.filter((w) => optNorm.includes(w)).length;
        const ratio = matched / ansWords.length;
        if (ratio > bestRatio2) { bestRatio2 = ratio; best2 = opt; }
      }
      if (bestRatio2 >= 0.5) return best2;
    }

    return null;
  }

  // Colour the text span(s) inside an option green + append checkmark.
  function markOptionCorrect(optionEl) {
    const textEl =
      optionEl.querySelector(".cds-checkboxAndRadio-labelText [data-testid='cml-viewer']") ||
      optionEl.querySelector("[data-testid='cml-viewer']") ||
      optionEl.querySelector(".cds-checkboxAndRadio-labelText");

    const target = textEl || optionEl;
    // Colour every span/p inside the text container (and the container itself)
    target.classList.add("cm-answer-text");
    target.querySelectorAll("span, p").forEach((n) => n.classList.add("cm-answer-text"));

    if (!optionEl.querySelector(".cm-correct-mark")) {
      const mark = document.createElement("span");
      mark.className = "cm-correct-mark";
      mark.textContent = "✓";
      optionEl.appendChild(mark);
    }
  }

  // Put a red ✗ on the question element when no option could be matched.
  function markQuestionFailed(questionEl) {
    if (!questionEl || questionEl.querySelector(".cm-fail-mark")) return;
    const mark = document.createElement("span");
    mark.className = "cm-fail-mark";
    mark.textContent = "✗";
    questionEl.appendChild(mark);
  }

  // Scroll through the entire page so Coursera's lazy renderer
  // adds all question elements to the DOM before we scan.
  async function revealAllQuestions() {
    const totalHeight = document.documentElement.scrollHeight;
    const step = Math.max(window.innerHeight, 600);
    const savedScroll = window.scrollY;

    for (let y = 0; y < totalHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    // Scroll back to where the user was
    window.scrollTo(0, savedScroll);
    await new Promise((r) => setTimeout(r, 80));
  }

  // Scan the page for Coursera MCQ blocks.
  // Processes ALL questions in DOM regardless of scroll position.
  function scanCourseraDOM() {
    const questionEls = document.querySelectorAll(
      '[data-testid="part-Submission_MultipleChoiceQuestion"]'
    );
    const items = [];
    let idx = 0;

    for (const qEl of questionEls) {
      if (isInjected(qEl)) continue;
      // Skip only truly hidden questions (display:none), not off-screen ones
      if (getComputedStyle(qEl).display === "none") continue;

      const result = extractCourseraQuestion(qEl);
      if (!result) continue;

      const id = `cm-${idx++}`;
      qEl.setAttribute("data-cm-id", id);
      qEl.classList.add("cm-processing");
      items.push({ id, payload: result.payload, optionEls: result.optionEls, el: qEl });
    }

    return items;
  }

  // ============================================================
  // Generic DOM scan (fallback for non-Coursera pages)
  // ============================================================

  function scanDOM() {
    const selector = CONFIG.targetSelectors.join(", ");
    const elements = document.querySelectorAll(selector);
    const items = [];
    let idx = 0;

    for (const el of elements) {
      if (items.length >= CONFIG.maxElements) break;
      const text = el.textContent?.trim();
      if (!text || text.length < CONFIG.minTextLength) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const id = `cm-${idx++}`;
      el.setAttribute("data-cm-id", id);
      el.classList.add("cm-processing");
      items.push({ id, rawText: text.substring(0, 800), optionEls: [], el });
    }

    return items;
  }

  // ---- API call ----
  // Payload: { question: string, options?: { "1": string, ... } }
  // Response: { answer: string }

  async function askQuestion(payload) {
    const url = `${CONFIG.backendUrl}/api/courses/${CONFIG.courseSlug}/chat/`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CONFIG.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`HTTP ${res.status}: unauthorized`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json(); // { answer: string }
  }

  const NO_INFO_PHRASES = [
    "не знаю", "нет информации", "не нашёл", "не нашел",
    "не нашла", "материалах курса я не нашёл",
    "don't know", "no information", "i don't have", "not found",
    "cannot find", "no answer",
  ];

  function isSubstantial(answer) {
    if (!answer || !answer.trim()) return false;
    const lower = answer.toLowerCase();
    return !NO_INFO_PHRASES.some((p) => lower.includes(p));
  }

  // ---- Main analyze ----

  async function analyze() {
    clearResults();

    if (!CONFIG.courseSlug) {
      return { success: false, error: "No course selected" };
    }

    // Coursera pages get the structured parser; everything else uses generic scan.
    let items;
    if (isCoursera()) {
      // Scroll through the page first to force Coursera to render all questions
      await revealAllQuestions();
      items = scanCourseraDOM();
      // Fallback to generic scanner if not on a quiz page
      if (items.length === 0) {
        items = scanDOM().map((item) => ({
          ...item,
          payload: extractQuestionPayload(item.rawText),
        }));
      }
    } else {
      items = scanDOM().map((item) => ({
        ...item,
        payload: extractQuestionPayload(item.rawText),
      }));
    }

    if (items.length === 0) {
      return { success: true, message: "No elements found", stats: {} };
    }

    const stats = { answered: 0, unknown: 0, error: 0 };
    let authError = null;

    for (let i = 0; i < items.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 500));

      const item = items[i];
      try {
        const data = await askQuestion(item.payload);

        // Re-query after await — Coursera React may have replaced the element
        const el = document.querySelector(`[data-cm-id="${item.id}"]`);
        if (el) {
          el.classList.remove("cm-processing");
          el.removeAttribute("data-cm-id");
        }

        const answer = data.answer || "";
        const substantial = isSubstantial(answer);

        if (substantial && item.optionEls.length > 0) {
          const matched = findMatchingOption(answer, item.optionEls);
          if (matched) {
            markOptionCorrect(matched.el);
            stats.answered++;
          } else {
            // Answer received but no option matched — mark question as failed
            if (el) markQuestionFailed(el);
            stats.unknown++;
          }
        } else {
          stats[substantial ? "answered" : "unknown"]++;
        }
      } catch (err) {
        if (err.message.includes("401") || err.message.includes("403")) {
          authError = err;
          break;
        }
        const el = document.querySelector(`[data-cm-id="${item.id}"]`);
        if (el) {
          el.classList.remove("cm-processing");
          el.removeAttribute("data-cm-id");
        }
        stats.error++;
      }
    }

    document.querySelectorAll(".cm-processing").forEach((el) =>
      el.classList.remove("cm-processing")
    );

    if (authError) {
      return { success: false, error: authError.message };
    }

    return { success: true, stats, total: items.length };
  }

  // ---- Message listener ----

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "analyze") {
      analyze()
        .then(sendResponse)
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.action === "reset") {
      clearResults();
      sendResponse({ success: true });
    }
    if (msg.action === "updateConfig") {
      Object.assign(CONFIG, msg.config);
      sendResponse({ success: true });
    }
  });
})();
