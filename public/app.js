// State
let allConcepts = [];
let selectedConcept = null;
let currentCase = null;
let currentStage = 1;

// DOM Elements
const carouselTrack = document.getElementById("carousel-track");
const carouselTrackContainer = document.querySelector(".carousel-track-container");
const carouselDots = document.getElementById("carousel-dots");
const btnPrev = document.getElementById("carousel-prev");
const btnNext = document.getElementById("carousel-next");

// Stage sections
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

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  initCarousel();
  bindEvents();
});

// 1. Load concepts and render carousel
async function initCarousel() {
  try {
    const res = await fetch("/api/concepts");
    if (!res.ok) throw new Error("Failed to load concepts");
    allConcepts = await res.json();
    renderCarousel(allConcepts);
  } catch (err) {
    console.error(err);
    carouselTrack.innerHTML = `<div class="error-msg">Could not load concepts. Please check your backend.</div>`;
  }
}

function renderCarousel(concepts) {
  carouselTrack.innerHTML = "";
  carouselDots.innerHTML = "";

  concepts.forEach((c, idx) => {
    // Card element
    const card = document.createElement("div");
    card.className = "concept-card";
    card.innerHTML = `
      <div class="card-top">
        <span class="concept-id-tag">${c.ID}</span>
      </div>
      <h3 class="concept-question-title">${c.concept_question}</h3>
      <div class="card-action">Select Concept →</div>
    `;
    card.addEventListener("click", () => selectConcept(c));
    carouselTrack.appendChild(card);

    // Indicator Dot
    const dot = document.createElement("div");
    dot.className = `dot ${idx === 0 ? "active" : ""}`;
    dot.addEventListener("click", () => {
      card.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    });
    carouselDots.appendChild(dot);
  });
}

function selectConcept(concept) {
  selectedConcept = concept;
  
  // Set details on Stage 2 & 3
  document.getElementById("stage2-concept-id").textContent = concept.ID;
  document.getElementById("stage2-concept-title").textContent = concept.concept_question;
  document.getElementById("stage3-concept-id").textContent = concept.ID;

  // Reset inputs
  document.getElementById("initial-explanation-input").value = "";
  document.getElementById("probe-feedback-panel").classList.add("hidden");
  document.getElementById("followup-input").value = "";

  goToStage(2);
}

// 2. Stepper Transition Management
function goToStage(stageNum) {
  currentStage = stageNum;

  // Update sections visibility
  Object.keys(stages).forEach(num => {
    if (parseInt(num) === stageNum) {
      stages[num].classList.remove("hidden");
    } else {
      stages[num].classList.add("hidden");
    }
  });

  // Update Stepper Nav indicators
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

// 3. Stage 2: Socratic Probe Submission
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

  // Jargon / recitation display
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

// 4. Stage 3: Fetch Case and Advance
async function proceedToCaseChallenge() {
  const followupAnswer = document.getElementById("followup-input").value.trim();
  if (!followupAnswer) {
    alert("Please formulate an answer to the Socratic follow-up first.");
    return;
  }

  try {
    const res = await fetch(`/api/case/${selectedConcept.ID}`);
    if (!res.ok) throw new Error("Could not fetch case");
    currentCase = await res.json();

    document.getElementById("case-id-badge").textContent = currentCase.ID;
    document.getElementById("case-scenario-text").textContent = currentCase.case_scenario;
    document.getElementById("case-explanation-input").value = "";

    goToStage(3);
  } catch (err) {
    console.error(err);
    alert("Failed to retrieve challenge case: " + err.message);
  }
}

// 5. Stage 4: Dual Evaluation Submission
async function submitCaseEvaluation() {
  const explanation = document.getElementById("case-explanation-input").value.trim();
  if (!explanation) {
    alert("Please explain your solution or rationale for this case.");
    return;
  }

  const btn = document.getElementById("btn-submit-case");
  setLoading(btn, true);

  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_id: currentCase.ID,
        user_explanation: explanation
      })
    });

    if (!res.ok) throw new Error("Evaluation failed");
    const result = await res.json();
    renderScorecard(result);
    goToStage(4);
  } catch (err) {
    console.error(err);
    alert("Evaluation failed: " + err.message);
  } finally {
    setLoading(btn, false);
  }
}

function renderScorecard(result) {
  const { final_verdict, evaluation_a, evaluation_b } = result;

  // Verdict Banner
  const banner = document.getElementById("verdict-banner");
  const icon = document.getElementById("verdict-icon");
  const title = document.getElementById("verdict-title");
  const subtitle = document.getElementById("verdict-subtitle");

  if (final_verdict) {
    banner.className = "verdict-banner passed";
    icon.textContent = "🏆";
    title.textContent = "Concept Mastered!";
    subtitle.textContent = "Both keyword precision and semantic reasoning criteria satisfied.";
  } else {
    banner.className = "verdict-banner failed";
    icon.textContent = "❌";
    title.textContent = "Revision Needed";
    subtitle.textContent = "One or more evaluation criteria were not satisfied. Review the gaps below.";
  }

  // Evaluation A Card
  const evalAStatus = document.getElementById("eval-a-status");
  evalAStatus.textContent = evaluation_a.passed ? "✅ Passed" : "❌ Failed";
  evalAStatus.className = `status-indicator ${evaluation_a.passed ? "passed" : "failed"}`;

  document.getElementById("eval-a-ratio").textContent = `${evaluation_a.matched_count}/${evaluation_a.total_required}`;

  const matchedTags = document.getElementById("eval-a-matched-tags");
  if (evaluation_a.matched_terms.length > 0) {
    matchedTags.innerHTML = evaluation_a.matched_terms.map(t => `<span class="tag success">${t}</span>`).join("");
  } else {
    matchedTags.innerHTML = `<span class="tag">None matched</span>`;
  }

  const missingBlock = document.getElementById("eval-a-missing-block");
  const missingTags = document.getElementById("eval-a-missing-tags");
  if (evaluation_a.missing_concepts && evaluation_a.missing_concepts.length > 0) {
    missingTags.innerHTML = evaluation_a.missing_concepts.map(t => `<span class="tag missing">${t}</span>`).join("");
    missingBlock.classList.remove("hidden");
  } else {
    missingBlock.classList.add("hidden");
  }

  // Evaluation B Card
  const evalBStatus = document.getElementById("eval-b-status");
  evalBStatus.textContent = evaluation_b.passed ? "✅ Passed" : "❌ Failed";
  evalBStatus.className = `status-indicator ${evaluation_b.passed ? "passed" : "failed"}`;

  document.getElementById("eval-b-reasoning").textContent = evaluation_b.reasoning || "No notes provided.";

  const gapsBlock = document.getElementById("eval-b-gaps-block");
  const gapsList = document.getElementById("eval-b-gaps-list");
  const gaps = evaluation_b.missing_points || [];
  if (gaps.length > 0) {
    gapsList.innerHTML = (Array.isArray(gaps) ? gaps : [gaps]).map(g => `<li>${g}</li>`).join("");
    gapsBlock.classList.remove("hidden");
  } else {
    gapsBlock.classList.add("hidden");
  }
}

// Helper: Loading indicator for buttons
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

// Event Bindings
function bindEvents() {
  // Carousel scroll buttons
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

  // Keep dots updated on manual scroll
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

  // Stage navigation buttons
  document.getElementById("btn-back-to-1").addEventListener("click", () => goToStage(1));
  document.getElementById("btn-submit-initial").addEventListener("click", submitInitialExplanation);
  document.getElementById("btn-proceed-to-case").addEventListener("click", proceedToCaseChallenge);
  document.getElementById("btn-back-to-2").addEventListener("click", () => goToStage(2));
  document.getElementById("btn-submit-case").addEventListener("click", submitCaseEvaluation);

  // Scorecard actions
  document.getElementById("btn-retry-case").addEventListener("click", proceedToCaseChallenge);
  document.getElementById("btn-restart").addEventListener("click", () => goToStage(1));
}
