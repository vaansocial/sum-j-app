// --- STATE MANAGEMENT ---
let allConcepts = [];
let selectedConcept = null;
let currentSessionId = null;
let challengeCases = null;       // { case_1, case_2 }
let currentCaseNumber = 1;       // 1 or 2
let case1Result = null;          // { attempt_id, case_passed, evaluation_a, evaluation_b, identified_gap }
let case2Result = null;          // { attempt_id, case_passed, evaluation_a, evaluation_b, final_verdict }
let currentUser = null;          // { user_id, name, sessions_remaining }
let pendingConcept = null;

// --- DOM ELEMENTS ---
const carouselTrack = document.getElementById("carousel-track");
const carouselTrackContainer = document.querySelector(".carousel-track-container");
const carouselDots = document.getElementById("carousel-dots");
const btnPrev = document.getElementById("carousel-prev");
const btnNext = document.getElementById("carousel-next");

// Stage Sections
const stages = {
  1: document.getElementById("stage-1"),
  2: document.getElementById("stage-2"),
  3: document.getElementById("stage-3"),
  4: document.getElementById("stage-4")
};

// Stepper items
const stepNavs = {
  1: document.getElementById("step-nav-1"),
  2: document.getElementById("step-nav-2"),
  3: document.getElementById("step-nav-3"),
  4: document.getElementById("step-nav-4")
};

// User status elements
const userStatusBadge = document.getElementById("user-status-badge");
const userDisplayName = document.getElementById("user-display-name");
const userSessionsTag = document.getElementById("user-sessions-tag");
const btnSwitchUser = document.getElementById("btn-switch-user");
const btnHeaderLogin = document.getElementById("btn-header-login");

// Auth Modal elements
const authModal = document.getElementById("auth-modal");
const authForm = document.getElementById("auth-form");
const inputAuthUserId = document.getElementById("input-auth-userid");
const inputAuthName = document.getElementById("input-auth-name");
const modalErrorBanner = document.getElementById("modal-error-banner");
const modalErrorText = document.getElementById("modal-error-text");
const btnModalCancel = document.getElementById("btn-modal-cancel");

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initUser();
  initCarousel();
  bindEvents();
});

// 1. User Authentication & Rate Limit Checks
function initUser() {
  const saved = localStorage.getItem("sumj_user");
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      updateUserHeaderUI();
      refreshUserAuth(currentUser.user_id, currentUser.name);
    } catch (e) {
      localStorage.removeItem("sumj_user");
    }
  } else {
    updateUserHeaderUI();
  }
}

async function refreshUserAuth(userId, name) {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, name: name })
    });
    
    if (res.status === 429) {
      const data = await res.json();
      if (currentUser) {
        currentUser.sessions_remaining = 0;
        localStorage.setItem("sumj_user", JSON.stringify(currentUser));
        updateUserHeaderUI();
      }
      return false;
    }
    
    if (!res.ok) throw new Error("Auth failed");
    
    const data = await res.json();
    currentUser = {
      user_id: data.user_id,
      name: data.name,
      sessions_remaining: data.sessions_remaining
    };
    localStorage.setItem("sumj_user", JSON.stringify(currentUser));
    updateUserHeaderUI();
    return true;
  } catch (err) {
    console.error("Auth check error:", err);
    return false;
  }
}

function updateUserHeaderUI() {
  if (currentUser) {
    userDisplayName.textContent = `${currentUser.name} (${currentUser.user_id})`;
    userSessionsTag.textContent = `${currentUser.sessions_remaining}/3 left today`;
    if (currentUser.sessions_remaining <= 0) {
      userSessionsTag.classList.add("limit-reached");
    } else {
      userSessionsTag.classList.remove("limit-reached");
    }
    userStatusBadge.classList.remove("hidden");
    if (btnHeaderLogin) btnHeaderLogin.classList.add("hidden");
  } else {
    userStatusBadge.classList.add("hidden");
    if (btnHeaderLogin) btnHeaderLogin.classList.remove("hidden");
  }
}

function showAuthModal(conceptToSelect = null) {
  pendingConcept = conceptToSelect;
  modalErrorBanner.classList.add("hidden");
  if (currentUser) {
    inputAuthUserId.value = currentUser.user_id;
    inputAuthName.value = currentUser.name;
  }
  authModal.classList.remove("hidden");
  authModal.setAttribute("aria-hidden", "false");
  inputAuthUserId.focus();
}

function hideAuthModal() {
  authModal.classList.add("hidden");
  authModal.setAttribute("aria-hidden", "true");
  pendingConcept = null;
}

function showRateLimitExceeded(message) {
  modalErrorText.textContent = message || "Daily limit reached (3/3 sessions used). Please come back in 24 hours.";
  modalErrorBanner.classList.remove("hidden");
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const userId = inputAuthUserId.value.trim().toLowerCase();
  const name = inputAuthName.value.trim();

  if (!userId || !name) return;

  const btn = document.getElementById("btn-modal-submit");
  setLoading(btn, true);
  modalErrorBanner.classList.add("hidden");

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, name: name })
    });

    const data = await res.json();

    if (res.status === 429) {
      showRateLimitExceeded(data.detail);
      return;
    }

    if (!res.ok) throw new Error(data.detail || "Authentication failed");

    currentUser = {
      user_id: data.user_id,
      name: data.name,
      sessions_remaining: data.sessions_remaining
    };
    localStorage.setItem("sumj_user", JSON.stringify(currentUser));
    updateUserHeaderUI();

    const nextConcept = pendingConcept;
    hideAuthModal();

    if (nextConcept) {
      selectConcept(nextConcept);
    }
  } catch (err) {
    modalErrorText.textContent = err.message;
    modalErrorBanner.classList.remove("hidden");
  } finally {
    setLoading(btn, false);
  }
}

// 2. Load concepts and render carousel from Supabase
async function initCarousel() {
  try {
    const res = await fetch("/api/concepts");
    if (!res.ok) throw new Error("Failed to load concepts");
    allConcepts = await res.json();
    renderCarousel(allConcepts);
  } catch (err) {
    console.error(err);
    carouselTrack.innerHTML = `<div class="error-msg">Could not load concepts from Supabase. Check backend credentials.</div>`;
  }
}

function renderCarousel(concepts) {
  carouselTrack.innerHTML = "";
  carouselDots.innerHTML = "";

  concepts.forEach((c, idx) => {
    const card = document.createElement("div");
    card.className = "concept-card";
    card.innerHTML = `
      <div class="card-top">
        <span class="concept-id-tag">${c.ID}</span>
      </div>
      <h3 class="concept-question-title">${c.concept_question}</h3>
      <div class="card-action">Select Concept →</div>
    `;
    card.addEventListener("click", () => {
      if (!currentUser) {
        showAuthModal(c);
      } else {
        selectConcept(c);
      }
    });
    carouselTrack.appendChild(card);

    const dot = document.createElement("div");
    dot.className = `dot ${idx === 0 ? "active" : ""}`;
    dot.addEventListener("click", () => {
      card.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    });
    carouselDots.appendChild(dot);
  });
}

// 3. Concept Selection & Start Session
async function selectConcept(concept) {
  selectedConcept = concept;
  currentSessionId = null;
  challengeCases = null;
  currentCaseNumber = 1;
  case1Result = null;
  case2Result = null;

  // Immediate rate limit check
  if (currentUser && currentUser.sessions_remaining <= 0) {
    showAuthModal(concept);
    showRateLimitExceeded("Daily limit reached (3/3 sessions used). Please come back in 24 hours.");
    return;
  }

  // Set details on Stage 2 & 3
  document.getElementById("stage2-concept-id").textContent = concept.ID;
  document.getElementById("stage2-concept-title").textContent = concept.concept_question;
  document.getElementById("stage3-concept-id").textContent = concept.ID;
  document.getElementById("stage3-concept-title").textContent = concept.concept_question;

  // Reset inputs
  document.getElementById("initial-explanation-input").value = "";
  document.getElementById("probe-feedback-panel").classList.add("hidden");
  document.getElementById("followup-input").value = "";

  // Create review session row in Supabase
  try {
    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: currentUser.user_id,
        concept_id: concept.ID
      })
    });
    
    if (res.status === 429) {
      const data = await res.json();
      if (currentUser) {
        currentUser.sessions_remaining = 0;
        localStorage.setItem("sumj_user", JSON.stringify(currentUser));
        updateUserHeaderUI();
      }
      showAuthModal(concept);
      showRateLimitExceeded(data.detail);
      return;
    }
    
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Failed to start review session");
    }

    const data = await res.json();
    currentSessionId = data.session_id;
    goToStage(2);
  } catch (err) {
    console.error("Could not initialize session:", err);
    alert("Could not start session: " + err.message);
  }
}

// 4. Stepper Navigation
function goToStage(stageNum) {
  Object.keys(stages).forEach(num => {
    if (parseInt(num) === stageNum) {
      stages[num].classList.remove("hidden");
    } else {
      stages[num].classList.add("hidden");
    }
  });

  Object.keys(stepNavs).forEach(num => {
    const n = parseInt(num);
    const nav = stepNavs[n];
    nav.classList.remove("active", "completed");
    if (n === stageNum) {
      nav.classList.add("active");
    } else if (n < stageNum) {
      nav.classList.add("completed");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 5. Stage 2: Socratic Probe Submission
async function submitInitialExplanation() {
  const explanation = document.getElementById("initial-explanation-input").value.trim();
  if (!explanation) {
    alert("Please provide your explanation first.");
    return;
  }

  const btn = document.getElementById("btn-submit-initial");
  setLoading(btn, true);

  try {
    const res = await fetch("/api/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentSessionId,
        user_id: currentUser.user_id,
        concept_id: selectedConcept.ID,
        concept_question: selectedConcept.concept_question,
        user_explanation: explanation
      })
    });

    if (!res.ok) throw new Error("Probe analysis failed");
    const data = await res.json();
    displayProbeFeedback(data);
  } catch (err) {
    console.error(err);
    alert("Error communicating with SumJ engine: " + err.message);
  } finally {
    setLoading(btn, false);
  }
}

function displayProbeFeedback(data) {
  const panel = document.getElementById("probe-feedback-panel");
  const jargonBox = document.getElementById("jargon-container");
  const jargonTags = document.getElementById("jargon-tags");
  const critiqueText = document.getElementById("critique-text");
  const socraticText = document.getElementById("socratic-question-text");

  const recitations = data.detected_recitation || [];
  if (recitations.length > 0) {
    jargonTags.innerHTML = recitations.map(r => `<span class="tag warning">${r}</span>`).join("");
    jargonBox.classList.remove("hidden");
  } else {
    jargonBox.classList.add("hidden");
  }

  critiqueText.textContent = data.critique || "Review your core mechanism.";
  socraticText.textContent = data.follow_up_question || "How does the system behave without this component?";

  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth" });
}

// 6. Transition from Socratic Probe to Two-Case Challenge
async function proceedToDualCaseChallenge() {
  const followupAnswer = document.getElementById("followup-input").value.trim();
  if (!followupAnswer) {
    alert("Please formulate an answer to the Socratic follow-up first.");
    return;
  }

  const btn = document.getElementById("btn-proceed-to-case");
  setLoading(btn, true);

  try {
    // Record socratic response in Supabase
    await fetch("/api/session/followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentSessionId,
        socratic_response: followupAnswer
      })
    });

    // Fetch 2 distinct cases from Supabase
    const casesRes = await fetch(`/api/cases/${selectedConcept.ID}`);
    if (!casesRes.ok) throw new Error("Could not fetch challenge cases");
    challengeCases = await casesRes.json();

    // Prepare UI for Case 1
    currentCaseNumber = 1;
    loadCaseUI(1);
    goToStage(3);
  } catch (err) {
    console.error(err);
    alert("Failed to load challenge cases: " + err.message);
  } finally {
    setLoading(btn, false);
  }
}

// 7. Render Case 1 or Case 2 UI
function loadCaseUI(caseNum) {
  currentCaseNumber = caseNum;
  const currentCase = (caseNum === 1) ? challengeCases.case_1 : challengeCases.case_2;

  // Indicators
  document.getElementById("case-progress-indicator").textContent = `Case ${caseNum} of 2`;
  document.getElementById("case-id-badge").textContent = `CASE ${caseNum} · ${currentCase.ID}`;
  document.getElementById("case-subtext-label").textContent = `Real-World Engineering Scenario (${caseNum} of 2)`;
  document.getElementById("case-scenario-text").textContent = currentCase.case_scenario;
  document.getElementById("case-input-heading").textContent = `Explain the Rationale / Solution for Case ${caseNum}:`;
  document.getElementById("btn-submit-case-text").textContent = (caseNum === 1) 
    ? "Submit Case 1 Evaluation" 
    : "Submit Case 2 & Final Evaluation";

  // Reset inputs & hide interim cards
  document.getElementById("case-explanation-input").value = "";
  document.getElementById("case-input-container").classList.remove("hidden");
  document.getElementById("interim-feedback-panel").classList.add("hidden");

  // Show gap context on Case 2 if Case 1 identified a gap (Proof Link Context)
  const gapBanner = document.getElementById("case2-gap-banner");
  if (caseNum === 2 && case1Result && case1Result.identified_gap) {
    document.getElementById("case2-gap-instruction").textContent = 
      `In Case 1, a conceptual gap was identified: "${case1Result.identified_gap}". Make sure your rationale for Case 2 explicitly addresses this constraint!`;
    gapBanner.classList.remove("hidden");
  } else {
    gapBanner.classList.add("hidden");
  }
}

// 8. Submit Case Evaluation (Case 1 or Case 2)
async function submitCaseEvaluation() {
  const explanation = document.getElementById("case-explanation-input").value.trim();
  if (!explanation) {
    alert("Please explain your solution or rationale for this case.");
    return;
  }

  const btn = document.getElementById("btn-submit-case");
  setLoading(btn, true);

  const currentCase = (currentCaseNumber === 1) ? challengeCases.case_1 : challengeCases.case_2;
  const proofLinkAttemptId = (currentCaseNumber === 2 && case1Result) ? case1Result.attempt_id : null;

  try {
    const res = await fetch("/api/evaluate-case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentSessionId,
        user_id: currentUser.user_id,
        concept_id: selectedConcept.ID,
        case_id: currentCase.ID,
        try_number: currentCaseNumber,
        user_explanation: explanation,
        closing_gap_from_attempt_id: proofLinkAttemptId // PROOF LINK: retry -> gap
      })
    });

    if (!res.ok) throw new Error("Evaluation failed");
    const result = await res.json();

    if (currentCaseNumber === 1) {
      case1Result = result;
      // Show interim feedback card
      document.getElementById("case-input-container").classList.add("hidden");
      const interimPanel = document.getElementById("interim-feedback-panel");
      const interimBadge = document.getElementById("interim-status-badge");
      const interimSummary = document.getElementById("interim-summary");

      if (result.case_passed) {
        interimBadge.textContent = "✅ Case 1 Passed";
        interimBadge.className = "status-indicator passed";
        interimSummary.textContent = "Strong explanation! Both keyword alignment and semantic reasoning satisfied. Proceed to Case 2 to complete concept mastery.";
      } else {
        interimBadge.textContent = "❌ Case 1 Needs Revision";
        interimBadge.className = "status-indicator failed";
        interimSummary.textContent = `A conceptual gap was identified: "${result.identified_gap}". You will now tackle Case 2—use it to demonstrate that this gap is closed!`;
      }

      // Populate detailed interim breakdown
      const evalAStatus = document.getElementById("interim-evalA-status");
      if (evalAStatus) {
        evalAStatus.textContent = `${result.evaluation_a.matched_count}/${result.evaluation_a.total_required} groups`;
        evalAStatus.className = result.evaluation_a.passed ? "status-indicator passed" : "status-indicator failed";
      }

      const interimTags = document.getElementById("interim-tags");
      if (interimTags) {
        const matched = (result.evaluation_a.matched_terms || []).map(t => `<span class="tag success">✓ ${t}</span>`).join("");
        const missing = (result.evaluation_a.missing_concepts || []).map(m => `<span class="tag missing">✗ ${m}</span>`).join("");
        interimTags.innerHTML = (matched || missing) ? (matched + missing) : `<span class="tag">No keywords matched</span>`;
      }

      const evalBStatus = document.getElementById("interim-evalB-status");
      if (evalBStatus) {
        evalBStatus.textContent = result.evaluation_b.passed ? "Passed" : "Needs Revision";
        evalBStatus.className = result.evaluation_b.passed ? "status-indicator passed" : "status-indicator failed";
      }

      const interimNotes = document.getElementById("interim-notes");
      if (interimNotes) {
        interimNotes.textContent = result.evaluation_b.reasoning || "Evaluation complete.";
      }

      interimPanel.classList.remove("hidden");
      interimPanel.scrollIntoView({ behavior: "smooth" });
    } else {
      // Case 2 evaluated -> Advance to Final Scorecard
      case2Result = result;
      renderDualScorecard();
      goToStage(4);
    }
  } catch (err) {
    console.error(err);
    alert("Evaluation error: " + err.message);
  } finally {
    setLoading(btn, false);
  }
}

// 9. Stage 4: Render Final Combined Scorecard
function renderDualScorecard() {
  const finalVerdict = case2Result.final_verdict;

  // Final Banner
  const banner = document.getElementById("verdict-banner");
  const icon = document.getElementById("verdict-icon");
  const title = document.getElementById("verdict-title");
  const subtitle = document.getElementById("verdict-subtitle");

  if (finalVerdict) {
    banner.className = "verdict-banner passed";
    icon.textContent = "🏆";
    title.textContent = "Concept Mastered!";
    subtitle.textContent = "Both Case 1 and Case 2 passed with verified vocabulary alignment and sound semantic causality.";
  } else {
    banner.className = "verdict-banner failed";
    icon.textContent = "❌";
    title.textContent = "Mastery Incomplete";
    subtitle.textContent = "Both cases must pass to master the concept. Review the examiner notes and gaps below.";
  }

  // Populate Case 1 Card
  document.getElementById("scorecard-case1-badge").textContent = `CASE 1 · ${challengeCases.case_1.ID}`;
  const c1Status = document.getElementById("scorecard-case1-status");
  c1Status.textContent = case1Result.case_passed ? "✅ Passed" : "❌ Failed";
  c1Status.className = `status-indicator ${case1Result.case_passed ? "passed" : "failed"}`;
  document.getElementById("scorecard-case1-scenario").textContent = challengeCases.case_1.case_scenario;
  document.getElementById("scorecard-case1-evalA").textContent = `${case1Result.evaluation_a.matched_count}/${case1Result.evaluation_a.total_required} groups`;
  
  const c1Tags = document.getElementById("scorecard-case1-tags");
  const c1Matched = (case1Result.evaluation_a.matched_terms || []).map(t => `<span class="tag success">✓ ${t}</span>`).join("");
  const c1Missing = (case1Result.evaluation_a.missing_concepts || []).map(m => `<span class="tag missing">✗ ${m}</span>`).join("");
  c1Tags.innerHTML = (c1Matched || c1Missing) ? (c1Matched + c1Missing) : `<span class="tag">No keywords matched</span>`;

  document.getElementById("scorecard-case1-evalB").textContent = case1Result.evaluation_b.passed ? "Passed" : "Needs Revision";
  document.getElementById("scorecard-case1-notes").textContent = case1Result.evaluation_b.reasoning || "No notes.";

  // Populate Case 2 Card
  document.getElementById("scorecard-case2-badge").textContent = `CASE 2 · ${challengeCases.case_2.ID}`;
  const c2Status = document.getElementById("scorecard-case2-status");
  c2Status.textContent = case2Result.case_passed ? "✅ Passed" : "❌ Failed";
  c2Status.className = `status-indicator ${case2Result.case_passed ? "passed" : "failed"}`;
  document.getElementById("scorecard-case2-scenario").textContent = challengeCases.case_2.case_scenario;
  document.getElementById("scorecard-case2-evalA").textContent = `${case2Result.evaluation_a.matched_count}/${case2Result.evaluation_a.total_required} groups`;
  
  const c2Tags = document.getElementById("scorecard-case2-tags");
  const c2Matched = (case2Result.evaluation_a.matched_terms || []).map(t => `<span class="tag success">✓ ${t}</span>`).join("");
  const c2Missing = (case2Result.evaluation_a.missing_concepts || []).map(m => `<span class="tag missing">✗ ${m}</span>`).join("");
  c2Tags.innerHTML = (c2Matched || c2Missing) ? (c2Matched + c2Missing) : `<span class="tag">No keywords matched</span>`;

  document.getElementById("scorecard-case2-evalB").textContent = case2Result.evaluation_b.passed ? "Passed" : "Needs Revision";
  document.getElementById("scorecard-case2-notes").textContent = case2Result.evaluation_b.reasoning || "No notes.";

  // Refresh remaining sessions counter
  if (currentUser) {
    refreshUserAuth(currentUser.user_id, currentUser.name);
  }
}

// 10. Helper: Button Loading Spinner
function setLoading(button, isLoading) {
  const text = button.querySelector(".btn-text");
  const spinner = button.querySelector(".btn-spinner");
  if (isLoading) {
    button.disabled = true;
    if (spinner) spinner.classList.remove("hidden");
  } else {
    button.disabled = false;
    if (spinner) spinner.classList.add("hidden");
  }
}

// 11. Event Bindings
function bindEvents() {
  // Carousel arrows
  btnPrev.addEventListener("click", () => {
    const card = carouselTrack.querySelector(".concept-card");
    const scrollDist = card ? (card.offsetWidth + 16) : 340;
    carouselTrackContainer.scrollBy({ left: -scrollDist, behavior: "smooth" });
  });
  btnNext.addEventListener("click", () => {
    const card = carouselTrack.querySelector(".concept-card");
    const scrollDist = card ? (card.offsetWidth + 16) : 340;
    carouselTrackContainer.scrollBy({ left: scrollDist, behavior: "smooth" });
  });

  // Carousel dot sync
  carouselTrackContainer.addEventListener("scroll", () => {
    const cards = carouselTrack.querySelectorAll(".concept-card");
    const dots = carouselDots.querySelectorAll(".dot");
    const scrollPos = carouselTrackContainer.scrollLeft;

    cards.forEach((card, index) => {
      if (Math.abs(card.offsetLeft - scrollPos) < (card.offsetWidth / 2 + 20)) {
        dots.forEach((d, i) => d.classList.toggle("active", i === index));
      }
    });
  }, { passive: true });

  // Auth modal & header login events
  authForm.addEventListener("submit", handleAuthSubmit);
  btnModalCancel.addEventListener("click", hideAuthModal);
  btnSwitchUser.addEventListener("click", () => showAuthModal(null));
  if (btnHeaderLogin) {
    btnHeaderLogin.addEventListener("click", () => showAuthModal(null));
  }

  // Stage 2 events
  document.getElementById("btn-back-to-1").addEventListener("click", () => goToStage(1));
  document.getElementById("btn-submit-initial").addEventListener("click", submitInitialExplanation);
  document.getElementById("btn-proceed-to-case").addEventListener("click", proceedToDualCaseChallenge);

  // Stage 3 events
  document.getElementById("btn-back-to-2").addEventListener("click", () => goToStage(2));
  document.getElementById("btn-submit-case").addEventListener("click", submitCaseEvaluation);
  document.getElementById("btn-advance-to-case2").addEventListener("click", () => loadCaseUI(2));

  // Stage 4 Scorecard events
  document.getElementById("btn-retry-concept").addEventListener("click", () => {
    if (selectedConcept) selectConcept(selectedConcept);
  });
  document.getElementById("btn-restart").addEventListener("click", () => goToStage(1));
}
